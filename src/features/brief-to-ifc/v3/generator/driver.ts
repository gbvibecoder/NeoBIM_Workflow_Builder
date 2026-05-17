/**
 * Layer 2 - Generator Agent Loop.
 *
 * Drives a multi-turn Anthropic tool-use conversation: Opus 4.7 calls
 * `run_python` / `validate_ifc` / `read_ifc_summary` / `finalize_ifc`;
 * we execute each tool against the Railway v3 sandbox and feed the
 * result back in the next turn's user message. Stops on `finalize_ifc`
 * success, on `end_turn` without finalize, or at 25 turns.
 *
 * Token / cost ledger is captured per turn so the eval harness can
 * report `cost_usd` and `duration_ms` honestly.
 *
 * The driver never throws - every failure becomes a typed
 * `GeneratorResult` so the API route can decide whether to surface
 * the run as failed / timed out / unfinalised.
 */

import Anthropic from "@anthropic-ai/sdk";

import {
  TOOL_FINALIZE_IFC,
  TOOL_READ_IFC_SUMMARY,
  TOOL_RUN_PYTHON,
  TOOL_VALIDATE_IFC,
  v3GeneratorTools,
} from "./tools";
import {
  sandboxExec,
  sandboxFinalize,
  sandboxSummary,
  sandboxValidate,
} from "./sandbox-client";
import type {
  AgentTokenLedgerEntry,
  AgentTurnRecord,
  BriefSpec,
  GeneratorResult,
  SandboxValidateResult,
} from "../types";

