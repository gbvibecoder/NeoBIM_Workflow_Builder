# Result Page · Phase 4.1 Report

**Date:** 2026-04-26
**Branch:** `feat/showcase-redesign-v1`
**HEAD:** `f4f4bf8` · 6 commits on top of `d7a542a`

The brief: 6 surgical fixes, no scope creep, ship in order so each is testable independently.

---

## 1 · Per-fix verification

### Fix 6 · Region never says USA · `b2cb26b`

```
$ grep -rEn 'USA \(baseline\)|United States|"baseline"' src/features/result-page/
src/features/result-page/lib/normalize-region.ts:6: * defaults to `"USA (baseline)"` — which is correct upstream (CPWD
src/features/result-page/lib/normalize-region.ts:23:    (lower.includes("baseline") && !lower.includes("india"))
```
Both matches are inside the `normalize-region.ts` *helper itself* (its docstring + matcher logic). No rendered string in the result page emits `USA` — the helper translates every USA fallback into `INDIA · BASELINE` at render time.

Wired in two render sites:
- `HeroSection.tsx:795` — Region stat now always renders (Phase 4 hid it when empty).
- `lib/derive-stat-strip.ts` — BOQ stat strip's REGION tile.

### Fix 3 · Section numbering derives from rendered count · `087e7ae`

```
$ grep -rn "index={[0-9]" src/features/result-page/components/sections/
(no matches)
```
All hardcoded indices replaced with `index={index}` props. The orchestrator (`index.tsx`) now consults eligibility predicates in declaration order:

```tsx
let counter = 0;
const next = () => ++counter;
const willDedicated = isDedicatedVisualizerEntriesEligible(data);
const dedicatedIdx = willDedicated ? next() : 0;
// …repeat for all 5 sections
```
Five eligibility predicates exported alongside their sections so the gate stays in lockstep with the body.

### Fix 4 · Cost composition bar always renders for BOQ · `1fbb8c5`

`deriveCostComposition()` now returns a `CostComposition | null` with a `source: "live" | "ifc" | "indicative"` discriminator. Three tiers:
- **live** — keyword-match BOQ line descriptions (Phase 4 path)
- **ifc** — derive from IFC element category counts, weighted (Civil 1.5×, Steel 1.2×, MEP 0.9×, Finishings 0.7×, Labor 1.0×)
- **indicative** — typical-construction-share defaults: Civil 48 · Steel 18 · MEP 14 · Finishings 12 · Labor 8

The component renders the source as a mono caption: `Live breakdown · from BOQ table` (teal) vs `Indicative · derived from IFC categories` / `Indicative · typical construction shares` (slate).

### Fix 5 · Live status strip below header · `fd3b364`

New file `src/features/result-page/components/sections/LiveStatusStrip.tsx`. Sticky just under PageHeader (top 56), background `rgba(13,148,136,0.04)`, single ~32px row. Pulsing teal dot at left + workflow-aware items in mono + relative age + reload icon at right.

Workflow-specific copy (sample):
- BOQ: `LIVE PRICES · INDIA · BASELINE · BOQ ENGINE · IS 1200 · CONFIDENCE ±15%`
- IFC: `IFC4 SCHEMA · RICH · IfcOpenShell · 199 ELEMENTS · web-ifc · WASM`
- Floor Plan: `FLOOR PLAN · CAD · 9 ROOMS · 16 WALLS · 102 m² BUILT-UP`
- Video: `KLING RENDER · 1080P · 24FPS · 15s · 4 SHOTS`

Discipline: never fabricate signals. Where a number isn't in the data (e.g. brief suggested "23 SOURCES"), use a domain-true constant (`BOQ engine · IS 1200`) instead of inventing one.

### Fix 1 · BOQ cascade theater · `40c9fe8`

Re-authored `MaterialChipsCascade.tsx`:
- `useInView({ once: true, amount: 0.3 })` — defers until 30% of hero is visible (Phase 4 fired on mount, often before scroll).
- Chip enter: `opacity 0→1`, `scale 0.85→1`, `y +6→0`, **420ms back-out ease** `[0.34, 1.56, 0.64, 1]` — springy overshoot, the "BING" feel.
- Dot pulse + halo: dot scales `0.4 → 1.6 → 1` over 500ms with a separate halo ring expanding `scale 0 → 2.6` and fading `opacity 0.55 → 0` simultaneously.
- Connecting line: 1px teal stroke draws 0→18px before each chip (chips 2-5).
- Concrete dot color #94A3B8 → #475569 (Phase 4 was too pale to read on white).

