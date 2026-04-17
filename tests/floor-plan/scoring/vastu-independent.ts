import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { MetricResult, PromptExpectation, CompassDirection } from "../types";
import { quadrantOf, getAllRooms } from "./utils";

interface CriticalRule {
  id: string;
  description: string;
  matches: (name: string, type: string) => boolean;
  forbidden_quadrants: CompassDirection[];
  required_quadrants?: CompassDirection[];
}

const CRITICAL_RULES: CriticalRule[] = [
  {
    id: "MASTER_IN_SW",
    description: "Master Bedroom should be in SW; never NE/SE",
    matches: (name, type) => /master/i.test(name) && /bed/i.test(name) || type === "master_bedroom",
    forbidden_quadrants: ["NE", "SE"],
    required_quadrants: ["SW", "S", "W"],
  },
  {
    id: "KITCHEN_IN_SE",
    description: "Kitchen must be in SE; never NE/SW/N",
    matches: (name, type) => /\bkitchen\b/i.test(name) || type === "kitchen",
    forbidden_quadrants: ["NE", "SW", "N"],
    required_quadrants: ["SE", "E", "S"],
  },
  {
    id: "POOJA_IN_NE",
    description: "Pooja Room must be in NE; never S/SW/SE/W",
    matches: (name, type) => /pooja|puja|prayer|mandir/i.test(name) || type === "puja_room",
    forbidden_quadrants: ["S", "SW", "SE", "W"],
    required_quadrants: ["NE", "N", "E"],
  },
  {
    id: "STAIRCASE_NOT_CENTER_NE",
    description: "Staircase must not be in CENTER or NE",
    matches: (name, type) => /stair/i.test(name) || type === "staircase",
    forbidden_quadrants: ["CENTER", "NE"],
  },
  {
    id: "ENTRANCE_IN_N_E_NE",
    description: "Main entrance area (porch/foyer) should be in N, E, or NE",
    matches: (name, type) => /porch|foyer|entrance/i.test(name) || type === "foyer",
    forbidden_quadrants: ["S", "SW", "W"],
    required_quadrants: ["N", "E", "NE", "NW", "SE"],
  },
  {
    id: "BRAHMASTHAN_OPEN",
    description: "CENTER must not contain heavy rooms (kitchen, bathroom, staircase, store)",
    matches: (name, type) =>
      /\bkitchen\b|bath|toilet|wc|stair|store/i.test(name) ||
      ["kitchen", "bathroom", "toilet", "wc", "staircase", "store_room"].includes(type),
    forbidden_quadrants: ["CENTER"],
  },
];

export function scoreVastu(project: FloorPlanProject, expectation: PromptExpectation): MetricResult {
  const MAX = 20;
  if (!expectation.vastu_required) {
    return { score: MAX, max: MAX, details: ["vastu not required"] };
  }

  const rooms = getAllRooms(project);
  const details: string[] = [];
  let violations = 0;

  for (const rule of CRITICAL_RULES) {
    const candidates = rooms.filter(r => rule.matches(r.name, r.type));
    if (candidates.length === 0) continue;
    for (const room of candidates) {
      const q = quadrantOf(room, project);
      if (rule.forbidden_quadrants.includes(q)) {
        violations++;
        details.push(`VIOLATION ${rule.id}: ${room.name} placed in ${q}`);
      }
    }
  }

  const ruleCount = CRITICAL_RULES.length;
  const score = Math.max(0, Math.round(((ruleCount - violations) / ruleCount) * MAX));
  details.unshift(`${violations} violations across ${ruleCount} critical rules`);
  return { score, max: MAX, details };
}
