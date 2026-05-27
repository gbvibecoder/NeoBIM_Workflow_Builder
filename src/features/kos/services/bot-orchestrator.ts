/**
 * KOS bot orchestrator (Stage B, Phase 3A).
 *
 * Single entry point — `runBotTurn(...)` — yields a stream of
 * `BotEvent`s for one customer ↔ bot turn. The caller (SSE route
 * /api/kos/customer/chat, or the CLI test harness) consumes the
 * generator and forwards events as it sees fit.
 *
 * Internals:
 *   • Two tools — retrieve_documents (RAG) + escalate_to_human.
 *   • Loop bounded by KOS_BOT_MAX_TOOL_ITERATIONS to prevent
 *     runaway tool-use cycles.
 *   • Citations are tracked 1-indexed ACROSS all retrievals in a
 *     turn (so a second retrieval's first chunk is [N+1]).
 *   • Every retrieve_documents call writes a BOT_RETRIEVAL audit
 *     row; the final BOT_RESPONSE message references the most-
 *     recent retrieval's audit id via KosMessage.retrievalAuditId.
 *
 * Status enum mapping (Phase 3A "additive only" constraint —
 * existing KosConversationStatus values cover the cases):
 *   spec "ACTIVE"     → BOT_ACTIVE
 *   spec "ESCALATED"  → AWAITING_HUMAN
 *   spec "CLOSED"     → CLOSED
 */

import type Anthropic from "@anthropic-ai/sdk";
import type {
  KosCustomer,
  KosDocType,
  KosConversation,
  KosMessage,
  Tenant,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import {
  KOS_AUDIT,
  KOS_BOT_HISTORY_DEPTH,
  KOS_BOT_MAX_TOKENS,
  KOS_BOT_MODEL,
} from "@/features/kos/lib/kos-constants";
import {
  KOS_BOT_MAX_ITERATIONS,
  KOS_BOT_MAX_SIDECAR_CALLS_PER_TURN,
  TOOL_GENERATE_BOQ,
  TOOL_GENERATE_FORMWORK,
  TOOL_GENERATE_SHOP_DRAWING,
  TOOL_PROCESS_DRAWING,
} from "@/features/kos/lib/kos-bot-constants";
import { getKosAnthropicClient } from "@/features/kos/services/anthropic-client";
import { retrieveChunks } from "@/features/kos/services/rag-retriever";
import { buildKalzenSystemPrompt } from "@/features/kos/prompts/system-prompt";
import {
  processDrawingTool,
  type ProcessDrawingArgs,
} from "@/features/kos/services/bot-tools/tool-process-drawing";
import {
  generateBoqTool,
  type GenerateBoqToolArgs,
} from "@/features/kos/services/bot-tools/tool-generate-boq";
import {
  generateFormworkTool,
  type GenerateFormworkToolArgs,
} from "@/features/kos/services/bot-tools/tool-generate-formwork";
import {
  generateShopDrawingTool,
  type GenerateShopDrawingToolArgs,
} from "@/features/kos/services/bot-tools/tool-generate-shop-drawing";
import {
  SSE_EVT_ARTIFACT_FAILED,
  SSE_EVT_ARTIFACT_READY,
  SSE_EVT_CLASSIFICATION_NEEDED,
  SSE_EVT_DRAWING_STATUS,
} from "@/features/kos/lib/kos-sse-events";

// ─── Public event type ────────────────────────────────────────────────

export interface BotCitation {
  documentId: string;
  chunkId: string;
  pageNum: number | null;
  snippet: string;
  title: string;
}

// 5I PR 3 — re-export drawing SSE event types so the orchestrator's
// yield union covers them. The type module is the wire-format source
// of truth; this orchestrator widens BotEvent additively.
import type { KosDrawingSseEvent } from "@/features/kos/lib/kos-sse-events";

export type BotEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; tool: string; input: unknown }
  | { type: "tool_call_result"; tool: string; output: unknown }
  | { type: "citations"; citations: BotCitation[] }
  | { type: "escalation"; reason: string }
  | { type: "done"; messageId: string; conversationId: string }
  | { type: "error"; code: string; message: string }
  | KosDrawingSseEvent;

export interface RunBotTurnInput {
  tenantId: string;
  tenantName: string;
  conversationId?: string | null;
  customerId: string;
  customerMessage: string;
  customerDisplayName: string;
  /**
   * 5I PR 2b — drawing IDs the customer attached this turn. The chat
   * route validates (tenant, customer) ownership upfront and forwards
   * the list verbatim. The orchestrator surfaces them to the model
   * inside the customer message envelope so the model knows it has
   * drawings to call `process_drawing` on.
   */
  attachmentRefs?: string[];
}

// ─── Tool definitions (Anthropic JSON schema) ─────────────────────────

