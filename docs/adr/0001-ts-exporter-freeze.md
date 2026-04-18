# ADR 0001 — Freeze the TypeScript IFC Exporter at Phase 1 Track B

**Status:** Accepted
**Date:** 2026-04-19
**Deciders:** Govind (VibeCoders) + Claude Code (Opus 4.7)
**Supersedes:** —
**Superseded by:** —

---

## Context

Phase 0 audit (`docs/ifc-phase-0-audit.md`) surfaced a strategic inversion: the TypeScript IFC exporter at `src/features/ifc/services/ifc-exporter.ts` (6,328 LOC) contains **richer** emitters than the Python microservice at `neobim-ifc-service/`. The TS file already emits `IfcStructuralAnalysisModel`, `IfcDistributionPort`, `IfcRelConnectsPorts`, `IfcReinforcingBar`, `IfcCurtainWall`, `IfcFurniture`, `IfcFooting`, `IfcClassificationReference`, 4D/5D tasks, and Indian compliance data. Python emits only the core 12 element types with correct geometry.

However, the TS richness is behind four gate flags that default to `false`:
- `emitRebarGeometry` — produces "cloud of cylinders at origin" on non-rectangular buildings
- `autoEmitDemoContent` — produces "flying debris" at hardcoded bbox coordinates
- `emitCurtainWallGeometry` — 900+ mullions render as flying stick chaos
- `emitMEPGeometry` — ducts/pipes extrude along world +X, producing floating horizontal ladders

And `src/app/api/execute-node/handlers/ex-001.ts:172-176` calls `generateMultipleIFCFiles` with only `{projectName, buildingName}` as options. The flags are therefore never flipped. The rich emitters are dead code in production.

Plan v2 (`docs/RICH_IFC_IMPLEMENTATION_PLAN_v2.md`) adopts a **Python-primary** strategy: all new richness work lands on `neobim-ifc-service/`, where geometry discipline is already correct and adding entities doesn't re-surface the "flying debris" problem. The TS exporter remains as the emergency fallback path.

Phase 1 Track C extends `ElementProperties` with 26 new optional fields consumed progressively by Python builders in Phases 2-4. Phase 1 Track A shipped a pre-flight probe + Rich/Lean UI badge so users can see which engine produced their file.

### The drift problem

The TS fallback receives the enriched `MassingGeometry` input whenever the Python service is unreachable. Without active maintenance, its existing emitters ignore the new fields silently. Over time, as Phases 2-7 accumulate richer Python behaviour, same input yields substantively different outputs depending on which path ran. That is the opposite of what a fallback should be — "graceful degradation" means same shape / lower fidelity, not different shape / different fidelity.

## Decision

**Freeze `src/features/ifc/services/ifc-exporter.ts` at its Phase 1 Track B state.**

Specifically:

1. **No new feature consumers.** After Phase 1 Track B merges, no commit adds a new `ElementProperties` field consumer, new entity emitter, or new `IfcType` support to this file.
2. **Bug fixes permitted.** Critical correctness bugs in existing emitters can be patched (including `IFCExportOptions` shape fixes that preserve existing consumer behaviour).
3. **Gate flags stay intentional.** The four gate flags and their "flying debris" comments remain in place as documentation of known behaviour. `IFC_RICH_MODE` plumbing (Phase 1 Track B) is the final user-facing extension.
4. **File-header deprecation notice** added to `ifc-exporter.ts` pointing at this ADR.
5. **User visibility preserved.** The Rich/Lean badge shipped in Track A (see `src/features/execution/components/result-showcase/tabs/ExportTab.tsx:680-708`, `IfcEngineBadge`) and the probe metadata at `src/app/api/execute-node/handlers/ex-001.ts:255-260` (`engine`, `ifcServiceUsed`, `ifcServicePath`, `ifcServiceProbeMs`, `ifcServiceSkipped`, `ifcServiceSkipReason`) tell users which path ran. The tooltip explicitly states the Lean file is a reduced-richness snapshot.

## Consequences

### Positive

- Phase 2-7 engineering work narrows to a single target (Python). Each phase does one implementation, not two.
- Drift avoidance: Lean-path users always receive Phase-1-level output; the badge tells them so.
- Maintenance cost capped: the 6,328-LOC TS file is not growing.
- Clear architectural story: "Python is the product; TS is the graceful-degradation safety net."
- Removes pressure to re-solve the "flying debris" problem per new entity type.

### Negative

- Users who hit the TS fallback get a visibly less-rich file as Python races ahead through Phases 2-7. Mitigated by the Rich/Lean badge + tooltip: users know what they got.
- If the Python service is unavailable for an extended production window, affected users don't receive richness improvements during that window. Mitigated by fix-forward on Railway, plus the Per-Phase Python Rollback procedure documented in plan v2 amendments § C3.
- The 6,328 LOC of sophisticated but gated TS work becomes a historical reference, not an active code path.

### Neutral

- The file stays in the repo and continues running. This is a **freeze, not a removal.**
- Future deletion is possible if Phase 1 Track A's probe metadata indicates the TS fallback is never actually hit over a 3+ month production window. That decision is deferred.

## Alternatives Considered

### Option A — Keep TS in sync with Python every phase

Mirror every `ElementProperties` consumer and new entity emitter in the TS file at each phase boundary.

**Rejected because:**
- Doubles the engineering work per phase (two implementations, two code reviews, two tests).
- The "flying debris" gate-flag problem re-surfaces for each new entity type — every new emitter needs geometric-positioning input the TS side can't always derive.
- Delays every Phase 2-7 delivery by an estimated 30-50 %.

### Option C — Delete the TS exporter entirely

Simpler long-term state.

**Rejected for now because:**
- Provides emergency fallback when Python is down.
- Removal reduces graceful-degradation surface — a Python outage becomes an outright EX-001 failure rather than a reduced-richness file.
- No evidence yet that "we never hit the fallback" — Phase 1 Track A's metadata stamps will produce that evidence over the next 3+ months.

Option C may be revisited once Phase 1 Track A telemetry shows zero or near-zero TS-path runs in production. At that point, deleting the file and simplifying `ex-001.ts` to fail fast on probe failure becomes low-risk. Decision deferred.

## References

- `docs/RICH_IFC_IMPLEMENTATION_PLAN_v2.md` — strategic roadmap that adopts Python-primary.
- `docs/RICH_IFC_IMPLEMENTATION_PLAN_v2_1_AMENDMENTS.md` § C1 — amendment record linking this ADR into the plan.
- `docs/ifc-phase-0-audit.md` — capability audit that surfaced the inversion.
- `docs/ifc-feature-technical-report.md` § 12 — "Roadmap to Ultra-Realistic IFC", context for why richness has to land somewhere.
- `src/features/ifc/services/ifc-exporter.ts` (file header) — deprecation notice pointing back to this ADR.
- `src/app/api/execute-node/handlers/ex-001.ts:255-260` — artifact metadata stamps that expose path selection to the UI.
- `src/features/execution/components/result-showcase/tabs/ExportTab.tsx:680-708` — `IfcEngineBadge` component rendering the Lean indicator.
- `src/features/ifc/services/ifc-service-client.ts:62-152` — `isServiceReady()` probe that gates the Python call.
