# Proposed Target Architecture

**Date:** 2026-04-16
**Author:** Claude Opus 4.7 (ultrathink mode)
**Predecessor:** `docs/phase7-reality-check.md` §"Task 4(b)" already sketched a topology-first 3-stage pipeline. This document commits that sketch, adds the missing validation/dialog + transparency layers, specifies the migration path, and writes the test strategy.
**Status:** Proposal for approval. Do not implement until the user signs off on Phase 1.

---

## TL;DR

1. **Throw away the geometry-first mental model.** Adopt topology-first: graph before geometry, circulation before rooms, user-intent dialog before solver. Every competitor (Finch, Maket, Architechtures, House-GAN family, RPLAN, Tell2Design) does this. We are the outlier.
2. **Five agents replace one solver.** (1) Requirement Extractor. (2) **Validation & Dialog** — new, currently missing. (3) Topology / Circulation Planner. (4) Geometry Realizer. (5) Compliance (opt-in Vastu, code, energy).
3. **GENERIC prompts get a proposed default program the user can edit *before* generation.** "4BHK villa 1200 sqft" → a computed program is shown, not a blind generate.
4. **SPECIFIC prompts get a feasibility diff.** "You asked for 15 rooms totaling 1528 ft² in a 2600 ft² plot — we'll add a central hallway + utility + foyer to fill the 1072 ft² slack. Accept / edit / reject."
5. **Circulation is a first-class element.** A hallway spine is *placed first*, not emerged-from-leftovers. Every non-corridor room connects to the spine.
6. **Doors become graph edges, not post-hoc openings.** If the geometry stage can't realize an adjacency, it retries geometry — it does not silently drop the edge.
7. **Right-side "Transparency" panel** shows You-asked / We-did / Adjustments-and-why / We-suggest. Every auto-correction has a revert button.
8. **Consolidate GN-004, GN-012, and `/api/generate-floor-plan` behind one engine call.** Kill code duplication.
9. **Phase 1 is independently revertible.** A 2-week topology-first spike behind a `PIPELINE_T1` feature flag, routed only for opt-in users. Main pipeline runs unchanged until we flip the flag.
10. **Ship metrics: void %, door-per-room coverage, adjacency-satisfaction %, efficiency %, and "did we place what the user asked for" — not a 94.9/100 scorecard.**

---

## 7.1 Requirement Extraction Agent (evolve, don't rewrite)

Survives: `structured-parser.ts` schema (Phase 7 additions — directional adjacency, between, connects_all). This is the codebase's highest-leverage existing artifact.

Adds:

- **Prompt-type classifier: SPECIFIC / SEMI-SPECIFIC / GENERIC.** Not binary. Signal:
  - SPECIFIC: every room has dim_width_ft + dim_depth_ft + position_direction; total_built_up_sqft given.
  - SEMI-SPECIFIC: plot given + room count + some (not all) room dims.
  - GENERIC: plot area + BHK; no per-room dims.
- Every extracted field tagged `source: "explicit" | "inferred" | "default"` so the Transparency panel can distinguish "you said this" from "we assumed this."
- Output schema:
  ```ts
  {
    classification: "SPECIFIC" | "SEMI_SPECIFIC" | "GENERIC",
    plot: { width_ft, depth_ft, total_built_up_sqft, facing, source: {...} },
    rooms: ParsedRoom[],           // existing schema + source tags
    adjacency: ParsedAdjacency[],  // existing
    connects_all: ...,             // Phase 7 schema
    compliance: { vastu_required, vastu_source, nbc_required, setbacks? },
    explicit_intent: { entrance_direction?, style_preferences? }
  }
  ```

---

## 7.2 Validation & Dialog Agent (NEW — currently missing)

This is the piece that would have prevented both the 5BHK and 4BHK investor-demo failures.

**Runs after extraction, before generation. Output: a `FeasibilityReport` with per-field `verdict`s.**

### Feasibility checks (all of them, not just over-area)