const TOOL_RETRIEVE_DOCUMENTS = {
  name: "retrieve_documents",
  description:
    "Retrieve relevant document chunks from the Kalzen document library. " +
    "Use this BEFORE answering any factual question about products, " +
    "certifications, comparisons, pricing, warranty, or technical specs.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "The search query — focused, specific, in the customer's words. Avoid copying the literal user message; rephrase to highlight the searchable noun phrase.",
      },
      topK: {
        type: "integer",
        description:
          "How many chunks to retrieve. Default 5; cap 10. Smaller is sharper.",
        minimum: 1,
        maximum: 10,
      },
      docTypes: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional filter on document type. Allowed values: PAC, CERTIFICATE, CASE_STUDY, PRICING, COMPARISON, FAQ, WARRANTY, OTHER. Omit to search all docs.",
      },
    },
    required: ["query"],
  },
};

const TOOL_ESCALATE_TO_HUMAN = {
  name: "escalate_to_human",
  description:
    "Escalate this conversation to a human Kalzen BD team-mate. Use when " +
    "the question is commercial (custom quotes, negotiated pricing), " +
    "unusual (non-standard panel sizes, novel structural scenarios), or " +
    "outside the document library's coverage. Also use for medical/legal/" +
    "financial topics — refuse and escalate.",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: {
        type: "string",
        description:
          "Why you are escalating. One short sentence for BD's queue triage.",
      },
      customerSummary: {
        type: "string",
        description:
          "One or two sentences summarising what the customer needs, so the BD team-mate can pick up cold.",
      },
    },
    required: ["reason", "customerSummary"],
  },
};

// ─── 5I PR 2b — Drawing tools ─────────────────────────────────────────

const APPLICATION_HINT_VALUES = [
  "internal_partition",
  "villa_external",
  "apartment_external_g3",
  "apartment_external_g5",
  "school_commercial_g3",
  "lift_shaft_g5",
  "shear_wall_g10",
  "basement_lt3m",
  "basement_gt3m",
  "retaining",
] as const;

const TOOL_PROCESS_DRAWING_DEF = {
  name: TOOL_PROCESS_DRAWING,
  description:
    "Parse a customer-uploaded drawing and prepare it for BOQ/Formwork generation. Call this when the customer has attached a drawing (drawing_id is provided in the conversation context). If the call returns status='needs_classification', the parser couldn't auto-identify the drawing — present the suggested wall types to the user and call process_drawing again with the chosen application_hint.",
  input_schema: {
    type: "object" as const,
    properties: {
      drawing_id: {
        type: "string",
        description:
          "The ID of the drawing to process. The customer's message envelope lists drawing IDs they attached this turn.",
      },
      application_hint: {
        type: "string",
        enum: APPLICATION_HINT_VALUES,
        description:
          "Type of wall the customer confirmed. Only pass on re-classification rounds after status='needs_classification'.",
      },
      project_context: {
        type: "object",
        description:
          "Optional overrides for project context. Sidecar defaults apply otherwise.",
        properties: {
          project_name: { type: "string" },
          seismic_zone: { type: "string", enum: ["II", "III", "IV", "V"] },
          split_strategy: {
            type: "string",
            enum: ["minimize_panels", "minimize_cuts", "symmetric"],
          },
          wall_height_mm: { type: "number", minimum: 1, maximum: 20000 },
        },
      },
    },
    required: ["drawing_id"],
  },
};

const TOOL_GENERATE_BOQ_DEF = {
  name: TOOL_GENERATE_BOQ,
  description:
    "Generate the Bill of Quantities (BOQ) for a drawing. Only call this AFTER process_drawing has returned status='ready' for the same drawing_id. Returns a summary the customer wants to see (panel counts, grand total INR, custom-quote pending count). Can be called in parallel with generate_formwork in the same turn.",
  input_schema: {
    type: "object" as const,
    properties: {
      drawing_id: { type: "string" },
      project_id: {
        type: "string",
        description: "Optional project ID; defaults to drawing_id.",
      },
      project_name: { type: "string" },
      quote_date: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        description: "YYYY-MM-DD; defaults to today.",
      },
    },
    required: ["drawing_id"],
  },
};

const TOOL_GENERATE_FORMWORK_DEF = {
  name: TOOL_GENERATE_FORMWORK,
  description:
    "Generate the formwork quantities (props, walers, kickers, starter track) for a drawing. Only call AFTER process_drawing has returned status='ready'. No pricing in the response by design (Karthik 2026-05-26). Can be called in parallel with generate_boq.",
  input_schema: {
    type: "object" as const,
    properties: {
      drawing_id: { type: "string" },
      project_id: { type: "string" },
      project_name: { type: "string" },
      quote_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    },
    required: ["drawing_id"],
  },
};

const TOOL_GENERATE_SHOP_DRAWING_DEF = {
  name: TOOL_GENERATE_SHOP_DRAWING,
  description:
    "Generate shop drawings (assembly diagrams, cut sheets) for a drawing. NOT IMPLEMENTED YET — returns a polite not-implemented message. Only call if the user explicitly asks for shop drawings.",
  input_schema: {
    type: "object" as const,
    properties: { drawing_id: { type: "string" } },
    required: ["drawing_id"],
  },
};

const TOOLS = [
  TOOL_RETRIEVE_DOCUMENTS,
  TOOL_ESCALATE_TO_HUMAN,
  TOOL_PROCESS_DRAWING_DEF,
  TOOL_GENERATE_BOQ_DEF,
  TOOL_GENERATE_FORMWORK_DEF,
  TOOL_GENERATE_SHOP_DRAWING_DEF,
];

