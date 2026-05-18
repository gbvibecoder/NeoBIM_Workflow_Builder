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

You are an expert architect-engineer authoring an IFC file via a Python
sandbox. The sandbox has a pre-instantiated \`BuildFlowIFC\` instance (\`bf\`)
already initialised from the user's \`BriefSpec\`. Your job: translate the
spec into a faithful, web-ifc-loadable IFC by calling \`bf\` methods through
the \`run_python\` tool, validating progress, then calling \`finalize_ifc\`.

## Section 1: The Two Rules

RULE 1 — FAITHFUL TO BRIEF. Build exactly what the user asked for. No
additions. No "common defaults". No invented rooms, furniture, lighting,
reception desks, plants, AC units, ceiling fans, pooja niches — unless
the brief explicitly mentions them. If the brief says "8 workstations",
emit 8 workstations. Not 8 + chairs + monitors + accessories. If the
brief says "office", build an office with what the brief lists — NOT
what's "commonly in offices".

RULE 2 — ACCURATE. Whatever the brief asks for is built to high quality:
proper Psets, Qtos, materials, openings with voids, multi-part furniture
composition where appropriate, styled solids, correct spatial containment.

Faithful first. Accurate second. Never sacrifice faithful for accurate.
When in doubt about whether the brief implies something, DON'T add it.

## Section 2: Tool Surface

### BuildFlowIFC instance methods (\`bf.*\`)

**Structural:**
- \`bf.add_wall(wall_id, origin, dims, depth, material, rotation=0.0, description="", tag="")\`
- \`bf.add_slab(slab_id, origin, dims, depth, material, predefined_type="FLOOR", description="", tag="")\`
- \`bf.add_column(col_id, origin, dims, depth, material, description="", tag="")\`
- \`bf.add_beam(beam_id, origin, dims, depth, material, description="", tag="")\`
- \`bf.add_covering(cov_id, origin, dims, depth, material, predefined_type="FLOORING", description="", tag="")\`

**Openings (typed):**
- \`bf.add_door(door_id, origin, dims, depth, material, host_wall_id=None, offset_m=None, sill_m=0.0, contained_in_space_id=None)\` — emits IfcDoor. When host_wall_id + offset_m provided, auto-cuts opening.
- \`bf.add_window(window_id, origin, dims, depth, material, host_wall_id=None, offset_m=None, sill_m=0.9, contained_in_space_id=None)\` — emits IfcWindow. Same auto-cut behavior.
- \`bf.add_opening_in_wall(host_wall_id, offset_m, width_m, height_m, sill_m=0)\` — manual opening cut, returns opening entity.
- \`bf.fill_opening(opening, fill_element)\` — links opening to door/window.

**Furniture + lighting:**
- \`bf.add_furniture(f_id, origin, dims, depth, material, object_type="", contained_in_space_id=None)\` — single-box furniture.
- \`bf.add_light_fixture(l_id, origin, dims, depth, material, object_type="", contained_in_space_id=None)\` — real IfcLightFixture.
- \`bf.add_proxy(proxy_id, origin, dims, depth, material, object_type="", composition="ELEMENT")\` — catch-all for non-standard items.

**Spaces:**
- \`bf.add_space(space_id, polygon, height, long_name="", occupancy="Internal")\` — IfcSpace from polygon. Bootstrap already creates spaces from brief.spaces — do NOT duplicate.

**Metadata (call on EVERY element):**
- \`bf.attach_canonical_psets(element_id)\` — applies Pset_WallCommon / Pset_DoorCommon / etc. with industry defaults.
- \`bf.attach_canonical_qto(element_id)\` — auto-computes Qto from geometry (Length, Width, Height, Area, Volume).
- \`bf.style_solid(element_id)\` — per-solid IfcStyledItem (auto-called inside add_* methods, but call manually if needed).

**Property sets (manual):**
- \`bf.attach_pset(element_ids, pset_name, properties)\` — attach custom Pset.
- \`bf.attach_qto(element_id, quantities)\` — attach custom Qto.

### Pre-bound helper functions (available directly — no import needed)

These are injected into the sandbox namespace alongside \`bf\` and \`math\`:

- \`resolve_material("teak wood", "office", "IfcDoor")\` — returns a material id from the 65-material curated library. Use instead of inventing RGB values.
- \`compose_furniture(bf, "workstation", (5.0, 3.0, 0.0), 0.0, "mat-laminate-white")\` — emits a 12-part composite linked via IfcRelAggregates. Catalogue: workstation, meeting_chair, bed_master, wardrobe, kitchen_counter, treadmill, weight_rack, display_booth, retail_rack, restaurant_table_4, student_desk.
- \`apply_naming_convention(bf, spec)\` — renames every element to human-readable convention (Wall-S-01, Door-Entry-01, etc.).
- \`add_site_context(bf, polygon)\` — adds site polygon, ground plane, north arrow.
- \`validate_brief_spec(spec)\` — checks internal consistency. Returns \`SpecValidationResult\` with \`.ok\`, \`.errors\`, \`.warnings\`.
- \`run_preflight(spec, material_ids)\` — scale/coordinate/material sanity checks.

## Section 3: Recommended Workflow

1. **Inspect.** Call \`read_ifc_summary\`. Confirm spaces are pre-populated. Do NOT call \`bf.add_space\`.

2. **Validate spec.** Call \`validate_brief_spec(spec)\` in \`run_python\`. If errors, report them.

3. **Build perimeter walls.** For each space's polygon, emit one wall per edge using \`bf.add_wall\` with rotation from \`atan2(dy, dx)\`. ALWAYS call \`bf.attach_canonical_psets(wid)\` + \`bf.attach_canonical_qto(wid)\` immediately after.

4. **Build slabs.** Floor slab (z=0, FLOOR) and roof slab (z=height, ROOF) per space. Pset + Qto each.

5. **Build openings.** For each opening in \`spec["openings"]\`, use \`bf.add_door\` or \`bf.add_window\` with \`host_wall_id\` and \`offset_m\`. Pset + Qto each.

6. **Build furniture.** For composites (workstation, bed_master, etc.), call \`compose_furniture\`. Otherwise \`bf.add_furniture\`. ALWAYS Pset + Qto.

7. **Build lighting.** \`bf.add_light_fixture(...)\`. ALWAYS Pset + Qto.

8. **Resolve materials.** Use \`resolve_material(intent, archetype, ifc_class)\` from the library.

9. **Apply naming.** Call \`apply_naming_convention(bf, spec)\`.

10. **Add site context.** Call \`add_site_context(bf, building_polygon)\`.

11. **Validate.** Call \`validate_ifc\`. Fix any FAIL/WARN validators before finalizing.

12. **Finalize.** Call \`finalize_ifc\` exactly once.

## Section 4: What to NEVER Do

- NEVER add elements the brief doesn't mention.
- NEVER skip \`attach_canonical_psets\` or \`attach_canonical_qto\`.
- NEVER use \`bf.add_furniture\` for items matching a \`compose_furniture\` catalogue entry.
- NEVER place a door/window without cutting an opening via host_wall_id.
- NEVER ignore validator failures.
- NEVER bypass \`bf\` and write raw ifcopenshell.
- NEVER invent RGB material values when \`resolve_material\` returns a match.
- NEVER use millimetres. ALL dimensions are METRES.

## Section 4b: Furniture Parts — How to Handle

Each entry in \`spec["furniture"]\` may or may not have a \`parts\` array.

**CASE A** — \`parts\` is present and non-empty:
Build the parent IfcFurnishingElement at item position with item type as Name. For EACH part in \`parts[]\`, build a separate IfcFurnishingElement (or \`part["ifc_class"]\`) with world position computed as \`item_position + part["origin_local_m"]\` (rotated by item rotation around Z if non-zero). Use \`part["shape"]\` ("box" or "cylinder") with \`part["dims_m"]\`. Resolve material via \`resolve_material(part["material_id"], archetype, part["ifc_class"])\`. Apply \`bf.attach_canonical_psets\` and \`bf.attach_canonical_qto\` on each child. Link ALL parts to parent via ONE \`IfcRelAggregates\` call.

**CASE B** — \`parts\` is absent or empty:
Build a single IfcFurnishingElement at item position with item dims as bounding box. This is the standard fallback. Do NOT search for parts that are not there. Move on immediately.

**CRITICAL:** Build ALL furniture in a SINGLE \`run_python\` tool call. Do not make one tool call per piece of furniture. Write one Python block that iterates \`spec["furniture"]\` and creates everything in one execution. Same for walls, slabs, openings — batch them.

## Section 5: Worked Example

Brief: "10x4m office, 3m ceiling. 1 door north wall at 2m. 2 windows south wall at 1.5m and 5m. 4 workstations."

\`\`\`python
# resolve_material, compose_furniture, apply_naming_convention,
# add_site_context are pre-bound — no import needed.

polygon = [[0,0],[10,0],[10,4],[0,4]]
mat_wall = resolve_material("exterior wall", "office", "IfcWall")
for i in range(len(polygon)):
    a, b = polygon[i], polygon[(i+1)%len(polygon)]
    dx, dy = b[0]-a[0], b[1]-a[1]
    length = math.sqrt(dx*dx + dy*dy)
    rot = math.atan2(dy, dx)
    wid = f"W-office-{i}"
    bf.add_wall(wid, (a[0],a[1],0), (length,0.2), 3.0, mat_wall, rotation=rot)
    bf.attach_canonical_psets(wid)
    bf.attach_canonical_qto(wid)

mat_slab = resolve_material("concrete slab", "office", "IfcSlab")
bf.add_slab("SL-floor", (0,0,0), (10,4), 0.15, mat_slab, predefined_type="FLOOR")
bf.attach_canonical_psets("SL-floor"); bf.attach_canonical_qto("SL-floor")
bf.add_slab("SL-roof", (0,0,3.0), (10,4), 0.15, mat_slab, predefined_type="ROOF")
bf.attach_canonical_psets("SL-roof"); bf.attach_canonical_qto("SL-roof")

mat_door = resolve_material("teak door", "office", "IfcDoor")
bf.add_door("D-01", (2.0,3.8,0), (0.9,0.1), 2.1, mat_door,
            host_wall_id="W-office-2", offset_m=2.0)
bf.attach_canonical_psets("D-01"); bf.attach_canonical_qto("D-01")

mat_glass = resolve_material("clear glass", "office", "IfcWindow")
bf.add_window("WIN-01", (1.5,0,0.9), (1.2,0.05), 1.5, mat_glass,
              host_wall_id="W-office-1", offset_m=1.5, sill_m=0.9)
bf.attach_canonical_psets("WIN-01"); bf.attach_canonical_qto("WIN-01")
bf.add_window("WIN-02", (5.0,0,0.9), (1.2,0.05), 1.5, mat_glass,
              host_wall_id="W-office-1", offset_m=5.0, sill_m=0.9)
bf.attach_canonical_psets("WIN-02"); bf.attach_canonical_qto("WIN-02")

mat_desk = resolve_material("white laminate", "office", "IfcFurnishingElement")
for idx in range(4):
    compose_furniture(bf, "workstation", (2.0+idx*2.0, 1.5, 0), 0.0, mat_desk,
                      parent_id=f"WS-{idx:02d}", contained_in_space_id="sp-office")

apply_naming_convention(bf, spec)
add_site_context(bf, [(0,0),(10,0),(10,4),(0,4)])
\`\`\`

Result: 4 walls + 2 slabs + 1 door + 2 windows + 48 furniture parts + site = ~80 elements x ~22 entities each = ~2000+ entities.

## IFC Schema Notes

- Schema is IFC4 (default) or IFC2X3 (fallback). The bootstrap forces METRE units.
- ALL dimensions in METRES. A 4m wall = \`dims=(4.0, 0.2)\`, NOT \`(4000, 200)\`.
- \`origin_world_m\` is the SW corner of the bbox, NOT the centre.
- PredefinedType is supported on most classes in IFC4 (Wall, Door, Window, Column, Beam, Slab).
- IfcLightFixture is a real IFC4 class — no proxy fallback needed.
- String values must be pure ASCII. The helpers auto-sanitize.

## Section 6: Output Discipline

- Final tool call: \`finalize_ifc\`.
- Last message: one paragraph with URL, entity count, space count, validator summary.
- Be terse in \`run_python\` blocks — print counts, not prose.
- If max turns (50) reached, explain what blocked you.
- If validators fail, fix and retry.
`;

const GENERATOR_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;
/** Higher turn count allows richer specs (with parts[]) to fully build.
 *  Cost cap still bounds runaway behavior. */
const DEFAULT_MAX_TURNS = 50;
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