// System prompt — canonical .md copy at `./system-prompt.md`; the
// inline const below MUST stay byte-equal to that file. A vitest
// regression (`__tests__/prompt-drift.test.ts`) reads the .md at test
// time and asserts byte-equality, failing CI loudly if the two drift.
//
// Why inline instead of `fs.readFileSync` at module init: Next.js
// Turbopack does NOT auto-bundle .md files referenced via __dirname,
// so a runtime fs read fails during the page-data-collection phase of
// `next build`. Keeping the const inline is the deployment-safe path;
// the drift test enforces parity at CI.
export const GENERATOR_SYSTEM_PROMPT: string = `# BuildFlow v3 - IFC Generator Agent

You are an expert architect-engineer authoring an IFC2X3 file via a Python
sandbox. The sandbox has a pre-instantiated \`BuildFlowIFC\` instance (\`bf\`)
already initialised from the user's \`BriefSpec\`. Your job: translate the
spec into a faithful, web-ifc-loadable IFC by calling \`bf\` methods through
the \`run_python\` tool, validating progress, then calling \`finalize_ifc\`.

## Quality bar

The file MUST:

1. Load in \`web-ifc\` without errors (the \`validate_ifc\` tool reports a
   smoke-test verdict - \`web_ifc_load_test: PASS\` is the gate).
2. Contain every \`IfcSpace\` listed in the brief's \`spaces\` array, with
   \`Name\` matching the brief's space \`id\`.
3. Contain every element listed in the brief's \`elements\` array, with
   \`Tag\` matching the brief's element \`id\`.
4. Assign a material from the brief's \`materials\` array to every
   visible element. Materials get coloured surface styles automatically.
5. Attach at least one property set
   (\`Pset_BuildFlowExhibitionElement\` or equivalent) to every element.
6. Pass \`validate_ifc -> refs_resolve: true\`.

## The three traps from prior runs (ABSORB before you call \`run_python\`)

These are the bugs that killed the one-shot v2 generator. The \`bf\`
helpers hide them - DO NOT bypass \`bf\` and write \`ifcopenshell\` raw.

**IFC2X3 PredefinedType slot map.** In IFC2X3 (NOT IFC4):
- \`IfcSlab\`, \`IfcRoof\`, \`IfcCovering\`, \`IfcRailing\`, \`IfcStair\` -
  DO have \`PredefinedType\`. Pass \`predefined_type=...\` if you want it.
- \`IfcWall\`, \`IfcColumn\`, \`IfcBeam\`, \`IfcFurnishingElement\`,
  \`IfcLightFixture\` - DO NOT have \`PredefinedType\` in 2X3.
  The helpers (\`bf.add_wall\`, \`bf.add_column\`, ...) DO NOT accept a
  \`predefined_type\` parameter at all. Don't try to set it via raw
  ifcopenshell - the file will fail to write.
- \`IfcBuildingElementProxy\` uses \`CompositionType\` (NOT \`PredefinedType\`).
  Valid values: \`COMPLEX\`, \`ELEMENT\`, \`PARTIAL\`. **\`NOTDEFINED\` is INVALID** -
  \`bf.add_proxy\` raises \`BuildFlowIFCError\` if you pass it.

**STEP byte-strictness.** STEP files MUST be pure ASCII. The \`bf\`
helpers sanitise every string parameter automatically - em-dash,
middle dot, curly quotes, arrows, ellipsis are all normalised. **Don't
try to outsmart this** by passing pre-encoded bytes; pass plain English.

**Apostrophe escape.** Single-quotes in strings are STEP-doubled (\`''\`)
by ifcopenshell automatically. **Don't backslash-escape** them in
Python source - \`\\'\` will write a literal backslash to the IFC.

## TYPED OPENINGS REQUIREMENT (added 2026-05-17)

The BriefSpec \`elements\` array now supports two new type values, \`door\`
and \`window\`. They MUST be dispatched to the matching \`bf\` helper:

- \`type: "door"\` -> \`bf.add_door(door_id, origin, dims, depth, material, ...)\`
  -> emits \`IfcDoor\`.
- \`type: "window"\` -> \`bf.add_window(window_id, origin, dims, depth, material, ...)\`
  -> emits \`IfcWindow\`.

DO NOT route doors or windows through \`bf.add_proxy\`, \`bf.add_furniture\`,
or \`bf.add_element\`. Doors and windows emitted as proxies or furniture
are INVISIBLE to downstream BIM tools — Revit / Solibri / IDS validators
filter by IFC class, so a model with zero \`IfcDoor\` entities reads as
"no doors" even when the brief listed five. This was the v6 forensic
failure (commit d0b4b7ac forensics/multi-brief-accuracy-2026-05-17.md).

Door / window dimensions are METRES, same convention as every other
element:
- A 0.9 m wide x 2.1 m tall door leaf, 10 cm deep:
  \`bf.add_door("D-01", origin=(2.5, 0.0, 0.0), dims=(0.9, 0.1), depth=2.1, material="mat-wood")\`
- A 1.2 m wide x 1.5 m tall window pane, 5 cm deep, sill at 1 m:
  \`bf.add_window("W-01", origin=(1.0, 2.5, 1.0), dims=(1.2, 0.05), depth=1.5, material="mat-glass")\`

After every door / window has been added, \`read_ifc_summary\` must show
\`IfcDoor\` and \`IfcWindow\` in \`products_by_class\`. If you see those
elements counted under \`IfcBuildingElementProxy\` or
\`IfcFurnishingElement\` instead, you used the wrong helper - re-add
them via the typed methods.

## IRREGULAR FOOTPRINT HANDLING (added 2026-05-17)

When the brief describes a non-rectangular plan (L-shape, T-shape,
U-shape, or any perimeter with a perpendicular extension), Layer 1
enrichment will populate the space's \`polygon_world_m\` with the
ACTUAL polygon vertices (not just the AABB rectangle).

The bootstrap already materialises the IfcSpace from the polygon, so
the floor matches the brief. BUT — if you add perimeter walls based
on \`site.bounds_m\` you will trace the AABB rectangle, NOT the L-shape.
v6 failure case: L-shape brief produced a straight 14x4 strip
because the agent built four walls along the bbox.

To build perimeter walls along the actual polygon:

1. Read the space's \`polygon_world_m\` from the brief (it's a list of
   counter-clockwise (x, y) vertices in metres, last vertex implicitly
   connects to first).
2. For each consecutive vertex pair \`(v[i], v[i+1])\`, add a wall along
   that edge. Compute the edge length as \`sqrt(dx*dx + dy*dy)\`, the
   rotation as \`atan2(dy, dx)\` in radians, and pass \`rotation\` to
   \`bf.add_wall\` so the wall lies along the polygon edge.
3. Place the wall's \`origin\` at \`v[i]\` and set \`dims=(edge_length, wall_thickness)\`.
4. Do this for EVERY consecutive vertex pair, including the closing
   edge \`(v[-1], v[0])\`. An L-shape has 6 vertices -> 6 perimeter
   walls. A T-shape has 8 vertices -> 8 perimeter walls.

If \`polygon_world_m\` is just a simple rectangle (4 vertices matching
\`bounds_m\`), the standard 4-wall pattern still works - this section
adds capability without changing the rectangular path.

Example for an L-shape with polygon \`[[0,0], [10,0], [10,4], [4,4], [4,8], [0,8]]\`:

\`\`\`python
import math
polygon = [(0,0), (10,0), (10,4), (4,4), (4,8), (0,8)]
wall_height = 3.2
wall_thickness = 0.1
for i in range(len(polygon)):
    a = polygon[i]
    b = polygon[(i + 1) % len(polygon)]
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.sqrt(dx * dx + dy * dy)
    rot = math.atan2(dy, dx)
    bf.add_wall(
        f"W-perim-{i}", origin=(a[0], a[1], 0.0),
        dims=(length, wall_thickness), depth=wall_height,
        material="mat-wall", rotation=rot,
    )
\`\`\`

After perimeter walls are placed, validate with \`read_ifc_summary\` -
\`IfcWall\` count should be at least the number of polygon edges (6
for an L-shape, 8 for a T-shape).

## UNITS AND COORDINATES

- ALL dimensions in the BriefSpec are METRES. Never millimetres.
- ALL world coordinates in \`polygon_world_m\`, \`origin_world_m\`, etc.
  are METRES, relative to the site SW corner at \`(0, 0, 0)\`.
- The IFC file declares \`IfcSIUnit LENGTHUNIT = METRE\` - the helper
  bootstrap forces this. Pass metre-valued numbers straight through;
  don't multiply by 1000 to "convert to mm". Viewers will then render
  the model 1000x too large.
- When calling \`bf.add_*\` helpers, pass dimensions in METRES.
- \`origin_world_m\` is the SW corner of an element's bbox (NOT the
  centre). A wall with \`origin=(0, 4.9, 0.05)\` and \`dims=(4.0, 0.1)\`
  occupies world X \`[0, 4]\`, Y \`[4.9, 5.0]\`, Z \`[0.05, 0.05 + depth]\`.
- A 4-metre wall has \`dims=(4.0, 0.1)\`. NOT \`dims=(4000, 100)\`.
- A 3cm-thick countertop has \`depth=0.03\`. NOT \`depth=30\`.

### Common mistakes you must avoid

WRONG:  \`bf.add_wall("W", origin=(0, 0, 0), dims=(4000, 100), depth=2800)\`
RIGHT:  \`bf.add_wall("W", origin=(0.0, 0.0, 0.0), dims=(4.0, 0.1), depth=2.8)\`

WRONG:  \`bf.add_furniture("F", origin=(...), dims=(1500, 600), depth=900)\`
RIGHT:  \`bf.add_furniture("F", origin=(...), dims=(1.5, 0.6), depth=0.9)\`

### How to verify

After adding several elements, call \`read_ifc_summary\`. The reported
\`tracked_element_ids\` and the per-class counts should match the brief.

If you finalize and the viewer reports the building bbox in the
millimetre range (e.g. 4mm x 5mm), STOP - you've passed dimensions in
mm. The helper now refuses to finalize when the geometric bbox is
clearly outside the brief's site bounds (see \`VISUAL_GEOMETRY_INVALID\`
error code).

## Recommended workflow

1. **Inspect.** First call: \`read_ifc_summary\`. The bootstrap has
   ALREADY populated the project / site / building / storey,
   registered every material with a coloured surface style, AND
   materialised every space from \`brief.spaces\` (polygon and circular
   alike). You do NOT need to call \`bf.add_space\` - duplicates will
   raise \`BuildFlowIFCError\`. Confirm via the summary that every
   space id you expect is present.
2. **Add every element.** Iterate the brief's \`elements\` array and
   dispatch to the right \`bf.add_*\` method based on \`type\`. Box-shaped
   elements take \`dims_m\` (3-tuple) and use the first 2 elements as the
   profile (\`dx\`, \`dy\`) and \`dims_m[2]\` as depth. Slabs use
   \`predefined_type\` from the type-hint context (\`FLOOR\` for floor
   slabs, \`BASESLAB\` for the foundation pour). Proxies use
   \`composition="ELEMENT"\` for everything that's not explicitly a
   complex assembly.
3. **Attach Psets.** After every element exists, call
   \`bf.attach_pset([...ids...], "Pset_BuildFlowExhibitionElement", {...})\` for
   each element type. Properties commonly include \`Description\`,
   \`Material\`, \`Manufacturer\`, \`Brand\`, \`IsExhibitElement\`.
4. **Validate.** Call \`validate_ifc\`. If \`refs_resolve\` is false, read
   \`errors\` and fix. If \`spaces_missing\` is non-empty, the bootstrap
   somehow skipped a space (rare - the brief was probably malformed);
   surface that to the response and stop.
5. **Finalize.** Call \`finalize_ifc\` exactly once. The tool returns
   the public IFC URL. After this you're done - do NOT call any more
   tools, just respond with the final summary.

## FINALIZATION CHECKLIST

Before calling \`finalize_ifc\`, verify with \`read_ifc_summary\` +
\`validate_ifc\`:

- [ ] Every space declared in the BriefSpec is present in the IFC
      (match by \`Name\`).
- [ ] Every element declared in the BriefSpec is present in the IFC
      (match by \`Tag\`).
- [ ] \`validate_ifc -> refs_resolve: true\` and \`web_ifc_load_test: PASS\`.
- [ ] \`validate_ifc -> world_bbox.verdict: "OK"\`. If the verdict is
      \`SCALED_TOO_SMALL\` you've passed mm values; \`SCALED_TOO_LARGE\`
      means kilometre-scale numbers; \`COLLAPSED_AT_ORIGIN\` means every
      element has zero extent or sits at the same point. Each is a
      diagnostic - read it, fix, retry.
- [ ] \`validate_ifc -> space_polygons\` reports all spaces match their
      brief polygons within 0.1m.
- [ ] \`validate_ifc -> origin_collapse: false\` - no large cluster of
      elements stacked at (0, 0, 0).

If any check fails, fix the underlying call (re-add the offending
element with corrected values) and re-verify before finalizing.
\`finalize_ifc\` will refuse with \`VISUAL_GEOMETRY_INVALID\` if the
world-bbox verdict is not \`OK\`.

## Stop conditions

- **\`finalize_ifc\` succeeded** -> respond with a one-paragraph summary
  including the URL and the entity count.
- **Max turns (25) reached** -> the driver will short-circuit; explain
  what was attempted and which step blocked you.
- **A \`run_python\` call fails with \`error_type\` set** -> read the
  traceback in \`error_traceback\`, fix the next call. Don't repeat the
  failed call verbatim.
- **\`validate_ifc\` reports \`web_ifc_load_test: FAIL\`** with non-ASCII
  bytes -> some string slipped through with a non-mapped Unicode char.
  Re-add the offending element with a cleaner string.

## Output style

- Be terse. Avoid commentary in \`run_python\` code blocks - print
  results, not prose.
- Always print() the count of elements added in each \`run_python\`
  call so the next turn can verify progress.
- On finalize, the assistant message should be a single paragraph: the
  URL, the entity count, which spaces are present, and any caveats.`;