// ─── Local helper types ───────────────────────────────────────────────

interface PerTurnChunk {
  chunkId: string;
  documentId: string;
  title: string;
  pageNum: number | null;
  content: string;
  similarity: number;
}

interface ToolUseInFlight {
  id: string;
  name: string;
  inputJson: string;
}

interface ToolExecutionRecord {
  id: string;
  name: string;
  input: unknown;
  resultText: string;
}

// Anthropic SDK types are deep namespaced; alias the few we need so
// the orchestrator body stays readable.
type AnthropicClient = ReturnType<typeof getKosAnthropicClient>;
type MessageParam = Anthropic.Messages.MessageParam;
type StreamEvent = Anthropic.Messages.RawMessageStreamEvent;
type AnthropicMessage = Anthropic.Messages.Message;

// ─── Main entry ───────────────────────────────────────────────────────

export async function* runBotTurn(
  input: RunBotTurnInput,
): AsyncGenerator<BotEvent, void, void> {
  try {
    // ── 1. Resolve / create conversation ─────────────────────────
    let conversation = await ensureConversation(input);

    // ── 2. Persist the customer message + audit ──────────────────
    await persistCustomerMessage(conversation, input);

    // 5I PR 4b1 — update the customer's locator pointer so the chat
    // UI can find this conversation on reload. Best-effort: a failed
    // update must NOT block the bot turn. On retry the next successful
    // turn will fix the pointer; worst case the customer reloads to a
    // slightly stale (but still owned) conversation.
    try {
      await prisma.kosCustomer.update({
        where: { id: input.customerId },
        data: { currentConversationId: conversation.id },
      });
    } catch (err) {
      kosLog.warn("kos_current_conv_update_failed", {
        code: "KOS_CURRENT_CONV_001",
        customerId: input.customerId,
        conversationId: conversation.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // ── 3. Load history → Anthropic message format ───────────────
    const history = await loadHistoryAsMessages(conversation.id);

    // 5I PR 2b — when the customer has attached drawings this turn,
    // append a parenthetical hint to the user message so the model sees
    // the drawing IDs and knows to call `process_drawing`. The DB-
    // persisted message (from persistCustomerMessage above) stays as-is
    // — the hint is in-memory only, for tool-routing.
    const attachmentRefs = (input.attachmentRefs ?? []).filter(
      (r) => typeof r === "string" && r.length > 0,
    );
    const messageWithAttachmentHint =
      attachmentRefs.length === 0
        ? input.customerMessage
        : `${input.customerMessage}\n\n[The customer attached ${attachmentRefs.length} drawing(s) this turn. drawing_id(s): ${attachmentRefs
            .map((id) => `"${id}"`)
            .join(", ")}. Use the process_drawing tool to parse them.]`;

    const messages: MessageParam[] = [
      ...history,
      { role: "user", content: messageWithAttachmentHint },
    ];

    // ── 4. Tool-use loop ────────────────────────────────────────
    const anthropic = getKosAnthropicClient();
    const systemPrompt = buildKalzenSystemPrompt({
      tenantName: input.tenantName,
      customerDisplayName: input.customerDisplayName,
    });

    const perTurnRetrievals: PerTurnChunk[] = [];
    let lastRetrievalAuditId: string | null = null;
    let retrievalCount = 0;
    let escalated = false;
    let accumulatedText = "";
    let stopReason: string | null = null;

    // 5I PR 2b — shared per-turn sidecar quota; passed to drawing tools.
    const sidecarCallsRemaining = {
      count: KOS_BOT_MAX_SIDECAR_CALLS_PER_TURN,
    };

    // Lazily-loaded full Tenant + KosCustomer rows. The drawing tools
    // need them (parseDrawingFromS3 + uploadKosObject take a `Tenant`).
    // Loaded once per turn on first need.
    let tenantRow: Tenant | null = null;
    let customerRow: KosCustomer | null = null;
    const loadTenant = async (): Promise<Tenant> => {
      if (tenantRow) return tenantRow;
      const t = await prisma.tenant.findUnique({
        where: { id: input.tenantId },
      });
      if (!t) {
        throw new KosError(
          "KOS_BOT_004",
          `Tenant ${input.tenantId} not found (orchestrator could not load row for drawing tool).`,
          500,
        );
      }
      tenantRow = t;
      return t;
    };
    const loadCustomer = async (): Promise<KosCustomer> => {
      if (customerRow) return customerRow;
      const c = await prisma.kosCustomer.findUnique({
        where: { id: input.customerId },
      });
      if (!c) {
        throw new KosError(
          "KOS_BOT_005",
          `KosCustomer ${input.customerId} not found (orchestrator could not load row for drawing tool).`,
          500,
        );
      }
      customerRow = c;
      return c;
    };

    let iter = 0;
    let exceededIterations = false;

    // 5I PR 3 — track which drawings have completed both BOQ and Formwork
    // so we can emit a single `drawing_status: COMPLETE` event per drawing.
    // Keyed by drawingId. Each entry starts undefined and is set when the
    // first artifact succeeds.
    const drawingArtifactProgress = new Map<
      string,
      { boqDone: boolean; formworkDone: boolean; completeEmitted: boolean }
    >();
    const noteArtifactDone = (drawingId: string, kind: "boq" | "formwork"): void => {
      const cur = drawingArtifactProgress.get(drawingId) ?? {
        boqDone: false,
        formworkDone: false,
        completeEmitted: false,
      };
      if (kind === "boq") cur.boqDone = true;
      if (kind === "formwork") cur.formworkDone = true;
      drawingArtifactProgress.set(drawingId, cur);
    };

    while (iter < KOS_BOT_MAX_ITERATIONS) {
      iter++;

      const turn = await runOneStreamingTurn({
        anthropic,
        model: KOS_BOT_MODEL,
        systemPrompt,
        messages,
        onTextDelta: (delta) => {
          accumulatedText += delta;
        },
      });

      // Yield any text deltas the streaming layer accumulated for us.
      for (const ev of turn.events) yield ev;

      stopReason = turn.stopReason;

      // Execute any tool_use blocks emitted this turn.
      const executions: ToolExecutionRecord[] = [];
      for (const tool of turn.toolUses) {
        yield {
          type: "tool_call_start",
          tool: tool.name,
          input: tool.input,
        };

        let resultPayload: unknown;
        if (tool.name === TOOL_RETRIEVE_DOCUMENTS.name) {
          const res = await executeRetrieveDocuments({
            tenantId: input.tenantId,
            conversationId: conversation.id,
            input: tool.input,
            perTurnRetrievals,
          });
          retrievalCount++;
          lastRetrievalAuditId = res.auditId;
          resultPayload = { chunks: res.chunks, auditId: res.auditId };
        } else if (tool.name === TOOL_ESCALATE_TO_HUMAN.name) {
          const res = await executeEscalateToHuman({
            tenantId: input.tenantId,
            conversationId: conversation.id,
            input: tool.input,
          });
          if (res.escalated) escalated = true;
          if (res.escalated) {
            yield { type: "escalation", reason: res.reason };
          }
          resultPayload = res.toolResult;
          // Reflect the new status on our local cache so subsequent
          // reads in this function see ESCALATED state.
          conversation = { ...conversation, status: "AWAITING_HUMAN" };
        } else if (tool.name === TOOL_PROCESS_DRAWING) {
          // 5I PR 3 — emit pre-event so UI shows "Parsing…" immediately.
          const argsAny = tool.input as ProcessDrawingArgs;
          if (argsAny?.drawing_id) {
            yield {
              type: SSE_EVT_DRAWING_STATUS,
              drawingId: argsAny.drawing_id,
              status: "PROCESSING_PARSE",
              message: "Parsing drawing",
            };
          }
          try {
            const tenant = await loadTenant();
            const customer = await loadCustomer();
            const res = await processDrawingTool(argsAny, {
              tenant,
              customer,
              sidecarCallsRemaining,
            });
            resultPayload = res;

            // 5I PR 3 — emit per-status post-event.
            if (res.status === "ready") {
              yield {
                type: SSE_EVT_DRAWING_STATUS,
                drawingId: res.drawing_id,
                status: "READY_FOR_GENERATION",
                message: res.drawing_summary.title_block_drawing_title ?? undefined,
                summary: {
                  walls: res.drawing_summary.walls_count,
                  junctions: res.drawing_summary.junctions_count,
                  openings: res.drawing_summary.openings_count,
                  titleBlockDrawingTitle:
                    res.drawing_summary.title_block_drawing_title ?? null,
                },
              };
            } else if (res.status === "needs_classification") {
              yield {
                type: SSE_EVT_CLASSIFICATION_NEEDED,
                drawingId: res.drawing_id,
                message: res.message,
                titleBlock: {
                  drawingTitle: res.title_block?.drawing_title ?? null,
                  level: res.title_block?.level ?? null,
                },
                suggestedHints: res.suggested_hints,
              };
              yield {
                type: SSE_EVT_DRAWING_STATUS,
                drawingId: res.drawing_id,
                status: "NEEDS_CLASSIFICATION",
              };
            } else if (res.status === "scanned_pdf") {
              yield {
                type: SSE_EVT_DRAWING_STATUS,
                drawingId: res.drawing_id,
                status: "FAILED",
                errorCode: "KOS_DRAWING_004",
                errorMessage: res.message,
                message: res.message,
              };
            } else if (res.status === "failed") {
              yield {
                type: SSE_EVT_DRAWING_STATUS,
                drawingId: res.drawing_id,
                status: "FAILED",
                errorCode: res.error_code,
                errorMessage: res.error_message,
              };
            }
          } catch (err) {
            resultPayload = toToolErrorPayload(err);
            // The tool itself threw (quota / C2 / infra). Surface a
            // FAILED event so the UI shows the bubble red instead of
            // hanging on "Parsing…" forever.
            if (argsAny?.drawing_id) {
              const code =
                err instanceof KosError ? err.code : "KOS_BOT_TOOL_ERR";
              const msg = err instanceof Error ? err.message : String(err);
              yield {
                type: SSE_EVT_DRAWING_STATUS,
                drawingId: argsAny.drawing_id,
                status: "FAILED",
                errorCode: code,
                errorMessage: msg,
              };
            }
          }
        } else if (tool.name === TOOL_GENERATE_BOQ) {
          const argsAny = tool.input as GenerateBoqToolArgs;
          if (argsAny?.drawing_id) {
            yield {
              type: SSE_EVT_DRAWING_STATUS,
              drawingId: argsAny.drawing_id,
              status: "GENERATING_BOQ",
              message: "Generating Bill of Quantities",
            };
          }
          try {
            const tenant = await loadTenant();
            const customer = await loadCustomer();
            const res = await generateBoqTool(argsAny, {
              tenant,
              customer,
              sidecarCallsRemaining,
            });
            resultPayload = res;

            if (res.status === "generated") {
              yield {
                type: SSE_EVT_ARTIFACT_READY,
                drawingId: res.drawing_id,
                kind: "boq",
                s3Key: res.s3_key,
                summary: {
                  boqId: res.boq_id,
                  totalStandardPanels: res.summary.total_standard_panels,
                  grandTotalInrFormatted: res.summary.grand_total_inr_formatted,
                  customQuotesPendingCount: res.summary.custom_quotes_pending_count,
                  warningsCount: res.warnings_count,
                  pendingKarthikCount: res.pending_karthik_count,
                },
              };
              noteArtifactDone(res.drawing_id, "boq");
            } else if (res.status === "failed" || res.status === "no_mapper_output") {
              yield {
                type: SSE_EVT_ARTIFACT_FAILED,
                drawingId: res.drawing_id,
                kind: "boq",
                errorCode: res.error_code,
                errorMessage: res.error_message,
              };
            }
          } catch (err) {
            resultPayload = toToolErrorPayload(err);
            if (argsAny?.drawing_id) {
              const code =
                err instanceof KosError ? err.code : "KOS_BOT_TOOL_ERR";
              const msg = err instanceof Error ? err.message : String(err);
              yield {
                type: SSE_EVT_ARTIFACT_FAILED,
                drawingId: argsAny.drawing_id,
                kind: "boq",
                errorCode: code,
                errorMessage: msg,
              };
            }
          }

          // Same COMPLETE check as in the Formwork branch — model may
          // dispatch BOQ AFTER Formwork, in which case the check must
          // fire here too. completeEmitted flag prevents double-emit.
          for (const [drawingId, progress] of drawingArtifactProgress.entries()) {
            if (progress.boqDone && progress.formworkDone && !progress.completeEmitted) {
              progress.completeEmitted = true;
              yield {
                type: SSE_EVT_DRAWING_STATUS,
                drawingId,
                status: "COMPLETE",
              };
            }
          }
        } else if (tool.name === TOOL_GENERATE_FORMWORK) {
          const argsAny = tool.input as GenerateFormworkToolArgs;
          if (argsAny?.drawing_id) {
            yield {
              type: SSE_EVT_DRAWING_STATUS,
              drawingId: argsAny.drawing_id,
              status: "GENERATING_FORMWORK",
              message: "Generating Formwork quantities",
            };
          }
          try {
            const tenant = await loadTenant();
            const customer = await loadCustomer();
            const res = await generateFormworkTool(argsAny, {
              tenant,
              customer,
              sidecarCallsRemaining,
            });
            resultPayload = res;

            if (res.status === "generated") {
              yield {
                type: SSE_EVT_ARTIFACT_READY,
                drawingId: res.drawing_id,
                kind: "formwork",
                s3Key: res.s3_key,
                summary: {
                  formworkId: res.formwork_id,
                  propsCount: res.summary.total_props,
                  walersCount: res.summary.total_walers,
                  kickersCount: res.summary.total_kickers,
                  starterTrackMeters: res.summary.total_starter_track_meters,
                  warningsCount: res.warnings_count,
                  pendingKarthikCount: res.pending_karthik_count,
                },
              };
              noteArtifactDone(res.drawing_id, "formwork");
            } else if (res.status === "failed" || res.status === "no_mapper_output") {
              yield {
                type: SSE_EVT_ARTIFACT_FAILED,
                drawingId: res.drawing_id,
                kind: "formwork",
                errorCode: res.error_code,
                errorMessage: res.error_message,
              };
            }
          } catch (err) {
            resultPayload = toToolErrorPayload(err);
            if (argsAny?.drawing_id) {
              const code =
                err instanceof KosError ? err.code : "KOS_BOT_TOOL_ERR";
              const msg = err instanceof Error ? err.message : String(err);
              yield {
                type: SSE_EVT_ARTIFACT_FAILED,
                drawingId: argsAny.drawing_id,
                kind: "formwork",
                errorCode: code,
                errorMessage: msg,
              };
            }
          }

          // After every tool dispatch where the drawing has both BOQ +
          // Formwork generated, emit COMPLETE once.
          for (const [drawingId, progress] of drawingArtifactProgress.entries()) {
            if (progress.boqDone && progress.formworkDone && !progress.completeEmitted) {
              progress.completeEmitted = true;
              yield {
                type: SSE_EVT_DRAWING_STATUS,
                drawingId,
                status: "COMPLETE",
              };
            }
          }
        } else if (tool.name === TOOL_GENERATE_SHOP_DRAWING) {
          try {
            resultPayload = await generateShopDrawingTool(
              tool.input as GenerateShopDrawingToolArgs,
            );
          } catch (err) {
            resultPayload = toToolErrorPayload(err);
          }
        } else {
          // Unknown tool name — Anthropic returned a tool we didn't
          // define. Surface as a tool error so the model can recover.
          resultPayload = {
            error: `Unknown tool "${tool.name}". Available: retrieve_documents, escalate_to_human, process_drawing, generate_boq, generate_formwork, generate_shop_drawing.`,
          };
        }

        yield {
          type: "tool_call_result",
          tool: tool.name,
          output: resultPayload,
        };

        executions.push({
          id: tool.id,
          name: tool.name,
          input: tool.input,
          resultText:
            typeof resultPayload === "string"
              ? resultPayload
              : JSON.stringify(resultPayload),
        });
      }

      if (stopReason !== "tool_use" || executions.length === 0) {
        // end_turn / stop_sequence / max_tokens — model is done.
        break;
      }

      // Append the assistant's tool-use turn + the user's tool-result
      // turn, then loop for another model call.
      messages.push({
        role: "assistant",
        content: turn.finalMessage.content,
      });
      messages.push({
        role: "user",
        content: executions.map((e) => ({
          type: "tool_result" as const,
          tool_use_id: e.id,
          content: e.resultText,
        })),
      });

      if (iter === KOS_BOT_MAX_ITERATIONS && stopReason === "tool_use") {
        exceededIterations = true;
        break;
      }
    }

    if (exceededIterations) {
      yield {
        type: "error",
        code: "KOS_BOT_002",
        message: `Max tool-use iterations (${KOS_BOT_MAX_ITERATIONS}) exceeded — bot stopped without a final answer.`,
      };
      // Still persist whatever text we have — partial answer is
      // better than silence for debugging.
    }

    // ── 5. Citations: parse [N] markers from accumulated text ────
    const citations = mapCitationMarkers(accumulatedText, perTurnRetrievals);

    // ── 6. Persist the BOT message + final audit ─────────────────
    const botMessage = await prisma.kosMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        channel: "WEB",
        authorType: "BOT",
        content: accumulatedText,
        citations: citations as unknown as object, // Prisma Json
        retrievalAuditId: lastRetrievalAuditId,
        llmMetadata: {
          model: KOS_BOT_MODEL,
          toolIterations: iter,
          retrievalCount,
          escalated,
          exceededIterations,
        },
      },
    });

    await prisma.kosConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    await prisma.kosAuditLog.create({
      data: {
        tenantId: input.tenantId,
        conversationId: conversation.id,
        actorType: "BOT",
        action: KOS_AUDIT.BOT_RESPONSE,
        details: {
          messageId: botMessage.id,
          citationCount: citations.length,
          retrievalCount,
          escalated,
          exceededIterations,
          toolIterations: iter,
        },
      },
    });

    yield { type: "citations", citations };
    yield {
      type: "done",
      messageId: botMessage.id,
      conversationId: conversation.id,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    yield {
      type: "error",
      code: err instanceof KosError ? err.code : "KOS_BOT_003",
      message,
    };
    throw err;
  }
}

// ─── Helpers — conversation + history ────────────────────────────────

async function ensureConversation(
  input: RunBotTurnInput,
): Promise<KosConversation> {
  if (input.conversationId) {
    const existing = await prisma.kosConversation.findUnique({
      where: { id: input.conversationId },
    });
    if (
      existing &&
      existing.tenantId === input.tenantId &&
      existing.customerId === input.customerId
    ) {
      return existing;
    }
    // Mismatched conversationId — refuse rather than silently
    // creating a new one (the chat route validates this upstream
    // too; this is defence in depth).
    throw new KosError(
      "KOS_CHAT_003",
      `Conversation ${input.conversationId} not found for this customer/tenant.`,
      403,
    );
  }
  return prisma.kosConversation.create({
    data: {
      tenantId: input.tenantId,
      customerId: input.customerId,
      channel: "WEB",
      status: "BOT_ACTIVE", // spec "ACTIVE" → existing BOT_ACTIVE
    },
  });
}

async function persistCustomerMessage(
  conversation: KosConversation,
  input: RunBotTurnInput,
): Promise<KosMessage> {
  // 5I PR 4b1 — persist attachmentRefs so PR 4b2 reload-hydration can
  // re-render ArtifactBubbles under their original turn. Omit the field
  // entirely when empty (Prisma → SQL NULL); the JSONB column stays
  // sparse and `WHERE attachmentRefs IS NOT NULL` reliably picks out
  // turns with attachments.
  const refs = (input.attachmentRefs ?? []).filter(
    (r) => typeof r === "string" && r.length > 0,
  );
  const msg = await prisma.kosMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      channel: "WEB",
      authorType: "CUSTOMER",
      authorId: input.customerId,
      content: input.customerMessage,
      ...(refs.length > 0
        ? { attachmentRefs: refs as unknown as object }
        : {}),
    },
  });
  await prisma.kosConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  await prisma.kosAuditLog.create({
    data: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      actorType: "CUSTOMER",
      actorId: input.customerId,
      action: KOS_AUDIT.CUSTOMER_MESSAGE,
      details: {
        messageId: msg.id,
        contentLength: input.customerMessage.length,
      },
    },
  });
  return msg;
}

