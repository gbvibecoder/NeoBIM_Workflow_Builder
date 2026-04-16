import type { ParsedConstraints, ParsedRoom, CenterDirection } from "../structured-parser";
import { logger } from "@/lib/logger";
import {
  ALL_CELLS,
  cellToDirection,
  domainIsEmpty,
  domainSize,
  type CellIdx,
  type Domain,
} from "./domains";
import { computeInitialDomain, propagateCornerUniqueness } from "./propagators";
import { orderValues, selectVariable, type VariableState } from "./ordering";
import { explainConflict, type ConflictSet } from "./unsat-explainer";

export interface MandalaAssignment {
  room_id: string;
  room_name: string;
  function: string;
  cell: CellIdx;
  cell_direction: CenterDirection;
}

export interface SolveResult {
  feasible: boolean;
  assignments: MandalaAssignment[];
  conflict: ConflictSet | null;
  iterations: number;
  elapsed_ms: number;
  vastu_applied: boolean;
}

export interface SolveOptions {
  timeLimitMs?: number;
  vastuRequired?: boolean;
}

const DEFAULT_TIME_LIMIT_MS = 3000;

export function solveMandalaCSP(constraints: ParsedConstraints, options: SolveOptions = {}): SolveResult {
  const timeLimitMs = options.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const vastuRequired = options.vastuRequired ?? constraints.vastu_required;
  const startTime = Date.now();

  // ── Build variables + initial domains ──
  const variables: VariableState[] = [];
  const varLookup = new Map<string, ParsedRoom>();
  const initialRuleIds = new Map<string, string[]>();
  for (const room of constraints.rooms) {
    const { initialDomain, appliedRules } = computeInitialDomain(room, vastuRequired);
    variables.push({ id: room.id, room, domain: initialDomain });
    varLookup.set(room.id, room);
    initialRuleIds.set(room.id, appliedRules);

    if (domainIsEmpty(initialDomain)) {
      return {
        feasible: false,
        assignments: [],
        conflict: explainConflict({
          deadVariable: { id: room.id, room },
          ruleIdsOnDead: appliedRules,
          trailVarIds: [],
          varLookup: new Map([[room.id, room]]),
          assignments: new Map(),
          vastuRequired,
        }),
        iterations: 0,
        elapsed_ms: Date.now() - startTime,
        vastu_applied: vastuRequired,
      };
    }
  }

  const assignments = new Map<string, CellIdx>();
  const wdeg = new Map<string, number>();
  let iterations = 0;
  let lastConflict: ConflictSet | null = null;

  function timedOut(): boolean {
    return Date.now() - startTime > timeLimitMs;
  }

  // Snapshot-and-restore stack for backtracking
  type Snapshot = { varId: string; prevDomain: Domain }[];

  function search(trail: string[]): { ok: boolean; conflictVar?: string } {
    iterations++;
    if (timedOut()) return { ok: false };

    const v = selectVariable(variables, assignments, wdeg);
    if (!v) return { ok: true }; // all assigned

    if (domainIsEmpty(v.domain)) {
      wdeg.set(v.id, (wdeg.get(v.id) ?? 0) + 1);
      lastConflict = explainConflict({
        deadVariable: { id: v.id, room: v.room },
        ruleIdsOnDead: initialRuleIds.get(v.id) ?? [],
        trailVarIds: trail,
        varLookup,
        assignments,
        vastuRequired,
      });
      return { ok: false, conflictVar: v.id };
    }

    const ordered = orderValues(v.room, v.domain, constraints, assignments, vastuRequired);

    for (const cell of ordered) {
      if (timedOut()) return { ok: false };

      // Snapshot domains of unassigned vars for restore
      const snapshot: Snapshot = [];
      for (const other of variables) {
        if (other.id === v.id) continue;
        if (assignments.has(other.id)) continue;
        snapshot.push({ varId: other.id, prevDomain: other.domain });
      }
      const prevMyDomain = v.domain;

      assignments.set(v.id, cell);
      v.domain = 1 << cell;

      // Forward-checking via corner-uniqueness propagator
      const domainById = new Map<string, Domain>();
      for (const o of variables) if (!assignments.has(o.id)) domainById.set(o.id, o.domain);
      const prop = propagateCornerUniqueness(varLookup, domainById, assignments, v.id);

      let dead = false;
      if ("dead" in prop) {
        wdeg.set(prop.deadVarId, (wdeg.get(prop.deadVarId) ?? 0) + 1);
        const deadRoom = varLookup.get(prop.deadVarId);
        if (deadRoom) {
          lastConflict = explainConflict({
            deadVariable: { id: prop.deadVarId, room: deadRoom },
            ruleIdsOnDead: ["H4"], // corner-uniqueness is itself an H4-class conflict
            trailVarIds: [...trail, v.id],
            varLookup,
            assignments,
            vastuRequired,
          });
        }
        dead = true;
      } else {
        for (const prunedId of prop.prunedVars) {
          const pd = domainById.get(prunedId);
          if (pd !== undefined) {
            const target = variables.find(x => x.id === prunedId);
            if (target) target.domain = pd;
          }
        }
      }

      if (!dead) {
        const rec = search([...trail, v.id]);
        if (rec.ok) return { ok: true };
        if (rec.conflictVar && rec.conflictVar !== v.id) {
          wdeg.set(rec.conflictVar, (wdeg.get(rec.conflictVar) ?? 0) + 1);
        }
      }

      // Restore
      assignments.delete(v.id);
      v.domain = prevMyDomain;
      for (const { varId, prevDomain } of snapshot) {
        const t = variables.find(x => x.id === varId);
        if (t) t.domain = prevDomain;
      }
    }

    return { ok: false, conflictVar: v.id };
  }

  const result = search([]);
  const elapsed_ms = Date.now() - startTime;

  if (result.ok) {
    const out: MandalaAssignment[] = [];
    for (const v of variables) {
      const c = assignments.get(v.id);
      if (c === undefined) continue;
      out.push({
        room_id: v.id,
        room_name: v.room.name,
        function: v.room.function,
        cell: c,
        cell_direction: cellToDirection(c),
      });
    }
    logger.debug(`[CSP-3A] feasible: ${out.length} rooms, ${iterations} iters, ${elapsed_ms}ms`);
    return {
      feasible: true,
      assignments: out,
      conflict: null,
      iterations,
      elapsed_ms,
      vastu_applied: vastuRequired,
    };
  }

  logger.debug(`[CSP-3A] UNSAT after ${iterations} iters, ${elapsed_ms}ms`);
  return {
    feasible: false,
    assignments: [],
    conflict: lastConflict,
    iterations,
    elapsed_ms,
    vastu_applied: vastuRequired,
  };
}