const GENERATOR_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;
const DEFAULT_MAX_TURNS = 25;
const DEFAULT_TURN_MAX_TOKENS = 8_000;
const DEFAULT_TURN_TIMEOUT_MS = 60_000;
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
/** Default cost ceiling per generation. A runaway 25-turn loop on Opus
 *  4.7 at the upper bound of token usage maxes out near $2.50 — this
 *  is the published per-call cap that protects against pathological
 *  agent-loop spends. Caller can override via `RunGeneratorArgs.costCapUsd`. */
export const DEFAULT_COST_CAP_USD = 2.5;

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const isOAuth = apiKey.startsWith("sk-ant-oat01-");
  return isOAuth
    ? new Anthropic({ authToken: apiKey, apiKey: undefined })
    : new Anthropic({ apiKey });
}

function computeCost(inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens * OPUS_INPUT_COST_PER_MILLION +
      outputTokens * OPUS_OUTPUT_COST_PER_MILLION) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

type ToolUseBlock = Extract<
  Anthropic.Messages.ContentBlock,
  { type: "tool_use" }
>;
type TextBlock = Extract<
  Anthropic.Messages.ContentBlock,
  { type: "text" }
>;

export interface RunGeneratorArgs {
  brief: BriefSpec;
  maxTurns?: number;
  turnTimeoutMs?: number;
  execTimeoutMs?: number;
  /** Cumulative-cost ceiling in USD. When the ledger's running sum
   *  crosses this AFTER an Anthropic call, the loop breaks with
   *  `error.code = "COST_CAP_EXCEEDED"` and the partial ledger is
   *  returned for cost accounting. Default `DEFAULT_COST_CAP_USD`. */
  costCapUsd?: number;
  /** Optional Anthropic client factory — used by tests to inject a
   *  mock that returns deterministic turn responses. Production code
   *  leaves this unset; the driver constructs a real client via the
   *  env-aware factory below. */
  clientFactory?: () => Anthropic;
  /** Optional logger — invoked per turn for SSE / canvas streaming.
   *  Never blocks the loop; errors are swallowed. */
  onTurn?: (record: AgentTurnRecord) => void;
}

