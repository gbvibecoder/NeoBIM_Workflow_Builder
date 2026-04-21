# Phase 2.4 Pre-Test Independent Review

**Reviewer:** Claude (fresh session, no prior context on this codebase)
**Date:** 2026-04-22
**Scope:** Read-only review of `feat/phase-2-4-critical-fixes` (84df967), compared against `feat/phase-2-3-adjacency-and-ux` (cd57c44), `audit/geometry-senior-architect-review` (bc59eea), and `main` (e931992).
**Methodology:** Phase A — read code before touching the audit. Phase B — compare my findings to the audit. Phase C — five blunt judgments. Phase D — verdict. Appendix — bugs/risks nobody flagged.
**Bias disclosure:** I walked in cold. The audit report was hidden during Phase A.

---

## Phase A — Independent Findings (code first, audit later)

### A.1 Branch topology — this is the headline finding

```
e931992 (main) ──── feat/phase-2-3-adjacency-and-ux  (cd57c44)  ← 6 commits
              └───── feat/phase-2-4-critical-fixes   (84df967)  ← 3 commits
              └───── audit/geometry-senior-architect-review (bc59eea) ← 1 commit
```

All three feature branches fork directly from `main`. **Phase 2.4 does NOT sit on top of Phase 2.3.** They are parallel branches over the same base. `git merge-base main feat/phase-2-4 == main feat/phase-2-3 == main audit/... == e931992`.

Implication: if Rutik ships Phase 2.4 to main first, he *does not* get any of Phase 2.3's work — adjacency declarations, Option X enforcement, review modal, image approval gate, orchestrator-gated — unless he also merges Phase 2.3. The order matters for conflict resolution and for what the Phase 2.4 code can actually *do* once deployed.

### A.2 VIP pipeline architecture (Stage-by-stage read)

Read order: `orchestrator.ts` → `prompts/architect-brief.ts` → `schemas.ts` → `stage-1` through `stage-7` → strip-pack (`wall-builder`, `door-placer`, `window-placer`, `converter`, `strip-pack-engine`, `spine-placer`, `entrance-handler`, `room-classifier`, `types`) → `quality-evaluators.ts` → `constants/setbacks.ts`.

**Orchestrator (orchestrator.ts:134–449).** Clean 7-stage dispatch with fall-through on any throw. Stage 3 verdict is *advisory only* — comment at orchestrator.ts:233–239 confirms it does not branch behavior; Stage 4+5 always run regardless of the jury's `recommendation`. Retry loop is Stage-6-driven (max 1 retry, keeps better score, weak-areas appended to image prompt). Stage 6 API failure delivers the candidate with `qualityScore=0` (orchestrator.ts:357–361) — ambiguous: 0 means "gate crashed" but a reader can't tell from the value.

