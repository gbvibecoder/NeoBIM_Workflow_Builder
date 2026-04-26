# Phase 5.1 — Avatar Anchor + Residual Chrome · Plan

**Branch:** `feat/avatar-anchor-fix` (off `main` @ `ee4823c`)
**Date:** 2026-04-26

## Pre-flight findings

### Canvas duplicate chrome — root cause (honest)

Per the brief, Image 29 shows a `[search][EN][G Govind ▼]` cluster on the
canvas page. **This chrome does NOT exist in the current main codebase.**

Verified by exhaustive grep:
- `src/features/dashboard/components/Header.tsx` is imported by **exactly one
  caller** (`src/app/dashboard/layout.tsx:6`), and Phase 5 stripped its
  search/EN/profile-dropdown JSX completely.
- No other component grep-matches the OLD chrome pattern (avatar + name
  + chevron + lucide Search + EN literal):
  - `CanvasToolbar.tsx` (942 LOC) — only Save/Run/Mode/Share/Zoom/AI buttons.
    It portals into `canvas-toolbar-slot` inside Header.
  - `WorkflowCanvas.tsx` (1128 LOC) — no `useSession`, no `signOut`, no
    `useAvatar`, no `Header` import.
  - `RightNodePanel.tsx`, `NodeLibrarySidebar.tsx`, `ExecutionLog.tsx`,
    `ExecutionDiagnosticsPanel.tsx`, `Sidebar.tsx` — none have the pattern.
  - `src/app/admin/layout.tsx` does have an inline EN/DE button at line 576,
    but that layout serves `/admin/*` (platform admin console), NOT the
    dashboard. `/dashboard/admin/live-chat` uses dashboard/layout.tsx.

**Conclusion:** Image 29's leak is almost certainly **a stale build cache
serving the pre-Phase-5 bundle.** Phase 5 was merged at `ee4823c` minutes
before the screenshots were taken. Vercel deploy may have been mid-build,
or the browser was serving a service-worker / disk-cached old bundle.

Recommended user-side fix: hard refresh (Cmd+Shift+R) once Vercel reports
the new deploy as Ready. If the chrome STILL appears after a hard refresh
on a fresh deploy, that's a real bug — but my exhaustive code grep
indicates it can't be live-rendered from the current codebase.

Phase 5.1 will still ship verification gates (§7.5–§7.7) that PROVE no
old chrome exists, so any future regression would be caught immediately.

### Sticky bars audit

Found via `grep -rn 'position.*sticky' src/features/`:
- `LiveStatusStrip.tsx` — sticky `top:0` (Phase 4.2 work)
- `PageHeader.tsx` — Phase 4.2 result page header, NOT sticky (renders in flow)
- Templates page filter row — need to check current position spec

### Avatar mount audit

Single mount path verified:
```
src/app/dashboard/layout.tsx → <Header /> → <UserMenu />
```

No duplicate `<UserMenu />` or `<UserMenu` invocations anywhere else.

## Fix plan

### Fix 1 — Document the canvas chrome investigation

Since I cannot reproduce or find the bug in code, this fix is a
**verification commit** that:
- Adds `grep` gates §7.5 and §7.6 (already in brief) to PERMANENTLY
  catch any reintroduction of search/EN/profile chrome on canvas
- Documents the cache-invalidation hypothesis in the report
- No code changes (cannot fix what doesn't exist in code)

### Fix 2 — Avatar glass plate anchor [PRIMARY FIX]

Wrap the avatar trigger in a tone-aware glass backdrop pill.

`src/shared/components/UserMenu.tsx` modifications:
- New optional `withGlassPlate` prop (default `true`)
- When enabled, the trigger sits inside a slightly larger glass pill:
  - Light tone: `rgba(255,255,255,0.72)` + `backdrop-filter: blur(12px)`
    + `border: 1px solid rgba(0,0,0,0.04)` + `box-shadow: 0 2px 8px rgba(0,0,0,0.06)`
  - Dark tone: `rgba(20,20,28,0.5)` + `backdrop-filter: blur(12px)`
    + `border: 1px solid rgba(255,255,255,0.06)` + `box-shadow: 0 2px 12px rgba(0,0,0,0.4)`
  - `border-radius: 999px`, `padding: 4px`
- Position is unchanged (still inside Header chrome strip in flex flow);
  the glass plate gives the avatar visual anchoring so sticky bars below
  pass UNDER the plate's blur instead of competing with it.
- z-index 50 on the wrapper. Modals stay above (modal z-index = 100+).

### Fix 3 — Sticky bar offsets

`src/features/result-page/components/sections/LiveStatusStrip.tsx`:
- Change `top: 0` → `top: 56px` so it sticks BELOW the chrome strip /
  glass plate, not flush with viewport top. The avatar zone stays clear.

Templates page sticky filter:
- Audit `src/app/dashboard/templates/page.tsx` for sticky position rules
- Apply the same `top: 56px` offset

PageHeader (result page):
- Confirmed NOT sticky in source — no change needed

### Fix 4 — Single mount verification (gate-only)

Already verified in pre-flight. Adds `grep -rn '<UserMenu' src/` as
gate §7.7 — must be exactly 1 result.

### Fix 5 — Result page header layer collapse

`src/features/result-page/components/sections/LiveStatusStrip.tsx`:
- Remove the visible top border between PageHeader area and the strip
- Confirm the strip background blends with the page (no dark tint)

`src/features/result-page/components/PageHeader.tsx`:
- Audit for any visible bottom border that creates a hard layer
- Remove if it competes with LiveStatusStrip

### Fix 6 — Cross-page sweep

For the thin horizontal line at top in Image 25 — likely the Header's
old `borderBottom`, but Phase 5 set it to `none`. Verify.

Audit any remaining sticky bars across all 12 pages:
- `/dashboard/workflows` — filter/sort rows
- `/dashboard/history` — filter rows
- `/dashboard/community` — filter rows

## Sacred preservation list

`src/features/result-page/**` — only LiveStatusStrip + PageHeader for
Fixes 3 + 5; everything else is sacred Phase 4.2 work.
`src/features/boq/components/**`
`src/features/floor-plan/components/FloorPlanViewer.tsx`
`src/features/ifc/components/IFCViewerPage.tsx`
`src/middleware.ts`, `src/lib/auth.ts`
`prisma/schema.prisma`, `src/app/api/**`

## Risk inventory

- **Glass plate on dark canvas**: must NOT obscure the React Flow grid
  underneath — keep `rgba(20,20,28,0.5)` so dot grid shows through
  blurred at 50% opacity. Looks intentional.
- **Mobile**: glass plate width must not push UserMenu offscreen.
  Existing `right: Math.max(12, ...)` clamp protects us.
- **Reduced-motion**: glass plate has no animation; static appearance.
- **z-index race**: modal layers use 100+; UserMenu glass plate at 50;
  LiveStatusStrip after Fix 3 sits at lower z-index inside the page
  flow, well below 50.
- **Phase 4.2 cascade animations**: untouched. LiveStatusStrip's only
  change is `top: 56` instead of `top: 0`. Cascade timing unaffected.

— END PLAN —
