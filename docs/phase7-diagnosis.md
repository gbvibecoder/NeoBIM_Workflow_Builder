# Phase 7 Diagnosis — Relational Constraints + Main Entrance + Scorer Blind Spots

**Date:** 2026-04-16
**Prompt under investigation:** 4BHK villa, 45×55 ft E-facing, full spec (foyer, utility, common bath, hallway-connecting-bedrooms, main entrance on east).
**Raw trace:** `docs/phase7-diagnosis-data.json` (parser output + mandala assignments + fine placements + wall/door generation, dumped from a live parse+solve run).

---

## TL;DR

The Y-flip fix corrected quadrant placement (Master SW, Kitchen SE, Pooja NE, Bed-4 NW all land in the right quadrant visually). But **8 remaining failures all trace to ONE class of bug: the parser captures some but not all relational intent, and the solver has NO hard propagator for ANY adjacency relationship other than `attached_ensuite`.**

- Parser misses 2 whole classes of relationships: "between X and Y" (common bath), "connecting all X" (hallway).
- Parser captures `leads_to` / `behind`, but solver treats them as **SOFT-ONLY** (+25 cell-adjacency hint in Stage 3A value ordering). No Stage 3B propagator enforces directional semantics like "west of" or "behind".
- Main entrance door placement requires the entrance room to have an external wall on the plot.facing side — but nothing FORCES the entrance room to BE near the plot.facing edge. Foyer got auto-assigned to NW cell (soft Vastu preference) with zero external walls.
- Scorer has no relational checks, so it reads 96 on an output that visually breaks 8 user constraints.

---

## Task 1 — Parser Output Audit

### Plot + global
```
plot.facing   : "E"          ✓
plot.width_ft : 45           ✓
plot.depth_ft : 55           ✓
vastu_required: true         ✓
```

### Rooms (15 total)
| id | fn | position_type | dir | attached_to | windows | dim_explicit |
|---|---|---|---|---|---|---|
| foyer | foyer | **unspecified** | **null** | null | — | 10×8 ✓ |
| living | living | zone | NE | null | N large, E large | 18×14 ✓ |
| dining | dining | **unspecified** | **null** | null | — | 12×10 ✓ |
| kitchen | kitchen | corner | SE | null | E | 12×10 ✓ |
| utility | utility | **unspecified** | **null** | null | — | 6×5 ✓ |
| bed-master | master_bedroom | corner | SW | null | — | 15×13 ✓ |
| bath-master | master_bathroom | unspecified | null | **bed-master** ✓ | — | 8×6 ✓ |
| wardrobe-master | walk_in_wardrobe | unspecified | null | **bed-master** ✓ | — | 6×5 ✓ |
| bed-2 | bedroom | zone | S | null | — | 12×11 ✓ |
| bath-2 | bathroom | unspecified | null | **bed-2** ✓ | — | 7×5 ✓ |
| bed-3 | bedroom | zone | W | null | W | 12×10 ✓ |
| bed-4 | bedroom | zone | NW | null | N | 11×10 ✓ |
| bath-common | bathroom | **unspecified** | **null** | null | — | 6×5 ✓ |
| pooja | pooja | corner | NE | null | — | 5×4 ✓ |
| hallway | corridor | **unspecified** | **null** | null | — | — |

### Adjacency pairs extracted
```
living      <-> dining          [leads_to]         user_explicit=true   ✓
kitchen     <-> utility         [behind]           user_explicit=true   ✓
bed-master  <-> bath-master     [attached_ensuite] user_explicit=true   ✓
bed-master  <-> wardrobe-master [attached_ensuite] user_explicit=true   ✓
bed-2       <-> bath-2          [attached_ensuite] user_explicit=true   ✓
```