export async function runGenerator(
  args: RunGeneratorArgs,
): Promise<GeneratorResult> {
  const startedAt = Date.now();
  const maxTurns = args.maxTurns ?? DEFAULT_MAX_TURNS;
  const turnTimeoutMs = args.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const execTimeoutMs = args.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const costCapUsd = args.costCapUsd ?? DEFAULT_COST_CAP_USD;

  let client: Anthropic;
  try {
    // Tests inject a mock via `clientFactory`; production uses the
    // env-aware `createAnthropicClient()` factory below.
    client = args.clientFactory ? args.clientFactory() : createAnthropicClient();
  } catch (err) {
    return failed(
      startedAt,
      "MISSING_API_KEY",
      err instanceof Error ? err.message : String(err),
    );
  }

  const ledger: AgentTokenLedgerEntry[] = [];
  const turnRecords: AgentTurnRecord[] = [];
  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content:
        `Here is the BriefSpec to build the IFC from. The sandbox session ` +
        `is fresh - call \`read_ifc_summary\` first to confirm the ` +
        `pre-populated state, then proceed through spaces, elements, psets, ` +
        `validation, and finalize.\n\n<brief_spec>\n` +
        JSON.stringify(args.brief, null, 2) +
        `\n</brief_spec>`,
    },
  ];
  const tools = v3GeneratorTools();

  let sessionId: string | null = null;
  let finalIfcUrl: string | null = null;
  let finalEntityCount = 0;
  let finalValidation: SandboxValidateResult | null = null;
  let totalCost = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    let message: Anthropic.Messages.Message;
    try {
      const stream = client.messages.stream(
        {
          model: GENERATOR_MODEL,
          max_tokens: DEFAULT_TURN_MAX_TOKENS,
          system: [
            {
              type: "text",
              text: GENERATOR_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools,
          messages,
        },
        { signal: AbortSignal.timeout(turnTimeoutMs) },
      );
      message = await stream.finalMessage();
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError");
      return failed(
        startedAt,
        isAbort ? "AGENT_TIMEOUT" : "AGENT_API_ERROR",
        err instanceof Error ? err.message : String(err),
        { ledger, turnRecords, turns: turn - 1 },
      );
    }

    const turnDurationMs = Date.now() - startedAt - ledger.reduce((s, e) => s + e.durationMs, 0);
    const turnCost = computeCost(
      message.usage.input_tokens,
      message.usage.output_tokens,
    );
    totalCost += turnCost;
    ledger.push({
      turn,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
      costUsd: turnCost,
      durationMs: turnDurationMs,
    });

    // Cost-cap circuit breaker (Phase v3 completion §D4). Checked AFTER
    // the ledger entry is recorded so the running total reflects what
    // we've already committed to. Returning here preserves the partial
    // ledger + turnRecords for cost-accounting transparency.
    if (totalCost > costCapUsd) {
      return failed(
        startedAt,
        "COST_CAP_EXCEEDED",
        `Cumulative cost $${totalCost.toFixed(4)} exceeded the cap ` +
          `$${costCapUsd.toFixed(2)} after turn ${turn}. ` +
          "The loop short-circuited to prevent runaway spend; raise " +
          "`costCapUsd` if you genuinely need more budget per call.",
        { ledger, turnRecords, turns: turn },
      );
    }

    const toolUses = message.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    // Append the assistant turn before processing tool calls - the
    // tool_result blocks reference each tool_use_id by id.
    messages.push({ role: "assistant", content: message.content });

    // No tool calls -> model is done. If finalize hasn't fired, that's
    // a "model gave up" failure mode.
    if (toolUses.length === 0) {
      if (finalIfcUrl) {
        return ok(
          startedAt, finalIfcUrl, finalEntityCount, totalCost,
          turn, ledger, turnRecords, finalValidation,
        );
      }
      const lastText = (message.content.find(
        (b): b is TextBlock => b.type === "text",
      )?.text ?? "").slice(0, 500);
      return failed(
        startedAt, "AGENT_GAVE_UP",
        `Agent stopped at turn ${turn} with stop_reason=${message.stop_reason} without calling finalize_ifc. ` +
          `Last text: "${lastText}"`,
        { ledger, turnRecords, turns: turn },
      );
    }

    // Execute each tool call, batched into one user-role message of
    // tool_result blocks (Anthropic's required shape).
    const toolResultBlocks: Array<Anthropic.Messages.ToolResultBlockParam> = [];

    for (const tu of toolUses) {
      const startTool = Date.now();
      let resultPayload: unknown;
      let isError = false;
      let toolOk = true;
      let toolErrorType: string | null = null;

      try {
        switch (tu.name) {
          case TOOL_RUN_PYTHON: {
            const code = String((tu.input as { code?: unknown }).code ?? "");
            const res = await sandboxExec({
              code,
              brief: sessionId ? undefined : args.brief,
              sessionId,
              timeoutMs: execTimeoutMs,
            });
            if (!res.ok) {
              isError = true;
              toolOk = false;
              toolErrorType = res.failure.kind;
              resultPayload = { error: res.failure };
            } else {
              sessionId = res.data.session_id;
              resultPayload = res.data;
              toolOk = res.data.ok;
              toolErrorType = res.data.ok ? null : (res.data.error_type ?? "RUN_PYTHON_FAILED");
            }
            break;
          }
          case TOOL_VALIDATE_IFC: {
            if (!sessionId) {
              isError = true;
              toolOk = false;
              toolErrorType = "NO_SESSION";
              resultPayload = { error: "call run_python first to initialise the session" };
              break;
            }
            const res = await sandboxValidate(sessionId);
            if (!res.ok) {
              isError = true;
              toolOk = false;
              toolErrorType = res.failure.kind;
              resultPayload = { error: res.failure };
            } else {
              resultPayload = res.data;
              finalValidation = res.data;
            }
            break;
          }
          case TOOL_READ_IFC_SUMMARY: {
            if (!sessionId) {
              // First call to summary before any exec - return an
              // empty summary rather than a session error.
              resultPayload = {
                note: "no session yet - call run_python first to initialise",
                summary: null,
              };
              break;
            }
            const res = await sandboxSummary(sessionId);
            if (!res.ok) {
              isError = true;
              toolOk = false;
              toolErrorType = res.failure.kind;
              resultPayload = { error: res.failure };
            } else {
              resultPayload = res.data;
            }
            break;
          }
          case TOOL_FINALIZE_IFC: {
            if (!sessionId) {
              isError = true;
              toolOk = false;
              toolErrorType = "NO_SESSION";
              resultPayload = { error: "no session to finalize" };
              break;
            }
            const res = await sandboxFinalize(sessionId);
            if (!res.ok) {
              isError = true;
              toolOk = false;
              toolErrorType = res.failure.kind;
              resultPayload = { error: res.failure };
            } else {
              resultPayload = res.data;
              finalIfcUrl = res.data.ifc_url;
              finalEntityCount = res.data.entity_count;
              finalValidation = res.data.validation;
            }
            break;
          }
          default: {
            isError = true;
            toolOk = false;
            toolErrorType = "UNKNOWN_TOOL";
            resultPayload = { error: `unknown tool ${tu.name}` };
            break;
          }
        }
      } catch (err) {
        isError = true;
        toolOk = false;
        toolErrorType = "TOOL_UNCAUGHT";
        resultPayload = {
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const toolDuration = Date.now() - startTool;
      const argsPreview = JSON.stringify(tu.input).slice(0, 200);
      const record: AgentTurnRecord = {
        turn,
        toolName: tu.name,
        toolArgsPreview: argsPreview,
        toolDurationMs: toolDuration,
        toolOk,
        toolErrorType,
      };
      turnRecords.push(record);
      try {
        args.onTurn?.(record);
      } catch {
        /* swallow logger errors */
      }

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(resultPayload).slice(0, 50_000),
        is_error: isError,
      });
    }

    messages.push({ role: "user", content: toolResultBlocks });

    // Successful finalize_ifc - break early; the assistant's next turn
    // is just a summary message we don't need to wait for.
    if (finalIfcUrl) {
      return ok(
        startedAt, finalIfcUrl, finalEntityCount, totalCost,
        turn, ledger, turnRecords, finalValidation,
      );
    }
  }

  return failed(
    startedAt, "MAX_TURNS_EXCEEDED",
    `Agent did not call finalize_ifc within ${maxTurns} turns.`,
    { ledger, turnRecords, turns: maxTurns },
  );
}

// --- Result constructors ---------------------------------------------

function ok(
  startedAt: number,
  ifcUrl: string,
  entityCount: number,
  costUsd: number,
  turns: number,
  ledger: AgentTokenLedgerEntry[],
  turnRecords: AgentTurnRecord[],
  finalValidation: SandboxValidateResult | null,
): GeneratorResult {
  return {
    ok: true,
    ifcUrl,
    entityCount,
    costUsd,
    durationMs: Date.now() - startedAt,
    turns,
    ledger,
    turnRecords,
    finalValidation,
    error: null,
  };
}

function failed(
  startedAt: number,
  code: string,
  message: string,
  extras?: {
    ledger?: AgentTokenLedgerEntry[];
    turnRecords?: AgentTurnRecord[];
    turns?: number;
  },
): GeneratorResult {
  const ledger = extras?.ledger ?? [];
  return {
    ok: false,
    ifcUrl: null,
    entityCount: 0,
    costUsd: ledger.reduce((s, e) => s + e.costUsd, 0),
    durationMs: Date.now() - startedAt,
    turns: extras?.turns ?? 0,
    ledger,
    turnRecords: extras?.turnRecords ?? [],
    finalValidation: null,
    error: { code, message },
  };
}
