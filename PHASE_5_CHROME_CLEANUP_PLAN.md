# Phase 5 — Chrome Cleanup · Plan of Attack

**Branch:** `feat/profile-first-chrome` (off `main` @ `3620fc4`)
**Date:** 2026-04-26

## Layout architecture (audited)

The codebase uses `src/app/dashboard/...` (not `(dashboard)` route group). All
authenticated pages inherit a single layout: **`src/app/dashboard/layout.tsx`**.
That layout mounts:
- `<Sidebar />` (left dark rail — preserve)
- `<BetaBanner />` (conditional flow strip — preserve)
- `<Header theme={...} />` (the dark grey strip we're killing)
- `{children}` (the page)

`Header` is imported **only** by `src/app/dashboard/layout.tsx`. Fix the layout
and Header, and every authenticated route inherits the new chrome for free.

## What's inside the current Header

`src/features/dashboard/components/Header.tsx` (469 LOC) contains:
1. **Dark glass background** (`rgba(10,12,20,0.8)` + `backdrop-filter: blur(20px)`)
2. **Search button** — opens `Cmd+K` command palette via synthetic keydown
3. **EN/DE language toggle** (inline via `useLocale().setLocale`)
4. **Vertical separator**
5. **Profile dropdown** — avatar + name + chevron + portal dropdown with
   Settings, Refer & Earn, Sign out
6. **`canvas-toolbar-slot`** — `<div id="canvas-toolbar-slot">` portal target
   used by `CanvasToolbar.tsx:234`. Critical.
7. **Title/subtitle props** — currently unused by the lone caller (layout doesn't pass them)
8. **`theme` prop** — `"dark" | "light"` for `/dashboard/3d-render`
9. **`floating` prop** — for immersive `/dashboard` landing

## Locales

Only **EN** and **DE** exist (`src/lib/i18n.ts:3`). The brief mentions HI/MR — those
don't exist in the codebase. UserMenu will show two pills only.

## Approach decision (Fix 2)

**Approach A — keep Header.tsx as transparent slot.** Selected.

Reasons:
- `canvas-toolbar-slot` portal target must persist; deleting Header would
  break `CanvasToolbar.tsx`.
- Single import site means refactoring Header is contained.
- Keeping Header preserves immersive (`floating`) behavior for `/dashboard`
  landing where the 3D scene fills the viewport.
- `theme` prop already handles dark vs light surface — UserMenu inherits this.

Header becomes a transparent ~52px strip:
- `background: transparent`, no border, no blur
- Renders `canvas-toolbar-slot` (unchanged) + `<UserMenu />` (new) on the right
- No search, no inline language toggle, no inline profile dropdown JSX
- Net result: the dark grey strip is gone visually, but the layout slot remains
  for portal targets and chrome elements.

## Migration plan (sub-fixes, each = one commit)

1. **Fix 1 — `UserMenu` component** at `src/shared/components/UserMenu.tsx`.
   Avatar trigger (32×32), portal dropdown (240px), tone-aware (dark/light),
   identity row → divider → language pills → divider → Settings → Refer & Earn
   → Sign out. Reduced-motion respected, ARIA on trigger + menu, click-outside,
   Escape closes, focus return.

2. **Fix 2 — Strip Header chrome.** Remove dark bg, search button, inline
   language toggle, inline profile dropdown JSX. Header now mounts only:
   `canvas-toolbar-slot` + `<UserMenu theme={theme} />`. Title/subtitle/floating/theme
   props preserved for backward compat (immersive mode still works).

3. **Fix 3 — Verify search references gone** in shell components. Grep for
   remaining `Search` icon references in `Header.tsx`. Check no orphaned
   `nav.searchPlaceholder` i18n keys are still used (will keep i18n keys
   themselves intact — used by `<input>` elsewhere if present).

4. **Fix 4 — LanguageSwitcher fold-in verification.** Confirm dashboard
   `Header.tsx` no longer calls `useLocale().setLocale` directly (UserMenu owns
   it now). Keep `src/shared/components/ui/LanguageSwitcher.tsx` — it's used by
   landing/auth/light pages, NOT the dashboard chrome.

5. **Fix 5 — Verify UserMenu on all 12 pages.** Since one layout serves all
   12, this reduces to: confirm `src/app/dashboard/layout.tsx` mounts Header
   (which mounts UserMenu) on every authenticated route. Any custom layouts
   in `src/app/dashboard/*/layout.tsx`?

6. **Fix 6 — Polish pass.** Mobile breakpoint adjustments in UserMenu
   (28×28 avatar at <768px, viewport-clamped dropdown). Dark surfaces
   (canvas, IFC viewer) — UserMenu adapts via `tone="dark"` prop. Sidebar
   bottom user card review (already lean — likely no-op).

## Sacred preservation list

`src/features/result-page/**` — Phase 4.2, untouchable.
`src/features/boq/components/**`
`src/features/floor-plan/components/FloorPlanViewer.tsx`
`src/features/ifc/components/IFCViewerPage.tsx` + `Viewport.tsx`
`src/features/canvas/**`
`src/features/execution/**`
`prisma/schema.prisma`
`src/app/api/**`
`src/middleware.ts`
`src/lib/auth.ts`

## Functional preservation

- **Refer & Earn** in profile dropdown is existing functionality —
  preserve in new UserMenu (brief didn't list it, but removing it is scope creep).
- **Cmd+K command palette** still works via global keydown handler in
  `<CommandPaletteLoader />`. Removing the search BUTTON doesn't disable
  the keyboard shortcut.
- **Sign-out localStorage cleanup** — preserve the `buildflow-fp-*` clearing
  loop and sessionStorage purge (cross-user-data-leak prevention on shared
  devices).

## Risk inventory

- **Result page regression:** Header is rendered ABOVE result page content.
  As long as Header keeps its ~52px height reservation, the result page's
  sticky `<PageHeader />` won't collide with UserMenu. Verify.
- **Canvas toolbar portal:** `canvas-toolbar-slot` div ID must stay inside
  Header. Verify portal target still resolves.
- **Immersive landing (`/dashboard`):** floating mode renders Header with
  `position: absolute` over the 3D scene. UserMenu must support this — it
  becomes a single floating top-right pill on a dark background.
- **Light theme (`/dashboard/3d-render`):** UserMenu must read on a cream
  background — borders + text contrast adapt.

— END PLAN —
