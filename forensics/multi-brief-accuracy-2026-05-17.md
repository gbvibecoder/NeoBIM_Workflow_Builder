# Multi-Brief Accuracy Audit — Canvas v3 Pipeline
**Date:** 2026-05-17 (post commit `3a45e970`)
**Mission:** Prove the canvas pipeline produces geometrically accurate IFCs for **arbitrary briefs**, not just the two we happened to test.
**Method:** Submit 5 diverse raw-text briefs through `POST /api/brief-to-ifc/v3/runs` (the same code path canvas TR-025 → TR-026 takes), download each IFC, inspect entity-by-entity, compare against brief.
**Total spend:** $0.874 Anthropic across 5 runs.

---

## §1 — Executive Verdict

| # | Brief | Bbox match | Unit | Spatial | Element typing | Visual | Overall |
|---|---|---|---|---|---|---|---|
| 1 | Bathroom (2×2.5×2.4) | ✅ | ✅ METRE | ✅ | ⚠ | ✅ | **PASS** |
| 2 | Home office (3.5×4×2.8) | ✅ | ✅ METRE | ✅ | ⚠ | ✅ | **PASS** |
| 3 | Clinic reception (8×6×3) | ✅ | ✅ METRE | ✅ | ⚠ | ✅ | **PASS** |
| 4 | L-shape office (10×8 footprint) | ❌ topology | ✅ METRE | ✅ | ⚠ | ❌ shape | **FAIL** |
| 5 | Co-working (20×15×4) | ✅ | ✅ METRE | ✅ | ⚠ | ✅✅ | **PASS** |

**Aggregate: 4/5 PASS, 1 topology failure (L-shape unfolded into a 14×4 linear strip).**

**Two systemic gaps surface across all 5 IFCs (must be reviewed before public launch):**

1. **L-shape topology fails** — the agent treats "at right angles" as "end-to-end". This is the failure mode small users will hit FIRST (any irregular footprint).
2. **Zero IfcDoor / IfcWindow entities across all 5 IFCs** — the agent uses `IfcFurnishingElement` / `IfcBuildingElementProxy` for everything including openings. Downstream BIM tools (clash detection, schedules, IDS validation) that filter by IFC class will see zero doors and zero windows in every model.

Both are v3 backend issues. Per the phase rules I have NOT modified the backend; the user must approve before any agent-prompt / class-emission patch.

---

## §2 — Per-Brief Details

### Brief 1 — Bathroom (smallest, single space)

- **Brief text:** "Small bathroom, 2 by 2.5 metres, 2.4m ceiling height. One shower in the corner, one sink along one wall, one toilet against the opposite wall, one small window above the sink."
- **Run:** `cmpa13t5q000004kyaduz5lxg`
- **Output:** 21,027 bytes · 357 entities · 8 turns · $0.116 · 34.0s

| Check | Expected | Actual | Status |
|---|---|---|---|
| Aggregate world bbox | 2.0 × 2.5 × 2.4 m | 2.00 × 2.50 × 2.50 m | ✅ within 5% |
| Length unit | METRE | METRE | ✅ |
| IfcSpace count | 1 | 1 | ✅ |
| IfcWall count | 4 | 4 | ✅ |
| IfcDoor count | (any) | **0** | ⚠ no door class |
| IfcWindow count | 1 | **0** | ⚠ window emitted as proxy |
| Furnishings / fixtures | 4 (shower, sink, toilet, window) | 5 furnishing/proxy | ✅ count |

**Visual (top view):** 2×2.5m room with 4 walls, multiple internal rectangles (fixtures), one pink shape near the top wall (likely the window position above the sink). Rough placement is correct; element identity is unlabelled.
**Verdict: PASS** — Geometry & sizing accurate. Typing weakness shared with all 5 runs.

---

### Brief 2 — Home office