| Check | What it returns |
|-------|----------------|
| `Σ room_area > plot × 1.1` | `OVER_FULL` — suggest rooms to drop / shrink |
| `Σ room_area < plot × 0.7` | `UNDER_FULL` — suggest circulation + rooms to add |
| plot perimeter vs `room_count × min_perimeter_share` | `INSUFFICIENT_PERIMETER` — not enough exterior-wall frontage for bedrooms |
| adjacency cycles | `ADJACENCY_CYCLE` — e.g. A adj B adj C adj A when one pair is impossible |
| dim_width_ft > plot_width (same room) | `ROOM_EXCEEDS_PLOT_SIDE` |
| user-pinned position vs Vastu | `POSITION_VASTU_CONFLICT` (offer override) |
| two rooms claim the same corner | `CORNER_COLLISION` |
| user total_built_up_sqft ≠ Σ room_area + corridor_default | `AREA_MISMATCH` — propose expansion plan |
| Vastu hard-forbidden placement | `VASTU_HARD_VIOLATION` (already exists) |

### Dialog strategy per verdict

Every feasibility issue resolves to one of three actions:
- **(a) auto-adjust & disclose.** E.g. expand a 30-sqft powder room up to minimum by 10% — log "we grew this because NBC requires".
- **(b) ask the user.** E.g. "You asked for 15 rooms totaling 1528 ft² in 2600 ft². Add a 1072 ft² central hallway + dining + store? [Show me] [Edit] [Keep voids anyway]".
- **(c) hard-fail.** Impossible adjacencies, dimensions exceeding plot side by >15%, two rooms in the same corner with no override.

### For GENERIC prompts

Proposes a default program sourced from room-standards:
- 4BHK 1200 sqft → ~10 rooms with typical areas. Shows it as an **editable table** before generation.
- Uses `room-standards.ts` and `typology-templates.ts` which already exist and are under-used.
- Includes Vastu / pooja / utility only if the prompt mentions India/Indian/Vastu or explicitly asks.

### For SPECIFIC prompts with under-fill

Proposes an expansion plan:
- Computes slack = `plot − Σ rooms`.
- Proposes adding circulation (hallway spine, foyer if absent, utility if absent, and one or more rooms appropriate to BHK count).
- Shows the proposed expansion as a side-by-side diff before generation.

**UX:** modal that cannot be skipped for GENERIC or for any `UNDER_FULL`/`OVER_FULL` prompt. For SPECIFIC with clean feasibility, it auto-skips.

---

## 7.3 Layout Planning Agent — topology-first

Survives: `ai-room-programmer.ts` → bubble diagram. Existing adjacency/zone output IS a bubble diagram in disguise. Reuse.

Replaces: `cell-csp.ts` Stage 3B as primary placement. Cell-CSP remains as an inner-loop realizer given a fixed topology (§7.3.d).

### (a) Zone planning

- Divide plot into macro-regions: `PUBLIC` / `PRIVATE` / `SERVICE` / `WET` / `OUTDOOR`.
- Rule-based for v1 (Vastu-aware if vastu_required; standard north-zoning otherwise).
- Produces `ZoneMap` — plot rectangle partitioned into 2-4 labelled rectilinear regions.

### (b) Circulation-first spine placement

- Place a `HallwaySpine` rectangle inside the plot **before** rooms.
- Spine connects entrance region to each zone centroid.
- Spine depth: per-standard 1.0-1.5 m; length: whatever is needed to touch every zone.
- T-spine for duplex ground floors; L-spine for narrow plots; straight for square plots.

### (c) Adjacency graph satisfaction

- From bubble diagram + spine, build `TopologyGraph = {nodes: rooms ∪ spine ∪ plot_boundary, edges: adjacency ∪ connects_all ∪ exterior_wall_required}`.
- Feasibility check: graph must be embeddable in the plot minus spine. Apply Fraysseix-Rosenstiehl or similar planarity check (rooms are all rectangles — simpler).
- If infeasible: return to Dialog Agent with a graph-repair suggestion.

### (d) Rectilinear dissection as geometry realizer (reuse existing CSP)

- Given: zone map, spine rectangle, topology graph, per-room dim preferences.
- The inner-loop solver becomes a **guided rectilinear dissection**: BSP-like slicing of each zone, with the following hard constraints:
  1. No overlaps (existing H1).
  2. Union of all placed rooms + spine + explicit courtyard = plot (NEW — the missing constraint).
  3. Every adjacency edge in the topology graph realized as a shared wall.
  4. Every `mustHaveExteriorWall` room has at least one edge on plot perimeter.
  5. User-specified dims within ±10% (SPECIFIC) or ±20% (SEMI/GENERIC).