### Adjacency pairs MISSING (parser failures)
| Prompt fragment | Expected relationship | Extracted? |
|---|---|---|
| "common bathroom sits between bedrooms 3 and 4" | bath-common ↔ bed-3, bath-common ↔ bed-4 (or a new "between" relationship) | **✗ NOT EXTRACTED** |
| "hallway runs east-west connecting all bedrooms" | hallway ↔ each of bed-master, bed-2, bed-3, bed-4 | **✗ NOT EXTRACTED** |
| "main entrance is a 4ft wide door on the east wall opening into a 10ft x 8ft foyer" | Implicit "foyer near east wall" | **✗ NOT EXTRACTED as position (but door marked `is_main_entrance: true`)** |

### Main entrance door — parser DID extract
```
foyer.doors[0]: { width_ft: 4, leads_to_room_id: null, is_main_entrance: true }
```
**Parser correctness: PASS on main entrance door flag. FAIL on inferring foyer should be on east side.**

### Windows — extracted correctly
Living Room: N large + E large ✓ ("large windows on the north and east walls")
Kitchen: E ✓ ("window on the east wall")
Bedroom 3: W ✓
Bedroom 4: N ✓

---

## Task 2 — Solver Constraint Audit

I inspected `src/features/floor-plan/lib/csp-solver/*.ts` for every adjacency relationship handler.

| Relationship | Enforcement in CSP | Where enforced |
|---|---|---|
| `attached_ensuite` | **HARD** | `cell-csp.ts::pruneAttachedEnsuite` — requires ≥3ft shared edge between parent and child. Keyed off `room.attached_to_room_id`, NOT off adjacency_pairs. |
| `leads_to` | **SOFT only** | `ordering.ts::valueScore` S1 term: +25 if cells are mandala-adjacent. No Stage 3B geometric enforcement. |
| `flowing_into` | **SOFT only** | Same as above. |
| `behind` | **SOFT only** | Same. **No directional semantics**: "A behind B" does NOT pin A on any specific side of B. |
| `door_connects` | **SOFT only** for placement. **Opening-placer** will place a door IF a shared edge already happens to exist, but never MOVES rooms to create the shared edge. |
| `shared_wall` | **SOFT only**, same as door_connects. |
| "between X and Y" | **N/A — parser never emits this.** No ternary relationship type in the schema. |
| "hallway connects all bedrooms" | **N/A — parser never emits this.** |

### The critical gap

`cell-csp.ts` iterates `constraints.adjacency_pairs` ZERO times. Only `room.attached_to_room_id` (the parent link) is consulted. This means: every adjacency_pair in the parser output is invisible to Stage 3B fine placement.

```ts
// In pruneAttachedEnsuite (cell-csp.ts):
for (const v of unassignedVars) {
  if (v.parentId !== parent.id) continue;  // <-- only attached_to_room_id
  ...
}
```

Mandala Stage 3A does use adjacency_pairs via S1 soft scoring:
```ts
// In ordering.ts valueScore:
for (const adj of constraints.adjacency_pairs) {
  ...
  if (cellsAreAdjacent(cell, otherCell)) score += 25;  // soft
}
```

But "cells adjacent" is coarse (3×3 grid adjacency) and doesn't encode direction. `leads_to` and `behind` are reduced to "same or neighbor cell", losing directional meaning.

---

## Task 3 — Main Entrance Audit

### Parser output
```
foyer.doors[0].is_main_entrance = true   ✓ correctly extracted
plot.facing = "E"                         ✓ correctly extracted
```

### Opening-placer flow (`opening-placer.ts::placeMainEntrance`)

1. `findEntranceRoom` — finds a room with `is_main_entrance` door → picks **foyer**. ✓
2. Find wall of foyer on `plot.facing=E` side:
   ```
   for (const w of wallRefs) {
     if (w.side !== "E") continue;
     const edge = rectEdgeOnWall(foyer, w);  // does foyer touch a plot-E wall?
     if (!edge) continue;
     ...
   }
   ```
