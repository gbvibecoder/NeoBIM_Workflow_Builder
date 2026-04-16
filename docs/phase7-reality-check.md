# Phase 7 Reality Check — Post-Mortem

**Date:** 2026-04-16
**Author:** Claude Opus 4.6
**Mode:** Diagnostic only. No code changes.

---

## TL;DR — the brutal verdict

**We built a constraint-satisfaction rectangle packer. Production floor-plan systems build topology-first synthesizers. These are not the same tool, and no number of additional CSP propagators turns one into the other.**

- After 7 phases and ~27 commits, the scorer reports **94.9 / 100** average.
- On the simplest 3BHK N-facing prompt, production shows **33% efficiency** (819 ft² of rooms in a 2500 ft² plot — **67% dead space**).
- The scorer has no void / efficiency / reachability metric, so it can report 94.9 while the render looks like Tetris in a box.
- The user's hypothesis is correct on every point.

The failure mode has a name in the literature: **"trapped rooms"** (GFLAN 2025). Every serious system in this space — Finch, Architechtures, Maket, House-GAN++, Graph2Plan, HouseDiffusion, Tell2Design, GFLAN — fixes **topology first** and deforms **geometry to fit**. We do the inverse. The space of valid rectangular packings is vastly larger than the space of valid floor plans, and almost none of it is architecturally sound.

---

## Task 1 — Hypothesis confirmed (with file:line evidence)

| # | Property | Verdict | Evidence |
|---|----------|---------|----------|
| a | Contiguous interior / no voids | **NOT ENFORCED** | `cell-csp.ts` value function (lines 382–430) rewards mandala proximity, exterior-wall touch, and adjacency. Zero term for plot coverage / void minimization. `layout-validator.ts:114` warns if coverage < 85% — **post-hoc warning only, never fed back to the solver**. |
| b | Every room has ≥1 door | **NOT ENFORCED** | `opening-placer.ts:434-437`: *"Contract: NEVER throws UNSAT. Every failure case degrades (skips, shrinks, picks alternate wall) and pushes a warning."* Line 269-343: `placeInteriorDoors()` silently skips a door if rooms are not edge-adjacent. A room can emerge from the pipeline with zero doors and no error. |
| c | Reachability graph from entrance | **PARTIALLY** | `layout-validator.ts:124-154` builds a BFS graph from room-edge overlaps and flags unreachable rooms — **but this is post-hoc validation**, never a CSP constraint. The solver returns before this runs, so the layout is already frozen. No DFS/BFS inside the CSP search. |
| d | Dead-space minimization | **NOT ENFORCED** | `cell-csp.ts` is pure satisfiability: `tryOnce()` returns on first feasible assignment (lines 449-692). No objective function, no energy term, no "pack tighter" reward. Graceful-degradation escalations *drop* constraints under pressure; they never *tighten* packing. |
| e | Hallway-as-connector role | **PARTIALLY** | `propagators-relational.ts:173-231` (`pruneConnectsAll`) enforces ≥3 ft shared edge between hallway and every connected room — but it is relaxed away in the Phase 7 escalation (`cell-csp.ts: disableConnectsAll`) when tight. More importantly: hallway has **no special "circulation only" role** — it's just a room whose domain is pruned. Nothing forces it to *be* the circulation path between the other rooms. |

Supporting facts:
- **Scorer also blind:** `tests/floor-plan/scoring/gaps.ts` measures dangling wall endpoints + a door-count heuristic. **Zero measurement of void area or plot coverage.** That is why a 33%-efficient layout can score 94.9.
- **Opening placer is last, not first:** `pipeline-b-orchestrator.ts:574-583` places doors *after* walls are already drawn. Doors are not input to placement — they are cosmetic output.
- **Infeasibility detector only checks the easy case** (`pipeline-b-orchestrator.ts:484` → `infeasibility-detector.ts`): rejects if rooms **exceed** plot area. The opposite case (rooms **under-fill** the plot) is silently allowed. This is the exact condition the 3BHK screenshot is in.

---

## Task 2 — Industry comparison (what "right" looks like)

### Maket.ai
**Learned conditional generator (diffusion-family).** Takes boundary + program + constraints, denoises a plan conditioned on them. Topology is *implicit* in weights trained on an RPLAN-style 80K-plan corpus. Not a CSP. Not template retrieval. Refs: maket.ai, ChatHouseDiffusion (arXiv 2410.11908), Automation in Construction 2024 multi-conditional diffusion paper.