**Stage 1 (stage-1-prompt.ts + prompts/architect-brief.ts).** Claude Sonnet 4.6 tool-use. 188-line system prompt with BHK convention, standard room sizes, vastu rules (~11 of 16 MahaVastu zones), default plot dims. Tool schema is minimal — only requires `projectType`, `roomList`, `plotWidthFt`, `plotDepthFt`, `facing`, `styleCues`, `constraints`. `municipality` is optional (schemas.ts:28). **No adjacencies on this branch** (Phase 2.3 adds them; Phase 2.4 doesn't).

**Stage 2 (stage-2-images.ts).** Single-provider wrapper around `gpt-image-1.5`. Imagen 4 removed in Phase 2.0a. Only checks base64 presence — no content/dimension validation.

**Stage 3 (stage-3-jury.ts).** Claude Sonnet 4.6 Vision, 8 weighted dimensions (extraction-centric — roomCountMatch, labelLegibility, noDuplicateLabels, extractability weighted 2.0). PASS ≥70 / RETRY ≥50. Result logged but does not gate Stage 4. **Decorative, as documented.**

**Stage 4 (stage-4-extract.ts).** GPT-4o with strict tool-use; returns pixel-space `plotBoundsPx` + `rooms[]` with 0–1 confidence. `validateAndClamp` clamps coords and does fuzzy name matching via `wordOverlapScore` (threshold 0.5). Duplicates flagged with reduced confidence but both kept. **Confidence field clamped to [0,1] then never read again** (stage-5-synthesis.ts:114 uses it only to copy into `TransformedRoom.confidence`, which also goes unused downstream).

**Stage 5 (stage-5-synthesis.ts) — the big one.** Read it fully. Three surprising facts:

1. **It bypasses the strip-pack engine entirely.** The `runStripPackEngine` in `strip-pack-engine.ts` (1076 lines — with classifyRooms, planSpine, placeEntrance, packStrip, attachSubRooms, fillVoids, overflow placement, snapFloatingRooms, topological adjacency coercion, flipInvertedAttachments, synthesizeMissingPorch) is **not called from Stage 5**. Stage 5 reuses only `buildWalls`, `placeDoors`, `placeWindows`, and the `converter.toFloorPlanProject`. The rest of the strip-pack intelligence is dead weight in the VIP path — it is only used by the fallback pipelines on other code paths.
2. **`buildSpine` is a stub.** stage-5-synthesis.ts:242–272 either picks a room typed `corridor/hallway/passage` or fabricates a 3.5 ft horizontal slab at y = 0.48·plotDepthFt. No strip allocation, no entrance carve-out, no front/back split matching the extracted geometry.
3. **Phase 2.4 P0-A setback integration is partial.** `computeEnvelope` returns a shifted origin and a shrunk usable rectangle; rooms get transformed into the envelope and shifted; walls use `buildingRect` as their `plot` input; but `floor.boundary` (built by the converter from `stripPackResult.plot`) still equals the *full* plotRect. The building envelope is inside the polygon — correct architecturally, but downstream checks that read `floor.boundary.points` see the plot, not the envelope (see A.6).

**Stage 6 (stage-6-quality.ts).** Claude Sonnet 4.6, 7 LLM-scored dimensions + 2 deterministic (`bedroomPrivacy`, `entranceDoor`) merged in. Weights: LLM 2.0/2.0/2.0/1.5/1.5/1.0/1.0, local 1.0/1.5. PASS ≥65, RETRY ≥45. `summarizeProject` passes room dims, doors-per-room, windows-per-room to the LLM. It does **not** pass the municipality, setback metadata, or adjacency report (because none exist on this branch).

**Quality evaluators (quality-evaluators.ts).** Two new deterministic scorers:

- `evaluateBedroomPrivacy` — 10 if all bedrooms have no door to a common area; 7 if one leaks; 1 if ≥2 leak. Uses `COMMON_AREA_TYPES = living_room | dining_room | kitchen | lobby | foyer`. Sensible.
- `evaluateEntranceDoor` — finds `type === "main_entrance"`, checks the wall's cardinal side vs declared `brief.facing`, tolerance 15% of min(plotW, plotD). Matching side=10, adjacent=5, opposite=1. Neutral(5) on any missing data.

**Constants/setbacks.ts.** Municipality table: DEFAULT 3/2/3, MUMBAI 9.8/4.9/9.8, BENGALURU_SMALL 5/2.5/5 (≤1200 sqft), BENGALURU_LARGE 10/5/10, DELHI_DDA 9.8/6.6/9.8, PUNE 6.5/3.3/6.5, HYDERABAD 5/3/5. Feature-flagged behind `PHASE_2_4_SETBACKS === "true"` (default OFF). Safe-fallback if usable area goes non-positive.

### A.3 Strip-pack subsystem (shared but not called by VIP Stage 5)

This is ~2500 lines of carefully-engineered geometric machinery — spine planning, adjacency-group coercion with capacity check, entrance carve with L-carve for porch+foyer, per-strip scaling, packStrip + overflow fallback, snapFloatingRooms, sub-room-attacher, void-filler, multi-pass door connectivity with tight-clearance backoff. It has been iterated through Phases 3A–3H to fix orphaned rooms, doorless rooms, bedroom-through-bedroom, foyer-to-hallway, inverted attachments, missing-porch synthesis. The code is production-quality and well-commented.

But Stage 5 of the VIP pipeline calls none of it except `buildWalls`, `placeDoors`, `placeWindows`, and the converter. This is either:
- (a) a deliberate decision — the image model "packs" the rooms, so the strip-packer isn't needed, OR
- (b) a missed opportunity — the strip-packer could validate or repair extraction output.

### A.4 GA.3 security fix (commit e415bc7)

**src/app/api/vip-jobs/worker/route.ts:29–42.** Old code skipped signature verification on `NODE_ENV === "development"`. New code requires explicit `SKIP_QSTASH_SIG_VERIFY === "true"` opt-in and hard-throws if that flag is set in production. Tests cover all four cells of the matrix (prod+skip→throws, dev+skip→bypass, prod+no-skip→verify, dev+no-skip→verify). Clean fix.

Commit body explicitly notes: "Phase 2.3 routes (worker/resume, worker/regenerate-image) on feat/phase-2-3-adjacency-and-ux have the same pattern and must receive the same fix at merge time." **This warning is load-bearing.** I grep-verified: `feat/phase-2-3-adjacency-and-ux:src/app/api/vip-jobs/worker/resume/route.ts:38-45` still uses `const isDev = process.env.NODE_ENV === "development"; if (!isDev) { verify() }`. Same for `worker/regenerate-image`. So merging Phase 2.3 post-Phase-2.4 *without* porting GA.3 silently reopens the vulnerability on two *additional* routes.

### A.5 Phase 2.3 features (read from that branch)

- **Adjacencies in brief (types.ts):** `AdjacencyRelationship = "attached" | "adjacent" | "direct-access" | "connected"`. `ArchitectBrief.adjacencies: AdjacencyDeclaration[]`. Stage 1 prompt instructs Claude to populate.
- **Option X (stage-5-synthesis.ts:275–413):** For each "attached" declaration where A and B don't already share a wall, try placing B flush on each of A's four sides (east/west/north/south); first side that fits in the plot and doesn't overlap *other* rooms wins; otherwise log "unfixable". Mutates `TransformedRoom.placed` before wall-building.
- **Review modal intelligence (validate-floor-plan/route.ts):** Ensuite-aware bathroom auto-add (3BHK+ → both master_bathroom and bathroom added), vastu-aware Pooja pre-select, deterministic regex override of LLM-parsed facing on explicit "N-facing" / "north-facing" phrases. Emits a `FACING_CORRECTED` issue type.
- **Image approval gate (orchestrator-gated.ts + worker/resume/route.ts + worker/regenerate-image/route.ts + ImageApprovalGate.tsx):** Splits the pipeline at Stage 2 so user approves/regenerates before the $0.15 Stage 4 extraction fires. DB schema adds `AWAITING_APPROVAL` status + `intermediateBrief` + `intermediateImage` JSON columns to VipJob.

### A.6 Bugs I spotted during Phase A (flagged early; revisited in Appendix)

- **B1 — `evaluateEntranceDoor` misidentifies cardinal walls when setbacks are applied** (quality-evaluators.ts:100–124 reading `floor.boundary` which is the *full plot*, not the envelope). Silent regression when `PHASE_2_4_SETBACKS=true`.
- **B2 — Stage 5 P0-A uniformly *compresses* every room** (stage-5-synthesis.ts:111–112 scales pixels to envelope dims). The Stage 1 brief and Stage 2 image are sized for the full plot; extracting into the envelope shrinks everything. Mumbai 9.8ft setback on a 30×40 plot kills ~45% of the usable area.
- **B3 — `bedroomPrivacy` evaluator uses `RoomType` equality** (quality-evaluators.ts:20–27) but the converter's `functionToRoomType` map (converter.ts:45–82) lowercases-but-doesn't-harmonize labels like `drawing_room` → `living_room`. Works for the converter's outputs; fragile if Stage 5 ever emits `drawing_room`.
- **B4 — `isOnSpineEdge` in door-placer.ts:322–329 has an unreachable `void end;` after return**. Dead code, not a bug, but a smell.
- **B5 — converter.ts:307 door `swing_direction: "right"` hardcoded.** Matches the audit's 5.6.
- **B6 — converter.ts:368 `operable: p.kind !== "ventilation"`** (via converter.ts around window write) — inverted logic per audit's P0-D. Verified by reading it.
- **B7 — Stage 5 hardcodes `adjacency_satisfaction_pct: 80` and `satisfied_adjacencies = 0.8 × required`** (stage-5-synthesis.ts:447–452). Synthetic metrics.

### A.7 Coverage snapshot

Phase 2.4's new tests (in `__tests__/`):
- `phase-2-4-setbacks.test.ts` (218 lines) — covers computeEnvelope + resolveSetback + fallback cases.
- `phase-2-4-quality-evaluators.test.ts` (247 lines) — covers bedroomPrivacy + entranceDoor.
- `vip-worker-sig-bypass.test.ts` (121 lines) — 4 env-matrix cases for GA.3.

Tests look reasonable in scope. No end-to-end test asserts that setbacks-enabled output is *architecturally* better (only that the envelope math works). No test hits the B1/B2 interaction (entranceDoor evaluator vs P0-A enabled).

---

## Phase B — Comparison to the Audit Report

I read `docs/phase-2-3-5-geometry-audit.md` only after writing Phase A.

### B.1 Does the audit accurately describe the current code state?

Mostly yes. Where I agree:

- Every single Stage 5 claim the audit makes — no setback enforcement on main, Option X covers only "attached", aspect-ratio deformation up to 80% in the strip-packer, door swing hardcoded, window `operable` inverted, Stage 3 advisory-only — I independently hit all of them.
- Audit's file:line pointers are accurate (spot-checked: stage-5-synthesis.ts:330 for setbacks, converter.ts:307 for swing, converter.ts:368 for operable, door-placer.ts:161 for bedroom-through-bedroom).
- 84 findings / 20 CRITICAL claim. The audit's own verification section V.1 concedes only 38 explicit severity tags are in prose — the rest live in tables. That's a fair disclosure; reader discretion.

Where the audit over-emphasizes or gets shaky:

- **The "$0.29 per retry" claim** (Perspective 2) implies Stage 2 always retries the full stack. In practice the Stage 6 retry path re-runs Stage 2 + Stage 4 + Stage 5 + Stage 6; Stage 3 is skipped on retry (orchestrator.ts:308–342). Math still lands around $0.20–0.29 but the stack is slightly different.
- **"The pipeline trusts GPT Image 1.5 as source of truth"** (Theme 3) is rhetorically strong but ignores that Stage 1's brief *is* the source of truth for every field except room placement. The image only decides *where*, not *what*.
- **The Executive Summary claim that Stage 4 "does not filter low-confidence extractions"** is a fair statement of what the code does, but the audit then proposes P0-E (drop confidence<0.3) without noting that GPT-4o's confidence calibration is poor (per OpenAI's own cookbook) — a naive threshold may drop correct rooms as often as hallucinated ones. The audit's V.3 risk table does add this caveat, but the headline doesn't.

