import {
  NextResponse,
  generateId,
  formatErrorResponse,
  logger,
} from "./deps";
import type { NodeHandler } from "./types";
import {
  createAnthropicClient,
  IFC_ARCHITECT_MODEL,
  IFC_ARCHITECT_INPUT_COST_PER_MILLION,
  IFC_ARCHITECT_OUTPUT_COST_PER_MILLION,
  estimateTokens,
  computeAnthropicCostUsd,
} from "@/features/ifc/services/brief-to-ifc-v2/anthropic-client";
import {
  IFC_ARCHITECT_SYSTEM_PROMPT,
  IFC_ARCHITECT_TOOL_NAME,
  buildArchitectUserMessage,
  buildSubmitIfcBuilderScriptTool,
} from "@/features/ifc/services/brief-to-ifc-v2/architect-prompt";
import {
  ArchitectScriptDataSchema,
  type ArchitectScriptData,
} from "@/features/ifc/services/brief-to-ifc-v2/contracts";

/**
 * TR-022 — IFC Architect (Brief-to-IFC v2, Phase 1).
 *
 * Reads the enriched specification from TR-024 and authors a complete
 * IfcOpenShell 0.8 Python script via Claude Opus 4.7. The script is
 * extracted through a FORCED `tool_use` call — `tool_choice` is pinned to
 * the single `submit_ifc_builder_script` tool — so there is no Markdown
 * fence to parse and prose can never leak into the code.
 *
 * Output `artifact.data._script.python_code` is the builder script; EX-006
 * (AI IFC Generator) executes it in the Railway sandbox.
 */

/** Reject enriched specs over this estimated size rather than truncating. */
const ARCHITECT_INPUT_TOKEN_CAP = 200_000;
/** Opus 4.7 streamed output ceiling for the builder script. 24k output
 *  tokens is enough Python to author 1500+ IFC elements. Phase 1.5:
 *  lowered from 30k. */
const ARCHITECT_MAX_TOKENS = 24_000;
/** Wall-clock cap for the Anthropic call — Opus authoring a full script is
 *  the slowest node in the pipeline. Phase 1.5: raised from 280s to 540s to
 *  use the route's 600s maxDuration budget (with headroom for response
 *  handling) so a slow-but-working call isn't aborted prematurely. */
const ARCHITECT_TIMEOUT_MS = 540_000;
/** Below this the upstream "spec" is too thin to author an IFC from. */
const MIN_SPEC_CHARS = 50;

