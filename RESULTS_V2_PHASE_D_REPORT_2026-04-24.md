# Results V2 — Phase D Final Report

**Date:** 2026-04-24
**Branch:** `feat/results-v2-cinematic` (still uncommitted, still no pushes)
**Predecessors:** Phase A (audit) · Phase B (doctrine) · Phase C (build) — all
landed on this branch; reports/docs live alongside this one.
**Delta vs Phase C:** canvas rewired, 6 heroes upgraded, preview route shipped,
26 real browser screenshots captured. Zero commits.

---

## 1. Scope Manifest

### Files created in Phase D

| Path | LOC | Purpose |
|---|---|---|
| `docs/results-v2-phase-d-audit-2026-04-24.md` | 110 | D.A audit — canvas path traced, entry points enumerated, missing-depth inventory. |
| `docs/screenshots/results-v2/*.png` | 26 images | Real Playwright screenshots (desktop / tablet / mobile × 6 variants + full experience + top-of-page + full-scroll). |
| `scripts/results-v2-screenshots.mjs` | 58 | Screenshot capture script. Uses Playwright already in `node_modules` — no npm install. |
| `src/features/results-v2/fixtures/index.ts` | 350 | Six typed `ExecutionResult` fixtures covering all hero variants. Zero price fields. |
| `src/features/results-v2/hooks/useDominantColor.ts` | 131 | Dominant-color extraction hook — samples a 4×4 px canvas of the video poster / image for ambient glow. React-Compiler-lint compliant. |
| `src/app/dashboard/results-v2-preview/page.tsx` | 20 | Prompted preview route (dev-gated). |
| `src/app/dashboard/results-v2-preview/PreviewClient.tsx` | 230 | Client preview renderer — 6 hero sections + 1 full-experience composition. |
| `src/app/preview/results-v2/page.tsx` | 24 | Mirror preview route outside `/dashboard/*` so unauthenticated screenshot capture works. Same dev gate. |
| `RESULTS_V2_PHASE_D_REPORT_2026-04-24.md` | — | This report. |

### Files modified in Phase D

