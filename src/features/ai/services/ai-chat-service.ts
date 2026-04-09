/**
 * AI Chat Service — GPT-4o-mini powered workflow assistant.
 * Sends the full 31-node catalogue + current workflow state to the LLM,
 * which returns natural language + structured JSON actions.
 */

import { NODE_CATALOGUE } from "@/features/workflows/constants/node-catalogue";
import type { NodeCatalogueItem } from "@/types/nodes";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatAction {
  type: "add" | "remove" | "replace";
  nodeId?: string;
  connectFrom?: string;
  oldNodeId?: string;
  newNodeId?: string;
}

export interface ChatResponse {
  message: string;
  actions: ChatAction[];
}

interface WorkflowNodeSummary {
  instanceId: string;
  catalogueId: string;
  label: string;
}

interface WorkflowEdgeSummary {
  source: string;
  target: string;
}

// ─── Build catalogue context (cached) ────────────────────────────────────────

let _catalogueContext: string | null = null;

function getCatalogueContext(): string {
  if (_catalogueContext) return _catalogueContext;

  const lines = NODE_CATALOGUE.map((n: NodeCatalogueItem) => {
    const ins = n.inputs.map(i => i.label).join(", ") || "none";
    const outs = n.outputs.map(o => o.label).join(", ") || "none";
    return `- ${n.id} "${n.name}" [${n.category}]: ${n.description}. Inputs: ${ins}. Outputs: ${outs}.`;
  });

  _catalogueContext = lines.join("\n");
  return _catalogueContext;
}

// ─── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(
  nodes: WorkflowNodeSummary[],
  edges: WorkflowEdgeSummary[]
): string {
  const catalogue = getCatalogueContext();

  const nodeList = nodes.length > 0
    ? nodes.map(n => `  - ${n.instanceId} → ${n.catalogueId} "${n.label}"`).join("\n")
    : "  (empty canvas)";

  const edgeList = edges.length > 0
    ? edges.map(e => `  - ${e.source} → ${e.target}`).join("\n")
    : "  (no connections)";

  return `You are BuildFlow's AI workflow assistant for architects and engineers. You help users build and modify visual node-based workflows for AEC (Architecture, Engineering, Construction) projects.

AVAILABLE NODES (${NODE_CATALOGUE.length} total):
${catalogue}

CURRENT WORKFLOW:
Nodes:
${nodeList}
Edges:
${edgeList}

YOUR CAPABILITIES:
1. Add nodes to the workflow
2. Remove nodes from the workflow
3. Replace one node with another
4. Explain what the current workflow does
5. Suggest improvements or missing steps

RESPONSE FORMAT:
Always respond with:
1. A concise natural language explanation (2-4 sentences, use **bold** for node names)
2. If you're making changes, append a JSON action block on its own line:

ACTIONS_JSON:{"actions":[{"type":"add","nodeId":"TR-008","connectFrom":"TR-007"},{"type":"remove","nodeId":"GN-003"}]}

Action types:
- {"type":"add","nodeId":"XX-NNN","connectFrom":"INSTANCE_ID"} — add node, optionally connect from existing node
- {"type":"remove","nodeId":"XX-NNN"} — remove first instance of this node type
- {"type":"replace","oldNodeId":"XX-NNN","newNodeId":"YY-NNN"} — swap one node for another

Rules:
- Only suggest nodes from the catalogue above
- Keep connections logical (output types should match input types)
- connectFrom should reference a catalogueId of an existing node on the canvas
- If the user asks a question (not a modification), just explain — no ACTIONS_JSON needed
- Be helpful, professional, and concise`;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

const sessionCounts = new Map<string, { count: number; resetAt: number }>();
const MAX_MESSAGES_PER_SESSION = 30;
const SESSION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const entry = sessionCounts.get(sessionId);

  if (!entry || now > entry.resetAt) {
    sessionCounts.set(sessionId, { count: 1, resetAt: now + SESSION_WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_MESSAGES_PER_SESSION) return false;
  entry.count++;
  return true;
}

// ─── Main function ───────────────────────────────────────────────────────────

export async function processWorkflowChat(
  message: string,
  nodes: WorkflowNodeSummary[],
  edges: WorkflowEdgeSummary[],
  sessionId: string = "default"
): Promise<ChatResponse> {
  // Rate limit check
  if (!checkRateLimit(sessionId)) {
    return {
      message: "You've reached the chat limit for this session (30 messages). Please start a new workflow session to continue.",
      actions: [],
    };
  }

  const systemPrompt = buildSystemPrompt(nodes, edges);

  const res = await fetch("/api/ai-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, systemPrompt }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>).error || "AI chat request failed");
  }

  const data = (await res.json()) as { reply: string };
  return parseAIResponse(data.reply);
}

// ─── Parse AI response ───────────────────────────────────────────────────────

function parseAIResponse(reply: string): ChatResponse {
  const actionMarker = "ACTIONS_JSON:";
  const idx = reply.indexOf(actionMarker);

  if (idx === -1) {
    return { message: reply.trim(), actions: [] };
  }

  const message = reply.slice(0, idx).trim();
  const jsonStr = reply.slice(idx + actionMarker.length).trim();

  try {
    const parsed = JSON.parse(jsonStr) as { actions: ChatAction[] };
    return {
      message,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    };
  } catch {
    return { message: reply.trim(), actions: [] };
  }
}