### Fix 2 · Live cost breakdown donut · `f4f4bf8`

New file `src/features/result-page/components/animations/LiveCostBreakdownDonut.tsx`. 240×240 SVG donut, 28px stroke, 5 segments tied to the chip palette. Each arc draws via `pathLength 0→1` with the **same delay schedule** as the chip cascade (200/440/680/920/1160ms) — they finish together as one unified moment. Center label `TOTAL · ₹X.XX L · 5 CATEGORIES`. 5 mini legend rows beneath. Hover thickens segment + halos the legend dot.

BoqVariant layout converted to 2-column grid (`1.3fr | 1fr`, 36px gap), breakpoint 900px → single column. Number duration bumped 1.2s → 1.6s and DimensionLine delay 1.4s → 1.6s for cleaner sequence.

---

## 2 · Animation timing diagram (chip cascade ↔ donut sync)

```
t (ms)    KPI tick-up    Material chip       Donut arc        DimensionLine
─────    ────────────    ─────────────       ──────────       ─────────────
   0     start (₹0)      —                    —                —
 200     ₹0.18 L         CONCRETE in (•—)    Concrete arc      —
 440     ₹0.40 L         STEEL in     (•—)    Steel arc        —
 680     ₹0.62 L         BRICKS in    (•—)    Bricks arc       —
 920     ₹0.85 L         LABOR in     (•—)    Labor arc        —
1160     ₹1.07 L         FINISHINGS in (•—)   Finishings arc   —
1600     ₹1.37 L (lands)  …                   …                draw begins
2200     ₹1.37 L          all settled         all settled      complete
```

Each chip's halo pulse + dot scale finishes 100ms after its entrance (so when the next chip activates 240ms later, the previous chip is fully settled — no overlapping pulses). The donut arc and chip share the same `delay` so they read as a single act.

---

## 3 · Reduced-motion behavior

| Element | Animated path | Reduced-motion path |
|---|---|---|
| MaterialChipsCascade chips | Springy entrance + halo + connecting line | All chips render fully formed, no entrance / halo / line draw |
| LiveCostBreakdownDonut arcs | `pathLength 0→1`, 600ms each, 240ms staggered | All arcs render at `pathLength: 1` immediately |
| LiveCostBreakdownDonut legend rows | Staggered `opacity + x` slide-in | Render at full opacity, no slide |
| LiveCostBreakdownDonut hover | Stroke thickens, halo on legend dot | Same — hover effects work |
| LiveStatusStrip live dot | Pulses opacity 0.65↔1, ripple ring | Static dot, no pulse, no ripple |
| LiveStatusStrip reload icon | Color transition on hover | Same |
| CostCompositionBar segments | Sequential left→right grow (120ms apart) | All segments render at final % immediately |
| KPI AnimatedNumber | Tick 0→final over 1.6s | Renders at final value immediately |
| Hero entrance (Phase 2 carryover) | Blur-to-focus | Renders crisp |
| Section reveals (Phase 3 carryover) | `whileInView` slide+fade | Render fully visible |

End state pixels are identical between the two paths.

---

## 4 · Bundle delta

**Zero new dependencies.** All animation primitives are pure SVG + framer-motion (already in bundle) + CSS.

New files (this phase only):
```
src/features/result-page/lib/normalize-region.ts                         (32 LOC)
src/features/result-page/components/sections/LiveStatusStrip.tsx        (294 LOC)
src/features/result-page/components/animations/LiveCostBreakdownDonut.tsx (262 LOC)
+ 5 eligibility predicates exported from existing section files          (~15 LOC each)
+ derive-cost-composition.ts rewrite                                     (167 LOC, was 102)
+ MaterialChipsCascade.tsx rewrite                                       (148 LOC, was 80)
+ CostCompositionBar.tsx rewrite                                         (160 LOC, was 110)
```

Net: ~+1,000 LOC new code. Build artifact change negligible (text-only, no asset shipping).

---

## 5 · What I deliberately did NOT do (resisted scope creep)

