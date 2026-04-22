/**
 * Phase 2.7B — post-LLM pruner for the Stage 1 ArchitectBrief.
 *
 * The system prompt in `prompts/architect-brief.ts` now explicitly
 * forbids auto-adding Porch / Foyer / Utility / Powder Room and caps
 * room count by plot size. This module is the belt-and-suspenders
 * layer that runs AFTER the LLM returns: it compares the brief
 * against the raw user prompt and trims phantom rooms the LLM slipped
 * in anyway.
 *
 * Design principles:
 *   - Deterministic, pure function. No I/O.
 *   - Prune, never invent. If the LLM omits a required room, the
 *     pruner leaves the brief alone — it's the prompt's job to get
 *     required rooms right.
 *   - Record every drop in `constraints` so the reasoning surfaces
 *     in the Logs Panel.
 *   - Required rooms (bedrooms, kitchen, living, bathrooms) are
 *     never prunable.
 *
 * The thresholds here MUST match the ones in the system prompt
 * CORE POLICY so the LLM and the pruner agree on what's legal.
 */

import type { ArchitectBrief } from "./types";

// ─── Bucket definitions ─────────────────────────────────────────

/**
 * Forbidden auto-adds — rooms that require explicit user mention.
 * Matched against BOTH room.type and room.name (case-insensitive)
 * because the LLM sometimes uses "Entrance Porch" (name) with
 * type="porch" and sometimes vice versa.
 */
const FORBIDDEN_AUTO_TYPES = new Set<string>([
  "porch",
  "foyer",
  "utility",
  "laundry",
  "powder_room",
  "mud_room",
]);

/** Synonyms / phrases that count as the user "mentioning" each forbidden type. */
const FORBIDDEN_PROMPT_SYNONYMS: Record<string, RegExp[]> = {
  porch: [/\bporch\b/i, /\bveranda[h]?\b/i],
  foyer: [/\bfoyer\b/i, /\bvestibule\b/i, /\bentry\s+hall\b/i],
  utility: [/\butility\b/i, /\blaundry\b/i, /\bwash\s*area\b/i, /\bmud\s*room\b/i],
  laundry: [/\blaundry\b/i, /\bwash\s*area\b/i, /\butility\b/i],
  powder_room: [/\bpowder\s*room\b/i, /\bguest\s*toilet\b/i, /\bhalf\s*bath(?:room)?\b/i],
  mud_room: [/\bmud\s*room\b/i],
};

/**
 * User-explicit rooms. These are allowed only when the user mentions
 * them. The LLM shouldn't auto-add them, but if it does, prune.
 * Applied AFTER the forbidden-auto pass; only invoked when the brief
 * is still over its cap after forbidden pruning.
 */
const USER_EXPLICIT_TYPES = new Set<string>([
  "pooja",
  "study",
  "balcony",
  "store",
  "servant_quarter",
  "walk_in_closet",
  "garage",
]);

const USER_EXPLICIT_SYNONYMS: Record<string, RegExp[]> = {
  pooja: [/\bpooja\b/i, /\bprayer\b/i, /\bmandir\b/i, /\bpuja\b/i],
  study: [/\bstudy\b/i, /\boffice\b/i, /\bwork\s*room\b/i, /\bwork\s*space\b/i],
  balcony: [/\bbalcony\b/i, /\bterrace\b/i, /\bdeck\b/i],
  store: [/\bstore\b/i, /\bstorage\b/i, /\bpantry\b/i],
  servant_quarter: [/\bservant\b/i, /\bmaid\s*room\b/i, /\bstaff\s*quarter\b/i],
  walk_in_closet: [/\bwalk[- ]?in\s*closet\b/i, /\bwalk[- ]?in\s*wardrobe\b/i, /\bcloset\b/i],
  garage: [/\bgarage\b/i, /\bparking\b/i, /\bcar\s*port\b/i, /\bcar\s*porch\b/i],
};

/** Required types — never prunable. */
const REQUIRED_TYPES = new Set<string>([
  "bedroom",
  "master_bedroom",
  "kids_bedroom",
  "guest_bedroom",
  "kitchen",
  "living",
  "drawing_room",
  "hall",
  "bathroom",
  "master_bathroom",
  "ensuite",
]);

// ─── Cap computation ────────────────────────────────────────────

/**
 * Room-count cap by plot sqft. Mirrors the CORE POLICY thresholds
 * in the system prompt — any change here must be mirrored there.
 */
export function computeRoomCap(plotSqft: number): number {
  if (!Number.isFinite(plotSqft) || plotSqft <= 0) return 7;
  if (plotSqft < 1000) return 7;
  if (plotSqft < 1800) return 10;
  if (plotSqft < 2500) return 12;
  return 14;
}

// ─── Prompt-mention helpers ─────────────────────────────────────

function promptMentions(rawPrompt: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(rawPrompt));
}