### Architechtures.com
**Learned template assembly under hard constraints.** User declares volume + unit mix + min/max per-room; system selects from pre-authored typology blocks (apartment units, stair cores, corridor patterns) and parametrically deforms them to hit constraints in real time. Dodges the open-ended plan problem by restricting to multi-family where per-unit topology is well-known. Refs: architechtures.com blog "Parametric vs Generative vs AI-aided."

### Finch3D
**The canonical topology-first production system — and the most damning comparison to ours.** Their patented **Finch Graph** is built *before any geometry*: nodes = spaces/rooms/objects, edges = adjacency + access + daylight + regulatory relations. They solve/sample on the **graph** (GNN + rule evaluation), reject graphs that violate rules, *then* instantiate geometry inside the imported mass. A bathroom with no corridor-edge is rejected at the graph stage — **it never becomes a rectangle in the first place**. Refs: medium.com/finch3d/introducing-finch-graph-rules, docs.finch3d.com/floor-plate-studio/algorithm-theory, Architosh 2024 coverage.

### Academic systems (all RPLAN-derived)
- **House-GAN / House-GAN++** (CVPR 2020/21): bubble diagram *in*, boxes *out*. Graph conditions the generator at every layer.
- **RPLAN** (SIGGRAPH Asia 2019): **two-stage**: (1) locate rooms given boundary, (2) then walls. Rooms before walls. Boundary before rooms.
- **Graph2Plan** (SIGGRAPH 2020): user-given or retrieved adjacency graph, then box regression.
- **Tell2Design** (ACL 2023): LLM → structured relational representation → Seq2Seq decoder. Even "pure LLM" builds the relational layer first.
- **GFLAN** (arXiv 2512.16275, 2025): states the thesis explicitly — *"factorizing into a topology-first stage and a geometry stage reduces failure modes typical of monolithic models (e.g., **trapped rooms**)."*

### The pattern every one of them shares — and that our CSP lacks

All of them do, in this order:

1. **Construct an explicit (or implicit-in-weights) room-adjacency graph** — nodes = rooms with area/program, edges = required adjacency / access / via-corridor.
2. **Verify / solve the graph for feasibility** against the plot's topological capacity *before any rectangle is drawn*.
3. **Realize the graph geometrically** — the boundary deforms geometry to fit a **fixed** topology. Doors are promoted *edges*, not post-hoc opening passes.