async function loadHistoryAsMessages(
  conversationId: string,
): Promise<MessageParam[]> {
  const rows = await prisma.kosMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: KOS_BOT_HISTORY_DEPTH,
  });

  // The customer turn we're about to send is ALREADY in the DB
  // (persistCustomerMessage just inserted it). Drop the most recent
  // CUSTOMER message so we don't double-append it on the caller side.
  let stripLastCustomer = false;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].authorType === "CUSTOMER") {
      stripLastCustomer = true;
      rows.splice(i, 1);
      break;
    }
  }
  void stripLastCustomer;

  const messages: MessageParam[] = [];
  for (const m of rows) {
    if (m.authorType === "SYSTEM") continue;
    const role: "user" | "assistant" =
      m.authorType === "CUSTOMER" ? "user" : "assistant";
    // BD_HUMAN messages collapse to assistant role with the raw
    // content for Phase 3A — Phase 5 will introduce a richer
    // hand-off semantic.
    messages.push({ role, content: m.content });
  }
  return messages;
}

// ─── Streaming layer (one Anthropic call) ─────────────────────────────

interface OneStreamingTurnResult {
  events: BotEvent[];
  toolUses: Array<{ id: string; name: string; input: unknown }>;
  stopReason: string | null;
  finalMessage: AnthropicMessage;
}

