/**
 * Support Chat Service — Claude Haiku-powered support assistant.
 *
 * Uses Anthropic Claude for intelligent support conversations.
 * Falls back to OpenAI GPT-4o-mini if Claude is unavailable.
 *
 * Capabilities:
 * - Rich system prompt with full product knowledge
 * - Dynamic context injection (user plan, usage, page)
 * - Auto-categorization of conversations
 * - Subject generation from first message
 * - Conversation summary for admin escalation
 * - Smart reply suggestions
 * - Confidence scoring
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type {
  SupportCategory,
  SupportMessage,
  SupportMessageMeta,
} from "@/types/support";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatContext {
  userPlan: string;
  userName: string | null;
  remainingExecutions?: number;
  workflowCount?: number;
  pageContext?: string;
  previousMessages: Array<{ role: "USER" | "AI" | "ADMIN" | "SYSTEM"; content: string }>;
}

export interface ChatResult {
  content: string;
  metadata: SupportMessageMeta;
}

// ─── System Prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: ChatContext): string {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return `You are BuildFlow's AI support assistant. BuildFlow is a visual workflow automation platform for AEC (Architecture, Engineering & Construction) professionals. Users drag-and-drop nodes onto a canvas to build pipelines that parse IFC files, run AI analysis, generate 3D models and renders, estimate costs, and export deliverables.

${greeting}! The user's name is ${ctx.userName || "there"}.

══ USER CONTEXT ══
- Current plan: ${ctx.userPlan}
${ctx.remainingExecutions !== undefined ? `- Remaining executions this month: ${ctx.remainingExecutions}` : ""}
${ctx.workflowCount !== undefined ? `- Workflows created: ${ctx.workflowCount}` : ""}
${ctx.pageContext ? `- Currently on: ${ctx.pageContext}` : ""}

══ AVAILABLE NODE TYPES (31 total) ══

INPUT NODES (Blue):
- IN-001 Text Prompt: Free-text input from user
- IN-002 PDF Upload: Upload project briefs, zoning docs
- IN-003 Image Upload: Reference images, sketches, floor plans
- IN-004 IFC Upload: BIM model files
- IN-005 Parameter Input: Numeric entries (floors, height, area)
- IN-006 Location Input: Geographic location via address
- IN-007 DXF/DWG Upload: CAD drawing files
- IN-008 Multi-Image Upload: Multiple building photos

TRANSFORM / AI NODES (Brown):
- TR-001 Brief Parser: Extract requirements from PDFs
- TR-002 Requirements Extractor: Text → structured requirements
- TR-003 Design Brief Analyzer: Text → building program with areas, floors
- TR-004 Image Understanding: Vision analysis of reference images
- TR-005 Visualization Style Composer: Create rendering parameters
- TR-007 Quantity Extractor: Extract quantities from IFC (CSI MasterFormat)
- TR-008 BOQ / Cost Mapper: Map quantities to costs with unit prices
- TR-012 GIS Context Loader: Load site terrain and context
- TR-015 Market Intelligence Agent: Live construction material prices
- TR-016 Clash Detector: Detect spatial overlaps in building elements

GENERATE NODES (Gold):
- GN-001 Massing Generator: Text-to-3D building massing
- GN-003 Concept Render Generator: Photorealistic renders via DALL-E 3
- GN-004 Floor Plan Generator: 2D layouts from room program
- GN-007 Image to 3D (SAM 3D): Building image → 3D GLB model
- GN-008 Text to 3D Generator: Text → 3D model
- GN-009 Video Walkthrough Generator: Cinematic video from renders
- GN-010 Hi-Fi 3D Reconstructor: Multi-view → detailed 3D mesh
- GN-011 Interactive 3D Viewer: Floor plan → explorable 3D
- GN-012 Floor Plan Editor: Interactive 2D CAD editor

EXPORT NODES (Cyan):
- EX-001 IFC Exporter: Download IFC4 file
- EX-002 BOQ / Spreadsheet Exporter: XLSX/CSV export
- EX-003 PDF Report Generator: Formatted PDF reports

══ PRICING PLANS ══
- FREE (₹0): 3 executions/month, 3 workflows, 1 render
- MINI (₹99/mo): 10 executions/month, 10 workflows, 3 renders
- STARTER (₹799/mo): 30 executions/month, 30 workflows, 3 video walkthroughs, 3 AI 3D models, 10 renders
- PRO (₹1999/mo): 100 executions/month, 100 workflows, 7 video walkthroughs, 10 AI 3D models, 30 renders
- TEAM (₹4999/mo): Unlimited everything, team management

══ COMMON WORKFLOW PATTERNS ══
1. IFC → BOQ Pipeline: IN-004 (IFC Upload) → TR-007 (Quantity Extractor) → TR-015 (Market Intelligence) → TR-008 (BOQ Cost Mapper) → EX-002 (Spreadsheet Export)
2. Text → 3D Pipeline: IN-001 (Text Prompt) → TR-003 (Design Brief) → GN-001 (Massing Generator) → EX-001 (IFC Export)
3. Floor Plan → 3D: IN-003 (Image Upload) → TR-004 (Image Understanding) → GN-011 (Interactive 3D Viewer)
4. Clash Detection: IN-004 (IFC Upload) → TR-016 (Clash Detector) → EX-003 (PDF Report)

══ HOW TO USE BUILDFLOW ══
1. Create a workflow from Dashboard → "New Workflow"
2. Add nodes from the Node Library panel (left sidebar or Cmd+K palette)
3. Connect nodes by dragging from output port to input port
4. Configure node settings by clicking on each node
5. Click "Execute" in the toolbar to run the workflow
6. View results in the Result Showcase panel
7. Export results using Export nodes or the download buttons

══ COMMON ISSUES & SOLUTIONS ══
- "Rate limit reached": User has used all monthly executions. Upgrade plan or wait for reset.
- "Node execution failed": Usually an API timeout. Try again. If persistent, check if the input is valid.
- "IFC parse failed": File may be corrupted or use an unsupported IFC version. Try re-exporting from the BIM tool.
- "3D generation taking long": 3D generation can take 1-3 minutes. This is normal.
- "Video generation failed": Kling AI service may be temporarily unavailable. Try again in a few minutes.

══ BILLING ══
- Upgrade: Dashboard → Billing → Choose plan. Payment via Stripe (global) or Razorpay (India).
- Cancel: Dashboard → Billing → Manage Subscription → Cancel. Access continues until period end.
- Invoices: Available in the Stripe/Razorpay customer portal.
- Referral program: Share your referral code from Dashboard. Each successful referral gives both users bonus executions.

══ BEHAVIORAL RULES ══
- NEVER make up features that don't exist. Only reference nodes and features listed above.
- NEVER promise specific timelines for feature releases.
- NEVER ask users for passwords, payment card numbers, or sensitive personal data.
- If unsure, say "I'm not 100% certain about that. Would you like me to connect you with our team?"
- Be concise — max 3 paragraphs per response unless the user asks for detail.
- Use markdown: **bold** for emphasis, \`code\` for technical terms, bullet lists for steps.
- If the user seems frustrated (exclamation marks, CAPS, negative words), proactively offer escalation.
- If the user mentions payment/billing problems, IMMEDIATELY offer escalation — don't troubleshoot payments.
- For bug reports, collect: what they were doing, what happened, what they expected — then offer escalation.
- End responses about limitations with "Would you like me to pass this feedback to our team?"
- Match the user's language when possible, but default to English.`;
}

// ─── Category Detection ─────────────────────────────────────────────────────

export function detectCategory(message: string): SupportCategory {
  const lower = message.toLowerCase();

  if (/\b(price|plan|upgrade|payment|billing|subscription|cancel|invoice|refund|charge)\b/.test(lower)) {
    return "BILLING";
  }
  if (/\b(error|fail|broken|bug|crash|not\s+work|doesn.t\s+work|issue)\b/.test(lower)) {
    if (/\b(ifc|bim|model\s+file)\b/.test(lower)) return "IFC_PARSING";
    if (/\b(3d|render|video|massing|mesh)\b/.test(lower)) return "THREE_D_GENERATION";
    if (/\b(cost|boq|estimate|quantity|price)\b/.test(lower)) return "COST_ESTIMATION";
    return "NODE_EXECUTION";
  }
  if (/\b(ifc|bim|model\s+file|parse)\b/.test(lower)) return "IFC_PARSING";
  if (/\b(cost|boq|estimate|quantity|bill\s+of)\b/.test(lower)) return "COST_ESTIMATION";
  if (/\b(3d|render|video|walkthrough|massing|mesh|texture)\b/.test(lower)) return "THREE_D_GENERATION";
  if (/\b(how\s+to|how\s+do\s+i|tutorial|help\s+me|guide|step)\b/.test(lower)) return "WORKFLOW_HELP";
  if (/\b(feature|request|wish|would\s+be\s+nice|suggest|add\s+a)\b/.test(lower)) return "FEATURE_REQUEST";
  if (/\b(bug|report|wrong|incorrect)\b/.test(lower)) return "BUG_REPORT";
  if (/\b(account|password|login|email|profile|sign\s+in|sign\s+up)\b/.test(lower)) return "ACCOUNT";
  if (/\b(api|code|technical|integration|webhook|sdk)\b/.test(lower)) return "TECHNICAL";

  return "GENERAL";
}

// ─── Confidence Scoring ─────────────────────────────────────────────────────

function scoreConfidence(content: string): "HIGH" | "MEDIUM" | "LOW" {
  const low = content.toLowerCase();
  const uncertainPhrases = [
    "i think", "i'm not sure", "i believe", "might", "possibly",
    "not 100%", "may not be", "could be", "i don't have",
  ];
  const uncertainCount = uncertainPhrases.filter((p) => low.includes(p)).length;
  if (uncertainCount >= 2) return "LOW";
  if (uncertainCount === 1) return "MEDIUM";
  return "HIGH";
}

// ─── Generate Suggestions ───────────────────────────────────────────────────

function generateSuggestions(
  aiContent: string,
  category: SupportCategory,
): string[] {
  const suggestions: string[] = [];

  if (category === "WORKFLOW_HELP") {
    if (aiContent.includes("node")) suggestions.push("Show me all available nodes");
    if (aiContent.includes("execute") || aiContent.includes("run")) suggestions.push("Why did my execution fail?");
    suggestions.push("Show me a workflow example");
  } else if (category === "BILLING") {
    suggestions.push("How do I upgrade my plan?");
    suggestions.push("What does each plan include?");
  } else if (category === "NODE_EXECUTION") {
    suggestions.push("What are common causes?");
    suggestions.push("Can I retry the execution?");
  } else if (category === "IFC_PARSING") {
    suggestions.push("What IFC versions are supported?");
    suggestions.push("How do I re-export my IFC file?");
  } else if (category === "COST_ESTIMATION") {
    suggestions.push("How accurate are estimates?");
    suggestions.push("Can I customize unit rates?");
  } else if (category === "THREE_D_GENERATION") {
    suggestions.push("How long does 3D generation take?");
    suggestions.push("What affects 3D quality?");
  } else {
    suggestions.push("Tell me more about BuildFlow");
    suggestions.push("What workflows can I create?");
  }

  // Always include escalation option
  suggestions.push("Talk to our team");

  return suggestions.slice(0, 3);
}

// ─── Main Chat Function ─────────────────────────────────────────────────────

export async function generateSupportResponse(
  userMessage: string,
  ctx: ChatContext,
): Promise<ChatResult> {
  const startTime = Date.now();
  const systemPrompt = buildSystemPrompt(ctx);
  const category = detectCategory(userMessage);

  // Build message history for Claude
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const recentMessages = ctx.previousMessages.slice(-20);
  for (const msg of recentMessages) {
    if (msg.role === "USER") {
      messages.push({ role: "user", content: msg.content });
    } else if (msg.role === "AI" || msg.role === "ADMIN") {
      messages.push({ role: "assistant", content: msg.content });
    }
    // Skip SYSTEM messages in AI context
  }
  // Add current message
  messages.push({ role: "user", content: userMessage });

  // Try Anthropic Claude first
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20241022",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });

      const content =
        response.content[0]?.type === "text"
          ? response.content[0].text
          : "I couldn't generate a response.";

      const latencyMs = Date.now() - startTime;
      const confidence = scoreConfidence(content);
      const suggestions = generateSuggestions(content, category);

      return {
        content,
        metadata: {
          model: "claude-haiku-4-5-20241022",
          tokens: response.usage.input_tokens + response.usage.output_tokens,
          latencyMs,
          confidence,
          suggestedCategory: category,
          suggestions,
        },
      };
    } catch (err) {
      console.error("[support-chat] Anthropic error, falling back to OpenAI:", err);
    }
  }

  // Fallback to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const client = new OpenAI({ apiKey: openaiKey });
      const openaiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...messages,
      ];

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: openaiMessages,
        max_tokens: 1024,
        temperature: 0.3,
      });

      const content = completion.choices[0]?.message?.content || "I couldn't generate a response.";
      const latencyMs = Date.now() - startTime;
      const confidence = scoreConfidence(content);
      const suggestions = generateSuggestions(content, category);

      return {
        content,
        metadata: {
          model: "gpt-4o-mini",
          tokens: completion.usage?.total_tokens ?? 0,
          latencyMs,
          confidence,
          suggestedCategory: category,
          suggestions,
        },
      };
    } catch (err) {
      console.error("[support-chat] OpenAI fallback error:", err);
    }
  }

  // Both failed
  const suggestions = ["Talk to our team"];
  return {
    content:
      "I'm having trouble thinking right now. Would you like to send your question directly to our team? Click **\"Talk to our team\"** below and we'll get back to you as soon as possible.",
    metadata: {
      model: "fallback",
      latencyMs: Date.now() - startTime,
      confidence: "LOW",
      suggestedCategory: category,
      suggestions,
    },
  };
}

// ─── Subject Generation ─────────────────────────────────────────────────────

export async function generateSubject(firstMessage: string): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return firstMessage.slice(0, 60).trim() + (firstMessage.length > 60 ? "…" : "");
  }

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20241022",
      max_tokens: 30,
      system: "Generate a 5-8 word subject line summarizing the user's support question. Return ONLY the subject line, no quotes or punctuation at the end.",
      messages: [{ role: "user", content: firstMessage }],
    });

    const text =
      response.content[0]?.type === "text"
        ? response.content[0].text.trim()
        : null;

    return text || firstMessage.slice(0, 60).trim();
  } catch {
    return firstMessage.slice(0, 60).trim() + (firstMessage.length > 60 ? "…" : "");
  }
}

// ─── Conversation Summary for Escalation ────────────────────────────────────

export async function generateConversationSummary(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || messages.length === 0) {
    return "User requested human support.";
  }

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const transcript = messages
      .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
      .join("\n");

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20241022",
      max_tokens: 150,
      system: "Summarize this support conversation in 2-3 sentences for an admin reviewer. Focus on what the user needs and what the AI could not resolve. Be factual and concise.",
      messages: [{ role: "user", content: transcript }],
    });

    const text =
      response.content[0]?.type === "text"
        ? response.content[0].text.trim()
        : null;

    return text || "User requested human support.";
  } catch {
    return "User requested human support.";
  }
}
