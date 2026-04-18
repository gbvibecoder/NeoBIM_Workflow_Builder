# RICH_IFC_IMPLEMENTATION_PLAN v2.1 — Amendments

**Date:** 2026-04-19
**Status:** Approved by VibeCoders 2026-04-19.
**Applies to:** `docs/RICH_IFC_IMPLEMENTATION_PLAN_v2.md`
**Purpose:** Targeted amendments resolving the 12 critical-review concerns raised on v2. Not a full rewrite. Read alongside v2.

---

## How to read this document

Each section below corresponds to one of the 12 concerns raised during the v2 review. Each contains:

- **Target** — the v2 section being amended
- **Action** — Insert / Replace / New section
- **Text** — exact markdown to add or replace
- **Rationale** — one-line link back to the concern

Apply these by editing `docs/RICH_IFC_IMPLEMENTATION_PLAN_v2.md` at the next revision, or treat this file as authoritative overrides when reading v2.

All concerns are recorded in section order (C1-C12). Severity grouping mirrors the original concern catalogue.

---

# CRITICAL RESOLUTIONS (block Phase 2 start)

---

## C1 — TS Exporter Freeze (ADR-0001)

**Target:** v2 § "Phase 1 (B + C + D) — in progress" — new subsection after § 1.D.

**Action:** Insert new § 1.E.

**Text to insert:**

```
### 1.E — Architecture Decision: TS Exporter Frozen at Track B

Effective from Phase 1 Track B merge: `src/features/ifc/services/ifc-exporter.ts` is frozen. See `docs/adr/0001-ts-exporter-freeze.md` for the decision record.

**What this means for Phase 2 onward:**

- No new ElementProperties field consumers in the TS exporter.
- No new entity emitters in the TS exporter.
- `IFCExportOptions` interface stays at Phase-1-Track-B state.
- Bug fixes to existing emitters are permitted; new features are not.
- The four gate flags (`emitRebarGeometry`, `autoEmitDemoContent`, `emitCurtainWallGeometry`, `emitMEPGeometry`) retain current defaults. `IFC_RICH_MODE` plumbing (Track B) is the final user-facing extension.

**Why this is safe for Lean-path users:**

Phase 1 Track A shipped the Rich/Lean badge on every EX-001 artifact (`src/features/execution/components/result-showcase/tabs/ExportTab.tsx:680-708` — `IfcEngineBadge`). When the Python service is unavailable, users see the amber Lean chip with a tooltip explicitly stating the file is a reduced-richness snapshot. They know what they got.

**Effect on the plan:**

Phases 2-7 narrow to a single engineering target: `neobim-ifc-service/`. The "Python-primary" pivot from v2 becomes architecturally enforceable rather than aspirational.
```

**Additional artifacts landing in the amendment commit:**

- `docs/adr/0001-ts-exporter-freeze.md` — decision record.
- `src/features/ifc/services/ifc-exporter.ts` — deprecation comment block prepended to the file, linking back to the ADR.

**Rationale:** Concern 1 — without freezing, 26 new ElementProperties fields from Track C + 13 new entity types from Phases 2-4 require mirror implementations in TS, doubling per-phase work and re-surfacing the "flying debris" problem per new entity. Badge already provides user visibility.

---

## C2 — Track D Blocks Phase 2 (explicit + CI-enforced)

**Target 1:** v2 § 1.D "Baseline fixtures" — extend with CI enforcement spec.

**Action:** Append to § 1.D.

**Text to append to § 1.D:**

```
**CI enforcement (lands in Track D as part of the same commit):**

A new CI check, `scripts/ci/require-phase0-baseline.sh`, runs on every PR targeting `rutikerole/main` that modifies `neobim-ifc-service/app/services/` (Python builder surface). The check:

- Asserts `neobim-ifc-service/tests/fixtures/baseline/phase0/` exists and contains at least one `.ifc` fixture.
- Asserts `neobim-ifc-service/tests/fixtures/baseline/phase0/entity_counts.md` exists and is ≥ 500 bytes.
- Asserts `scripts/count-ifc-entities.py` exists and exits 0 on `--help`.

Failure mode: PR cannot merge. Mitigation: complete Track D before opening Phase 2+ PRs.

**Track D lands as a single atomic commit** containing: phase0 fixtures (4 Python + 8 TS), `entity_counts.md`, `scripts/count-ifc-entities.py`, regeneration recipe (`docs/ifc-baseline-regeneration.md`), and the CI guard script itself. Partial Track D states are invalid.
```