async function runOneStreamingTurn(args: {
  anthropic: AnthropicClient;
  model: string;
  systemPrompt: string;
  messages: MessageParam[];
  onTextDelta: (delta: string) => void;
}): Promise<OneStreamingTurnResult> {
  const events: BotEvent[] = [];
  const toolUses: Array<{ id: string; name: string; input: unknown }> = [];

  // We need raw streaming events so we can intercept input_json_delta
  // for tool inputs. `messages.stream(...)` returns a MessageStream
  // that's both an EventEmitter (high-level events) AND an async
  // iterable of the raw events. We iterate the raw events here.
  const stream = args.anthropic.messages.stream({
    model: args.model,
    max_tokens: KOS_BOT_MAX_TOKENS,
    system: args.systemPrompt,
    tools: TOOLS,
    messages: args.messages,
  });

  // Track in-flight tool_use blocks by content-block index. Anthropic
  // emits `input_json_delta` events for each tool_use partial input;
  // we concatenate per-index until content_block_stop fires.
  const inFlight = new Map<number, ToolUseInFlight>();
  let stopReason: string | null = null;

  for await (const event of stream as AsyncIterable<StreamEvent>) {
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "tool_use") {
          inFlight.set(event.index, {
            id: block.id,
            name: block.name,
            inputJson: "",
          });
        }
        break;
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          args.onTextDelta(delta.text);
          events.push({ type: "text_delta", text: delta.text });
        } else if (delta.type === "input_json_delta") {
          const slot = inFlight.get(event.index);
          if (slot) slot.inputJson += delta.partial_json;
        }
        break;
      }
      case "content_block_stop": {
        const slot = inFlight.get(event.index);
        if (slot) {
          let parsedInput: unknown = {};
          try {
            parsedInput = slot.inputJson ? JSON.parse(slot.inputJson) : {};
          } catch {
            parsedInput = { __parseError: true, raw: slot.inputJson };
          }
          toolUses.push({
            id: slot.id,
            name: slot.name,
            input: parsedInput,
          });
          inFlight.delete(event.index);
        }
        break;
      }
      case "message_delta": {
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
        break;
      }
      default:
        break;
    }
  }

  const finalMessage = await stream.finalMessage();
  if (!stopReason) stopReason = finalMessage.stop_reason ?? null;

  return { events, toolUses, stopReason, finalMessage };
}