function isUserMentioned(
  rawPrompt: string,
  roomType: string,
  roomName: string,
): boolean {
  // Try the type's synonym list first.
  const typeSyns = { ...FORBIDDEN_PROMPT_SYNONYMS, ...USER_EXPLICIT_SYNONYMS }[roomType];
  if (typeSyns && promptMentions(rawPrompt, typeSyns)) return true;
  // Fall back to the room's own words — e.g. "study" in name matches
  // prompts that use "study" even if type is "other".
  const nameWords = roomName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !["room", "the", "and"].includes(w));
  const promptLower = rawPrompt.toLowerCase();
  return nameWords.some((w) => promptLower.includes(w));
}

// ─── Public pruner ──────────────────────────────────────────────

export interface PruneResult {
  brief: ArchitectBrief;
  droppedNames: string[];
  warnings: string[];
}

/**
 * Apply the CORE POLICY pruning rules to an LLM-produced brief.
 * Never throws; if anything goes wrong, returns the original brief
 * unchanged with a warning.
 */
export function pruneBrief(
  brief: ArchitectBrief,
  rawPrompt: string,
): PruneResult {
  try {
    const plotSqft = brief.plotWidthFt * brief.plotDepthFt;
    const cap = computeRoomCap(plotSqft);
    const droppedNames: string[] = [];
    const warnings: string[] = [];

    // Pass 1: always drop forbidden-auto types the user didn't mention,
    // regardless of cap. They're explicitly forbidden by policy.
    let kept = brief.roomList.filter((r) => {
      const type = (r.type || "").toLowerCase();
      if (!FORBIDDEN_AUTO_TYPES.has(type)) {
        // Also check the name, in case LLM used type="other" for a porch.
        const looksForbidden = Object.values(FORBIDDEN_PROMPT_SYNONYMS).some((pats) =>
          pats.some((re) => re.test(r.name)),
        );
        if (!looksForbidden) return true;
      }
      // It IS forbidden-auto. Keep only if user explicitly mentioned it.
      if (isUserMentioned(rawPrompt, type, r.name)) return true;
      droppedNames.push(r.name);
      return false;
    });

    // Pass 2: if still over cap, drop user-explicit rooms not mentioned.
    if (kept.length > cap) {
      kept = kept.filter((r) => {
        if (kept.length <= cap) return true;
        const type = (r.type || "").toLowerCase();
        if (!USER_EXPLICIT_TYPES.has(type)) return true;
        if (isUserMentioned(rawPrompt, type, r.name)) return true;
        droppedNames.push(r.name);
        return false;
      });
    }

    // Pass 3: if STILL over cap, drop dining / hallway (auto-add category).
    if (kept.length > cap) {
      const autoAddTypes = new Set(["dining", "hallway", "corridor", "passage"]);
      kept = kept.filter((r) => {
        if (kept.length <= cap) return true;
        const type = (r.type || "").toLowerCase();
        if (!autoAddTypes.has(type)) return true;
        droppedNames.push(r.name);
        return false;
      });
    }

    // Hard truncation floor: if STILL over cap AFTER the three passes,
    // truncate from the end, protecting required types.
    if (kept.length > cap) {
      const required: typeof kept = [];
      const optional: typeof kept = [];
      for (const r of kept) {
        if (REQUIRED_TYPES.has((r.type || "").toLowerCase())) required.push(r);
        else optional.push(r);
      }
      const roomBudget = Math.max(0, cap - required.length);
      const survivingOptional = optional.slice(0, roomBudget);
      for (const r of optional.slice(roomBudget)) droppedNames.push(r.name);
      kept = [...required, ...survivingOptional];
    }

    if (droppedNames.length === 0) {
      return { brief, droppedNames: [], warnings: [] };
    }

    // Record the prune in constraints so it surfaces in the Logs Panel.
    const warning = `warning: cap applied — dropped ${droppedNames.length} phantom room${droppedNames.length === 1 ? "" : "s"}: ${droppedNames.join(", ")}`;
    warnings.push(warning);

    // Strip any declared adjacencies that reference a dropped room —
    // leaving them in confuses Stage 5's enforcement pass.
    const keptNames = new Set(kept.map((r) => r.name.toLowerCase()));
    const keptAdjacencies = (brief.adjacencies ?? []).filter(
      (a) =>
        keptNames.has(a.a.toLowerCase()) && keptNames.has(a.b.toLowerCase()),
    );

    const newBrief: ArchitectBrief = {
      ...brief,
      roomList: kept,
      adjacencies: keptAdjacencies,
      constraints: [...(brief.constraints ?? []), warning],
    };
    return { brief: newBrief, droppedNames, warnings };
  } catch (err) {
    // Never throw from the pruner — fail open, log a warning.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      brief,
      droppedNames: [],
      warnings: [`warning: stage-1-pruner failed internally, brief passed through unchanged: ${msg}`],
    };
  }
}