**Target 2:** v2 § 2.1 "Discovery" (Phase 2) — add prerequisite note.

**Action:** Prepend to § 2.1.

**Text to prepend to § 2.1:**

```
**Prerequisite — Phase 2 does not start without this:**

Phase 1 Track D baseline fixtures must exist at `neobim-ifc-service/tests/fixtures/baseline/phase0/`. The CI check `require-phase0-baseline.sh` gates PR merge. This is not optional — Phase 2's merge gate compares entity counts against phase0 baseline, and that comparison has no meaning without the baseline.

If phase0 fixtures are missing when this phase starts: STOP and complete Track D first. Do not regenerate post-hoc; "baseline" means the state before Phase 2 started.
```

**Rationale:** Concern 2 — without enforcement, Phase 2 can merge with no numeric proof of improvement. CI check + explicit prerequisite eliminates the anti-pattern.

---

## C3 — Per-Phase Python Rollback Procedure

**Target:** v2 § "Rollback Plan" — append new subsection.

**Action:** Append new § "Per-Phase Python Rollback" to end of Rollback Plan.

**Text to append:**

```
### Per-Phase Python Rollback

Railway deploys independently of Vercel. A `git revert` on the NeoBIM repo does not roll back the Railway container. Each Python phase's merge gate requires a documented and **rehearsed** Python rollback path.

**Each phase (Phase 2 onward) ships with:**

1. **Pre-deploy snapshot.** Before Railway deploys the new Python code, record the current prod SHA:
   ```
   curl -s https://buildflow-python-server.up.railway.app/health | jq -r .git_sha
   ```
   Commit this SHA into the phase's completion doc under a "Pre-deploy Railway SHA" heading.

2. **Durable tag.** Tag the merged Python commit:
   ```
   git tag python-phase-<N>-prod-YYYY-MM-DD <commit-sha>
   git push upstream python-phase-<N>-prod-YYYY-MM-DD
   ```

3. **Rollback procedures (documented in completion doc):**

   **Path A — Railway dashboard (preferred).** Railway UI → Deployments tab → previous deploy → "Redeploy". ≤2 min. No repo change needed.

   **Path B — Git-push rollback.** When the dashboard is unavailable or the issue is git-shaped:
   ```
   git push --force-with-lease railway <previous-prod-sha>:main
   ```
   ~5 min.

4. **Dry-run before merge.** Before merging the phase PR, rehearse the rollback in a non-prod Railway environment. Deploy the phase's code, execute Path A, confirm `/health` reports the pre-deploy SHA. Record the rehearsal outcome in the phase completion doc.

5. **Fail-safe (last resort).** Unset `IFC_SERVICE_URL` on Vercel. EX-001 reverts to pure TS fallback. User-visible downgrade — all new users see the Lean chip until Python is restored.

**What "breaks production" means for a Python phase:**

- `/health` returns non-200 after deploy
- `/ready` returns 503 (ifcopenshell broken)
- Error rate on `/api/v1/export-ifc` exceeds 1 % over 5 min
- A user reports EX-001 produces malformed IFC that crashes BlenderBIM or Revit on import

On any of the above, execute Path A immediately. Investigate in a non-prod environment.
```

**Rationale:** Concern 3 — Python is a separate deployment surface; git revert doesn't touch it; the original plan had no documented Python recovery path.

---

# IMPORTANT RESOLUTIONS (block Phase 2 PR merge)

---

## C4 — Infrastructure Commitments

**Target:** v2 — new section before § "Execution Order & Next Steps".

**Action:** Insert new top-level § "Infrastructure Commitments".

**Text to insert:**