### B.2 Are the 5 P0s correctly identified?

The audit's P0 block (in § "Prioritized Fix Recommendations"):

| P0 | Effort | Audit impact claim | My read |
|---|---|---|---|
| P0-A setback enforcement | 2–3 h | Every plan becomes bylaw-legal | Agree it's the most visible legal issue. Implementation detail: needs to *shift* rooms, not *shrink* rooms (see B2 below). The audit's V.9 gives the municipality table, which Phase 2.4 adopted correctly. |
| P0-B expand Stage 6 to 11 dims (add ensuiteAttachment + adjacencyCompliance + windowPresence + bedroomPrivacy) | 4–6 h | Retry loop stops optimizing the wrong variables | Agree on *direction*. The **4 dims named** are the right 4 if and only if `adjacency_report` exists — which it doesn't on main, only on Phase 2.3. Phase 2.4 therefore had to pick different dims (see B.3). |
| P0-C Stage 3 FAIL binding | 30 min | Saves $0.15 on bad images | Agree. Simple, high-ROI. **Not addressed in Phase 2.4.** |
| P0-D window `operable` flag | 10 min | Metadata correctness | Agree. Trivial. **Not addressed in Phase 2.4.** |
| P0-E confidence filter in Stage 4 | 30 min | Reduces hallucination class | Agree as a direction; the audit's V.3 risk note (drop-filter may kill requested rooms) is the right guardrail. **Not addressed in Phase 2.4.** |

**So of the audit's 5 P0s, Phase 2.4 addresses P0-A (fully) and P0-B (partially, with substituted dimensions).** P0-C, P0-D, P0-E — each effort 10–30 min — are untouched. This is a judgment call, not an obvious failure; P0-B's substitution is defensible given the Phase 2.3 branch split.

### B.3 Are Phase 2.4's fixes actually addressing the P0s they claim?

