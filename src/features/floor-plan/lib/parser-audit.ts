import { getSurfaceForms, type RoomFunction, type SurfaceForm } from "./room-vocabulary";
import type { ParsedConstraints, ParsedRoom } from "./structured-parser";

export interface AuditFinding {
  kind: "room_no_surface_form" | "dim_not_in_prompt" | "position_not_in_prompt" | "special_feature_not_verbatim";
  room_id?: string;
  message: string;
}

export interface AuditResult {
  passed: boolean;
  findings: AuditFinding[];
}

const LEVENSHTEIN_THRESHOLD = 2;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRoomAnchors(
  promptLower: string,
  roomName: string,
  surfaceForms: SurfaceForm[],
): { matched: boolean; matched_form: string | null; anchor_positions: number[] } {
  const anchor_positions: number[] = [];

  // First-priority anchor: the room.name itself (handles "Bedroom 2", "Master Bedroom")
  const nameLower = roomName.toLowerCase().trim();
  if (nameLower.length >= 2) {
    const namePat = new RegExp(escapeRegex(nameLower), "g");
    let nm: RegExpExecArray | null;
    while ((nm = namePat.exec(promptLower)) !== null) anchor_positions.push(nm.index);
    if (anchor_positions.length > 0) {
      return { matched: true, matched_form: nameLower, anchor_positions };
    }
  }

  // Fallback: collect ALL surface form match positions across vocabulary
  let bestForm: string | null = null;
  for (const form of surfaceForms) {
    const pat = form.requires_word_boundary
      ? new RegExp(`\\b${escapeRegex(form.text)}\\b`, "g")
      : new RegExp(escapeRegex(form.text), "g");
    let m: RegExpExecArray | null;
    while ((m = pat.exec(promptLower)) !== null) {
      anchor_positions.push(m.index);
      if (!bestForm) bestForm = form.text;
    }
  }
  if (anchor_positions.length > 0) {
    return { matched: true, matched_form: bestForm, anchor_positions };
  }

  // Levenshtein fallback for typos — only on tokens ≥4 chars vs forms ≥4 chars
  const tokens = promptLower.split(/[^a-z0-9]+/).filter(t => t.length >= 4);
  for (const form of surfaceForms) {
    if (form.text.length < 4) continue;
    for (const tok of tokens) {
      if (Math.abs(tok.length - form.text.length) > LEVENSHTEIN_THRESHOLD) continue;
      if (levenshtein(tok, form.text) <= LEVENSHTEIN_THRESHOLD) {
        const pos = promptLower.indexOf(tok);
        return { matched: true, matched_form: `${form.text} (fuzzy:${tok})`, anchor_positions: [pos] };
      }
    }
  }

  return { matched: false, matched_form: null, anchor_positions: [] };
}

function dimNearAnchors(prompt: string, w: number, d: number, anchors: number[]): boolean {
  const tolerance = 0.5;
  const re = /(\d{1,3}(?:\.\d)?)\s*(?:ft|feet|foot|x|×)?\s*[x×]\s*(\d{1,3}(?:\.\d)?)\s*(?:ft|feet|foot)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    const matches = (Math.abs(a - w) <= tolerance && Math.abs(b - d) <= tolerance) ||
                    (Math.abs(a - d) <= tolerance && Math.abs(b - w) <= tolerance);
    if (!matches) continue;
    if (anchors.length === 0) return true;
    if (anchors.some(a => Math.abs(m!.index - a) <= 80)) return true;
  }
  return false;
}

const POSITION_LONG: Record<string, RegExp> = {
  N: /\b(?:north(?![- ]?(?:east|west))|n[- ]?facing)\b/i,
  S: /\b(?:south(?!(?:[- ]?east|[- ]?west)))\b/i,
  E: /\b(?:east(?![- ]?(?:north|south)))\b/i,
  W: /\b(?:west(?![- ]?(?:north|south)))\b/i,
  NE: /\b(?:north[- ]?east|northeast|n[- ]?e\b)\b/i,
  NW: /\b(?:north[- ]?west|northwest|n[- ]?w\b)\b/i,
  SE: /\b(?:south[- ]?east|southeast|s[- ]?e\b)\b/i,
  SW: /\b(?:south[- ]?west|southwest|s[- ]?w\b)\b/i,
  CENTER: /\b(?:center(?:ed)?|central|middle|centre)\b/i,
};