```
## Infrastructure Commitments

The following monthly cost commitments are **pre-approved by VibeCoders**. No further decision gating required; each takes effect automatically at its trigger phase.

| Commitment | Trigger | Est. monthly | Status |
|---|---|---|---|
| Railway Hobby plan (eliminates cold starts, raises memory ceiling) | Phase 3 start | $5-$20 | **APPROVED** 2026-04-19 |
| R2 `MAX_IFC_SIZE` raise to 500 MB (files + request limits) | Phase 5 start | $0-$10 | **APPROVED** 2026-04-19 |
| Vercel function memory bump (only if Phase 2 OOM observed) | As-needed | $0-$30 | **APPROVED** 2026-04-19 |

**Total maximum incremental burn:** ~$60/month at peak. Approved upfront.

**Reporting cadence:** each phase completion doc includes a "Cost delta" row comparing month-over-month infrastructure spend against pre-phase baseline. If burn exceeds the approved envelope, flag for VibeCoders review before the next phase starts.

**Trigger definitions:**

- **Phase 3 Railway upgrade** — automatic at the start of Phase 3. Cold-start elimination has independent value for the probe design in Phase 1 Track A.
- **Phase 5 R2 raise** — update `src/lib/r2.ts:34` (`MAX_IFC_SIZE`), `src/app/api/parse-ifc/route.ts:9`, `src/app/api/upload-ifc/route.ts:38` simultaneously. Update R2 bucket lifecycle rules if needed.
- **Vercel memory bump** — only if Phase 2 production logs show Node lambda OOM or near-OOM. Configure via Vercel project settings → Function Memory.
```

**Rationale:** Concern 4 — commitments were buried in risk-register mitigation cells. Making them first-class removes the "discover infra cost mid-phase" anti-pattern.

---

## C5 — TR-007 Entity Type Tracking Policy

**Target 1:** v2 § "Testing Strategy" § "Round-trip tests" — expand test spec.

**Action:** Replace existing § "Round-trip tests" content with the expanded version.

**Original text to find:**

```
### Round-trip tests

Produce IFC → parse with existing `parseIFCBuffer` (TR-007) → confirm quantity extraction still works. Catches regressions where rich geometry breaks quantity takeoff.
```

**Amended text:**

```
### Round-trip tests

Every phase's Python generator output MUST round-trip cleanly through TR-007's WASM parser. Per-type count assertion, not just "still works":

1. Produce IFC via Python path with the phase's canonical fixture.
2. Re-parse with `parseIFCBuffer` at `src/features/ifc/services/ifc-parser.ts:1896`.
3. For every entity type the phase newly emits, assert aggregated count in `divisions/categories/elements` output ≥ instance count in the generated file. Zero-count for a Python-emitted type fails the test.

**Cross-phase policy — every Python phase that introduces a new `IfcType` MUST include a same-PR commit updating TR-007's three sources-of-truth:**

- `src/features/ifc/services/ifc-parser.ts` — add `import { IFC<TYPE> } from "web-ifc"` or a numeric ID constant in the L40-66 block. Extend the CSI MasterFormat mapping at L446-650. Extend aggregation logic if the new type has a non-standard unit.
- `src/features/ifc/components/ifc-worker.ts:9-41` — mirror the same constant (required for the viewer to show the type).
- `src/features/3d-render/services/clash-detector.ts` — mirror the same constant (required for TR-016 to include the type in AABB clash analysis).

Round-trip test fails on any PR that adds a new `IfcType` to Python without updating the three TS-side files.
```

**Target 2:** v2 § 2.1 "Discovery" (Phase 2) — add pre-Phase-2 audit step.

**Action:** Append to § 2.1.

**Text to append to § 2.1:**

