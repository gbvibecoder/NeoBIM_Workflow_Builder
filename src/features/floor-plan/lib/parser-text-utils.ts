import type { SurfaceForm } from "./room-vocabulary";

export const LEVENSHTEIN_THRESHOLD = 2;

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function levenshtein(a: string, b: string): number {
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

export interface AnchorMatch {
  matched: boolean;
  matched_form: string | null;
  anchor_positions: number[];
}

export function findRoomAnchors(
  promptLower: string,
  roomName: string,
  surfaceForms: SurfaceForm[],
): AnchorMatch {
  const anchor_positions: number[] = [];

  const nameLower = roomName.toLowerCase().trim();
  if (nameLower.length >= 2) {
    const namePat = new RegExp(escapeRegex(nameLower), "g");
    let nm: RegExpExecArray | null;
    while ((nm = namePat.exec(promptLower)) !== null) anchor_positions.push(nm.index);
    if (anchor_positions.length > 0) {
      return { matched: true, matched_form: nameLower, anchor_positions };
    }
  }

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

export function dimNearAnchors(prompt: string, w: number, d: number, anchors: number[]): boolean {
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
    if (anchors.some(p => Math.abs(m!.index - p) <= 80)) return true;
  }
  return false;
}

export const POSITION_LONG: Record<string, RegExp> = {
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

export const POSITION_SHORT: Record<string, RegExp> = {
  N: /(?:^|[\s,.;:])(N)(?=$|[\s,.;:])/,
  S: /(?:^|[\s,.;:])(S)(?=$|[\s,.;:])/,
  E: /(?:^|[\s,.;:])(E)(?=$|[\s,.;:])/,
  W: /(?:^|[\s,.;:])(W)(?=$|[\s,.;:])/,
  NE: /(?:^|[\s,.;:])(NE)(?=$|[\s,.;:])/,
  NW: /(?:^|[\s,.;:])(NW)(?=$|[\s,.;:])/,
  SE: /(?:^|[\s,.;:])(SE)(?=$|[\s,.;:])/,
  SW: /(?:^|[\s,.;:])(SW)(?=$|[\s,.;:])/,
};

export function positionNearAnchors(prompt: string, dir: string, anchors: number[]): boolean {
  const longPat = POSITION_LONG[dir];
  if (longPat) {
    const re = new RegExp(longPat.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      if (anchors.length === 0) return true;
      if (anchors.some(p => Math.abs(m!.index - p) <= 100)) return true;
    }
  }
  const shortPat = POSITION_SHORT[dir];
  if (shortPat) {
    const re = new RegExp(shortPat.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      const matchIdx = m.index + (m[0].length - m[1].length);
      if (anchors.length === 0) return true;
      if (anchors.some(p => Math.abs(matchIdx - p) <= 100)) return true;
    }
  }
  return false;
}
