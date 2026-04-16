import type { ParsedRoom } from "../structured-parser";
import { hardVastuRulesFor } from "./propagators";
import { cellToDirection, type CellIdx } from "./domains";

export interface ConflictSet {
  variables: string[];
  rule_ids: string[];
  human_reason: string;
}

/**
 * Collect a minimal-ish conflict set from the backtrack trail.
 * For Stage 3A, "minimal" = the variables whose initial-domain rules collectively
 * produced the dead-end PLUS any corner-uniqueness culprits.
 */
export function explainConflict(params: {
  deadVariable: { id: string; room: ParsedRoom };
  ruleIdsOnDead: string[];
  trailVarIds: string[];
  varLookup: Map<string, ParsedRoom>;
  assignments: Map<string, CellIdx>;
  vastuRequired: boolean;
}): ConflictSet {
  const { deadVariable, ruleIdsOnDead, trailVarIds, varLookup, assignments, vastuRequired } = params;

  const ruleSet = new Set<string>(ruleIdsOnDead);
  const varSet = new Set<string>([deadVariable.id, ...trailVarIds]);

  for (const vid of trailVarIds) {
    const r = varLookup.get(vid);
    if (!r) continue;
    if (vastuRequired) {
      for (const rid of hardVastuRulesFor(r.function)) ruleSet.add(rid);
    }
    if (r.position_type === "corner") ruleSet.add("H4");
    if (r.position_type === "zone" || r.position_type === "wall_centered") ruleSet.add("H5");
  }
  if (deadVariable.room.position_type === "corner") ruleSet.add("H4");
  if (vastuRequired) {
    for (const rid of hardVastuRulesFor(deadVariable.room.function)) ruleSet.add(rid);
  }

  const parts: string[] = [];
  parts.push(`Room "${deadVariable.room.name}" (${deadVariable.room.function}) has no feasible mandala cell.`);

  if (trailVarIds.length > 0) {
    const trailDesc = trailVarIds.slice(0, 5).map(vid => {
      const r = varLookup.get(vid);
      const cell = assignments.get(vid);
      const dir = cell !== undefined ? cellToDirection(cell) : "?";
      return r ? `"${r.name}"@${dir}` : vid;
    }).join(", ");
    parts.push(`Conflicts with earlier placements: ${trailDesc}.`);
  }

  if (ruleSet.size > 0) {
    parts.push(`Triggered rules: ${[...ruleSet].sort().join(", ")}.`);
  }

  parts.push(`Suggestions: relax the Vastu requirement, or remove one of the conflicting user-specified positions.`);

  return {
    variables: [...varSet],
    rule_ids: [...ruleSet],
    human_reason: parts.join(" "),
  };
}