// ─── Tool handlers ────────────────────────────────────────────────────

interface RetrieveDocumentsArgs {
  tenantId: string;
  conversationId: string;
  input: unknown;
  perTurnRetrievals: PerTurnChunk[];
}

async function executeRetrieveDocuments(
  args: RetrieveDocumentsArgs,
): Promise<{
  chunks: Array<{
    index: number;
    chunkId: string;
    documentId: string;
    title: string;
    pageNum: number | null;
    content: string;
    similarity: number;
  }>;
  auditId: string;
}> {
  const parsed = parseRetrieveDocumentsInput(args.input);

  const chunks = await retrieveChunks(args.tenantId, parsed.query, {
    topK: parsed.topK ?? 5,
    docTypes: parsed.docTypes,
  });

  const audit = await prisma.kosAuditLog.create({
    data: {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      actorType: "BOT",
      action: KOS_AUDIT.BOT_RETRIEVAL,
      details: {
        query: parsed.query,
        topK: parsed.topK ?? 5,
        docTypes: parsed.docTypes ?? null,
        chunkIds: chunks.map((c) => c.chunkId),
        similarities: chunks.map((c) => c.similarity),
      },
    },
  });

  const baseIndex = args.perTurnRetrievals.length;
  for (const c of chunks) {
    args.perTurnRetrievals.push({
      chunkId: c.chunkId,
      documentId: c.documentId,
      title: c.documentTitle,
      pageNum: c.pageNum,
      content: c.content,
      similarity: c.similarity,
    });
  }

  return {
    chunks: chunks.map((c, i) => ({
      index: baseIndex + i + 1,
      chunkId: c.chunkId,
      documentId: c.documentId,
      title: c.documentTitle,
      pageNum: c.pageNum,
      content: c.content,
      similarity: c.similarity,
    })),
    auditId: audit.id,
  };
}