Ours: `Vastu quadrant assignment → rectangle packing → opening pass`. That is *quadrant → geometry → (topology emerges or it doesn't)*. Almost always "doesn't," because the pigeonhole says so: the valid-packings space is orders of magnitude larger than the valid-plans subset, and random sampling lands outside the subset.

**Our approach isn't incomplete — it's the wrong order of operations.** Every paper and product in this space has learned the same lesson. We are re-learning it the hard way.

---

## Task 3 — 3BHK N-facing, step by step

**Prompt:** *"A 3BHK villa on a 50ft x 50ft north-facing plot, 1800 sq ft. Vastu compliant. Master bedroom 14ft × 12ft in the SW corner with attached bathroom 7ft × 5ft. Kitchen 12ft × 10ft in the SE corner. Living 16ft × 14ft in the NE. Pooja 5ft × 4ft in the NE corner. Bedroom 2 12ft × …"*

**Plot area:** 50 × 50 = **2,500 ft²**. User asked for ~1,800 ft² of built area.
**Screenshot stats:** 7 rooms placed, total 819 ft², **efficiency 33%**, doors = 1, windows = 0.

### What each stage did

| Stage | Output | Why the output is what it is |
|---|---|---|
| **Parser** | 7 rooms, each with user-pinned quadrant (SW / SE / NE / NE / N / N / S or similar). Vastu=required. | Dutifully extracts — no complaint that 819 ft² of rooms won't fill 2,500 ft². |
| **Infeasibility detector** | PASS | Only trips when rooms > plot. 819 < 2,500, so "feasible." The under-fill case — the exact failure we're looking at — is invisible to it. |
| **Stage 3A mandala** | Each room → a 3×3 cell (NW/N/NE/W/CENTER/E/SW/S/SE). Master → SW cell, Kitchen → SE cell, Living → NE cell, Pooja → NE cell, etc. | All user quadrants are honored. **No room claims the 4 interior-ring cells** (W, CENTER, E, and whatever corner is empty) because the user didn't ask for rooms there. Those cells are permanently void. |
| **Stage 3B fine placement** | Each room gets a rectangle of its asked size, placed anywhere inside its mandala cell that doesn't overlap others. | CSP is satisfied the moment the rectangle fits in the cell. There is no reward for pushing rectangles together, filling cells, or eliminating gaps between cells. Master 14×12 floats in the SW 16.6×16.6 cell with 4 ft of gap on two sides. |
| **Stage 3C boundary align** | Snaps some rooms to plot edges. | Cosmetic only. Doesn't expand rooms, doesn't add circulation, doesn't fill voids. |
| **Wall gen** | Draws walls around each rectangle + plot boundary. | Walls follow rooms. Walls don't create rooms. The interior gap has no walls because no room is there. |
| **Stage 3D openings** | 1 door (main entrance), 0 windows. | Interior doors require shared edges between rooms. With rooms floating in their cells **nothing shares an edge**, so `placeInteriorDoors` skips them all and warns (`opening-placer.ts:293`). Windows need rooms on plot edges with space; most rooms are neither flush nor sized to fit the corner-margin / spacing rules. |

### Why the east-central area is empty

- No room was parsed into cells W, CENTER, or E.
- Stage 3A needs no room in a cell → the cell stays empty.
- Stage 3B never asks "who will fill this gap?" — nothing in the solver is driven by void minimization.
- The pipeline has no concept of *circulation* as a placed element. Real plans put a corridor / hallway in that central strip to connect bedrooms to living. We don't.

### Why the master bathroom is floating

- Parsed as `attached_ensuite` of master bedroom.
- `cell-csp.ts` enforces **shared edge ≥ 3 ft** with the parent.
- But if the parent master floats inside its SW cell with gaps on two sides, the ensuite still touches *one* edge of the master to satisfy the constraint — and can itself be anywhere else in its cell. Result: ensuite touches master on one side but is surrounded by void on the other three.

### What would need to change to produce a tight layout

*(Stating the requirement, not the implementation — we are not fixing today.)*

1. Either **automatically add circulation rooms** (hallway, dining, foyer) to fill the gaps the user didn't spec, or **grow requested rooms** to absorb the slack, or **shrink the plot** to match the requested program — all three are valid, none are implemented.
2. **A plot-coverage objective** in the CSP (minimize `plot_area - Σ room_area - circulation`), not just a post-hoc warning.
3. **A topology graph** that forces every non-corridor room to connect to a corridor, and every corridor to connect to the entrance — so the empty central strip is *required* to be a corridor, not *allowed* to be void.

---

## Task 4 — The honest path forward

### (a) Can CSP-with-more-propagators ever make the 3BHK case look right?

**No.** The problem is not under-constrained search — it is **under-specified input**. The user asked for 819 ft² on a 2,500 ft² plot. A CSP is a *satisfiability* engine: given the program as spec'd, it placed every requested room validly. The layout is *correct* by the spec and *wrong* by any architectural eye.

To fix it we need one of:

1. An **auto-programmer** that invents unrequested rooms (hallway, dining, foyer, balcony, store, utility) to fill the gap, *then* runs the CSP on the expanded program.
2. A **deformation** model that scales requested rooms to fill the plot while preserving ratios.
3. A **topology graph** that makes voids illegal: every interior cell must either contain a room or be a labelled corridor reachable from the entrance.

None of these are "more propagators." All are new stages above or below the CSP.

### (b) What a correct rearchitecture looks like

A 3-stage pipeline modeled on Finch / House-GAN / RPLAN:

```
LLM programmer            → bubble diagram (rooms + area ranges + adjacency graph)
Topology solver / retriever → graph valid for this plot + vastu? if not, repair graph
Geometry realizer         → embed graph in plot, deform rectangles to fit, promote edges to doors
```

Key inversions vs. what we have:

- **Circulation is a graph node, not an optional room.** Every plan has at least one corridor/hallway node with edges to every bedroom cluster.
- **Doors are graph edges, not post-hoc openings.** An adjacency edge *is* a door. If the geometry can't realize the edge, geometry retries; it does not silently drop the door.
- **Plot under-fill is resolved at the programmer stage, not ignored.** If the user's program is 819 ft² on 2,500 ft², the programmer adds rooms until the graph tiles the plot.

**Rough scope estimate (order-of-magnitude, not a commitment):**
- Bubble-diagram LLM stage on top of existing parser: 1–2 weeks to prototype, 3–4 weeks to make reliable on the current test set.
- Topology solver (graph feasibility + auto-circulation insertion): 2–3 weeks if rule-based; 2–3 months if learned on RPLAN.
- Geometry realizer reusing our existing CSP as the inner loop (now given a *fixed* topology to realize, not a free search): 2–3 weeks of adaptation.
- Scorer rewrite with void, reachability, door-per-room metrics: 1 week.
- Honest regression + visual validation: 1–2 weeks.

**Total: 2–4 months** of focused work to reach a state where the 3BHK N-facing simple case renders as a plausible floor plan. The current approach, at any propagator count, will not.

### (c) What we can ship today from the existing work

There is real value in the current codebase — it's just not "generate a floor plan from a prompt."

1. **Vastu rule engine** (`vastu-rules.ts`, `mandala-csp.ts`) — standalone, correct, usable as a compliance checker for user-edited or third-party plans. Ship as `/api/vastu-check`.
2. **Room-dimension / program validator** (`dimension-corrector.ts`, `room-sizer.ts`, `room-standards.ts`, `infeasibility-detector.ts`) — given a prompt, tell the user whether the program is plausible and which rooms are undersized. Ship as a pre-flight hint in the UI.
3. **Structured prompt parser** (`structured-parser.ts` with Phase 7 additions) — ships as-is. Directly usable by any future architecture. The schema work from Phase 7 is the highest-leverage output of the past month.
4. **Seed layout for manual editing** — the current output, honestly reframed: "AI starter layout, drag to complete." Lead with the editor (which is good), not with the generator's output (which is bad).
5. **Wall / door / window renderer** (`wall-generator.ts`, `opening-placer.ts` minus the solver coupling) — usable by a topology-first successor unchanged.

### (d) Are the last 7 phases wasted?

**Mostly not. Some yes.**

**Lasting value:**
- **Parser schema** (Phase 7 A): directional adjacency, between, connects_all are *exactly* the graph edges a topology-first system needs. This is the single highest-value artifact.
- **Y-flip fix** (pre-Phase 7): bug fix, permanent value.
- **Vastu mandala propagator** (`FACING_MANDALA_CELLS`, propagators.ts): reusable as a graph-level constraint in any successor.
- **Infeasibility detector** (for the over-area case): permanent value.
- **Boundary aligner** (Stage 3C): the final geometry cleanup any system would want.
- **Opening placer**: reusable as-is once it's given a topology graph to realize (instead of best-effort scanning adjacency pairs).

**Wasted:**
- **Scorer rebalance to 100** (Phase 7 F): the 10-metric split is moot because the scorer misses the dominant failure (voids, unreachable rooms). The four new metrics (relational, main_entrance, hallway, windows) will need rewriting once topology is a first-class concept — they currently measure the wrong things at the wrong stage.
- **Graceful-degradation escalation stack** (`slack=5 → dim-shrink 10% → disableConnectsAll`): built to paper over CSP failures that shouldn't exist in a topology-first system. Mostly throw-away.
- **The `connects_all_groups` hard propagator**: right idea, wrong place. In a topology-first pipeline this would be the *input* to the graph stage, not a propagator inside the geometry CSP.

**Net assessment:** roughly **60% of the last 7 phases has lasting value** (parser, validator, renderer primitives, Vastu engine). The other 40% is scaffolding around the wrong architecture. None of it is destructive — everything stays in the repo, and the salvageable pieces slot into a topology-first successor.

---

## Recommendation

1. **Stop shipping scorecard averages as a quality signal.** The scorer is blind to the pathology the user sees on screen. A layout with 67% dead space and 0 windows should not score 94.9.
2. **Reframe today's output honestly in the UI.** "AI starter — edit to complete" — not "generated floor plan." Lead with the editor.
3. **Spike a topology-first prototype** on the simplest prompt (3BHK N-facing) before any more CSP work. Use the existing parser (now emitting bubble-diagram-shaped data) and a rule-based graph stage. 2-week timebox. If the spike renders as a plausible plan, commit to the rearchitecture; if it doesn't, we've at least learned which stage is the true blocker.
4. **Do not add more CSP propagators.** Every additional propagator in the current architecture increases the surface area to unwind when topology moves above it.

The cheapest mistake from here is to keep adding constraints. The most expensive mistake is to keep reporting 94.9 while the product looks like Tetris.