const POSITION_SHORT: Record<string, RegExp> = {
  N: /(?:^|[\s,.;:])(N)(?=$|[\s,.;:])/,
  S: /(?:^|[\s,.;:])(S)(?=$|[\s,.;:])/,
  E: /(?:^|[\s,.;:])(E)(?=$|[\s,.;:])/,
  W: /(?:^|[\s,.;:])(W)(?=$|[\s,.;:])/,
  NE: /(?:^|[\s,.;:])(NE)(?=$|[\s,.;:])/,
  NW: /(?:^|[\s,.;:])(NW)(?=$|[\s,.;:])/,
  SE: /(?:^|[\s,.;:])(SE)(?=$|[\s,.;:])/,
  SW: /(?:^|[\s,.;:])(SW)(?=$|[\s,.;:])/,
};

function positionNearAnchors(prompt: string, dir: string, anchors: number[]): boolean {
  const longPat = POSITION_LONG[dir];
  if (longPat) {
    const re = new RegExp(longPat.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      if (anchors.length === 0) return true;
      if (anchors.some(a => Math.abs(m!.index - a) <= 100)) return true;
    }
  }
  const shortPat = POSITION_SHORT[dir];
  if (shortPat) {
    const re = new RegExp(shortPat.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      const matchIdx = m.index + (m[0].length - m[1].length);
      if (anchors.length === 0) return true;
      if (anchors.some(a => Math.abs(matchIdx - a) <= 100)) return true;
    }
  }
  return false;
}

export function auditConstraints(
  constraints: ParsedConstraints,
  originalPrompt: string,
): AuditResult {
  const findings: AuditFinding[] = [];
  const promptLower = originalPrompt.toLowerCase();

  for (const room of constraints.rooms) {
    const forms = getSurfaceForms(room.function as RoomFunction);
    const m = findRoomAnchors(promptLower, room.name, forms);
    if (!m.matched) {
      findings.push({
        kind: "room_no_surface_form",
        room_id: room.id,
        message: `Room "${room.name}" (function=${room.function}) has no surface form matching the prompt. Likely hallucination.`,
      });
      continue;
    }

    if (room.user_explicit_dims && room.dim_width_ft && room.dim_depth_ft) {
      if (!dimNearAnchors(originalPrompt, room.dim_width_ft, room.dim_depth_ft, m.anchor_positions)) {
        findings.push({
          kind: "dim_not_in_prompt",
          room_id: room.id,
          message: `Room "${room.name}" claims user_explicit_dims but ${room.dim_width_ft}x${room.dim_depth_ft}ft not found near the room mention in the prompt.`,
        });
      }
    }

    if (room.user_explicit_position && room.position_direction) {
      if (!positionNearAnchors(originalPrompt, room.position_direction, m.anchor_positions)) {
        findings.push({
          kind: "position_not_in_prompt",
          room_id: room.id,
          message: `Room "${room.name}" claims user_explicit_position=${room.position_direction} but no matching direction word found near the room mention.`,
        });
      }
    }
  }

  for (const sf of constraints.special_features) {
    if (sf.mentioned_verbatim) {
      const tokens = sf.feature.replace(/_/g, " ");
      const pat = new RegExp(`\\b${tokens.replace(/\s+/g, "[- ]?")}\\b`, "i");
      if (!pat.test(originalPrompt)) {
        findings.push({
          kind: "special_feature_not_verbatim",
          message: `special_features[].feature="${sf.feature}" claims mentioned_verbatim=true but does not appear in the prompt.`,
        });
      }
    }
  }

  return { passed: findings.length === 0, findings };
}

export function summarizeFindings(findings: AuditFinding[]): string {
  return findings.map((f, i) => `${i + 1}. [${f.kind}] ${f.message}`).join("\n");
}
