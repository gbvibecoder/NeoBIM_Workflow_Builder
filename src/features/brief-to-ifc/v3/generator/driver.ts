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
  TOOL_RENDER_PREVIEW,
  TOOL_RUN_PYTHON,
  TOOL_VALIDATE_IFC,
  v3GeneratorTools,
} from "./tools";
import {
  handleRenderPreviewTool,
  RenderPreviewBudget,
} from "../tools/render-preview-tool";
import type { RenderPreviewInput, RenderPreviewView } from "../tools/render-preview-tool";
import {
  sandboxExec,
  sandboxFinalize,
  sandboxSummary,
  sandboxValidate,
} from "./sandbox-client";
import type {
  AgentInputSuggestions,
  AgentTokenLedgerEntry,
  AgentTurnRecord,
  BriefSpec,
  GeneratorResult,
  SandboxValidateResult,
} from "../types";
import {
  AGENT_MAX_TURNS_DIRECT_MODE,
  AGENT_DEFAULT_COST_CAP_USD,
} from "../constants";

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

You are a senior BIM architect generating IFC building models. The
user gives you a brief in plain English. You build an accurate,
detailed IFC4 file that reflects what they described.

## HOW YOU WORK

You have a Python sandbox with the BuildFlowIFC helper (\`bf\`) loaded.
You build the IFC by calling Python — adding walls, slabs, spaces,
openings, furniture, fixtures, trim — using \`bf\` methods. When you're
satisfied with the build, call \`finalize_ifc\`.

You have 200 turns. Use them. Don't rush. A great IFC is worth more
than a fast IFC.

## SEEING YOUR WORK

Call \`render_preview\` to see what you've built. Do this after every
20-30 turns. Compare what you see against the brief. If something
looks wrong, fix it before continuing. If something is missing,
add it.

You can render 10 times per build. Use them strategically:
  Turn ~20: shape (walls, slabs, openings placed correctly?)
  Turn ~40: large furniture (desk, table, mannequin in right spots?)
  Turn ~60: small furniture and parts
  Turn ~80: trim and fixtures
  Turn ~100+: final review

## UPSTREAM SUGGESTIONS

The user message includes suggestions from automated upstream
analysis: a structured spec, design rationale, suggested part
decomposition, trim items, and material assignments.

Materials are mandatory — use the provided material IDs verbatim
(the catalog is deterministic and curated).

Everything else is advisory. Read it, take what's useful, refine
what's incomplete, ignore what's wrong. You are the architect.
The upstream analysis is a colleague's notes, not a contract.

## WHAT MAKES A GREAT IFC

1. **Multi-part composite items.** A "cutting table" is not a single
   box — it has a top surface, legs, perhaps a stretcher, perhaps
   drawers. A "sewing machine" is not a single box — it has a
   body, a needle assembly, a handwheel, a presser foot. A
   "mannequin on a tripod" has a torso form, a neck, a head form,
   a pole, three legs, a base plate.
   
   Use IfcRelAggregates to link parent items to their parts. Single
   boxes are placeholder geometry, not BIM.

2. **Correct IFC classes.** Use the right class for each item:
   - Furniture, fixtures, appliances → IfcFurnishingElement
   - Floor coverings, rugs, mats → IfcCovering (FLOORING)
   - Wall panels, partitions → IfcCovering or IfcWallStandardCase
   - Light fixtures → IfcLightFixture
   - Plugs, outlets, switches → IfcFlowTerminal
   - Walls, doors, windows, slabs → use the obvious classes
   - Hinges, handles, door hardware → IfcDiscreteAccessory
   
   NEVER use IfcBuildingElementProxy for furniture or fixtures.
   That class is for true unknowns at the IFC schema level.
   Furniture always has a proper class.

3. **Property sets and quantities.** Each element gets at least:
   - One IfcPropertySet with semantic properties
   - One IfcElementQuantity with measured quantities
   
   Use \`bf.attach_canonical_psets()\` and \`bf.attach_canonical_qto()\` helpers.

4. **Accurate placement.** The brief describes spatial relationships
   ("desk against north wall", "rug centered in room"). Build to
   those constraints. If the brief is ambiguous, make a reasonable
   choice and proceed — don't get stuck.

5. **Real-world scale.** A door is ~2.1m tall, ~0.9m wide. A standard
   desk is ~0.75m tall, 1.5-2m wide. A chair seat is ~0.45m off
   the floor. Use sensible dimensions when the brief doesn't
   specify them.

## SANDBOX METHODS

The \`bf\` helper has methods for every common building element. Key ones:

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

**Pre-bound helper functions (available directly — no import needed):**
- \`resolve_material("teak wood", "office", "IfcDoor")\` — returns a material id from the 65-material curated library.
- \`compose_furniture(bf, "workstation", (5.0, 3.0, 0.0), 0.0, "mat-laminate-white")\` — emits a 12-part composite via IfcRelAggregates.
- \`apply_naming_convention(bf, spec)\` — renames every element to human-readable convention.
- \`add_site_context(bf, polygon)\` — adds site polygon, ground plane, north arrow.
- \`validate_brief_spec(spec)\` — checks internal consistency.
- \`run_preflight(spec, material_ids)\` — scale/coordinate/material sanity checks.

When unsure of a method signature, run a small Python probe like
\`help(bf.method_name)\`.

## IFC SCHEMA NOTES

- Schema is IFC4 (default) or IFC2X3 (fallback). The bootstrap forces METRE units.
- ALL dimensions in METRES. A 4m wall = \`dims=(4.0, 0.2)\`, NOT \`(4000, 200)\`.
- \`origin_world_m\` is the SW corner of the bbox, NOT the centre.
- PredefinedType is supported on most classes in IFC4 (Wall, Door, Window, Column, Beam, Slab).
- IfcLightFixture is a real IFC4 class — no proxy fallback needed.
- String values must be pure ASCII. The helpers auto-sanitize.

## MATERIAL ASSOCIATIONS (CRITICAL — without this everything is gray)

The \`bf.add_*\` methods create IfcMaterial + IfcStyledItem (visual),
but they do NOT create IfcRelAssociatesMaterial (the semantic link
IFC viewers need to display colors). You MUST create these yourself
in a final \`run_python\` block BEFORE calling \`finalize_ifc\`.

Pattern — run this AFTER all elements are built:

\`\`\`python
f = bf._file  # the underlying ifcopenshell file object
owner = f.by_type("IfcOwnerHistory")[0]

# Build a map: material name → IfcMaterial entity
mat_map = {}
for m in f.by_type("IfcMaterial"):
    mat_map[m.Name] = m

# For each product, find its material from the styled item chain
# and create the association
products = [p for p in f.by_type("IfcProduct") if hasattr(p, "Representation") and p.Representation]
for product in products:
    # Walk representation → styled item → surface style → name
    for rep in (product.Representation.Representations if product.Representation else []):
        for item in (rep.Items or []):
            for style in (f.get_inverse(item) if hasattr(f, 'get_inverse') else []):
                if style.is_a("IfcStyledItem"):
                    for s in (style.Styles or []):
                        if s.is_a("IfcPresentationStyleAssignment"):
                            for ps in (s.Styles or []):
                                if ps.is_a("IfcSurfaceStyle") and ps.Name in mat_map:
                                    f.create_entity("IfcRelAssociatesMaterial",
                                        GlobalId=ifcopenshell.guid.new(),
                                        OwnerHistory=owner,
                                        RelatedObjects=[product],
                                        RelatingMaterial=mat_map[ps.Name])
\`\`\`

If this exact pattern fails (API differences), try a simpler approach:
\`\`\`python
# Simpler fallback: associate ALL products with the first matching material
for product in f.by_type("IfcProduct"):
    tag = getattr(product, "Tag", "") or ""
    for mat in f.by_type("IfcMaterial"):
        if mat.Name and mat.Name.lower() in tag.lower():
            f.create_entity("IfcRelAssociatesMaterial",
                GlobalId=ifcopenshell.guid.new(),
                OwnerHistory=owner,
                RelatedObjects=[product],
                RelatingMaterial=mat)
            break
\`\`\`

Verify with: \`print("IfcRelAssociatesMaterial count:", len(f.by_type("IfcRelAssociatesMaterial")))\`.
If the count is 0 after your attempt, debug and retry. Gray IFC = broken output.

## FINALIZE

When done, call \`finalize_ifc()\`. This writes the .ifc file and
completes the build. After finalize, you cannot make more changes.

Do not call \`finalize_ifc\` until you have:
- Built every item in the brief
- Created IfcRelAssociatesMaterial for every product (see above)
- Used \`render_preview\` at least once on the final state
- Confirmed via \`render_preview\` that nothing is missing or wrong
- Added property sets + quantities to every element

## ITERATION CONTEXT

If the brief tells you this is iteration 2 or 3 of a self-correcting
pipeline, you'll see a PREVIOUS ITERATION FEEDBACK section. That's
feedback from automated review of your last attempt. Read it.
Address each point. The feedback is in English, not JSON — it's
a colleague telling you what to improve.

## NOW

Read the brief carefully. Plan your approach in 3-5 sentences as a
text response (no tool call) before you start building. Then begin.`;

const GENERATOR_MODEL = "claude-opus-4-7";
const OPUS_INPUT_COST_PER_MILLION = 5;
const OPUS_OUTPUT_COST_PER_MILLION = 25;
/** Phase gamma.1: Direct Agent Mode — 200 turns, imported from constants. */
const DEFAULT_MAX_TURNS = AGENT_MAX_TURNS_DIRECT_MODE;
const DEFAULT_TURN_MAX_TOKENS = 8_000;
const DEFAULT_TURN_TIMEOUT_MS = 60_000;
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
/** Phase gamma.1: raised to $5.00 for Direct Agent Mode. */
export const DEFAULT_COST_CAP_USD = AGENT_DEFAULT_COST_CAP_USD;

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
  /** Phase gamma.1: verbatim user brief text — primary context for the agent. */
  briefText?: string;
  /** Phase gamma.1: advisory suggestions from upstream analysis nodes. */
  suggestions?: AgentInputSuggestions;
  /** Phase gamma.1: plain-English retry hint from previous iteration. */
  previousFeedback?: string;
  /** Phase gamma.1: which iteration this is (1-based). */
  iteration?: number;
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

  // Phase gamma.1: Build the user message with brief + spec + suggestions + feedback
  const userMessageParts: string[] = [];

  if (args.briefText) {
    userMessageParts.push(
      `## THE BRIEF\n\n${args.briefText}`,
    );
  }

  userMessageParts.push(
    `## UPSTREAM SUGGESTIONS (advisory, not mandatory)\n\n` +
    `### Structured spec from Brief Enricher\n\n` +
    `<brief_spec>\n${JSON.stringify(args.brief, null, 2)}\n</brief_spec>`,
  );

  if (args.suggestions?.rationale?.length) {
    userMessageParts.push(
      `### Design rationale from Architectural Reasoner\n\n` +
      args.suggestions.rationale.map(r =>
        `- **${r.itemId}**: position [${r.position.join(", ")}], rotation ${r.rotation_z_rad}rad — ${r.rationale}`,
      ).join("\n"),
    );
  }

  if (args.suggestions?.decomposed_furniture?.length) {
    userMessageParts.push(
      `### Suggested part decomposition from Item Decomposer\n\n` +
      `This is a starting point — refine as needed.\n\n` +
      args.suggestions.decomposed_furniture.map(f =>
        `- **${f.id}** (${f.type}): ${f.parts?.length ?? 0} parts suggested` +
        (f.parts?.length ? `\n  Parts: ${f.parts.map(p => `${p.subtype} [${p.dims_m.join("x")}m]`).join(", ")}` : ""),
      ).join("\n"),
    );
  }

  if (args.suggestions?.trim?.length) {
    userMessageParts.push(
      `### Suggested trim items from Trim Specifier\n\n` +
      args.suggestions.trim.map(t =>
        `- **${t.id}** (${t.type}): host=${t.hostId}, material=${t.material_id}`,
      ).join("\n"),
    );
  }

  if (args.suggestions?.materials?.length) {
    userMessageParts.push(
      `### Material catalog from Material Resolver — REQUIRED, deterministic\n\n` +
      `Use these material IDs verbatim.\n\n` +
      args.suggestions.materials.map(m =>
        `- **${m.id}**: ${m.name} (${m.method}, rgb=[${m.rgb.join(",")}])`,
      ).join("\n"),
    );
  }

  if (args.previousFeedback && (args.iteration ?? 1) > 1) {
    userMessageParts.push(
      `## PREVIOUS ITERATION FEEDBACK\n\n` +
      `This is iteration ${args.iteration}. The previous build was reviewed and here is the feedback:\n\n` +
      args.previousFeedback,
    );
  }

  userMessageParts.push(
    `## YOUR TASK\n\n` +
    `Build the IFC. You have ${maxTurns} turns. You have a render_preview tool — ` +
    `use it to see what you're building. Iterate within your own session ` +
    `until you're satisfied. Then call finalize_ifc.\n\n` +
    `The structured spec, rationale, decomposition, and trim are SUGGESTIONS ` +
    `from upstream analysis. Use what's useful, ignore what isn't, add what's ` +
    `missing. You are the architect — judge for yourself what makes a good ` +
    `building model.\n\n` +
    `Materials are deterministic — use the material IDs provided. Everything ` +
    `else is up to you.`,
  );

  // Fallback: if no briefText was provided, log a warning (backwards compat)
  if (!args.briefText) {
    // eslint-disable-next-line no-console
    console.warn(
      `[runGenerator] briefText absent — falling back to spec-only mode. ` +
      `Direct Agent Mode works best with the original brief.`,
    );
  }

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userMessageParts.join("\n\n") },
  ];
  const tools = v3GeneratorTools();

  let sessionId: string | null = null;
  let finalIfcUrl: string | null = null;
  let finalEntityCount = 0;
  let finalValidation: SandboxValidateResult | null = null;
  let totalCost = 0;
  // Phase gamma.1: render_preview budget — max 10 calls per build
  const renderBudget = new RenderPreviewBudget();

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
          case TOOL_RENDER_PREVIEW: {
            const input = tu.input as { view?: string; note?: string };
            const view = (input.view ?? "iso") as RenderPreviewView;
            const renderResult = await handleRenderPreviewTool(
              { view, note: input.note } as RenderPreviewInput,
              { sessionId, runId: args.iteration?.toString(), turn },
              renderBudget,
            );
            if (renderResult.ok && renderResult.image_b64) {
              // Return image content block — the driver will wrap it
              resultPayload = {
                _renderPreview: true,
                image_b64: renderResult.image_b64,
                render_ms: renderResult.render_ms,
                note: renderResult.note,
                budget_used: renderBudget.used,
                budget_remaining: renderBudget.remaining,
              };
            } else {
              resultPayload = {
                error: renderResult.error ?? "Render failed",
                budget_used: renderBudget.used,
                budget_remaining: renderBudget.remaining,
              };
              if (renderResult.error?.includes("budget exhausted")) {
                // Not an error per se — just budget exhausted
                isError = false;
              } else {
                isError = true;
                toolOk = false;
                toolErrorType = "RENDER_PREVIEW_FAILED";
              }
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

      // Phase gamma.1: render_preview returns image content blocks
      const isRenderPreviewImage =
        resultPayload &&
        typeof resultPayload === "object" &&
        (resultPayload as Record<string, unknown>)._renderPreview === true;

      if (isRenderPreviewImage) {
        const rp = resultPayload as { image_b64: string; render_ms?: number; note?: string; budget_used: number; budget_remaining: number };
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: rp.image_b64,
              },
            },
            {
              type: "text",
              text: JSON.stringify({
                render_ms: rp.render_ms,
                note: rp.note,
                budget_used: rp.budget_used,
                budget_remaining: rp.budget_remaining,
              }),
            },
          ] as unknown as string,
          is_error: false,
        });
      } else {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(resultPayload).slice(0, 50_000),
          is_error: isError,
        });
      }
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