- Objectives (soft, for when multiple dissections are feasible):
  - Minimize deviation from user-specified dims.
  - Maximize proportion score (aspect ratios).
  - Minimize total wall length (compactness).
- Solver: MIP for n ≤ 15 rooms (feasible latency <2 s); fall back to SA for larger.

### (e) Differential handling per classification

| Classification | Zone plan | Spine | Dim respect | Slack policy |
|---|---|---|---|---|
| SPECIFIC | inferred from user positions | rule-based | **hard ±5%** | absorb into spine, or propose extra rooms via Dialog |
| SEMI-SPECIFIC | partly inferred | rule-based | hard ±10% where given, free elsewhere | grow under-specified rooms |
| GENERIC | default template | spine via template | free | perfect tiling, all slack into corridor + service rooms |

---

## 7.4 Compliance & Post-Processing Agents (user-toggled)

- **Vastu** as **post-process** (not pre-placement). Runs `vastu-analyzer.ts` on the realized plan and proposes room swaps. UI: "Arrange according to Vastu" button on the Vastu tab (exists as pass-check today; needs a swap-apply action). **User can generate without Vastu** by default; the current implicit "vastu_required if the prompt mentions the word" becomes an explicit toggle.
- **NBC / building code:** existing `code-validator.ts`, `building-code-rules.ts` — run as checker only; show compliance badges; don't block generation.
- **Energy / daylight:** `light-analysis.ts` already exists as a panel. Ship as advisory.

---

## 7.5 Geometry Finalization

Survives largely as-is:
- `wall-generator.ts` — shared-wall merging + T-junction splits (already correct).
- `boundary-aligner.ts` — final snap pass.
- `opening-placer.ts` — with one change: door placement must be **guaranteed** by the topology graph. If `findSharedEdgeWall` returns null, that's a solver failure, not a degradation — trigger a geometry re-solve, don't skip.
- Dimensioning / annotation — unchanged.

---

## 7.6 Transparency UI (NEW — currently missing)

Right-side panel (new tab in the existing `Props / Vastu / Code / Stats / BOQ / Program` tab bar; `FloorPlanViewer.tsx:634-653`) titled **"Explain"**.

Sections:

1. **You asked for** — parsed requirements with `source` badges (explicit/inferred/default). Editable in place.
2. **We did** — the realized plan summary: N rooms, total area, efficiency, door count, exterior walls, zones.
3. **Adjustments we made** — one row per auto-correction with reason and **Revert** button.
   - "Expanded Pooja Room 30 → 40 ft² to meet NBC minimum" [Revert]
   - "Added Central Hallway (125 ft²) to fill plot slack" [Revert]
   - "Rotated Kitchen 90° to share wall with Dining" [Revert]
4. **We suggest** — accept/reject chips for:
   - Vastu swaps (existing — shown as "AI SWAP SUGGESTIONS" in screenshot 2).
   - Room additions the user didn't ask for but plot needs.
   - Geometry tightenings (e.g. "Bedroom 4 currently floats — move it to share wall with corridor? [Accept] [Reject]").
5. **Room schedule** — existing (screenshot 1 right side). Click a row → highlight room, **Edit** opens inline dims.

### Inline editability

- Click any room → change size/position/name.
- **Regenerate only the affected region.** Re-dissect the containing zone, leave others alone. Requires the dissection step to be zone-scoped (which §7.3 already is).

---

## 7.7 Architecture Diagram