**P0-A (setback enforcement):** Partially yes.
- ✓ Municipality table implemented per audit V.9 recommendation (matches recommended values).
- ✓ Feature-flag gated — safer than audit suggested, which only proposed a config default.
- ✓ Walls are classified against `buildingRect`, so external-wall classification is correct.
- ✗ **Room-scaling bug** (see Appendix B2). The transform from pixels→feet uses `plotWidthFt/plotBoundsPx.w` where `plotWidthFt` has been *replaced* by `envelope.usableWidthFt`. That silently shrinks every extracted room proportional to the setback. The correct transform preserves scale and clips overflow. Today the envelope is narrower than the image, so the image's "40ft of rooms" get squashed into "34ft of envelope" — every room is 15% smaller than the brief asked for. With Mumbai on a 30×40 plot, the crush is >45%.
- ✗ **Floor boundary mismatch.** `floor.boundary` stays at the full plotRect (converter.ts:104, fed by `stripPackResult.plot = plotRect`). That's architecturally sensible (the floor *is* the plot), but downstream readers that compute cardinal-side tolerance against `floor.boundary` (e.g., the new `evaluateEntranceDoor`) now see a *larger* bounding rectangle than the building itself, which breaks the tolerance heuristic (see B1 Appendix).

**P0-B (bedroomPrivacy + entranceDoor):** Legitimate substitution, with caveats.
- The audit's named 4 dims (ensuiteAttachment, adjacencyCompliance, windowPresence_Habitable, bedroomPrivacy) all require Phase 2.3's adjacency data or full walk of `floor.windows`. Phase 2.4 couldn't pick ensuiteAttachment or adjacencyCompliance without the Phase 2.3 branch. That's a forced trade.
- ✓ `bedroomPrivacy` matches the audit's recommendation.
- △ `entranceDoor` is reasonable but overweighted at 1.5. The audit suggested `doorPlacementQuality` at 0.5. Adding a dim at weight 1.5 shifts the aggregate score more than the audit modeled.
- ✗ `entranceDoor` is silently fooled by P0-A setbacks (Appendix B1). When both are on, this dim returns neutral (5) for every plan on any urban plot.

**GA.3 (signature bypass):** Half-fixed.
- ✓ `worker/route.ts` patched cleanly with the explicit opt-in pattern the audit's V.7 recommended.
- ✗ The audit's V.7 named *three* routes: `worker/route.ts` (on main), `worker/resume/route.ts`, `worker/regenerate-image/route.ts`. Phase 2.4 only patched main's. The other two live on Phase 2.3 and still carry the vulnerable `isDev = NODE_ENV === "development"` pattern. The commit body calls this out but the fix does not travel with the branch. **If Phase 2.3 merges to main without a re-application of GA.3, the security hole returns via two new endpoints.**

### B.4 What the audit MISSED that I found in Phase A

- **Branch topology risk.** The audit treats Phase 2.3 and Phase 2.4 as sequential phases. They are parallel branches from the same base. A merge-order error would lose work or regress security.
- **Stage 5 bypasses the strip-pack engine entirely.** The audit's Section 4a describes strip-pack as if it were active in the VIP pipeline. It's not. The 1,076-line `strip-pack-engine.ts` is dead code in the VIP path — only its leaf modules (wall-builder, door-placer, window-placer, converter) are called by Stage 5. That reframes some of the audit's Stage 5 recommendations: they're changes to a subsystem the VIP flow doesn't use.
- **Stage 5's synthetic `buildSpine`** (stage-5-synthesis.ts:242–272) fabricates a hallway at 48% depth regardless of where the image actually put one. Audit didn't call this out. Impact: walls and doors assume a hallway geometry that may have no correspondence to the extracted image.
- **`adjacency_satisfaction_pct: 80`** is hardcoded in Stage 5 (stage-5-synthesis.ts:447). A downstream reader relying on this metric gets a fiction, not a measurement.
- **`entranceDoor` evaluator × setback envelope interaction** (Appendix B1). Both P0s landed in the same commit; they don't compose.
- **Retry loop's "weak hint" construction** uses the weak-area *name* of the previous attempt's Stage 6. After Phase 2.4 P0-B, those names include `bedroomPrivacy` and `entranceDoor` — strings the image model has no prior on. The hint gets less useful, not more.

### B.5 What the audit OVEREMPHASIZES or gets wrong

- The executive summary claim that **"the realistic quality ceiling is 75–80/100 on the same Gen 1 prompt"** after the 5 changes is optimistic. P2-A (replace GPT Image 1.5) is the *actual* quality-ceiling move per the same audit's own Theme 3. Everything short of that is a scoring-side improvement, not an output-quality improvement.
- The retry cost analysis is shaky (see B.1).
- **"Option X has closed the most visible gap (ensuite attachment)"** in the exec summary overstates it. Option X is linear-first-fit, order-sensitive, and only handles `attached`. It fixes the ensuite case when there's one ensuite; breaks down when there are multiple attached pairs that interact (master bath + guest bath + walk-in closet, all flagged attached). The audit's V.3 acknowledges this; the exec summary doesn't.

---

## Phase C — Five Key Judgments

### Q1 — Is the pipeline architecturally sound?

**Mixed.** The 7-stage decomposition is reasonable on paper. Clear boundaries; Zod at stage outputs; graceful fall-through on exceptions; observability via VIPLogger; cost tracking per stage. That's good.