interface ParsedRetrieveInput {
  query: string;
  topK?: number;
  docTypes?: KosDocType[];
}

const ALLOWED_DOC_TYPES = new Set<KosDocType>([
  "PAC",
  "CERTIFICATE",
  "CASE_STUDY",
  "PRICING",
  "COMPARISON",
  "FAQ",
  "WARRANTY",
  "OTHER",
]);

function parseRetrieveDocumentsInput(raw: unknown): ParsedRetrieveInput {
  if (!raw || typeof raw !== "object") {
    throw new KosError(
      "KOS_BOT_011",
      "retrieve_documents called with non-object input.",
      400,
    );
  }
  const obj = raw as Record<string, unknown>;
  const query = typeof obj.query === "string" ? obj.query.trim() : "";
  if (!query) {
    throw new KosError(
      "KOS_BOT_012",
      "retrieve_documents requires a non-empty `query` string.",
      400,
    );
  }
  let topK: number | undefined;
  if (typeof obj.topK === "number" && Number.isFinite(obj.topK)) {
    topK = Math.max(1, Math.min(10, Math.floor(obj.topK)));
  }
  let docTypes: KosDocType[] | undefined;
  if (Array.isArray(obj.docTypes)) {
    const filtered = obj.docTypes
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toUpperCase())
      .filter((t): t is KosDocType => ALLOWED_DOC_TYPES.has(t as KosDocType));
    if (filtered.length > 0) docTypes = filtered;
  }
  return { query, topK, docTypes };
}