```
**Pre-Phase-2 audit — run before any Phase 2 code:**

Audit the existing TR-007 entity whitelist against what the current Python service already emits. Any gap fixed in the same PR that starts Phase 2.

Procedure:
1. Generate a fixture via the current Python service against `sample_geometry.json`.
2. Parse the raw STEP with `grep -oE '^#[0-9]+=IFC[A-Z]+' | sort -u` to extract distinct entity types.
3. For each type: check `src/features/ifc/services/ifc-parser.ts:14-37` (imports), `:40-66` (numeric constants), `:446-650` (CSI mapping). Note any missing.
4. If any Python-emitted type is missing from any of the three places, fix in the same pre-Phase-2 cleanup commit. Extend the round-trip test to prevent regression.
```

**Rationale:** Concern 5 — without tracking, new Python entities drop silently from BOQ. Cross-phase policy + pre-phase audit prevents this systematically.

---

## C6 — Auto-Cut Openings Default OFF + Metadata Field

**Target:** v2 § 5.1 "Opening auto-generation".

**Action:** Replace entire § 5.1.

**Original text to find:** v2 § 5.1 in its current form with `autoCutServiceOpenings: bool = True`.

**Amended text:**

```
### 5.1 Opening auto-generation (experimental, default OFF)

**New file:** `neobim-ifc-service/app/services/coordination_openings.py`

For each MEP segment crossing a wall (AABB intersection), emit `IfcOpeningElement` sized to segment diameter + 50 mm clearance. Use existing opening pattern from `wall_builder.py:108-183` (`create_opening_in_wall`).

For slab crossings: `IfcOpeningElement` + `IfcRelVoidsElement` with slab host.

**Gate:** `options.autoCutServiceOpenings: bool = False`. **OFF by default.** The v2 framing ("objectively correct") is true in the abstract but wrong as a default because:

- Enabling it changes `Qto_WallBaseQuantities.NetSideArea` for walls with MEP crossings.
- TR-007 re-parses → BOQ wall-area numbers shift vs pre-Phase-5 runs for the same input.
- Users see BOQ shift with no input change — a behaviour break they did not opt into.

**User visibility: metadata field**

Every EX-001 artifact carries `artifact.metadata.coordinationOpeningsApplied: boolean`:
- `true` — openings were auto-cut; NetSideArea reflects this.
- `false` — classic mode; openings absent.
- `undefined` — pre-Phase-5 artifact; NetSideArea is pre-Phase-5 semantics.

BOQ consumers branching on this field can calibrate their interpretation accordingly.

**Promotion to default ON:**

Default flips to `true` only after ≥ 2 weeks of real-project validation with:
- No duplicate-opening reports.
- No unexpected BOQ deltas attributed to opening auto-cut.

Record the promotion decision in `docs/ifc-phase-5-completion.md` with before/after BlenderBIM screenshots.
```

**Rationale:** Concern 6 — default-on is a behaviour break for every existing consumer. Default-off + metadata field + staged promotion gives safe rollout.

---

## C7 — Phase 7 MEP: Honest Scoping (Procedural MEP Demonstration)

**Target 1:** v2 § 7 header and goal.

**Action:** Replace section title + goal paragraph.

**Original text to find:**

```
## Phase 7 — Procedural Enrichment Upstream (TR-013 Discipline Enricher)

**Goal:** The user's dream: type "5-storey mixed-use Pune" → get everything above automatically.
```

**Amended text:**

```
## Phase 7 — Procedural Enrichment Upstream (TR-013 Discipline Enricher) — Demonstration Scope

**Goal:** Type "5-storey mixed-use Pune" and get a federated IFC4 package with all the architectural + structural + classification + compliance richness from Phases 2-6 AUTOMATICALLY populated, plus **demonstration-grade** procedural MEP routing suitable for concept visualization and BOQ placeholders.

**Scope boundary — read carefully:**

This phase ships **procedural MEP for demonstration only**. The backbones are geometrically placed and topologically connected but not engineered. Pipe sizes don't respect flow calculations. Duct sizes don't respect load calculations. Fire compartmentation is not integrated. Diversity factors are not applied. NBC Part 8 clearances are not verified.

For tender-grade or construction-grade MEP, users must engage a registered MEP consultant to review and re-engineer the output. The UI makes this explicit (see § 7.8 below).

**Engineered MEP generation** — proper sizing, fire-compartment integration, NBC clearances — is scoped as a notional **Phase 8**, deferred pending customer demand and MEP consultant engagement.
```