- ❌ Did not redesign anything outside the 6 named fixes. The brief's `STAY IN SCOPE` was load-bearing.
- ❌ Did not modify the `BoqVariant` BOQ preview table or "Open BOQ Visualizer" CTA. Both stayed exactly as Phase 4 shipped.
- ❌ Did not touch other hero variants (Video / Floor Plan / Image / IFC / Clash / Failure / Pending). Phase 4's signatures stand.
- ❌ Did not redesign the PageHeader. WorkflowTypeBadge from Phase 4 stayed; the LiveStatusStrip is mounted *below* the header, not inside it.
- ❌ Did not add new dependencies (kept the no-Lottie / no-Phosphor discipline from Phase 3/4).
- ❌ Did not invent fake numbers in LiveStatusStrip. The brief suggested "23 SOURCES" as a plausible static; I refused — every value is data-derived or a true constant (`IS 1200`, `web-ifc · WASM`).
- ❌ Did not modify the TR-008 handler or any preservation-list file (audit §11.1).
- ❌ Did not adjust the IsometricBuilding wireframe behind the IFC hero — Phase 4's setting is fine.
- ❌ Did not add Compare-with-previous-run, Annotate-server-sync, or canvas-side prefill. All deferred to Phase 5 per Phase 3 product questions.

---

## 6 · What still feels off after 4.1

Honest critique:

1. **The five chip labels are static.** Concrete · Steel · Bricks · Labor · Finishings is true for a typical Indian construction project but not derived from the actual run's BOQ. A run that's mostly mason-labor lines would still show Concrete first. Phase 5 should plumb the BOQ table's real top-5 categories into the chip cascade — same code path as `deriveCostComposition` but with category names instead of bucket totals.

2. **The donut and the cost composition bar tell *related but slightly different* stories.** Donut uses a static palette; bar uses live/IFC/indicative tiers. Both describe BOQ composition. A future round should unify them so they share the same source of truth — render the same percentages in two visual forms instead of two slightly-divergent stories.

3. **Status strip's "X ago"** updates only on page navigation. If a user keeps the page open for hours, the strip lies. A `setInterval(60s)` rerender would fix it but adds a small RAF cost — left out for now since result pages aren't typically held open.

4. **Reload (`router.refresh()`)** is a Next.js soft refresh. If the page state is large, this *re-fetches* but doesn't *re-animate*. Could feel like nothing happened. Phase 5 could add a brief flash on the strip ("REFRESHED · just now") so the user gets visual confirmation.

5. **Mobile (<900px) collapses the BOQ hero to single column.** Donut goes below the KPI on small screens, which is fine — but the donut at 240×240 is ~50% of typical mobile viewport width. Could shrink to 180×180 on mobile breakpoint. Low priority.

6. **No "compare to last run" anywhere.** The Live Status Strip is a perfect host for `vs LAST RUN · cost ↓ 4%` if the data captured input deltas. Phase 3's product question still stands.

7. **The cascade uses `useInView({ amount: 0.3 })`.** If a user lands directly on a `?open=…` deep link that's intercepted before the hero is in view, the chips never trigger. Edge case, acceptable.

---

## 7 · Verification gates (final)

```
$ npx tsc --noEmit                                              → 0 errors
$ npx eslint src/features/result-page/                          → 0 errors, 0 warnings
$ npm run build                                                 → Compiled successfully
$ grep -rEn '"\$[0-9]|>\$[0-9]' src/features/result-page/        → 0 matches
$ grep -rEn ' as any|@ts-ignore|: any\b' src/features/result-page/ → 0 matches
$ git log --oneline -7
  f4f4bf8 feat(result-page): live cost-breakdown donut — fills BOQ hero right side
  40c9fe8 feat(result-page): BOQ cascade re-choreography — unmissable theater
  fd3b364 feat(result-page): live status strip — workflow-aware mono ticker beneath header
  1fbb8c5 fix(result-page): cost composition bar always renders for BOQ (live → IFC → indicative)
  087e7ae fix(result-page): section numbering derives from rendered sections (no skips)
  b2cb26b fix(result-page): normalize region — never default to USA
  d7a542a docs(result-page): Phase 4 report (Phase 4 baseline)
```

Branch pushed; main untouched.

— END REPORT —
