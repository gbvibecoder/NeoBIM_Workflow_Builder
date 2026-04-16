import { getSurfaceForms, type RoomFunction } from "./room-vocabulary";
import { findRoomAnchors } from "./parser-text-utils";
import type { ParsedConstraints } from "./structured-parser";

export interface AuditFinding {
  kind: "room_no_surface_form" | "special_feature_not_verbatim";
  room_id?: string;
  message: string;
}

export interface AuditResult {
  passed: boolean;
  findings: AuditFinding[];
}

const SUBTYPE_FALLBACK: Partial<Record<RoomFunction, RoomFunction>> = {
  master_bedroom: "bedroom",
  master_bathroom: "bathroom",
  guest_bedroom: "bedroom",
  kids_bedroom: "bedroom",
  powder_room: "bathroom",
};

const BEDROOM_FNS = new Set<RoomFunction>(["bedroom", "master_bedroom", "guest_bedroom", "kids_bedroom"]);

interface BhkAllowance {
  bedrooms: number;
  living: number;
  kitchen: number;
  dining: number;
}

function detectBhkAllowance(prompt: string): BhkAllowance {
  const m = prompt.match(/(\d{1,2})\s*[- ]?\s*bhk/i);
  if (!m) return { bedrooms: 0, living: 0, kitchen: 0, dining: 0 };
  const n = parseInt(m[1], 10);
  return { bedrooms: n, living: 1, kitchen: 1, dining: 0 };
}

export function auditConstraints(
  constraints: ParsedConstraints,
  originalPrompt: string,
): AuditResult {
  const findings: AuditFinding[] = [];
  const promptLower = originalPrompt.toLowerCase();
  const bhk = detectBhkAllowance(originalPrompt);

  for (const room of constraints.rooms) {
    const fn = room.function as RoomFunction;
    const forms = getSurfaceForms(fn);
    let m = findRoomAnchors(promptLower, room.name, forms);

    if (!m.matched) {
      const fallback = SUBTYPE_FALLBACK[fn];
      if (fallback) {
        m = findRoomAnchors(promptLower, room.name, getSurfaceForms(fallback));
      }
    }

    if (!m.matched) {
      if (BEDROOM_FNS.has(fn) && bhk.bedrooms > 0) {
        bhk.bedrooms--;
        continue;
      }
      if (fn === "living" && bhk.living > 0) {
        bhk.living--;
        continue;
      }
      if (fn === "kitchen" && bhk.kitchen > 0) {
        bhk.kitchen--;
        continue;
      }
      findings.push({
        kind: "room_no_surface_form",
        room_id: room.id,
        message: `Room "${room.name}" (function=${room.function}) has no surface form matching the prompt. Likely hallucination.`,
      });
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