interface EscalateArgs {
  tenantId: string;
  conversationId: string;
  input: unknown;
}

async function executeEscalateToHuman(args: EscalateArgs): Promise<{
  escalated: boolean;
  reason: string;
  toolResult: unknown;
}> {
  const parsed = parseEscalationInput(args.input);

  await prisma.kosConversation.update({
    where: { id: args.conversationId },
    data: {
      status: "AWAITING_HUMAN", // spec "ESCALATED" → AWAITING_HUMAN
      escalationReason: parsed.reason,
    },
  });

  await prisma.kosAuditLog.create({
    data: {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      actorType: "BOT",
      action: KOS_AUDIT.BOT_ESCALATION,
      details: {
        reason: parsed.reason,
        customerSummary: parsed.customerSummary,
        conversationId: args.conversationId,
      },
    },
  });

  return {
    escalated: true,
    reason: parsed.reason,
    toolResult: {
      ok: true,
      message: "Conversation escalated. A human will follow up.",
    },
  };
}

function parseEscalationInput(raw: unknown): {
  reason: string;
  customerSummary: string;
} {
  if (!raw || typeof raw !== "object") {
    throw new KosError(
      "KOS_BOT_013",
      "escalate_to_human called with non-object input.",
      400,
    );
  }
  const obj = raw as Record<string, unknown>;
  const reason =
    typeof obj.reason === "string" ? obj.reason.trim() : "";
  const customerSummary =
    typeof obj.customerSummary === "string"
      ? obj.customerSummary.trim()
      : "";
  if (!reason || !customerSummary) {
    throw new KosError(
      "KOS_BOT_014",
      "escalate_to_human requires both `reason` and `customerSummary`.",
      400,
    );
  }
  return { reason, customerSummary };
}

// ─── 5I PR 2b — drawing-tool error envelope ─────────────────────────
//
// Drawing tools (process_drawing / generate_boq / generate_formwork)
// throw KosError for true infrastructure failures (C2 boundary, S3 PUT
// failure, quota exhausted). The model needs to see those errors in a
// shape it can reason about — surface a structured payload, not a
// thrown exception that would tear down the whole turn.
function toToolErrorPayload(err: unknown): {
  error_code: string;
  error_message: string;
} {
  if (err instanceof KosError) {
    return { error_code: err.code, error_message: err.message };
  }
  return {
    error_code: "KOS_TOOL_INTERNAL_001",
    error_message: err instanceof Error ? err.message : String(err),
  };
}

// ─── Citation mapper ─────────────────────────────────────────────────

function mapCitationMarkers(
  finalText: string,
  perTurnRetrievals: PerTurnChunk[],
): BotCitation[] {
  const indices = new Set<number>();
  const re = /\[(\d+)\]/g;
  for (const m of finalText.matchAll(re)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1) indices.add(n);
  }
  const out: BotCitation[] = [];
  for (const n of indices) {
    const chunk = perTurnRetrievals[n - 1];
    if (!chunk) continue;
    out.push({
      documentId: chunk.documentId,
      chunkId: chunk.chunkId,
      pageNum: chunk.pageNum,
      snippet: chunk.content.slice(0, 200),
      title: chunk.title,
    });
  }
  return out;
}