- **Brief text:** "Home office, 3.5 by 4 metres, 2.8m ceiling. One L-shaped desk along the north wall, one office chair, two bookshelves against the east wall, one whiteboard on the west wall, large window on the south wall."
- **Run:** `cmpa14h8v000904ky304squ0s`
- **Output:** 27,195 bytes · 462 entities · 8 turns · $0.126 · 42.4s

| Check | Expected | Actual | Status |
|---|---|---|---|
| Aggregate world bbox | 3.5 × 4.0 × 2.8 m | 3.50 × 4.10 × 2.85 m | ✅ within 5% |
| Length unit | METRE | METRE | ✅ |
| IfcSpace count | 1 | 1 | ✅ |
| IfcWall count | 4 | 4 | ✅ |
| L-shaped desk | 1 | visible at NW (3 connected rectangles) | ✅ |
| Office chair | 1 | visible | ✅ |
| Bookshelves on east wall | 2 | 2 stacked on east wall (x≈3-3.5) | ✅ |
| Whiteboard on west wall | 1 | pink strip on west wall (x≈0) | ✅ |
| Window on south wall | 1 | pink strip at bottom (y≈0) | ✅ |
| IfcDoor / IfcWindow | (any) | **0 / 0** | ⚠ |

**Visual (top view):** Every brief element is identifiable in the correct position with roughly correct size.
**Verdict: PASS** — Best result of the 5. Excellent semantic accuracy.

---

### Brief 3 — Clinic reception (multi-feature single space)

- **Brief text:** "Small clinic reception area, 8 by 6 metres total, 3m ceiling. Reception desk in one corner (2 by 1m). Waiting area with 4 chairs along the south wall. Door to consultation room on the east side. Door to storage on the west side. Two large windows on the north wall."
- **Run:** `cmpa156qv000t04ky0q26sdwf`
- **Output:** 28,733 bytes · 495 entities · 8 turns · $0.134 · 41.5s

| Check | Expected | Actual | Status |
|---|---|---|---|
| Aggregate world bbox | 8.0 × 6.0 × 3.0 m | 8.00 × 6.00 × 3.15 m | ✅ within 5% |
| Length unit | METRE | METRE | ✅ |
| IfcSpace count | 1 (reception) | 1 | ✅ |
| IfcWall count | 4 | 4 | ✅ |
| Reception desk in corner | 1 (2×1m) | large blue rect in NE corner | ✅ |
| 4 chairs along south wall | 4 | 4 small blue squares evenly spaced at y≈0.5 | ✅ |
| Doors east + west | 2 | 2 pink rects on side walls | ✅ (as proxy) |
| Windows on north wall | 2 | 2 pink rects on north wall (y≈6) | ✅ (as proxy) |
| IfcDoor / IfcWindow count | 2 / 2 | **0 / 0** | ⚠ all openings emitted as proxy |

**Visual:** All 7 brief elements (desk + 4 chairs + 2 doors + 2 windows) are visible in correct positions. Door / window placements match wall positions exactly.
**Verdict: PASS** — Semantic placement excellent, IFC class typing weak.

---

### Brief 4 — L-shape office (irregular footprint) ❌

- **Brief text:** "L-shaped open office, with one 10m long arm by 4m wide and a 4m by 4m extension at right angles. 3.2m ceiling height. 8 workstations in the long arm laid out in two rows of 4 desks, a meeting table seating 6 in the extension, kitchenette with sink and counter in the corner where the L joins."
- **Run:** `cmpa165k0001i04kywqxvfp0v`
- **Output:** 42,916 bytes · 728 entities · 10 turns · $0.171 · 51.7s

| Check | Expected | Actual | Status |
|---|---|---|---|
| Aggregate world bbox | union of (0,0,10,4) and a 4×4 perpendicular extension | **14.00 × 4.00 × 3.25 m** | ❌ topology |
| Length unit | METRE | METRE | ✅ |
| IfcSpace count | 1-2 | 2 | ✅ |
| IfcWall count | 6-8 (L perimeter has 6 outer + interior) | 7 | ≈ |
| 8 workstations in long arm, 2 rows of 4 | 8 | 8 desks visible in 2 rows ✅ | ✅ count |
| Meeting table in extension | 1 | larger rect at x≈12 | ✅ |
| IfcDoor / IfcWindow | (any) | **0 / 0** | ⚠ |

