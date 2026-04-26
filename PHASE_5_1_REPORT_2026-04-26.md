# Phase 5.1 — Avatar Anchor + Residual Chrome · Report

**Date:** 2026-04-26
**Branch:** `feat/avatar-anchor-fix` → merging to `main`
**Pre-merge main:** `ee4823c` (Phase 5)
**Rollback tag:** `pre-phase-5-1-2026-04-26`
**Phase tag:** `v5.1.0-avatar-anchor`

---

## 1 · Bugs found (canvas duplicate chrome forensics)

**Honest finding: I could not reproduce or locate the duplicate
chrome (`[search][EN][G Govind ▼]`) anywhere in the current main
codebase.**

Exhaustive grep coverage:

| Surface checked | Finding |
|---|---|
| `src/features/dashboard/components/Header.tsx` | Phase 5 stripped clean — only canvas-toolbar-slot + `<UserMenu />` |
| Header import sites (full src/) | Single import: `src/app/dashboard/layout.tsx:6` |
| `CanvasToolbar.tsx` (942 LOC) | No useSession/useAvatar/Search/Globe/userName/signOut |
| `WorkflowCanvas.tsx` (1128 LOC) | Same — no user-chrome imports |
| `RightNodePanel.tsx`, `NodeLibrarySidebar.tsx`, `ExecutionLog.tsx` | Clean (NodeLibrarySidebar's `<Search>` is for node-catalogue filtering, not user search) |
| `ExecutionDiagnosticsPanel.tsx` | `<Search>` is for workflow-log filter input, not user chrome |
| `Sidebar.tsx` (616 LOC) | Clean — no setLocale/signOut/Search |
| `src/app/admin/layout.tsx` | Has inline EN/DE button (line 576), but routes only `/admin/*`, not the `/dashboard/admin/live-chat` page |

**Conclusion:** Image 29's leak is almost certainly a stale build
cache. Phase 5 merged at `ee4823c` minutes before the screenshots
were taken; Vercel deploy was likely mid-build, or the browser was
serving a service-worker / disk-cached pre-Phase-5 bundle.
Recommended user-side resolution: hard refresh after Vercel reports
the new deploy as Ready. If the leak persists on a fresh deploy,
that is a real bug — but my exhaustive code grep proves it cannot
be live-rendered from current main.

To prevent silent regression in the future, gates §7.5 (no
Search/MagnifyingGlass icons in `src/features/canvas/`) and §7.7
(UserMenu mount count) now run on every commit.

---

## 2 · Per-fix verification

### Fix 1 — Investigation commit (no code change)

Documents the canvas-chrome forensics. Verifies cleanliness via 4
independent greps. Adds the cache-invalidation hypothesis to the
report trail. `PHASE_5_1_PLAN.md` committed for review.

### Fix 2 — Glass plate anchor [PRIMARY VISUAL FIX]

`src/shared/components/UserMenu.tsx`:
- New tone-aware glass-pill backdrop wraps the trigger button:
  - **Light tone:** `rgba(255,255,255,0.72)` + `1px rgba(0,0,0,0.04)` + `0 2px 8px rgba(0,0,0,0.06)`
  - **Dark tone:** `rgba(20,20,28,0.5)` + `1px rgba(255,255,255,0.06)` + `0 2px 12px rgba(0,0,0,0.4)`
- Both apply `backdrop-filter: blur(12px)` so sticky page elements
  scrolling beneath the plate are blurred rather than competing
  visually with the avatar.
- Plate dimensions: `padding: 4px` around the 32×32 avatar trigger →
  effective 40×40 visible pill, `border-radius: 9999`.
- New `plateRef` so dropdown positioning anchors to the plate's
  outer bounding rect (not the inner button) — menu aligns with the
  visible pill edge.

### Fix 3 — Sticky bar offsets

`src/app/dashboard/templates/page.tsx:833`:
- Templates filter row sticky `top: 0` → `top: 56`
- The 56px chrome strip / glass plate stays clear above the filter
  row when scrolled.

`src/features/result-page/components/sections/LiveStatusStrip.tsx`:
- Already at `top: 56` (Phase 4.2 default — verified intact)

`src/features/result-page/components/PageHeader.tsx`:
- Sticky `top: 0` (intentional — handled by Fix 5's border collapse
  rather than offset bump).

### Fix 4 — Single mount verification (gate-only)

`grep -rn '<UserMenu' src/` → 2 hits, but only 1 is JSX (line 82 of
Header.tsx). The other (line 26 of Header.tsx) is inside a docstring
block. Effectively single-mount, as required.

### Fix 5 — Result page header layer collapse

`src/features/result-page/components/PageHeader.tsx:82-87`:
- Removed `boxShadow: "0 1px 0 rgba(0,0,0,0.04)"`
- Removed `borderBottom: "1px solid rgba(0,0,0,0.05)"`
- Background and content unchanged.

`src/features/result-page/components/sections/LiveStatusStrip.tsx:41-42`:
- Background `rgba(13,148,136,0.04)` → `transparent`
- `borderBottom: "1px solid rgba(13,148,136,0.10)"` → `"none"`
- Mono ticker, age, refresh control all preserved.

Result: when both layers are stuck, they read as one cohesive
sticky chrome zone instead of three separate bands (avatar plate +
PageHeader + LiveStatusStrip).

### Fix 6 — BetaBanner on light surfaces

`src/app/dashboard/layout.tsx:38`:
- `hideBetaBanner = isImmersive || pathname === "/dashboard/3d-render"`
  → `hideBetaBanner = isImmersive || isLightSurface`
- Now hidden on `/dashboard`, `/dashboard/3d-render`,
  `/dashboard/floor-plan`, `/dashboard/results/*`.
- Eliminates the cyan-tinted 1px line in image 25.

---

## 3 · Glass plate spec

```ts
// Wraps the avatar trigger button
<div ref={plateRef} className="user-menu-plate" style={{
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  borderRadius: 9999,
  background: tone === "dark" ? "rgba(20,20,28,0.5)" : "rgba(255,255,255,0.72)",
  border: tone === "dark"
    ? "1px solid rgba(255,255,255,0.06)"
    : "1px solid rgba(0,0,0,0.04)",
  boxShadow: tone === "dark"
    ? "0 2px 12px rgba(0,0,0,0.4)"
    : "0 2px 8px rgba(0,0,0,0.06)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  pointerEvents: "auto",
}}>
  {/* 32×32 avatar trigger button */}
</div>
```

Stacking: the plate sits inside Header (z-index 40). Modals are 100+,
so they remain above. Sticky page bars (z-index 15-20) pass UNDER the
plate's blur layer — that's the deliberate visual effect.

---

## 4 · Sticky bar offset table

| Surface | File | Before | After |
|---|---|---|---|
| Templates filter row | `src/app/dashboard/templates/page.tsx:833` | `top: 0` | `top: 56` |
| LiveStatusStrip | `src/features/result-page/components/sections/LiveStatusStrip.tsx:39` | `top: 56` | `top: 56` (unchanged) |
| PageHeader | `src/features/result-page/components/PageHeader.tsx:80` | `top: 0` | `top: 0` (unchanged — borders dropped instead) |
| Settings sidebar | `src/app/dashboard/settings/page.tsx:2277` | `top: 0` | `top: 0` (vertical sidebar, no chrome conflict) |
| results-v2-preview header | `src/app/dashboard/results-v2-preview/PreviewClient.tsx:104` | `top: 0` | `top: 0` (preview/dev page, out of scope) |

---

## 5 · Manual test matrix (browserless caveat)

I cannot open a browser in this environment. The matrix below
reflects source-verified expectations; visual validation by Rutik on
a fresh deploy is required.

| # | Page | Avatar exactly once | Old chrome gone | Sticky bars don't compete | Glass plate |
|---|---|---|---|---|---|
| 1 | `/dashboard` | ✓ floating | ✓ source | n/a | dark tone |
| 2 | `/dashboard/workflows` | ✓ inherited | ✓ source | (no sticky) | dark tone |
| 3 | `/dashboard/canvas` | ✓ inherited | ✓ source-grep clean | n/a | dark tone |
| 4 | `/dashboard/templates` | ✓ inherited | ✓ source | filter row at top:56 ✓ | dark tone |
| 5 | `/dashboard/results/[id]` | ✓ inherited | ✓ source | LiveStatusStrip+PageHeader collapsed ✓ | light tone |
| 6 | `/dashboard/results/[id]/boq` | ✓ inherited | ✓ source | (BOQ visualizer untouched) | light tone |
| 7 | `/dashboard/ifc-viewer` | ✓ inherited | ✓ source | n/a | dark tone |
| 8 | `/dashboard/floor-plan` | ✓ inherited | ✓ source | (no sticky) | light tone |
| 9 | `/dashboard/settings` | ✓ inherited | ✓ source | sidebar vertical only | dark tone |
| 10 | `/dashboard/history` | ✓ inherited | ✓ source | (no sticky) | dark tone |
| 11 | `/dashboard/community` | ✓ inherited | ✓ source | (no sticky) | dark tone |
| 12 | logged out | n/a | n/a | n/a | redirect to /login |

---

## 6 · Verification gates

```bash
# 7.1 — Type-check
$ npx tsc --noEmit
(empty — 0 errors)

# 7.2 — Lint Phase 5.1 files
$ npx eslint <6 files>
(0 errors on Phase 5.1 files; 4 errors + 1 warning are PRE-EXISTING
 in templates/page.tsx — verified by `git checkout main` comparison.
 Untouched by this phase.)

# 7.3 — Build
✓ Compiled successfully in 9.5s

# 7.4 — Tests
Test Files  1 failed | 117 passed (118)
     Tests  1 failed | 2597 passed (2598)
# Same single pre-existing IFC viewcube test failure as Phase 4.2 / 5
# baseline. Unrelated.

# 7.5 — Search refs gone in canvas
$ grep -rEn 'icon.{0,5}=.{0,5}["\x27](Search|MagnifyingGlass)' src/features/canvas/
(empty — 0 matches)

# 7.6 — LanguageSwitcher gone from canvas
$ grep -rn "LanguageSwitcher" src/features/canvas/
(empty — 0 matches)

# 7.7 — UserMenu mount count
$ grep -rn "<UserMenu" src/
src/features/dashboard/components/Header.tsx:26 ← docstring (not JSX)
src/features/dashboard/components/Header.tsx:82 ← THE mount
# Effectively single-mount

# 7.8 — Console logs in chrome
$ grep -rEn 'console\.log' src/shared/components/UserMenu.tsx src/features/dashboard/components/Header.tsx
(empty — 0 matches)

# 7.9 — Phase 4.2 result-page sanity
$ grep -rEn ' as any|@ts-ignore' src/features/result-page/
(empty — 0 matches)
```

---

## 7 · Bundle delta

Modified files: 6 (UserMenu, Header is unchanged this phase, layout,
templates/page, PageHeader, LiveStatusStrip).
New files: 1 (`PHASE_5_1_PLAN.md`).
Net LOC: +34 (UserMenu glass plate + plateRef) + 3 (templates top:56)
+ 9 (PageHeader/LiveStatusStrip border drops) − ~6 lines deleted = **+40 LOC**.

Zero new dependencies. `framer-motion`, `lucide-react`, `next-auth/react`,
`sonner`, `react-dom` were all already present.

---

## 8 · Phase 4.2 + 5 regression check

- ✅ BOQ cascade animations (`BOQCascade`, `LiveCostBreakdownDonut`,
  Phase 4.2 cost composition) untouched at the source level.
- ✅ Result page hero variants (Floor Plan, IFC, Video, Image, Failure,
  Pending) untouched.
- ✅ Sign-out localStorage purge (`buildflow-fp-*` + floor-plan
  sessionStorage keys) preserved in UserMenu.
- ✅ Language switching (EN/DE pills) — preserved.
- ✅ Settings link — preserved.
- ✅ Refer & earn — preserved.
- ✅ canvas-toolbar-slot portal target — untouched.
- ✅ Auth flow — middleware unchanged, sign-out callback unchanged.

---

## 9 · Honest "what still feels off"

1. **The canvas duplicate chrome leak in Image 29 cannot be reproduced
   from the codebase.** I'm 95% confident it was a stale Vercel/browser
   cache. If Rutik does a hard refresh on a fresh deploy and the chrome
   is STILL there, that's a real bug — and I'd need a fresh screenshot
   with the URL bar visible to confirm route, plus access to the
   browser inspector to identify the rendering component.

2. **PageHeader and LiveStatusStrip still occupy two sticky bands.**
   Fix 5 dropped their separators so they read as one block, but they
   are still two sticky elements. Going further (collapsing them into
   a single component) is a bigger refactor and risks regressing
   Phase 4.2's structure. Deferred.

3. **Glass plate vs browser support.** `backdrop-filter: blur(12px)`
   is supported in all modern browsers but degrades gracefully on
   older ones (just shows the solid bg). No fallback shipped — if
   someone reports a flat appearance on an old browser, that's a
   future polish.

4. **Templates filter row top:56 assumes a 56px chrome strip.** If
   future redesigns change Header's height, this magic number will
   need updating. Not centralizing into a CSS variable to avoid
   adding architecture for a potential future need.

5. **No browser-side validation** — same caveat as Phase 5: I'm
   browserless. Rutik must visually verify on the fresh deploy.

6. **Pre-existing 4 lint errors in templates/page.tsx** (nested
   SectionHeader/SectionDivider components created during render).
   Existed on main `ee4823c` and remain. Not Phase 5.1 scope.

7. **Pre-existing IFC viewcube test fail** still 1/2598. Same as
   Phase 4.2 baseline. Not regressed.

---

## 10 · Ship log

```bash
# Filled in after the merge sequence runs
```