3. **Foyer is at (7, 11) 10×8 in solver coords. Plot is 45×55. Foyer's x range = [7, 17]. Plot east wall is at x=45. Foyer does NOT touch plot-E wall.** → no match.
4. Fall back to "longest external wall of entrance room":
   ```
   for (const w of wallRefs) {
     if (!w.side) continue;  // only plot-perimeter walls have a side
     const edge = rectEdgeOnWall(foyer, w);
     if (!edge) continue;
     ...
   }
   ```
   **Foyer touches NO plot-perimeter wall at all** (it's floating in the interior of NW cell).
5. Fall-through branch: `warnings.push("Foyer has no external wall at all; skipped")` → **NO MAIN DOOR placed.**

### Warning confirmed in diagnostic output
```
Opening warnings:
  - "Main entrance: "Foyer" has no external wall at all; skipped"
  - "Window on "Living Room"/N: wall is internal (shared with adjacent room), window dropped"
  - "Window on "Bedroom 4"/N: wall is internal (shared with adjacent room), window dropped"
```

### Root cause of missing main entrance

**Foyer ends up interior because:**
- Parser didn't extract a position for foyer (only `is_main_entrance` on its door).
- Mandala Stage 3A `SOFT_PREFERRED_CELLS["foyer"] = [N, E, NE, NW, SE]`. Scoring picks **NW** (first-available given other constraints, area-tiebreak).
- Stage 3B places foyer at `(7, 11)` — roughly in NW cell center, nowhere near the east plot edge.

**Nothing in the solver says "foyer must be on the plot.facing side of the plot for main-entrance door to land":** the main-entrance logic is read at OPENING-placer (Stage 3D) time, by which point foyer's location is already fixed. Too late.

### Why 2 windows were also dropped
- Living Room requested window on N, but its N edge is at y=4 in solver coords (internal, touching Dining Room's south edge).
- Bedroom 4 requested window on N — its N edge at y=18 is also interior.
Both = internal walls, per opening-placer's H11 rule "window must be on external wall".

---

## Task 4 — Hallway Audit

### Parser
Hallway extracted as `function: corridor`, `position_type: unspecified`, `position_direction: null`. **No adjacency_pairs involving hallway were extracted.**

The prompt "A 4ft wide hallway runs east-west connecting all bedrooms" encodes:
1. Hallway is a corridor (extracted ✓)
2. Hallway has a specific orientation (east-west) — **not captured** (no field for "long-axis direction")
3. Hallway shares walls with each bedroom — **not captured as adjacency_pairs**
4. Hallway should be ≥ 4ft wide — not captured (dim extraction would want 4ft width, but parser left dims null because the prompt says "4ft wide hallway" not "4ft × Nft")

### Solver
Because no adjacency_pairs exist for hallway:
- Stage 3A value-ordering S1 bonus = 0 for hallway.
- Hallway's mandala cell = N (soft-preferred for corridor).
- Stage 3B places hallway at `(17, 18)` w=12, d=4 — a standalone rectangle in the center-north area.
- Zero bedrooms share an edge with this rectangle.

### Why hallway is isolated
Even if parser HAD emitted `hallway ↔ bed-3 [door_connects]` etc., the solver's S1 would push them toward the same/adjacent mandala cells but wouldn't enforce shared edges.

The only relationship that enforces a shared edge is `attached_ensuite` (H9), keyed off `attached_to_room_id`. Hallway-bedroom is NOT an ensuite relationship — would need a new propagator.

---

## Task 5 — Root Cause Summary

### Category A: Relationships parser captures but solver IGNORES
| Relationship | Captured | Enforced hard | Visual failure |
|---|---|---|---|
| `leads_to` (living ↔ dining) | ✓ | ✗ soft only | Partially works (dining shares short 6ft wall with living, but relationship is more NW-of than W-of) |
| `behind` (kitchen ↔ utility) | ✓ | ✗ soft only | Utility north of kitchen, not "behind" (for E-facing, behind=W). |
| `attached_ensuite` (3 pairs) | ✓ | ✓ HARD | Works — master↔bath-master, master↔wardrobe, bed-2↔bath-2 all share walls. |

### Category B: Relationships parser MISSES ENTIRELY
| Prompt fragment | Not captured because |
|---|---|
| "common bathroom between bedrooms 3 and 4" | No `"between"` relationship type in the schema enum. Parser has no way to encode a ternary "A between B and C". |
| "hallway connecting all bedrooms" | No `"connects_to_all"` or multi-way relationship. Parser could emit N pairs but did not. SYSTEM_PROMPT doesn't instruct on this. |
| "east-west hallway orientation" | No field for long-axis direction. |

### Category C: Implicit constraints the parser infers weakly
| Implicit intent | Status |
|---|---|
| "Foyer must be on plot.facing side" (because main entrance enters into it) | Parser sets `is_main_entrance: true` on foyer's door. Doesn't translate that into a position constraint on foyer. Solver doesn't read this as positional. |
| "Utility must be on the side of kitchen AWAY from plot entrance" | `behind` is extracted but has no directional semantics in the solver. |

### Category D: Visual failures caused by A + B + C combination

| # | Visual | Root cause |
|---|---|---|
| 1 | Foyer at NW, not east | Parser didn't assign position to foyer. Mandala soft-preferred NW. No constraint linking foyer to plot.facing. |
| 2 | Main entrance door missing | Foyer has no external wall → opening-placer skips. |
| 3 | Dining NW of Living, not W | Parser captured `leads_to` but solver treats as cell-adjacency soft. Both landed in N-band of 3×3 grid. |
| 4 | Utility N of Kitchen, not behind (W) | Parser captured `behind` but solver has no directional semantics for it. |
| 5 | Common bath not between bed-3 and bed-4 | Parser didn't capture "between" at all. |
| 6 | Hallway not connecting bedrooms | Parser didn't capture multi-room "connecting" at all. |
| 7 | Living Room in middle-right not strictly NE | Living is in NE mandala cell but NE cell bbox extends further north than the visual would suggest (the "NE" of project bbox vs "NE" of plot differs when rooms don't fill plot fully). |
| 8 | Bed 2 attached bathroom — shared edge? | `attached_ensuite` IS enforced. Need to verify from data — bed-2 at (0,0,12,11) and bath-2 at (0,11,7,5). They share 7ft horizontal edge at y=11. ✓ |

### Propagators missing from the CSP
For full relational intent enforcement, the CSP needs these NEW hard/directional propagators:

1. **`H_DIRECTIONAL_ADJACENCY`** — for `leads_to` / `flowing_into` / `behind` with a cardinal direction, force room A to be on the correct side of room B + share an edge ≥ door-width. Example: `kitchen ↔ utility [behind]` with plot.facing=E → utility must be west of kitchen AND share ≥3ft edge.

2. **`H_BETWEEN`** — new relationship type: "A between B and C" forces A's centroid to be on the line segment between B and C centroids (or at least in the convex hull).

3. **`H_HALLWAY_CONNECTS`** — a hallway declared "connecting rooms X, Y, Z" must share an edge with each of X, Y, Z (≥ door-width).

4. **`H_MAIN_ENTRANCE_ROOM_POSITION`** — if any room has a door with `is_main_entrance: true` AND `plot.facing` is set, that room must touch the plot wall on the facing side.

5. **`H_DOOR_CONNECTS_SHARED_EDGE`** — `door_connects` relationships must share an edge ≥ door-width.

All 5 would be Stage-3B-level (fine placement) propagators, run alongside `pruneNoOverlap` and `pruneAttachedEnsuite`.

---

## Task 6 — Scorer Honesty Check

### Current scorer coverage (tests/floor-plan/scoring/*.ts)

| Metric | File | Scores what? |
|---|---|---|
| completeness | `completeness.ts` | Room names present |
| vastu (independent) | `vastu-independent.ts` | Room centroids in correct mandala quadrant per 6 hard rules |
| dims | `dims.ts` | Room dims within ±5% of user-specified |
| positions | `positions.ts` | Room centroid in correct quadrant per expectation |
| hallucinations | `hallucinations.ts` | Rooms in output that aren't expected |
| gaps | `gaps.ts` | Wall count + dangling endpoints + door-to-room ratio |

### What the scorer DOES NOT check
| Architectural concern | Checked? |
|---|---|
| "A west of B" | ✗ |
| "A behind B" (relative to plot.facing) | ✗ |
| "A between B and C" | ✗ |
| "Hallway shares edge with rooms X, Y, Z" | ✗ |
| "Attached ensuite shares ≥3ft edge with parent" | ✗ (only reason it holds is H9 in solver, but scorer doesn't verify) |
| "Main entrance door exists AND is on plot.facing wall" | ✗ |
| "Windows placed on requested walls AND those walls are external" | ✗ |
| "Shared edges are door-width" | ✗ |
| "No room is interior-isolated (reachable from entrance via doors)" | ✗ |

### Why the scorer agreed with the solver at 96 on this failing output

- Completeness: all 15 named rooms present (parser captured them, solver placed them) ✓
- Vastu quadrants: the 6 hard rules (master SW, kitchen SE, pooja NE, staircase not in center, brahmasthan open, entrance room in N/E/NE) — master in SW ✓, kitchen in SE ✓, pooja in NE ✓, no staircase, brahmasthan open, foyer in NW (N/E/NE includes NW? Let me check — **NE band: the scorer's rule for V-EN-001 is entrance-FUNCTION room (foyer/porch/living) centroid in N, E, NE, NW, SE → NW counts. 25/25**).
- Positions: 6 of 6 specified positions match quadrants (user only specified N/S/E/W-type positions, none of the relational ones). ✓
- Hallucinations: 0 ✓
- Gaps: 4/5 (walls exist, junctions clean) ✓
- Dims: 19/20 (minor deviation)

**Score = 96. Render = wrong in 8 ways. Scorer is blind to relational correctness.**

### Proposed new scoring dimensions (for Phase 7+ scorer)

| New metric | What it scores | Max points |
|---|---|---|
| `relational_adjacency` | For each parsed adjacency_pair, does the output satisfy it? (shared edge for attached_ensuite; correct direction for leads_to/behind/flowing_into) | 15 |
| `main_entrance_placement` | Main entrance door exists AND is on plot.facing side AND opens into an exterior-wall-touching room | 10 |
| `hallway_connectivity` | If parser emits hallway, does hallway share edge with each room declared as "connected"? | 10 |
| `window_wall_match` | For each expected window direction, is there a window on that external wall? | 5 |

With these added and the current metrics at 100-point max, this P01 4BHK run would currently score ~55-60 (not 96), accurately reflecting what's rendered.

---

## Priority ordering for a potential Phase 7 fix track

If/when the user authorizes a fix track, the order of impact:

1. **Add main-entrance position constraint** (Category C → HARD propagator). 1-2h. Fixes failures 1 + 2.
2. **Add directional semantics to `leads_to`/`behind`/`flowing_into`** (new propagator + parser schema extension for `direction: CompassDirection | null`). 2-3h. Fixes failures 3, 4.
3. **Parser schema: add `connects_all` relationship for hallway-style rooms**. 1-2h. Fixes failure 6.
4. **Parser schema: add `between` relationship (ternary)**. 1-2h. Fixes failure 5.
5. **Scorer: add relational + main-entrance + hallway metrics**. 1h. Stops the scorer from lying.

None of these require rewriting Phase 2-6 work. Each is additive.

### Philosophy alignment
User's philosophy: "User intent is sacred". Relational intent (west of, behind, between, connecting) IS user intent, equally as important as quadrant placement. Current implementation respects quadrant intent but silently drops relational intent. This is a partial philosophy violation — explicit user relational instructions are being ignored.