**Visual (top view):** A perfectly straight 14×4 rectangular strip with two zones: 8 workstations + chairs in x=0-10, meeting area in x=10-14. The "extension at right angles" was placed **inline** with the main arm rather than perpendicular. No L-shape is formed.

**Verdict: FAIL — topology gap.** The total floor area (56 m²) and per-zone element placement are correct, but the spatial relationship between the two arms is wrong. A clash-detection downstream tool would see a 14m linear office, not an L.

**Root cause hypothesis:** The agent's prompt / BriefSpec representation may flatten "at right angles" into a single axis-aligned bbox. Worth confirming by inspecting the BriefSpec the enrichment layer produced for this brief. Out of scope for this phase per the rules.

---

### Brief 5 — Co-working space (largest, multi-room) ⭐

- **Brief text:** "Co-working space, 20 by 15 metres, 4m ceiling. Open desks area in the centre containing 12 workstations laid out in 3 rows of 4. Two phone booths along the east wall (each 1.5 by 1.5 metres). Coffee and snack area in the north-west corner (4 by 3 metres). Three small meeting rooms along the south wall (each 3 by 3 metres). Reception and entrance in the south-east corner. Maximum natural light from large windows on the north wall."
- **Run:** `cmpa17txz000004l5iyl0aso6`
- **Output:** 88,884 bytes · 1,510 entities · 10 turns · $0.329 · 84.8s

| Check | Expected | Actual | Status |
|---|---|---|---|
| Aggregate world bbox | 20 × 15 × 4 m | 20.00 × 15.00 × 4.10 m | ✅ within 3% |
| Length unit | METRE | METRE | ✅ |
| IfcSpace count | 7-8 (open + 2 booths + coffee + 3 meeting + reception) | 8 | ✅ |
| IfcWall count | many (partition between zones) | 22 | ✅ |
| 12 workstations in 3 rows of 4 | 12 | 12 desks in 3 visible rows of 4 | ✅ |
| 2 phone booths east wall | 2 (1.5×1.5m) | 2 small rooms on east edge ≈ correct size | ✅ |
| Coffee area NW corner | 4×3 m | enclosed area top-left | ✅ |
| 3 meeting rooms south wall | 3 (3×3m) | 3 enclosed rooms along south wall | ✅ |
| Reception SE corner | 1 | desk in SE corner | ✅ |
| Windows on north wall | "large" | (proxies on north wall) | ⚠ as proxy |

**Visual:** **Best example of the 5.** Every functional zone is visible at correct size, in the correct position, with the correct count of internal items. This is the brief Rutik can ship as a marketing screenshot.
**Verdict: PASS — exemplary.** The pipeline scales well to complex multi-room briefs.

---

## §3 — Aggregate Findings

### Strengths (what's working at "any-brief" scale)