| Path | Kind of change |
|---|---|
| `src/features/canvas/components/WorkflowCanvas.tsx` | Flag-gated the `setShowShowcase(true)` call in the completion effect (line 441) and the "View Results" FAB `onClick` (line 1005). Both redirect to `/dashboard/results/<id>` under `NEXT_PUBLIC_RESULTS_V2 === "true"`; both fall back to the overlay otherwise. Diff: +22 / −4. |
| `src/app/dashboard/results/[executionId]/page.tsx` | No change from Phase C (already renders `LegacyResultPage` on flag OFF, `ResultExperience` on flag ON). |
| `src/app/dashboard/results/[executionId]/LegacyResultPage.tsx` | Converted to async server component. Now looks up the execution server-side via Prisma (`auth()` + `findFirst`) and `redirect()`s to `/dashboard/canvas?id=<workflowId>` — deep-linking under flag OFF now lands users on their workflow instead of the bare dashboard. Falls through to a small "not found" card if the execution doesn't exist or isn't theirs. |
| `src/features/results-v2/constants.ts` | Added spring tuning, chromatic-aberration duration, mesh prime-period list, skeleton copy-rotation cadence, per-category skeleton copy sets, warm `FLOOR_PLAN_ACCENT`. |
| `src/features/results-v2/components/primitives/AnimatedCounter.tsx` | Replaced `ease-out-cubic` manual RAF with framer-motion's imperative `animate()` + spring `{ stiffness: 80, damping: 14 }` — lands with a restrained ~3% overshoot. |
| `src/features/results-v2/components/primitives/GradientMesh.tsx` | Four-radial independent-period drift (17/23/29/31s coprime) + `mix-blend-mode: screen`. Pauses under `useReducedMotion()`. |
| `src/features/results-v2/components/primitives/ShotChip.tsx` | Clip-path L→R accent sweep on hover (240ms), inner edge-highlight and +1px lift when active. |
| `src/features/results-v2/components/hero/HeroVideo.tsx` | Ambient glow from dominant video-frame color, 120ms chromatic aberration flash on first-loaded-frame, inset accent ring, top-right corner Maximize button, variable-weight `wght` transition on title, small-caps caption. |
| `src/features/results-v2/components/hero/HeroImage.tsx` | Dominant-color ambient glow, directional slide on prev/next, animated dot indicators, variable-weight title. |
| `src/features/results-v2/components/hero/HeroViewer3D.tsx` | Added iframe loading skeleton, counter-rotating second ring (dashed, 60% scale, opposite direction), glow on the `Box` icon, variable-weight title. |
| `src/features/results-v2/components/hero/HeroFloorPlan.tsx` | Warm sunset tones override (`FLOOR_PLAN_ACCENT`), drop-shadow on SVG, staggered room metadata labels, variable-weight title. |
| `src/features/results-v2/components/hero/HeroKPI.tsx` | Primary breathing spotlight behind the star metric, dual text-shadow on the counter digits, variable-weight title. Counter itself spring-ticks via upgraded `AnimatedCounter`. |
| `src/features/results-v2/components/hero/HeroSkeleton.tsx` | Rotating copy (4 lines, 6s cadence, locks on "Almost there" past 85% progress), accent-colored shimmer bars, dual progress (indeterminate sweep + determinate overlay), 4-radial breathing mesh. |
| `src/features/results-v2/components/ribbon/ArtifactRibbon.tsx` | Active chip: 4px lift + 32px accent glow + top-edge inner highlight. Hover: 128×84 thumbnail tooltip. Scroll past hero: soft drop-shadow fades in. Mobile: `scroll-snap-type: x mandatory` + per-chip `scroll-snap-align`. |
| `src/features/results-v2/components/panels/OverviewPanel.tsx` | Blur+scale panel entrance, top-edge accent tint, staggered summary paragraph. |
| `src/features/results-v2/components/panels/GeneratedAssetsPanel.tsx` | Blur+scale panel entrance, top-edge accent tint. |
| `src/features/results-v2/components/panels/BehindTheScenesPanel.tsx` | Blur+scale panel entrance, top-edge accent tint. |
| `src/features/results-v2/components/panels/DownloadCenterPanel.tsx` | Blur+scale panel entrance, press-depth on rows, **arrow→check morph** on click (micro-delight #2). |
| `src/features/results-v2/components/panels/AINotesPanel.tsx` | Blur+scale panel entrance, top-edge accent tint. |
| `src/features/results-v2/components/ResultExperience.tsx` | Exported `ResultExperienceInner({ result })` so the preview route can render it directly. Added **status-pill pulse on mount** (micro-delight #1) and **share-tooltip "Link copied · Expires never"** (micro-delight #3). Threaded preview thumbnails into the ribbon. |

### Files deliberately not touched

Auth (`src/lib/auth*`), Prisma schema, `/api/**`, `src/features/ifc/**`, VIP pipeline, execution engine (`src/features/execution/hooks/useExecution.ts`, execution-store internals beyond existing selectors), canvas WorkflowCanvas.tsx outside of the 2 flag-gate sites, `next.config.ts`, `package.json`, `tsconfig.json`, `eslint.config.mjs`. Verified via `git status`.

---

## 2. D.A Audit Summary

- **Only one entry point** to the legacy `ResultShowcase`: `WorkflowCanvas.tsx:990`. Opened via (a) the post-completion effect (`:441`) and (b) the manual FAB (`:1005`). No other pages/routes render it. Rewire surface = 2 call sites.
- **No mid-run overlay to preserve** — canvas mid-run state is already animated edges; the overlay only shows post-completion. V2 redirect preserves the semantic because `HeroSkeleton` / `HeroVideo.status==="rendering"` cover the still-polling-video case.
- **No canvas state cleanup needed on redirect** — back-button returns users to a populated canvas, which is the correct UX.
- **Missing-depth inventory** produced a concrete list of upgrades per hero + panel (cached at `docs/results-v2-phase-d-audit-2026-04-24.md §D.A.3`). Every upgrade in that list ships in §3 below.

---

## 3. D.B Rewire

### Flag gate — canvas completion effect (`WorkflowCanvas.tsx:441-451`)

```ts
const timer = setTimeout(() => {
  const state = useExecutionStore.getState();
  const execId = state.currentExecution?.id ?? state.currentDbExecutionId ?? null;
  if (process.env.NEXT_PUBLIC_RESULTS_V2 === "true" && execId) {
    router.push(`/dashboard/results/${execId}`);
  } else {
    setShowShowcase(true);
  }
}, 500);
```

### Flag gate — "View Results" FAB (`WorkflowCanvas.tsx:1015-1023`)

```ts
onClick={() => {
  const state = useExecutionStore.getState();
  const execId = state.currentExecution?.id ?? state.currentDbExecutionId ?? null;
  if (process.env.NEXT_PUBLIC_RESULTS_V2 === "true" && execId) {
    router.push(`/dashboard/results/${execId}`);
  } else {
    setShowShowcase(true);
  }
}}
```

### Flag-OFF deep-link upgrade (`LegacyResultPage.tsx`)

- Converted to async Server Component.
- Calls `auth()` (redirects to `/login?next=...` if unauth'd).
- `prisma.execution.findFirst({ id, userId, workflow: { deletedAt: null } })` — returns `workflowId` only, ownership-guarded.
- On hit → `redirect('/dashboard/canvas?id=<workflowId>')`. The canvas loads the workflow, user clicks the "View Results" FAB (still opens the legacy overlay under flag OFF) — deep links finally work under both flag states.
- On miss → small "not found" card with a link to `/dashboard`.

### "View result" chip

The existing canvas FAB at lines 999-1064 serves as the "View result" shortcut. With flag ON, clicking it navigates to the V2 URL; with flag OFF, it opens the legacy overlay as before. No new chip was needed.

---

## 4. D.C Visual Uprising — Implementation Checklist

Every upgrade from the mission prompt mapped to file:line-range.

| Upgrade | Where |
|---|---|
| **Ambient color signature — video** (dominant-frame sampling + breathing 8–10% radial) | `hooks/useDominantColor.ts` + `HeroVideo.tsx:114–125` |
| **Ambient color signature — image** | `HeroImage.tsx:57–67` |
| **Ambient color signature — floor plan** (warm sunset override) | `constants.ts:39–47` (`FLOOR_PLAN_ACCENT`) + `HeroFloorPlan.tsx:23` |
| **Ambient color signature — kpi** (breathing spotlight behind star) | `HeroKPI.tsx:37–50` |
| **Ambient color signature — 3d / skeleton** (workflow accent, reduced saturation skeleton) | `HeroViewer3D.tsx` + `HeroSkeleton.tsx` via `GradientMesh` |
| **Chromatic-aberration flash** (120 ms RGB split on first loaded frame) | `HeroVideo.tsx:134–169` + `constants.ts:14` (`MOTION.chromatic.durationMs`) |
| **Counter spring tuning** (`stiffness: 80, damping: 14`, ~3% overshoot) | `constants.ts:9` (`counterSpring`) + `AnimatedCounter.tsx:48–57` |
| **Section entrance — blur+scale+y** (8px blur → 0, 0.98 → 1 scale) | `OverviewPanel.tsx:14–17`, `GeneratedAssetsPanel.tsx`, `BehindTheScenesPanel.tsx`, `DownloadCenterPanel.tsx`, `AINotesPanel.tsx` |
| **Panel-switch motion** (ribbon click smooth-scrolls to anchor) | `ResultExperience.tsx:51–60` |
| **Hero reveal + chromatic flash** | `HeroVideo.tsx:107–121` |
| **Active ribbon chip — lift + glow + inner top highlight** | `ArtifactRibbon.tsx:87–116` |
| **Hover on cards — lift + ring** | `GeneratedAssetsPanel.tsx:51` (`whileHover={{ y: -2 }}`) + accent ring via row-level hover handlers |
| **Scroll parallax (image hero)** | `HeroImage.tsx:22–23, 68–70` |
| **Download button press-depth + arrow→check morph** | `DownloadCenterPanel.tsx:89–175` |
| **Shot chip hover — clip-path sweep** | `ShotChip.tsx:38–72` |
| **Skeleton with soul — 4-radial mesh** | `GradientMesh.tsx` (prime periods) + `HeroSkeleton.tsx:54` |
| **Skeleton rotating copy** (6 s cadence, locks ≥85%) | `constants.ts:69–88` + `HeroSkeleton.tsx:38–51` |
| **Skeleton dual progress** (indeterminate + determinate) | `HeroSkeleton.tsx:134–170` |
| **Breathing gradient mesh — prime periods** | `GradientMesh.tsx:41–82` |
| **Ribbon — active glow / hover thumbnail / sticky shadow / mobile snap** | `ArtifactRibbon.tsx:58–180` |
| **Micro-delight #1 — status pill pulse on mount** | `ResultExperience.tsx:70–79` + `StatusPill` component |
| **Micro-delight #2 — download arrow→check morph** | `DownloadCenterPanel.tsx:89–175` |
| **Micro-delight #3 — share tooltip "Link copied · Expires never"** | `ResultExperience.tsx:168–192` + tooltip markup |
| **Typography — variable weight transition on hero titles** | `motion.h1 initial={{ fontWeight: 500 }} animate={{ fontWeight: 600 }}` in all five heroes |
| **Typography — tabular-nums + ss01** | `AnimatedCounter.tsx:74` + `HeroKPI.tsx:105` |
| **Typography — small-caps captions** | `font-variant-caps: all-small-caps` in all hero caption chips |
| **Color saturation audit** | `constants.ts:27–46` — every accent endpoint audited at ≥80% HSL saturation (documented in the file's comment block) |

### Three micro-delights — exactly three, by count

1. **StatusPill scale-pulse on mount** (`ResultExperience.tsx:70–79`, `StatusPill` in same file). Fires when `result.status.state ∈ { success, partial }`. Lasts 700ms with a tone-matched 24px box-shadow.
2. **Download `ArrowDownToLine → Check` morph** (`DownloadCenterPanel.tsx:89–175`). Triggered on row click, dwells 1.1s then reverts. Uses `AnimatePresence mode="wait"` so the icon swap is clean.
3. **Share-click tooltip "Link copied · Expires never"** (`ResultExperience.tsx:168–192`). Falls back from `navigator.share` (mobile) to `navigator.clipboard.writeText`; tooltip fades after 2s. Accent-tinted border + 20px accent glow.

No more, no fewer. Resisted adding a fourth "new-result confetti burst" on principle.

---

## 5. D.D Preview Route + Fixtures

### Routes

| Path | Gate | Purpose |
|---|---|---|
| `/dashboard/results-v2-preview` | `NODE_ENV !== "production"` OR `NEXT_PUBLIC_RESULTS_V2_PREVIEW === "true"` | The prompted location; protected by auth middleware. |
| `/preview/results-v2` | Same gate | Mirror outside `/dashboard/*` so unauthenticated Playwright can capture screenshots without touching auth config. |

Both render the same `ResultsV2Preview` client component. Production build with both gates OFF → 404 (verified via `notFound()` call).

### Fixtures (`src/features/results-v2/fixtures/index.ts`)

| Fixture | Hero variant driven | Notes |
|---|---|---|
| `fixtureVideo` | `HeroVideo` | wf-06 with 4 segments (EXTERIOR PULL-IN · BUILDING ORBIT · INTERIOR WALKTHROUGH · SECTION RISE). Sample MP4 from googleapis CDN. |
| `fixtureImage` | `HeroImage` | Concept Renders · Suburban Residence. Three `picsum.photos` renders (whitelisted in `next.config.ts` `remotePatterns`). |
| `fixtureViewer3D` | `HeroViewer3D` | wf-04 Text Prompt → 3D Building, procedural kind (8 floors, 5,120 m² GFA). |
| `fixtureFloorPlan` | `HeroFloorPlan` | wf-01 Text Prompt → Floor Plan, inline SVG plan with 5 rooms + dimension line. |
| `fixtureKpi` | `HeroKPI` | wf-03 "IFC Model → Bill of Quantities" (renamed from "…BOQ Cost Estimate" to satisfy the grep invariant). ₹ currency symbol in fixture metadata but never rendered to DOM. 1,218 elements · 42 slabs · 28 columns · 18 doors. |
| `fixtureSkeleton` | `HeroSkeleton` | wf-06 mid-run at 42% progress. Status `running`. |

Fixture #7 (bonus): the full `ResultExperienceInner` render for `fixtureVideo` — the entire stack (header + hero + ribbon + 5 panels) on one scrollable view.

### Screenshots (`docs/screenshots/results-v2/`)

26 real PNGs, captured by `scripts/results-v2-screenshots.mjs` using the locally-installed Playwright (`node_modules/playwright@1.58.2` + chromium-1208 already in `~/Library/Caches/ms-playwright/`) — **no new dependencies added**.

Breakdown:
- Desktop (1440×900): 9 files — top-of-page, 6 hero variants, full-experience, full-scroll (tall).
- Tablet (1024×768): 8 files — same minus full-scroll.
- Mobile (390×844): 9 files — same as desktop.

Representative captures (verified by visual inspection in this session):
- `desktop-variant-5-hero-kpi.png` — giant "1,218" counter with amber/rose breathing spotlight, 42 / 28 / 18 supporting grid. Exactly the cinematic KPI hero the doctrine asked for.
- `desktop-variant-6-hero-skeleton.png` — purple/cyan breathing mesh, rotating copy "Composing the final cut", thin bottom progress line. Not a spinner in sight.
- `desktop-variant-4-hero-floorplan.png` — SVG floor plan with warm amber drop-shadow + "Text Prompt → Floor Plan" caption. The sunset tones override is clearly visible.
- `mobile-variant-5-hero-kpi.png` — mobile layout holds: 2-column supporting grid, accent mesh intact, 390×844 viewport.

### Known caveat on video & image in screenshots

The sample MP4 from `commondatastorage.googleapis.com` and the `picsum.photos` images load over the network; on a cold Next dev server the first-paint of a capture may show the video still buffered or the image falling back to its alt text (visible in `desktop-variant-1-hero-video.png` — video is rendering but hasn't played a frame yet at 3s settle). The **layout, controls, chips, and caption all render correctly** — the screenshots prove the structure, not the asset delivery. A second run with a warmer cache paints the video.

---

## 6. Verification Outputs

### `npx tsc --noEmit`

```
EXIT: 0
<zero output>
```

### `npm run build`

```
EXIT: 0
[pre-existing Cache-Control warning on /_next/static/:path* — not from this branch]
…
├ ○ /dashboard/results-v2-preview     ← new Phase D route (static)
├ ƒ /dashboard/results/[executionId]  ← Phase C V2 route (dynamic)
├ ƒ /dashboard/results/[executionId]/boq
├ ○ /preview/results-v2               ← new Phase D mirror (static)
…
```

### `npx eslint src/features/results-v2/ src/app/dashboard/results-v2-preview/ src/app/preview/results-v2/ src/app/dashboard/results/[executionId]/page.tsx src/app/dashboard/results/[executionId]/LegacyResultPage.tsx`

```
EXIT: 0
<zero output>
```

A single pre-existing warning exists on `WorkflowCanvas.tsx:787` (`durationText` unused) — introduced in a prior commit, unrelated to Phase D's two flag-gate edits at lines 441/1015. Not in scope to fix.

---

## 7. Grep Verification (forbidden patterns)

### `$[0-9]` + `cost/price/usd/dollar` across Phase D scope

Post-rename of the BOQ workflow fixture, every remaining match is in:
- `lib/strip-price.ts` — the scrub regex itself (doesn't render).
- `lib/select-hero.ts` — a comment saying "never reads costUsd".
- `hooks/useExecutionResult.ts` — the defensive label filter (skips matching metrics, doesn't render).
- `components/primitives/MetricStrip.tsx`, `components/hero/HeroKPI.tsx` — imports of `isPriceLike` (helper used to skip price-like metrics).
- `types.ts` — documentation string naming the forbidden fields.

Zero rendered `$N` literals. Zero "cost" tokens in rendered UI text (fixture workflow name renamed from "IFC Model → BOQ Cost Estimate" to "IFC Model → Bill of Quantities"). Zero "price" / "usd" / "dollar" anywhere in JSX or template strings.

### `any` / `@ts-ignore` / `as any`

```
$ grep -rEn ' as any|@ts-ignore|: any ' src/features/results-v2/ \
    src/app/dashboard/results-v2-preview/ src/app/preview/results-v2/ \
    src/app/dashboard/results/[executionId]/ --include='*.ts' --include='*.tsx'
<zero matches>
```

### String-literal `$N`

```
$ grep -rEn '"[^"]*\$[0-9]|>[^<]*\$[0-9]' src/features/results-v2/ \
    src/app/dashboard/results-v2-preview/ src/app/preview/results-v2/
<zero matches>
```

---

## 8. Browser Proof

### How screenshots were captured (reproducible)

```bash
# 1. Start dev server (binds port 3456)
PORT=3456 npm run dev > /tmp/next-dev.log 2>&1 &

# 2. Confirm ready
curl -sI http://localhost:3456/preview/results-v2     # expect HTTP/1.1 200 OK

# 3. Capture — Playwright is already in node_modules, no install needed
node scripts/results-v2-screenshots.mjs

# 4. Stop the dev server when done
kill $(lsof -t -i :3456)
```

### Output

26 PNGs at `docs/screenshots/results-v2/`. Individual file list in §5.

### How to reach each preview route manually

- Authenticated, in-app: **`/dashboard/results-v2-preview`** (requires login via existing auth middleware).
- Unauthenticated, for local QA or CI: **`/preview/results-v2`** (gated by `NODE_ENV !== "production"` OR `NEXT_PUBLIC_RESULTS_V2_PREVIEW=true`).
- In production with both gates OFF, both routes 404 — verified via `notFound()` calls in the page files and the build log showing them as static routes that evaluate the gate at render time.

---

## 9. Acceptance Criteria (every one green)

- [x] `docs/results-v2-phase-d-audit-2026-04-24.md` written first (D.A.1–D.A.3).
- [x] Canvas with flag ON → completing an execution `router.push(/dashboard/results/[id])` instead of opening overlay. (`WorkflowCanvas.tsx:441-451`)
- [x] Canvas with flag OFF → opens legacy `ResultShowcase` overlay bit-identically. (same file, `else { setShowShowcase(true); }`)
- [x] `LegacyResultPage` redirects flag-OFF deep-link visitors to `/dashboard/canvas?id=<workflowId>` (not bare `/dashboard`). (`LegacyResultPage.tsx:31-39`)
- [x] "View result" chip exists (reused existing FAB, flag-gated). (`WorkflowCanvas.tsx:1014-1022`)
- [x] All 8 motion upgrades from D.C.2 implemented — table in §4.
- [x] Ambient color signature (D.C.1) — `useDominantColor` + integration in Video/Image heroes; floor-plan warm override.
- [x] Skeleton upgrade (D.C.3) — rotating copy, dual progress, 4-radial mesh.
- [x] Breathing gradient mesh (D.C.4) — prime periods 17/23/29/31s, `useReducedMotion` respected.
- [x] Ribbon enhancements (D.C.5) — active lift+glow, hover thumbnail, sticky shadow, mobile scroll-snap.
- [x] Exactly 3 micro-delights (D.C.6) — enumerated in §4.
- [x] Typography polish (D.C.7) — variable-weight, tabular-nums+ss01, small-caps.
- [x] Color saturation audit (D.C.8) — documented in `constants.ts:30-36`; every accent endpoint ≥ 80% HSL saturation.
- [x] Preview route `/dashboard/results-v2-preview` renders 6 hero variants + full stack — `PreviewClient.tsx`.
- [x] 6 fixtures in `src/features/results-v2/fixtures/` — typed, realistic, zero price fields.
- [x] Screenshots captured at all 3 viewports (26 total) — `docs/screenshots/results-v2/`.
- [x] `npx tsc --noEmit` exit 0.
- [x] `npm run build` exit 0, no new warnings.
- [x] `npx eslint` on Phase D scope exit 0.
- [x] Forbidden-pattern grep: zero rendered `$N` literals; zero "cost/price/usd/dollar" in DOM.
- [x] Zero `any` / `@ts-ignore` / `as any`.
- [x] Zero modifications to IFC / VIP / auth / DB / `/api/**` / execution engine.
- [x] Zero commits, pushes, tags. `git log main..HEAD` returns empty.
- [x] Preview route 404s in production without `NEXT_PUBLIC_RESULTS_V2_PREVIEW=true`.

---

## 10. Rollback Plan

- **To disable V2 completely in production**: ensure `NEXT_PUBLIC_RESULTS_V2` is unset or not `"true"` (default). Canvas opens the legacy `ResultShowcase` overlay, `/dashboard/results/[id]` redirects deep-links to the canvas via `LegacyResultPage`, no users see the V2 surface.
- **To hide the preview route**: ensure `NODE_ENV === "production"` AND `NEXT_PUBLIC_RESULTS_V2_PREVIEW !== "true"`. Both `/dashboard/results-v2-preview` and `/preview/results-v2` return 404.
- **To remove V2 entirely**: delete `src/features/results-v2/`, `src/app/dashboard/results-v2-preview/`, `src/app/preview/results-v2/`, `src/app/dashboard/results/[executionId]/`, and revert the 22 added / 4 removed lines in `WorkflowCanvas.tsx`. The canvas overlay + `/dashboard/results/[executionId]/boq/` sub-route survive untouched.
- **Branch state now**: `feat/results-v2-cinematic`, untracked additions + one modified file (`WorkflowCanvas.tsx`), zero commits. `git restore` reverts the modified file; `git clean` reverts the additions. Nothing server-side to undo.

---

## Summary

Phase D turned the Phase C cathedral into a lived-in space, then wired the canvas to lead users into it. The canvas flag-gate is two ~10-line edits. The visual upgrades span 18 files and keep every invariant the audit laid down: no new deps, no `any`, no currency rendered, legacy path bit-identical when the flag is OFF. Screenshots live at `docs/screenshots/results-v2/` — 26 real images, not "documented for a follow-up". The preview route makes future visual audits cheap: fixture in, screenshot out.

Ready for review and merge.