```
                ┌──────────────────────────────────────┐
  User prompt → │  1. Requirement Extractor  (LLM+schema) │
                └────────────────────┬─────────────────┘
                                     │ ParsedConstraints
                                     │ + classification
                                     ▼
                ┌──────────────────────────────────────┐
                │  2. Validation & Dialog Agent       │     ← NEW
                │   ── feasibility checks             │
                │   ── diff & propose modal           │───► UI: "Here's what we understood…"
                └────────────────────┬─────────────────┘        (user can edit / accept)
                                     │ ExpandedProgram
                                     │ + user-confirmed intent
                                     ▼
                ┌──────────────────────────────────────┐
                │  3. Topology Planner                │     ← NEW order
                │   3a. Zone map (public/private/…)   │
                │   3b. Circulation spine             │
                │   3c. Topology graph + feasibility  │
                │   3d. Rectilinear dissection (MIP/SA)│
                └────────────────────┬─────────────────┘
                                     │ Placement[]
                                     ▼
                ┌──────────────────────────────────────┐
                │  4. Geometry Finalization            │     ← EXISTING, refitted
                │   ── wall merge + junction split    │
                │   ── doors promoted from graph edges│
                │   ── windows on exterior walls      │
                │   ── boundary snap + annotations    │
                └────────────────────┬─────────────────┘
                                     │ FloorPlanProject
                                     ▼
                ┌──────────────────────────────────────┐
                │  5. Compliance Checks (opt-in)       │
                │   ── Vastu analyzer (post-hoc)      │
                │   ── NBC / code validator           │
                │   ── light / energy                 │
                └────────────────────┬─────────────────┘
                                     │ + compliance badges
                                     ▼
                ┌──────────────────────────────────────┐
                │  Renderer + Transparency Panel       │
                │   ── worldToScreen (unchanged)      │
                │   ── "Explain" tab w/ revert chips   │
                └──────────────────────────────────────┘

Single engine call used by:
  ── /api/generate-floor-plan (standalone + FloorPlanViewer)
  ── GN-012 handler
  ── GN-004 handler   (redirect; drop direct GPT-4o SVG path)
```

---

## 7.8 Migration Plan

### What survives from the existing codebase

| Keep | File | Why |
|---|---|---|
| **Structured-parser + Phase 7 schema** | `csp-solver/structured-parser.ts`, `parser-aliases.ts`, `room-vocabulary.ts`, `parser-audit.ts`, `parser-text-utils.ts` | The highest-value artifact; directly feeds §7.1 |
| **Infeasibility detector** | `infeasibility-detector.ts` | Foundation for §7.2; extend, don't rewrite |
| **Vastu engine** | `vastu-rules.ts`, `vastu-analyzer.ts`, `csp-solver/mandala-csp.ts` | Now post-hoc / opt-in (§7.4) |
| **Wall generator** | `csp-solver/wall-generator.ts` | Correct geometry pass; reuse |
| **Opening placer** | `csp-solver/opening-placer.ts` | Refactor: doors must be guaranteed, not degraded |
| **Boundary aligner** | `csp-solver/boundary-aligner.ts` | Final cosmetic snap; keep |
| **Room standards / rules** | `room-standards.ts`, `architectural-rules.ts`, `room-sizer.ts` | Sizing minima for §7.2 |
| **Grid generator + wall-from-grid** | `grid-generator.ts`, `grid-wall-generator.ts` | Structural grid as an optional §7.3.d realizer |
| **Renderer** | `components/renderers/*` | Faithful, untouched |
| **Editor** | `FloorPlanCanvas`, `Toolbar`, all panels | The best part of the codebase; leverage it |

### What gets deprecated

| Deprecate | File | Replacement |
|---|---|---|
| Legacy monolithic CSP | `constraint-solver.ts` (already `@deprecated`) | §7.3.d MIP realizer |
| Pipeline A's SA optimizer | `layout-optimizer.ts`, `energy-function.ts`, `typology-matcher.ts` | Only as fallback realizer |
| BSP `layoutFloorPlan` | `layout-engine.ts` | Only as SA inner-loop seed |
| Cell-CSP as primary placer | `csp-solver/cell-csp.ts` | Becomes an *optional* realizer variant |
| `runGridFirstPipeline` coordinator loop | `/api/generate-floor-plan/route.ts:492-749` | Replaced by §7.2+§7.3 |
| `pipeline-router.ts` binary A/B | replaced by §7.1 classification + §7.3 realizer selection |
| 8-step theatrical progress UI | `FloorPlanViewer.tsx:117-128` | Real per-stage progress tied to agent completions |
| `GN-004` direct GPT-4o SVG | `gn-004.ts` | Redirect to the unified engine |

### What gets merged

- `GN-012` handler and `/api/generate-floor-plan` call the same function. Move the engine out of `route.ts` into `src/features/floor-plan/services/floor-plan-engine.ts`. Both routes become thin wrappers.

---

### Phased rollout

Each phase is **independently revertible** (feature flag or env var) and **ships behind `PIPELINE_T1=true` until sign-off**. No customer-visible regression until the flag flips.

#### Phase 1 — Transparency wins without touching the engine (1 week, S)

