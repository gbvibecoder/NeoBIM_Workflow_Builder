/**
 * AI planner: converts a natural-language IFC modification prompt into a
 * structured list of operations that `executePlan` can execute.
 *
 * The planner is constrained to emit only operations from the supported
 * schema (see IFCOperation). If the user's prompt doesn't map cleanly, the
 * planner returns an empty operation list + a `notes` field explaining
 * what couldn't be done — we never invent or silently drop intent.
 */

import { getClient } from "@/features/ai/services/openai";
import { classifyPrompt, summarizeIFC } from "@/features/ifc/services/ifc-enhancer";
import type { IFCOperation, IFCSummary } from "@/features/ifc/services/ifc-enhancer";

export interface EnhancementPlan {
  operations: IFCOperation[];
  understood: string;
  notes: string;
  source: "ai" | "heuristic";
}

const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 600;
const TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `You are an IFC (Industry Foundation Classes) building-model modification planner.

Your job: read the user's request in plain language, consider the summary of their currently open IFC file, and return a strict JSON plan of operations to apply in-place.

You MUST return ONLY JSON matching this shape:
{
  "operations": [ { "op": "...", ...args } ],
  "understood": "one short sentence describing what you understood",
  "notes": "optional: call out anything you couldn't do or needed to guess"
}

Supported operations (use ONLY these; never invent new ones):
- {"op": "add_floor", "count": <1-10>}                   — append N new storeys on top, cloning the top storey's elements
- {"op": "remove_floor", "count": <1-10>}                — detach N top storeys from the building
- {"op": "set_floor_count", "count": <1-50>}             — reshape the building to have exactly N floors (adds or removes)
- {"op": "add_room", "storey": "top"|"bottom"|<name>, "name": <string>, "width"?: <model-units>, "depth"?: <model-units>, "height"?: <model-units>}
- {"op": "rename_storey", "target": "top"|"bottom"|<name>, "name": <new_name>}

Rules:
- "terrace", "roof", "rooftop" → storey "terrace" (the executor places the room on the roof level, above the topmost floor).
- "on top floor", "topmost floor" → storey "top".
- "ground", "basement", "bottom floor" → storey "bottom".
- "I want N floors/storeys/levels" → set_floor_count.
- "add X floors/storeys" → add_floor with count=X.
- "make it 5 storeys tall" → set_floor_count with count=5.
- Compound requests produce multiple operations in order.
- If the user mentions a room of any kind (room, balcony, penthouse, rooftop room, study, etc.), emit an add_room op even if the rest of the prompt is ambiguous.
- If the request is ambiguous, pick the most likely interpretation and explain in "notes".
- If you cannot express the request with the supported operations, return operations=[] and explain in "notes".
- NEVER wrap the JSON in markdown code fences.`;

function buildUserPrompt(prompt: string, summary: IFCSummary): string {
  return `IFC file summary:
- Schema: ${summary.schema}
- Storeys (${summary.storeyCount}): ${summary.storeys.map((s) => `"${s.name}" @ ${s.elevation}`).join(", ") || "(none)"}
- Unit scale: ${summary.unitScale}
- Element counts: ${Object.entries(summary.elementCounts).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}

User request: ${prompt}

Return the JSON plan only.`;
}

// ─── JSON extraction + validation ────────────────────────────────────────────

interface RawOp { op?: unknown; count?: unknown; storey?: unknown; name?: unknown; target?: unknown; width?: unknown; depth?: unknown; height?: unknown }
interface RawPlan { operations?: unknown; understood?: unknown; notes?: unknown }

function stripFences(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function validateOp(raw: RawOp): IFCOperation | null {
  if (!raw || typeof raw !== "object") return null;
  const opName = typeof raw.op === "string" ? raw.op : "";
  switch (opName) {
    case "add_floor":
      return { op: "add_floor", count: typeof raw.count === "number" ? Math.max(1, Math.min(10, Math.floor(raw.count))) : 1 };
    case "remove_floor":
      return { op: "remove_floor", count: typeof raw.count === "number" ? Math.max(1, Math.min(10, Math.floor(raw.count))) : 1 };
    case "set_floor_count":
      if (typeof raw.count !== "number" || !Number.isFinite(raw.count)) return null;
      return { op: "set_floor_count", count: Math.max(1, Math.min(50, Math.floor(raw.count))) };
    case "add_room":
      return {
        op: "add_room",
        storey: typeof raw.storey === "string" ? raw.storey : "top",
        name: typeof raw.name === "string" ? raw.name : "Room",
        ...(typeof raw.width === "number" ? { width: raw.width } : {}),
        ...(typeof raw.depth === "number" ? { depth: raw.depth } : {}),
        ...(typeof raw.height === "number" ? { height: raw.height } : {}),
      };
    case "rename_storey":
      if (typeof raw.name !== "string" || !raw.name.trim()) return null;
      return {
        op: "rename_storey",
        target: typeof raw.target === "string" ? raw.target : "top",
        name: raw.name.trim(),
      };
    default:
      return null;
  }
}

function validatePlan(raw: RawPlan): { operations: IFCOperation[]; understood: string; notes: string } {
  const opsArray = Array.isArray(raw.operations) ? raw.operations : [];
  const operations: IFCOperation[] = [];
  for (const o of opsArray) {
    const v = validateOp(o as RawOp);
    if (v) operations.push(v);
  }
  return {
    operations,
    understood: typeof raw.understood === "string" ? raw.understood : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function planEnhancement(
  ifcText: string,
  prompt: string,
): Promise<EnhancementPlan> {
  const summary = summarizeIFC(ifcText);

  // Always compute the heuristic plan — we use it as a fallback and to
  // backstop the AI if it misses operations the regex classifier clearly
  // caught (e.g. "and on terrace I want one room" slipped by).
  const heuristic = classifyPrompt(prompt);

  if (!process.env.OPENAI_API_KEY) {
    return {
      operations: heuristic,
      understood: heuristic.length > 0
        ? "Interpreted via offline classifier (OpenAI not configured)."
        : "Could not interpret this request with the offline classifier.",
      notes: "",
      source: "heuristic",
    };
  }

  try {
    const client = getClient(undefined, TIMEOUT_MS);
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(prompt, summary) },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "";
    const cleaned = stripFences(content);
    const parsed: RawPlan = JSON.parse(cleaned);
    const { operations, understood, notes } = validatePlan(parsed);

    // Merge: if AI found nothing but heuristic did, use heuristic.
    if (operations.length === 0 && heuristic.length > 0) {
      return {
        operations: heuristic,
        understood: understood || "AI couldn't classify this; applied offline heuristic instead.",
        notes,
        source: "heuristic",
      };
    }

    return { operations, understood, notes, source: "ai" };
  } catch (err) {
    console.warn("[ifc-planner] AI planning failed:", err instanceof Error ? err.message : err);
    return {
      operations: heuristic,
      understood: heuristic.length > 0
        ? "AI planner unavailable — applied offline classifier instead."
        : "AI planner unavailable, and the offline classifier couldn't interpret this request.",
      notes: err instanceof Error ? err.message : String(err),
      source: "heuristic",
    };
  }
}