**Target 2:** v2 § 7.3 "MEP backbone generator".

**Action:** Replace entire § 7.3.

**Amended text (replaces v2's current § 7.3):**

```
### 7.3 Procedural MEP backbone (demonstration scope)

Per storey, procedurally generate geometrically-placed but non-engineered MEP backbones. The goal is an IFC that *looks plausible* in viewers and *populates BOQ placeholders* — not one that's ready for tender.

**Per-system rules (geometric heuristics, NOT design calculations):**

- **HVAC:** primary duct trunk along longest axis of storey centerline, branches every 6 m. Diffusers (IfcAirTerminal.DIFFUSER) at space centroids, 1 per space or 1 per 25 m², whichever is greater. `systemName="HVAC Supply"` + mirror return. `systemPredefinedType=SUPPLYAIR`.
- **Plumbing:** cold/hot/waste as three `IfcDistributionSystem`s. Single vertical riser per system routed through nearest dedicated shaft area (inferred from space naming; falls back to SW corner when absent). Horizontal branch per bathroom group, terminating at IfcSanitaryTerminal at space centroid.
- **Electrical:** vertical riser per storey. Horizontal cable trays (`IfcCableCarrierSegment`) along corridor ceilings (inferred from IfcSpace names matching "corridor|hallway|passage"). Light fixtures (`IfcLightFixture`) at 2 × 15 W per 10 m² per space (residential assumption). Outlets (`IfcOutlet`) at 1 per 3 m of wall perimeter.
- **Fire:** sprinkler loop (`IfcFlowTerminal` with SPRINKLERHEAD type) on ceiling grid at 3 m spacing.

**What this demonstrates:**

- IFC topology is valid (ports + connections + fittings + terminals).
- BOQ gets concrete placeholders — quantities aren't zero.
- Visualizations in BlenderBIM and Navisworks look like an early-concept MEP layout.

**What this does NOT do:**

- Pipe/duct sizing calculations (Hazen-Williams, Darcy-Weisbach, equal-friction).
- Zone psychrometrics.
- Fire-compartment penetration analysis per NBC Part 4.
- Diversity-factor application per NBC / CIBSE / ASHRAE.
- Clearance verification per NBC Part 8.
- Coordination with structural beam soffits.

**All demonstration-MEP entities carry `Pset_BuildFlow_ProceduralDemo`** with attributes:
- `source: "procedural"`
- `engineeringVerified: false`
- `requiresMEPConsultantReview: true`
- `generationPhase: "phase-7-<date>"`

Downstream tools can filter on this Pset to distinguish generated from engineered MEP.
```

**Target 3:** v2 § 7 — add new § 7.8.

**Action:** Append new § 7.8 at end of Phase 7 section (before § 7.7 "Deliverables" or after it, whichever keeps Deliverables last).

**Text to append:**

```
### 7.8 UI disclaimer on procedural-MEP artifacts

Every EX-001 artifact whose `metadata.generationPhase >= "phase-7"` AND whose input included auto-enrichment via TR-013 surfaces a disclaimer card in the Export tab above the file download:

> ⚠ **Procedural MEP — Demonstration Only**
>
> This model includes procedurally-generated MEP routing (ducts, pipes, cable trays, fittings, terminals) suitable for concept visualization and BOQ placeholders. Before tender or construction:
>
> - Verify pipe/duct sizing with load calculations.
> - Confirm fire-compartment integration per NBC Part 4.
> - Check clearances per NBC Part 8.
> - Engage a registered MEP consultant for coordination.
>
> BuildFlow does not warrant this output for regulatory submission.

**Implementation:** new component `ProceduralMEPDisclaimer` in `src/features/execution/components/result-showcase/tabs/ExportTab.tsx`. Renders only when artifact metadata indicates the procedural-MEP path was taken. Uses existing `COLORS.AMBER` + `AlertTriangle` tokens (same tokens as the existing `IfcEngineBadge`). Dismissible per-session; re-appears on next session.
```

**Rationale:** Concern 7 — v2's 12-line MEP spec described concept-viz depth while implying tender-submission ambition. Honest scoping + UI disclaimer + deferred Phase 8 aligns user expectations with what the feature actually produces.

---

## C8 — TR-013 Sources-of-Truth Checklist + Pre-Phase-7 LIVE_NODES Consolidation

**Target 1:** v2 § 7.1 "New node: TR-013 Discipline Enricher".

**Action:** Replace § 7.1 with the expanded 5-step checklist.

**Original text to find:** v2 § 7.1 in its current single-file form.

**Amended text:**

```
### 7.1 New node: TR-013 Discipline Enricher — 5-step sources-of-truth checklist

**File:** `src/app/api/execute-node/handlers/tr-013.ts`

Takes `MassingGeometry` + `buildingType` + `location` as input. Produces enriched `MassingGeometry` where every element has structural, MEP, and architectural properties populated per the Phase 2 defaults library.

**Adding TR-013 end-to-end requires updating ALL FIVE sources of truth in the same PR:**

1. `src/features/workflows/constants/node-catalogue.ts` — add `NodeCatalogueItem` entry with `id="TR-013"`, `category="transform"`, inputs + outputs. Include `"TR-013"` in the `LIVE_NODES` set at L681.

2. `src/features/execution/hooks/useExecution.ts:60-74` — add `"TR-013"` to `LIVE_NODE_IDS` and `REAL_NODE_IDS` sets.

3. `src/app/api/execute-node/route.ts:19` — add `"TR-013"` to the `REAL_NODE_IDS` whitelist.

4. `src/app/api/execute-node/handlers/index.ts:40-64` — register `handleTR013` in the handler registry export.

5. `src/lib/validation.ts` — add `validateTR013Input` function and register in the validator dispatcher.

**CI enforcement (ships with Phase 7):**

New test `tests/unit/node-catalogue-consistency.test.ts` asserts:
- Every `catalogueId` with a registered handler in `handlers/index.ts` is also in `node-catalogue.ts LIVE_NODES`.
- Every `catalogueId` in `LIVE_NODES` (node-catalogue.ts) is also in `LIVE_NODE_IDS` (useExecution.ts).
- Every `catalogueId` in `REAL_NODE_IDS` (route.ts) has a matching handler.

Test fails the PR if any drift is introduced.

**Pre-Phase-7 prerequisite — resolve the existing LIVE_NODES drift:**

Phase 0 audit flagged: `node-catalogue.ts:681 LIVE_NODES` and `useExecution.ts:60-74 LIVE_NODE_IDS` currently differ in membership (catalogue has `GN-007`, `GN-008`, `EX-002`; executor has `TR-001`, `GN-012` instead).

Before Phase 7 starts, land a standalone cleanup commit that:
- Exports `LIVE_NODES` as the single authoritative set from `node-catalogue.ts`.
- Updates `useExecution.ts` to import and use it (removes the duplicate local set).
- Updates `route.ts` to derive `REAL_NODE_IDS` from it where possible.
- Adds the CI consistency test above so the drift cannot return.

This cleanup is a prerequisite for Phase 7. Do not start Phase 7 without it.
```

**Rationale:** Concern 8 — adding TR-013 on top of unresolved drift compounds the problem. Explicit 5-step checklist + pre-Phase cleanup + CI enforcement prevents repeat.

---

## C9 — v1 Plan Superseded Banner

**Target:** `docs/RICH_IFC_IMPLEMENTATION_PLAN.md` (the v1 plan, NOT v2).

**Action:** Insert 4-line banner immediately after the top-level H1 header.

**Banner text:**

```
> ⚠️ **SUPERSEDED by [v2](./RICH_IFC_IMPLEMENTATION_PLAN_v2.md) as of 2026-04-18.**
> **Do not execute from this file.** Key change in v2: Python-primary strategy
> replacing the TS gate-flag unlock approach. See v2 for the authoritative roadmap.
> Further amendments tracked in [v2.1 amendments](./RICH_IFC_IMPLEMENTATION_PLAN_v2_1_AMENDMENTS.md).
```

**Applied directly to v1 file in this amendment commit** (not via future edit).

**Rationale:** Concern 9 — alphabetically, v1 sorts before v2; future readers may execute against the superseded plan. Banner is minimal friction + maximum clarity.

---

# NICE-TO-HAVE RESOLUTIONS (apply in-flight)

---

## C10 — FEA / MEP Validation Owner + Fallback

**Target 1:** v2 § 3.6 "Deliverables" (Phase 3).

**Action:** Replace the "Gate for merge" line.

**Original text to find:**

```
**Gate for merge:** BIM/structural partner reviews the analytical model in an FEA tool. This phase is correctness-critical — do not merge on "it visualizes OK" alone.
```

**Amended text:**

```
**Gate for merge:** external validation of the analytical model, in descending order of ideality:

1. **Named in-house structural engineer** — TBD (VibeCoders to identify before Phase 3 starts).
2. **Retained consulting engineer** — TBD.
3. **Ad-hoc paid review** via Upwork/Toptal or a BIM bureau (~$300-800 per review).
4. **Fallback: internal self-validation via FreeCAD FEM.** Default when no external reviewer is available. Procedure:
   - Export Phase 3 IFC via Python service.
   - Open in FreeCAD FEM.
   - Confirm `IfcStructuralAnalysisModel` is detected and analytical graph walks cleanly (no orphan members, no unconnected nodes).
   - Load a simple cantilever test case — verify DL + LL combinations apply correctly.
   - Record pass/fail in `docs/ifc-phase-3-completion.md`.

Phase 3 cannot merge on visualization-only validation. Whichever of 1-4 is used, the completion doc records the reviewer, tool, and outcome.
```

**Target 2:** v2 § 4.7 "Deliverables" (Phase 4).

**Action:** Replace the "Gate for merge" line.

**Original text to find:**

```
**Gate for merge:** MEP consultant (or you + Navisworks trial) validates connectivity via trace tool.
```

**Amended text:**

```
**Gate for merge:** connectivity validation via Solibri or Navisworks trace, in descending order of ideality:

1. **Named MEP consultant** — TBD (VibeCoders to identify before Phase 4 starts).
2. **Retained MEP review** — TBD.
3. **Fallback: internal self-validation via Navisworks trial + Solibri Office trial.** Default when no external reviewer. Procedure:
   - Open Phase 4 federated IFC in Navisworks Clash Detective.
   - Use "Trace" from primary equipment (AHU or pump) through the network. Confirm trace reaches at least one terminal without break.
   - Repeat for each of HVAC, Plumbing, Electrical, Fire systems.
   - Record outcome in `docs/ifc-phase-4-completion.md`.

Phase 4 cannot merge on "ports emitted" alone; end-to-end trace must succeed.
```

**Rationale:** Concern 10 — external reviewer names are TBD but fallback is now defined. Phases aren't blocked by external reviewer availability.

---

## C11 — topologicpy Decision: Quantitative Criteria

**Target:** v2 § 5.6 "topologicpy decision point".

**Action:** Replace the "Skip if" and "Adopt if" criteria.

**Original text to find:**

```
**Skip topologicpy (lighter path) if:**
- Phase 5.1-5.3 coordination is producing acceptable clash counts.
- Space boundaries remain 1st-level (no EnergyPlus export requested).
- Docker image size stays under 1 GB.

**Adopt topologicpy if:**
- 2nd-level space boundaries are needed for energy analysis export.
- Clash counts remain high despite coordination.
- MEP routing through spaces needs graph-based path finding.
- Docker image can grow to ~2 GB (Railway upgrade acceptable).
```

**Amended text:**

```
**Decision criteria are quantitative** (clash budgets elsewhere in this plan are numeric; the decision should use those numbers, not fuzzy wording).

**Skip topologicpy iff ALL THREE hold:**
- (a) Phase 5 after-coordination hard-clash count ≤ 30 on `five_storey_mixed.json` canonical fixture.
- (b) No active user workflow requires `IfcRelSpaceBoundary2ndLevel` (energy analysis export via EnergyPlus or IES VE).
- (c) Phase 5 Docker image stays under 1.5 GB after all Phase 5 dependencies are installed.

**Adopt topologicpy iff ANY of the three flips:**
- (a) Hard-clash count > 30 on the canonical fixture after Phase 5.1-5.3 coordination.
- (b) Energy analysis export is requested by a real user workflow.
- (c) MEP routing through spaces requires graph-based path finding that can't be done with ifcopenshell alone.

**Decision record:** regardless of outcome, `docs/ifc-phase-5-completion.md` records:
- Which criterion triggered (or confirmed skip).
- Actual clash count measured.
- Docker image size measured.
- Date of decision.

This ensures the decision's basis is reproducible a year from now.
```

**Rationale:** Concern 11 — quantitative criteria don't drift over time; fuzzy wording does.

---

## C12 — `generation_phase` Field in Metadata

**Target:** v2 § 2.8 "Deliverables" (Phase 2).

**Action:** Append to § 2.8.

**Text to append to § 2.8:**

```
**Generation-phase marker (Phase 2 deliverable):**

Add a `generation_phase` field to both Python and TS artifact metadata:

- **Python side** — `neobim-ifc-service/app/models/response.py` `ExportMetadata` class adds:
  ```python
  generation_phase: str = "phase-2-2026-05"  # bumped per phase
  ```

- **TS side** — `src/app/api/execute-node/handlers/ex-001.ts:254-260` artifact metadata adds:
  ```ts
  generationPhase: "phase-2-2026-05",
  ```

**Semantics:** the phase marker records which generation cohort produced the file. Downstream consumers (current: download-only; future: reprocessing workflows) can branch on it.

**Reprocessing logic is NOT built in Phase 2.** The field is added now so it's present from day one; any future reprocessing feature in Phase 7+ consumes it. Zero runtime behaviour change in Phase 2 from this field's introduction.
```

**Rationale:** Concern 12 — field cost in Phase 2 is one line per side; building reprocessing logic before there's a use case is premature. Add the marker now, defer the logic.

---

# Summary of changes required (quick scan)

| # | Target | Action |
|---|---|---|
| C1 | v2 new § 1.E + ADR-0001 + ifc-exporter.ts header | Insert freeze note; new ADR; file-header deprecation comment |
| C2 | v2 § 1.D + § 2.1 | Append CI spec to 1.D; prepend prerequisite to 2.1 |
| C3 | v2 § "Rollback Plan" | Append "Per-Phase Python Rollback" subsection |
| C4 | v2 new "Infrastructure Commitments" § | Insert before "Execution Order" |
| C5 | v2 § "Round-trip tests" + § 2.1 | Replace test spec; append pre-audit step |
| C6 | v2 § 5.1 | Replace full section; default OFF + metadata field |
| C7 | v2 § 7 header, § 7.3, new § 7.8 | Replace title + 7.3; insert new 7.8 UI disclaimer |
| C8 | v2 § 7.1 | Replace full section with 5-step checklist + pre-Phase-7 cleanup |
| C9 | v1 plan file directly | Insert banner after H1 |
| C10 | v2 § 3.6, § 4.7 | Replace "Gate for merge" line in both |
| C11 | v2 § 5.6 | Replace Skip/Adopt criteria with numeric versions |
| C12 | v2 § 2.8 | Append generation_phase field spec |

---

# What lands in this amendment commit

1. **This file** (`docs/RICH_IFC_IMPLEMENTATION_PLAN_v2_1_AMENDMENTS.md`) — NEW.
2. `docs/adr/0001-ts-exporter-freeze.md` — NEW (C1 resolution).
3. `docs/RICH_IFC_IMPLEMENTATION_PLAN.md` — 4-line banner added at top (C9 resolution).
4. `src/features/ifc/services/ifc-exporter.ts` — 32-line deprecation comment block prepended to file (C1 resolution).

**No code behaviour changes.** Documentation + one header comment block only. Single atomic commit on `feature/rich-ifc-phase-1` branch.

---

**End of amendments v2.1.**