**Goal:** stop shipping 94.9 scorecards while users see Tetris. Give the user honest, actionable feedback today.

- Add a **post-solve validator** to every pipeline (new file `src/features/floor-plan/lib/layout-metrics.ts`): efficiency %, void area, adjacency-satisfaction %, door-per-room coverage, orphan-rooms count.
- If any of `efficiency < 70`, `void > 300 ft²`, `doors < rooms × 0.8`, `orphans > 0` → return 200 but surface a banner: "AI starter — N adjustments recommended. Click to see." Link to a new `Explain` panel.
- Add a feasibility-underfill hint (non-blocking) in `infeasibility-detector.ts`: `{ feasibility: "UNDER_FULL", slack_sqft: X }`.
- Fix `FloorPlanViewer.tsx:117-128` to drive progress from backend milestones via SSE or a server-timing header — no more theatre.
- **Kill the silent BHK-matched-sample fallback** at `FloorPlanViewer.tsx:176-198`. On API failure, show an explicit error UI ("AI generation failed: <reason>. [Retry] [Use sample]") instead of swapping in a sample plan with `dataSource: "sample"` and a small banner. This is the worst silent-failure path in the codebase and it directly enabled the investor demo to look "successful" when the underlying generator was broken.
- Files touched: `~5`. LOC: `~400`. No engine change.
- Rollback: revert commit. Zero data loss.

**Ships the "we suggest" row, doesn't yet ship new placement.**

#### Phase 2 — Pre-generation Dialog + GENERIC defaults (1-2 weeks, M)

**Goal:** catch the 5BHK case at extraction time. Show the diff. Let user accept/edit.

- Implement §7.2 FeasibilityReport with all listed checks.
- Implement Dialog modal: editable program, accept-auto-fixes, confirm button.
- For GENERIC prompts, compute default program from `room-standards.ts` + typology.
- For SPECIFIC under-fill, compute expansion plan (add corridor + foyer + store).
- Behind flag `DIALOG_V1`. A/B split; FREE tier users see the modal.
- Files touched: `~10`. LOC: `~1500`. Engine unchanged.

**Ships the "You asked for / We will do" dialog.**

#### Phase 3 — Topology-first engine (4-6 weeks, XL) — the highest-impact bet

**Goal:** implement the rearchitecture proper. Zone map + spine + dissection.

- Sub-phases:
  - 3a. `zone-planner.ts` + `spine-placer.ts` (1 week).
  - 3b. `topology-graph.ts` + feasibility check (1-2 weeks).
  - 3c. MIP dissection realizer + SA fallback (2-3 weeks). Use `ipopt-js` or similar (evaluate licensing).
  - 3d. Refactor `opening-placer` to require a door, not degrade (3 days).
  - 3e. Integration: make `/api/generate-floor-plan` call the new engine behind `PIPELINE_T1=true`.
- Phase-3 run behind the flag for opt-in users only. Pipeline B / Grid-First remain default.
- Files touched: `~15 new + 5 modified`. LOC: `~4000`.
- Rollback: flip flag. Old engine unchanged.

**Phase 1 should be Phase 1.** It ships value in days and catches the investor-demo symptom. Phases 2 and 3 build toward the endgame.

---

### Per-phase table

| Phase | Effort | LOC | Files | User-visible | Rollback |
|-------|--------|-----|-------|--------------|----------|
| 1 | 1w / S | ~400 | 5 | Banner: "AI starter — N adjustments recommended"; accurate progress bar | `git revert` |
| 2 | 2w / M | ~1500 | ~10 | "Confirm your program" modal before generation | feature-flag off |
| 3 | 5w / XL | ~4000 | ~20 | New engine for opt-in users; old engine still default | feature-flag off |
| 4 | 1w / S | ~300 | 3 | Consolidate GN-004, GN-012, standalone | feature-flag off |

---

## 7.9 Test Strategy

### Regression suite prompts (must pass before Phase 3 flips to default)