export const handleTR022: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const rawSpec: unknown =
    inputData?.content ?? inputData?.prompt ?? inputData?.rawText ?? "";
  const enrichedSpec = (typeof rawSpec === "string" ? rawSpec : "").trim();

  // ── Gate: too thin to author an IFC from ───────────────────────────
  if (enrichedSpec.length < MIN_SPEC_CHARS) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Specification too short",
        message:
          "The IFC Architect needs an enriched specification upstream. " +
          "Connect a Brief Enricher (TR-024) node, or feed in a detailed text spec.",
        code: "SPEC_TOO_SHORT",
      }),
      { status: 422 },
    );
  }

  // ── Gate: too large — fail loud, never silently truncate ────────────
  const estimatedInputTokens = estimateTokens(enrichedSpec);
  if (estimatedInputTokens > ARCHITECT_INPUT_TOKEN_CAP) {
    return NextResponse.json(
      formatErrorResponse({
        title: "Specification too large",
        message:
          `The enriched specification is approximately ` +
          `${estimatedInputTokens.toLocaleString()} tokens, over the ` +
          `${ARCHITECT_INPUT_TOKEN_CAP.toLocaleString()}-token limit for the ` +
          "IFC Architect. Split the brief into smaller documents.",
        code: "INPUT_TOO_LARGE",
      }),
      { status: 413 },
    );
  }

  logger.info(
    `[TR-022] authoring IFC builder script — specChars=${enrichedSpec.length} ~tokens=${estimatedInputTokens}`,
  );

  let client: ReturnType<typeof createAnthropicClient>;
  try {
    client = createAnthropicClient();
  } catch {
    return NextResponse.json(
      formatErrorResponse({
        title: "API key required",
        message:
          "ANTHROPIC_API_KEY is not configured. The IFC Architect needs it to run.",
        code: "MISSING_API_KEY",
      }),
      { status: 400 },
    );
  }

  // ── Author the script via Opus 4.7 (streamed; forced tool_use) ──────
  let scriptData: ArchitectScriptData;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  try {
    console.log(
      `[TR-022] starting Anthropic call · inputTokens=~${estimatedInputTokens} · maxTokens=${ARCHITECT_MAX_TOKENS} · specSize=${enrichedSpec.length}`,
    );
    const stream = client.messages.stream(
      {
        model: IFC_ARCHITECT_MODEL,
        max_tokens: ARCHITECT_MAX_TOKENS,
        system: [
          {
            type: "text",
            text: IFC_ARCHITECT_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [buildSubmitIfcBuilderScriptTool()],
        tool_choice: { type: "tool", name: IFC_ARCHITECT_TOOL_NAME },
        messages: [
          { role: "user", content: buildArchitectUserMessage(enrichedSpec) },
        ],
      },
      { signal: AbortSignal.timeout(ARCHITECT_TIMEOUT_MS) },
    );
    const message = await stream.finalMessage();
    console.log(
      `[TR-022] Anthropic call complete · outputTokens=${message.usage.output_tokens} · stopReason=${message.stop_reason}`,
    );

    inputTokens = message.usage.input_tokens;
    outputTokens = message.usage.output_tokens;
    cacheReadTokens = message.usage.cache_read_input_tokens ?? 0;
    cacheCreationTokens = message.usage.cache_creation_input_tokens ?? 0;

    if (message.stop_reason === "max_tokens") {
      // The tool input (the script) was cut off mid-stream — an
      // incomplete script will fail in the sandbox. Fail loud here.
      return NextResponse.json(
        formatErrorResponse({
          title: "Builder script truncated",
          message:
            "The IFC Architect's script exceeded the output limit before it " +
            "finished. The specification is unusually large — split the brief " +
            "into smaller documents and re-run.",
          code: "SCRIPT_TRUNCATED",
        }),
        { status: 500 },
      );
    }

    const toolUse = message.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> =>
        b.type === "tool_use",
    );
    if (!toolUse) {
      return NextResponse.json(
        formatErrorResponse({
          title: "No script produced",
          message:
            "The IFC Architect did not return a builder script. " +
            `Stop reason: ${message.stop_reason ?? "unknown"}. Please try again.`,
          code: "MISSING_TOOL_USE",
        }),
        { status: 500 },
      );
    }
    if (toolUse.name !== IFC_ARCHITECT_TOOL_NAME) {
      return NextResponse.json(
        formatErrorResponse({
          title: "Unexpected tool call",
          message:
            `The IFC Architect called "${toolUse.name}" instead of ` +
            `"${IFC_ARCHITECT_TOOL_NAME}". Please try running the node again.`,
          code: "WRONG_TOOL_USE",
        }),
        { status: 500 },
      );
    }

    const parsed = ArchitectScriptDataSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      console.error(
        "[TR-022] Architect tool payload failed schema validation",
        parsed.error.issues,
      );
      return NextResponse.json(
        formatErrorResponse({
          title: "Invalid script payload",
          message:
            "The IFC Architect returned a malformed script payload: " +
            parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          code: "INVALID_SCRIPT_PAYLOAD",
        }),
        { status: 500 },
      );
    }
    scriptData = parsed.data;
  } catch (err) {
    console.error("[TR-022] Anthropic architect call failed:", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      formatErrorResponse({
        title: "IFC Architect failed",
        message: `The IFC Architect could not complete: ${message}`,
        code: "ARCHITECT_FAILED",
      }),
      { status: 500 },
    );
  }

  const costUsd = computeAnthropicCostUsd({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    inputCostPerMillion: IFC_ARCHITECT_INPUT_COST_PER_MILLION,
    outputCostPerMillion: IFC_ARCHITECT_OUTPUT_COST_PER_MILLION,
  });

  logger.info(
    `[TR-022] script authored — scriptChars=${scriptData.python_code.length} ` +
      `expectedEntities=${scriptData.expected_entity_count} ` +
      `elementClasses=${scriptData.elements_emitted.length} ` +
      `tokensIn=${inputTokens} tokensOut=${outputTokens} cacheRead=${cacheReadTokens} costUsd=${costUsd}`,
  );

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "text",
    data: {
      content: scriptData.summary,
      label: "Architect Plan",
      _script: scriptData,
    },
    metadata: {
      model: IFC_ARCHITECT_MODEL,
      real: true,
      expectedEntityCount: scriptData.expected_entity_count,
      elementClassCount: scriptData.elements_emitted.length,
      scriptCharCount: scriptData.python_code.length,
      tokenCount: { input: inputTokens, output: outputTokens },
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
    },
    createdAt: new Date(),
  };
};