What's unsound:
1. **The core bet — "use a diffusion image model to compute a floor plan layout, then extract the layout back to coordinates" — is structurally incorrect for this problem.** Diffusion models cannot satisfy spatial arithmetic (rooms inside plot) or topology (adjacency) deterministically. You are paying $0.034 + $0.10 + $0.15 per run ($0.29 total) for a lossy round-trip where the deterministic alternative (render Stage 1's room coordinates to SVG locally) would be free, reproducible, and 100× faster. The audit's Theme 3 is right on this.
2. **Stage 5 is architecturally inert.** It's a pixel-to-feet transform wrapped around three leaf utilities. Every piece of strip-pack intelligence (adjacency-group coercion, overflow placement, snap-floating-rooms, entrance carve-out, scaled room-to-strip) sits one directory over and isn't called. Either delete the unused paths or wire them in — the current state is confusing.
3. **Stage 3 has no job.** Orchestrator.ts:233 literally says "Stage 3 verdict is advisory — does NOT branch behavior here." That's $0.10 of pure telemetry per run.
4. **Stage 5 `buildSpine` fabricates geometry.** stage-5-synthesis.ts:254–255 plants a 3.5 ft slab at y=0.48·depth when there's no hallway room. Walls built against this slab may not correspond to anything in the image. Doors/windows place off of this fiction.

Data flow is otherwise sensible. Nothing is catastrophically broken structurally; but the core model-choice assumption doesn't hold under the audit's (and my) scrutiny.

### Q2 — Where is the actual quality bottleneck?

In order, most to least:

1. **Stage 2 — GPT Image 1.5.** Diffusion models hallucinate labels ("KITCHAN"), ignore proportions, invert walls, randomize compass. This is the single largest source of quality loss. Stage 4 can only extract what Stage 2 drew; Stage 5 can only synthesize from what Stage 4 extracted. Evidence: architect-brief.ts:123–150 (prompt has no wall-thickness/door-arc/window-double-line/compass-rose/scale-marker notation), Imagen was already removed in Phase 2.0a for "hallucinated labels" (stage-1-prompt.ts:6–7 comment), Stage 4's `validateAndClamp` exists specifically to cope with Stage 2 garbage (stage-4-extract.ts:186).
2. **Stage 5 synthesis fidelity** — specifically, the assumption that the image's room boundaries map cleanly to axis-aligned rectangles in feet. Stage 4 returns axis-aligned boxes regardless of what the image actually contains; Stage 5 trusts them. `resolvePlotBounds` fallback (stage-5-synthesis.ts:69–92) can reduce scale by ≥20% if rooms are scattered, and the issue is logged but the pipeline does not abort. Any image with a non-rectangular outline (courtyards, L-plans) silently collapses to a smaller rectangle.
3. **Stage 1 prompt depth.** The knowledge base is good but not architect-grade: no kitchen triangle, no master-suite sequence, no bedroom-privacy rule, no wet-room clustering, no cross-ventilation, no NBC 2016 room minimums, no window-to-floor ratio. The audit's Perspective 1 catalogs this fully. I'd rank this 3rd, not 1st — a better prompt helps but can't overcome a diffusion model that ignores half of it.

Stages 3, 6, 7 are downstream of the above and can only score or deliver what Stages 1–5 produced.

### Q3 — Are Phase 2.3 + 2.4 fixes the right fixes?

Phase 2.3:
- **Option X (attached adjacency):** Direction right (extraction-output ≠ architect intent on ensuites — worth repairing); implementation **narrow and order-sensitive** (single pass, first-fit, only handles `attached`, order of declarations matters, no topological sort, fallback logs "unfixable" and moves on). Fixes the one case users notice most (master ensuite not attached) but doesn't help with multi-ensuite or mixed-relationship plans. Grade: **B−**.
- **Review modal intelligence:** Ensuite-aware bathroom add, vastu-aware Pooja pre-check, deterministic facing regex override. All three are sensible deterministic patches on top of an LLM parser that's known to slip. `FACING_CORRECTED` issue surfacing to UI is good UX — user sees the override, can correct if wrong. Grade: **A−**.
- **Image approval gate:** Architecturally clean (orchestrator split into phaseA/phaseB, DB schema addition, QStash resume route, UI component). Saves ~$0.15 per bad image by gating before Stage 4 extraction. **But** the resume + regenerate-image routes carry the pre-GA.3 signature bypass pattern, and they're on Phase 2.3 so they'll merge into production without the fix unless someone re-applies GA.3 at merge time. Grade: **A for design, C for merge hygiene**.

Phase 2.4:
- **GA.3 QStash signature:** Correct fix on `worker/route.ts`. Incomplete scope — the audit named 3 routes, Phase 2.4 fixed 1. Grade: **A for the route that got fixed, incomplete coverage**.
- **P0-A setback:** Right target, half-right implementation. Feature-flag gate is the right call (avoids surprise regressions). Municipality table matches audit V.9. But the room-scaling bug (B2 in Appendix) means the feature will regress visible room sizes when flipped on; users will see it before the quality scorer does. And the floor-boundary/envelope mismatch breaks the new `entranceDoor` dim (B1). Grade: **B− for implementation**.
- **P0-B bedroomPrivacy + entranceDoor:** Forced substitution for the audit's named dims; bedroomPrivacy is right. entranceDoor is overweighted (1.5 where the audit suggested 0.5 for the closest analog) and silently breaks under P0-A (B1). Grade: **B**.

Verdict on "right fixes": Phase 2.3 targets real problems and mostly hits them. Phase 2.4 targets real problems; GA.3 is good; P0-A and P0-B have composition issues between each other. Neither phase attacks the actual bottleneck (Q2 #1, GPT Image 1.5 choice); both are scoring-/validation-side improvements.

### Q4 — What's the single biggest risk if Rutik ships this?

**The biggest risk is a cascading security hole introduced by merge order.**

Here's the scenario:
1. Rutik merges Phase 2.4 to main. GA.3 fixes `worker/route.ts`. Good.
2. Later Rutik merges Phase 2.3 to main. It adds two new QStash-signed routes: `worker/resume/route.ts` and `worker/regenerate-image/route.ts`. Both still use the pre-GA.3 pattern (`isDev = NODE_ENV === "development"`).
3. Production deploy happens. If `NODE_ENV` is misconfigured (empty, typo), signature verification is skipped on both new routes. Attackers can POST a jobId and trigger arbitrary job resumption (which calls the full pipeline, including costs charged to arbitrary users) or trigger regenerate-image (which burns Stage 2 budget on arbitrary jobs).

The commit message for GA.3 (e415bc7) warns about exactly this: "Phase 2.3 routes... must receive the same fix at merge time." But warnings in commit bodies don't stop future-Rutik at 2am on a Friday.

Evidence:
- `git show feat/phase-2-3-adjacency-and-ux:src/app/api/vip-jobs/worker/resume/route.ts:37–43` — vulnerable.
- `git show feat/phase-2-3-adjacency-and-ux:src/app/api/vip-jobs/worker/regenerate-image/route.ts` — grep'd, same pattern.
- `git merge-base main feat/phase-2-3` = e931992 — means phase-2-3 has never seen the GA.3 commit.

**Secondary risk** (cost, not security): the Option X + entrance-door-evaluator + setback-envelope triple don't compose. Enabling P0-A for live users while the `entranceDoor` dim silently returns 5 for every plan will drag every quality score down 1–3 points. Users retrying chase a score that can't move. Retry cost compounds.

**Tertiary risk**: Stage 5's `buildSpine` fabrication + walls-against-fabricated-spine means the walls in the final FloorPlanProject often don't correspond to the image the user was shown. Users will notice.

I rank these security > cost > correctness in that order.

### Q5 — If you had 10 hours this week, what would you fix?

Ignoring the audit's ranking, from my independent read, in ROI order:

1. **Port GA.3 forward to the Phase 2.3 branch (30 min).** Not optional. Cherry-pick e415bc7 onto Phase 2.3 and patch `worker/resume/route.ts` + `worker/regenerate-image/route.ts` with the same explicit-opt-in pattern. Add tests mirroring `vip-worker-sig-bypass.test.ts` for both. This closes the #1 risk from Q4 before merge order can bite.

2. **Fix the Stage 5 room-scaling regression in P0-A (2–3 hours).** The correct transform preserves image→plot scale and *clips* overflow into the envelope, rather than *compressing* every room uniformly. Concretely: `transformToFeet` uses `plotWidthFt/plotBoundsPx.w` (full plot → full pixel bounds), then rooms that overflow the envelope are either clipped or pushed inward with a warning. Without this fix, `PHASE_2_4_SETBACKS=true` delivers measurably smaller rooms and users will notice before Stage 6 does. If the fix is non-trivial, ship P0-A *unflipped* (keep the flag off) and land the code as a no-op.

3. **Fix the `evaluateEntranceDoor` × setback interaction (1 hour).** The evaluator should compute cardinal-side tolerance against the *building envelope* (read from `project.metadata.plot_usable_area` which P0-A already writes, stage-5-synthesis.ts:471–475), not against `floor.boundary`. Five-line change. Adds a property test to pin this.

Optional if time permits (but these three above are the ones that move the needle without shipping new surface area):
4. Kill Stage 3 as a cost item — either make it binding on FAIL (orchestrator.ts:254–266) or remove the jury call entirely until it's useful. The audit's P0-C.
5. Ship the window `operable` flip (audit's P0-D, converter.ts:368). 10-minute, zero risk.

I deliberately don't recommend anything that requires Phase 2.3 merged — too much other risk.

---

## Phase D — Final Verdict

### 1. "Is Rutik on the right track?"

**Mixed.** The 7-stage VIP pipeline is a reasonable first-pass architecture and the last few phases have closed real gaps (GA.3, setback code path, quality-evaluator expansion). But the single highest-leverage change — replacing GPT Image 1.5 with a deterministic renderer fed by Stage 1's coordinates — isn't on anyone's active branch, and both Phase 2.3 and Phase 2.4 are working around the wrong bottleneck.

### 2. "Is the product ready to test with real users?"

**Test with caveats.** Specifically, before opening to users:
- (required) Port GA.3 onto the Phase 2.3 branch *before* merging it, or merge Phase 2.3 first and cherry-pick GA.3 on top of main.
- (required) Keep `PHASE_2_4_SETBACKS=false` until the Stage 5 room-scaling and entranceDoor-evaluator interaction bugs are fixed (Appendix B1 + B2). The feature flag default is already off; leave it.
- (strongly advised) Add a test that runs the full pipeline with setbacks on and asserts rooms stay within the envelope *and* their dimensions don't regress > 5% from the Stage 1 brief.
- (strongly advised) Add a cost cap per user per hour for the approval-gate + regenerate-image routes. Currently nothing prevents a malicious FREE-tier user from burning $20 on regenerates in 5 minutes.
- (nice to have) Flip Stage 3 to binding on FAIL — trivial, saves real money.

With those caveats, it is safe to test with a small cohort of real users for quality feedback. Without them, you're testing the bugs as much as the feature.

### 3. "What % of architect-grade output is this currently?"

**~50–55% on standard 3BHK rectangular plots in 2026-04.**
Slightly lower than the audit's 55% because my independent read surfaced additional issues the audit missed (Stage 5 bypasses strip-pack, synthetic `buildSpine`, `adjacency_satisfaction_pct` hardcoded, setback×entranceDoor interaction). Merge all current feature branches cleanly and you're at ~60%. Replace GPT Image 1.5 with deterministic SVG (audit's P2-A, 3 days) and you're at ~75%. Audit's "architect-grade 85%" requires an interactive adjust-resolve loop (audit's P2-H) — that's 1–2 weeks on top.

For irregular plots, duplexes, L-shapes, or strict Vastu requirements, drop the number another 15–25 points. Stage 1's typology menu lists courtyard/duplex/row-house; Stage 5 can't synthesize any of them correctly because it assumes a rectangular plot and a single straight hallway.

### 4. "What should Rutik do in the next 24 hours?"

1. **Decide the merge order.** Either (a) port GA.3 to Phase 2.3 and merge Phase 2.3 first, then Phase 2.4 — or (b) merge Phase 2.4 first, then port-and-merge Phase 2.3. **Do not merge Phase 2.3 without GA.3 applied**. Written down somewhere visible, not just in the commit body.
2. **Run the review-modal + image-approval-gate manually on one real prompt** before flipping anything in prod. Take a screenshot of the gate UI rendering. Confirm the resume QStash flow actually completes end-to-end in a dev environment. These are user-facing flows that have unit tests but no integration trace visible in the diff.
3. **Leave `PHASE_2_4_SETBACKS=false` everywhere.** Do not flip in a preview environment yet; Appendix B1+B2 will produce a silent quality regression that will confuse you more than help.

Stretch goal if energy permits: make Stage 3 binding on FAIL (orchestrator.ts:254 swap `return fall-through` when `verdict.recommendation === "fail"`). One-line change, saves ~$0.15 × fail-rate per run.

### 5. "What's one thing the previous session/agent missed entirely?"

**The branch-topology risk.** Neither the audit's cover page nor its TL;DR nor its V.x verification addendum identifies that Phase 2.3 and Phase 2.4 are parallel branches from main, not sequential phases. The audit's verification section V.7 names GA.3's scope as "Phase 2.3 workstream C" but never concludes "therefore merge order matters and GA.3 must travel with the merge". Phase 2.4's commit body calls it out briefly but the audit — which is the natural place for a cross-branch hygiene warning — does not.

Consequence: a reader who follows only the audit's recommendations in audit-order can easily merge Phase 2.3 to main *after* Phase 2.4 and silently introduce a security regression. That's a real, specific, avoidable failure mode and no document in the repo flags it.

---

## Appendix — Bugs and Risks Not Covered Elsewhere

### B1 — `evaluateEntranceDoor` silently fails under `PHASE_2_4_SETBACKS=true`

**File:** `src/features/floor-plan/lib/vip-pipeline/quality-evaluators.ts:100–124`
**Severity:** HIGH (conditional — only when `PHASE_2_4_SETBACKS=true`)

The `wallCardinalSide` helper computes tolerance = 15% of `min(plotWidth, plotHeight)` where `plot = polygonBounds(floor.boundary.points)`. `floor.boundary` is built by `converter.rectToPolygon(stripPackResult.plot)` (converter.ts:104 + 209–222). Stage 5 sets `stripPackResult.plot = plotRect` which is the **full plot** (stage-5-synthesis.ts:346), not the envelope.

When P0-A is enabled, walls are placed inside the envelope. The main-door wall's `midY` sits `rule.rear` ft from plot's south edge — 9.8ft for Mumbai, 10ft for Bengaluru_large, 6.5ft for Pune. Tolerance = 15% × plotDim:
- 30×40 plot: tolerance = 4.5ft; any setback > 4.5ft fails cardinal detection → returns neutral (5).
- 40×40 plot: tolerance = 6ft; Mumbai (9.8ft) fails, Hyderabad/Bengaluru_small pass.
- 60×60 plot: tolerance = 9ft; Mumbai (9.8ft) fails by 0.8ft.

Result: on every urban Indian plot (target market), the new `entranceDoor` dim returns 5/10 regardless of where the main door actually is — dragging aggregate Stage 6 score down by ~1.5 points × weight 1.5 = ~2.3 aggregate points.

**Fix:** Compute `plot` bounds from the envelope, not from `floor.boundary`. The envelope is already written to metadata (stage-5-synthesis.ts:471–475): `meta.plot_usable_area = { width_ft, depth_ft, origin_x_ft, origin_y_ft }`. The evaluator should read this when present, fall back to `floor.boundary` when absent.

### B2 — P0-A uniformly compresses every room

**File:** `src/features/floor-plan/lib/vip-pipeline/stage-5-synthesis.ts:290–309`
**Severity:** HIGH (conditional — only when `PHASE_2_4_SETBACKS=true`)

The call site:
```
const envelope = computeEnvelope(plotWidthFt, plotDepthFt, input.municipality);
const transformed = transformToFeet(
  extraction.rooms, plotBoundsPx,
  envelope.usableWidthFt, envelope.usableDepthFt, issues);
```

Inside `transformToFeet` (stage-5-synthesis.ts:104–171), `scaleX = plotWidthFt/plotBoundsPx.w` where the parameter `plotWidthFt` is now `envelope.usableWidthFt` (e.g., 34 on a 40×40 Mumbai plot). The image still represents the full 40×40 plot (Stage 1 brief said 40×40, Stage 2 generated for 40×40, Stage 4 extracted pixel bounds of 40×40). So a 14-ft-wide master bedroom in the image ends up 14 × (34/40) = 11.9 ft wide in the output.

Mumbai 30×40 plot with 9.8ft rear + 4.9ft side setbacks: usable = 20.2 × 20.4 — a 45% area loss applied uniformly to every room. Rooms visibly shrink; some drop below NBC 2016 minimums (bedroom 9.5m² ≈ 102 sqft).

**Fix:** Preserve the image→plot scale. `scaleX = plotWidthFt/plotBoundsPx.w` should use the *full plot* (the image's coordinate system). Then shift rooms by `(envelope.originX, envelope.originY)` and clip/warn on any that overflow the envelope. Today's code only shifts (stage-5-synthesis.ts:304–309) — but the shift is applied *after* the too-small scale was already applied, so it doesn't undo the compression.

Alternative: teach Stage 1 to produce a brief sized for the envelope (buildable dims), and Stage 2 to generate for the envelope. That's a bigger change; the pixel-scale fix is simpler.

### B3 — `adjacency_satisfaction_pct: 80` is a lie

**File:** `src/features/floor-plan/lib/vip-pipeline/stage-5-synthesis.ts:446–452`
**Severity:** MEDIUM (observability; fiction in telemetry)

Stage 5 hardcodes `adjacency_satisfaction_pct: 80` and `satisfied_adjacencies: Math.round(required × 0.8)`. No adjacency check happens in the VIP Stage 5 on this branch. Dashboards/logs reading this field see a synthetic 80% regardless of actual state.

**Fix:** Either wire in the Phase 2.3 evaluateAdjacencies machinery (cross-branch coordination needed) or emit `null` / `unknown` rather than a fabricated 80. Fabricated metrics actively mislead future debugging.

### B4 — `buildSpine` fabricates geometry that walls are built against

**File:** `src/features/floor-plan/lib/vip-pipeline/stage-5-synthesis.ts:242–272`
**Severity:** MEDIUM (architectural correctness; walls/doors may not match image)

When the extracted rooms do not include one typed `corridor/hallway/passage`, `buildSpine` creates a fake 3.5 ft hallway at y = 0.48·plotDepthFt across the full plot width. `buildWalls` then emits walls on all four sides of this fake hallway; `placeDoors` tries to place hallway-doors against it; `placeWindows` (via the fake spine) reasons about front-vs-back strip.

Consequence: walls and openings in the FloorPlanProject have a geometric basis — a hallway — that need not exist in the image the user was shown. Downstream renderers happily draw doors opening into a hallway the user never saw.

**Fix:** If no hallway room is extracted, set `spine` to a zero-size degenerate rect and teach the downstream placers to handle that case gracefully. Or extract a virtual hallway from void regions in the extracted layout (non-trivial). Either is better than fabrication.

### B5 — Stage 5 does not validate its own output

**File:** `src/features/floor-plan/lib/vip-pipeline/stage-5-synthesis.ts:457–488`
**Severity:** LOW (but concerning)

`runStage5Synthesis` can emit a project with 0 walls, 0 doors, degenerate rooms, or rooms whose polygons self-intersect, and the orchestrator will happily pass it to Stage 6. Zod only validates LLM outputs, not synthesized geometry.

**Fix:** Add a post-synthesis sanity check: `floor.rooms.length >= 1`, `floor.walls.length >= 1`, every room polygon is simple + CCW, every door has a valid `wall_id` that exists in `floor.walls`. Throw if any invariant fails — let the orchestrator's fall-through handle it.

### B6 — Retry hint uses Phase 2.4 dimension names the image model has no prior on

**File:** `src/features/floor-plan/lib/vip-pipeline/orchestrator.ts:311–314`
**Severity:** LOW (ROI regression on retry loop)

The weak-hint string appended to the retry image prompt is:
```
"Scored poorly on: ${weakAreas.join(", ")}"
```
After Phase 2.4, `weakAreas` can include `"bedroomPrivacy"` and `"entranceDoor"` — strings with no standard architectural-prompting semantics. The image model is unlikely to respond coherently. Retry converges even less than before.

**Fix:** Translate weak-dim names into human/architect-legible directives before appending: `bedroomPrivacy → "keep bedroom doors off the living/dining walls"`, `entranceDoor → "the main door must be on the {facing} wall"`. Keep the dim names for telemetry but don't feed them into the image prompt.

### B7 — No concurrency control on approve / regenerate routes

**File:** `src/app/api/vip-jobs/[jobId]/approve/route.ts` (Phase 2.3 branch)
**Severity:** HIGH (cost exposure)

Phase 2.3 Workstream C adds the approval routes but does not add rate limiting nor a TOCTOU-safe status update. The audit's V.7 identified both (GA.1, GA.2, GA.4). Phase 2.4 did not address these. Flagging again because when Phase 2.3 ships, these go live — a single user can trigger many concurrent resumes on the same job (TOCTOU), or spam regenerate-image ($0.034 × N) with no upstream cap.

**Fix:** `updateMany({ where: { id, status: 'AWAITING_APPROVAL' }, data: {...} })` pattern + `checkEndpointRateLimit(userId, "vip-approve", 5, "5 m")` on each route.

### B8 — Test suite has no end-to-end regression bar

**File:** `src/features/floor-plan/lib/vip-pipeline/__tests__/*`
**Severity:** LOW (process smell)

No test runs the full pipeline on a fixed prompt and asserts `qualityScore >= N`. Unit tests cover individual stages and new Phase 2.4 dims, but there's no canary that says "Gen 1 3BHK Vastu prompt still scores ≥ 57 after this change". Without that, any refactor can silently regress the aggregate score and no CI signal fires until a human notices.

**Fix:** Add a single deterministic-seed integration test with a mocked OpenAI/Anthropic response (capture real responses once, replay them) that asserts a floor of aggregate score on a reference prompt.

---

## Closing Note

The pipeline is not broken, but it is not architect-grade yet. Phase 2.4's three commits are legitimate forward progress; none of them is a mistake. But they compose awkwardly with each other (B1), compose incorrectly with Stage 5 under their feature flag (B2), and don't travel to the parallel Phase 2.3 branch where half the relevant code also needs them (GA.3 on `worker/resume` + `worker/regenerate-image`). Before real-user testing: port GA.3 forward, leave `PHASE_2_4_SETBACKS=false`, verify the image approval gate end-to-end once by hand. Everything else in the audit is for next month.

— fresh-session reviewer, 2026-04-22