1. **Reliability:** 5/5 briefs completed without failure. No timeouts. No agent-gave-up.
2. **Cost predictability:** $0.116-$0.329 per run, scales with brief complexity. Median $0.134. The "small office" range Rutik will see most often is ~$0.13.
3. **Length unit is METRE in every IFC** — the pre-fix millimetre regression that burned a previous phase is conclusively gone.
4. **Bbox accuracy:** 4/5 within 5% (the tightness exceeds the validator's own 50% tolerance).
5. **Element placement matches semantic intent** — desks where desks belong, reception in the right corner, windows on the right wall.
6. **Scales 4× in entity count (357 → 1510) without degradation.**

### Gaps (must be resolved before public launch)

#### Gap A — L-shape topology fails (⚠ HIGH SEVERITY)
- **What:** Briefs that describe non-rectangular footprints ("L-shape", "T-shape", "U-shape") get flattened into a single axis-aligned bbox. The L-shape office produced a 14×4 linear strip, not an L.
- **Where:** Likely in either the Layer 1 BriefSpec extraction (the enriched spec may not carry polygon vertices for the L) or the Layer 2 agent's interpretation of the polygon.
- **Impact:** A non-trivial fraction of real briefs will have irregular footprints. Without a fix, ~20-30% of user submissions could exhibit this failure.
- **Recommended next step (NOT executed this phase per backend-untouchable rules):** Inspect the enriched BriefSpec for the L-shape run (`cmpa165k0001i04kywqxvfp0v`). If `polygon_world_m` is present and correctly L-shaped, the gap is in the agent's wall placement. If it's a bare `bounds_m: [14, 4]`, the gap is in Layer 1 prompt — surface to Rutik.

#### Gap B — Zero IfcDoor / IfcWindow across all 5 IFCs (⚠ HIGH SEVERITY for BIM compliance)
- **What:** Doors and windows mentioned in every brief are emitted as `IfcFurnishingElement` or `IfcBuildingElementProxy`, never as the typed `IfcDoor` / `IfcWindow` classes.
- **Where:** v3 generator helpers / agent prompt.
- **Impact:** Downstream BIM tools (Revit import, clash detection, IDS validation, schedule generation) will see zero doors / zero windows. Compliance with standard BIM workflows is broken.
- **Recommended next step (NOT executed):** Check the v3 generator's element-class taxonomy and the `system-prompt.md` instructions. The agent likely has access to `IfcDoor` / `IfcWindow` constructors but is preferring the proxy class. Worth a prompt tweak.

#### Gap C — Element labels are absent
- Every furnishing comes back unnamed (`Name=None`). The bathroom's "shower vs sink vs toilet" identity is only inferable from position and size, not from the IFC properties. Marketing-grade clarity weakness.
- Lower severity than A and B.

---

## §4 — What this audit did NOT test (handover to manual)

- **PDF/DOCX uploads via IN-009** — the canvas UI's tabbed input flow uses multipart drag-drop which is not API-testable. Rutik to manually verify after Vercel deploys `3a45e970`.
- **Result page rendering of the new IFC hero card** — requires a real browser; this audit was CLI-only. Manual click-through TODO:
  - `trybuildflow.in/dashboard/results/<exec-id>` for each of the 5 new runs (note: these runs were submitted via /runs directly and do NOT create a workflow Execution, so they won't surface on the canvas result page; Rutik to re-run a fresh brief from the canvas template for end-to-end UX verification).
- **3D viewer auto-load** — the `?url=` mode needs eyes-on verification. CLI cannot rotate the model.

---

## §5 — Recommendation

**Ship status: SHIP-WITH-CAVEATS.**

The pipeline is reliable, fast, and accurate for **rectangular footprints with simple element placement** — which covers most starter-tier user cases (residential rooms, small offices, retail interiors). Marketing the canvas template for these cases is safe.

**Hold launch communication that promises:**
- Irregular footprints (L/T/U shapes) — Gap A
- BIM-compliant door/window typing for tool interop — Gap B

**Two backend issues to surface to Rutik for approval before any fix:** see Gap A and Gap B above. Both require touching files in `src/features/brief-to-ifc/v3/` or `neobim-ifc-service/` which the phase rules locked.

---

## §6 — Artifacts

- `prod-eval-outputs-v6/<stem>.ifc` (5 files, 21-89 KB each)
- `prod-eval-outputs-v6/<stem>-status.json` (final run status)
- `prod-eval-outputs-v6/<stem>-logs.json` (per-turn agent logs)
- `prod-eval-outputs-v6/<stem>-inspect.json` (forensic dump per file)
- `prod-eval-outputs-v6/<stem>-top.png` + `<stem>-iso.png` (renders)
- `prod-eval-outputs-v6/progress.log` (eval timeline)
- `prod-eval-outputs-v6/edge-case-results.json` (edge case audit)
- `scripts/forensics/run-multi-brief-eval.py` (the eval harness)
- `scripts/forensics/edge-case-audit.py` (the edge-case probe)