1. **Specific, simple.** "3BHK villa on 50×50 ft plot, 1800 sqft, Vastu, master 14×12 SW, kitchen 12×10 SE, living 16×14 NE, pooja 5×4 NE." → efficiency ≥75, 0 orphans, all doors placed.
2. **Specific, complex (investor 5BHK).** 15 rooms with dims. → efficiency ≥75, ≤5% dim deviation, all doors placed.
3. **Semi-specific.** "4BHK apartment, 1500 sqft, north-facing, master 16×14." → pipeline auto-sizes remaining rooms; efficiency ≥80.
4. **Generic.** "4BHK villa, 1200 sqft." → default program shown in Dialog; user accepts; efficiency ≥85.
5. **Edge: tiny plot.** "1BHK studio, 400 sqft." → efficient single-zone layout.
6. **Edge: many rooms.** "6BHK duplex, 3500 sqft, 24 rooms." → multi-floor; no timeout.
7. **Edge: infeasible under.** "5BHK, 800 sqft." → 422 with `ROOM_MINIMUMS_VIOLATE`.
8. **Edge: infeasible over.** "2BHK, 5000 sqft." → Dialog prompt: "plot is much larger than 2BHK needs — add rooms?".
9. **Vastu-heavy.** All rooms with Vastu-correct placements. → match without swap suggestions.
10. **Vastu-disabled.** "3BHK, 1000 sqft. Don't worry about Vastu." → `vastu_required=false`; free placement.

### Automated metrics (continuous regression)

| Metric | Definition | Pass threshold (Phase 3 GA) |
|--------|-----------|-----------------------------|
| Efficiency | `Σ room_area / plot_area` | ≥ 75% for residential |
| Void % | `plot_area − Σ room_area − corridor` / `plot_area` | ≤ 10% (courtyards excepted) |
| Adjacency satisfaction | `satisfied / total` explicit adjacencies | ≥ 95% |
| Door coverage | `doors_placed / rooms_with_required_door` | = 100% |
| Dim accuracy | mean `abs(actual - user_specified) / user_specified` | ≤ 5% for SPECIFIC |
| Area accuracy | `abs(generated_total - user_total) / user_total` | ≤ 5% for SPECIFIC |
| Wall continuity | no dangling endpoints, no stray T-junctions | 100% |
| Orphan rooms | rooms unreachable from entrance via BFS | 0 |
| p95 latency | API response time | ≤ 8 s |

### Visual validation

- 20-prompt snapshot gallery (committed to `tests/floor-plan/visual/`).
- Per prompt: SVG snapshot + metrics JSON.
- Human reviewer signs off on each snapshot before it enters the baseline.
- CI diffs on every PR; non-trivial diffs block merge.

### Specific metrics the current scorer misses (per `phase7-reality-check.md`)

- **Void area** (none today).
- **Reachability graph** from entrance (only as post-hoc warning today).
- **Per-room door count** (only logged as console warn).
- **Tiling coverage** (plot_area − Σ rooms − corridor) as a hard metric, not just visual.

---

## Open questions for Rutik

Before I propose code changes I need answers to these. Phase 1 can start without them; Phases 2 and 3 can't.

1. **Vastu default.** Should the default pipeline be Vastu-on or Vastu-off? In screenshots 1 and 2 Vastu appears mandatory. For GENERIC prompts (no mention of Vastu), current code infers `vastu_required` via keyword regex — which for generic prompts returns false. Keep as-is, or flip for Indian users?
2. **Classification taxonomy.** Are SPECIFIC / SEMI / GENERIC the right three buckets, or do you want four (e.g. split GENERIC into "pure BHK" vs "BHK + style")?
3. **Modal vs inline dialog.** For the Dialog Agent, do you want a modal (blocking) or inline-below-prompt (non-blocking)? Modal catches more errors; inline converts better.
4. **MIP vs SA vs GNN.** §7.3.d defaults to MIP; I can also propose a GNN-based realizer trained on RPLAN if you want learned behavior (more impressive demo, more data engineering).
5. **GN-004 vs GN-012.** Do we keep GN-004 as a "quick-SVG" node (for BOQ compatibility chains) or redirect entirely to GN-012's engine? My default is redirect; if removing GN-004 would break live workflows, we keep it as a thin wrapper.
6. **Feature flag scope.** Phase 1 rollout — all users, or gradual?
7. **Investor narrative.** Do you want a demo-ready Phase 1.5 with a hand-tuned 5BHK sample that shows the Dialog + Transparency panel, even if the underlying engine is unchanged? This would be the "fast investor demo" tactic — we ship a better UX for known prompts while engineering the real fix in the background.

---

*End of proposed architecture. Awaiting approval.*
