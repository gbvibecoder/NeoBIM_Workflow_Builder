# Phase 5 — Chrome Cleanup · Report

**Date:** 2026-04-26
**Branch:** `feat/profile-first-chrome` → merging to `main`
**Pre-merge commit on main:** `3620fc4` (Phase 4.2)
**Rollback tag:** `pre-phase-5-chrome-2026-04-26`
**Phase tag:** `v5.0.0-chrome-cleanup`

---

## 1 · Architecture decision

**Approach A — Header.tsx kept as transparent slot.**

Reasons (audited before any code was touched):

- `src/features/canvas/components/toolbar/CanvasToolbar.tsx:234` portals
  the canvas-page toolbar into `<div id="canvas-toolbar-slot">` inside
  `Header`. Deleting Header would break the canvas toolbar render.
- `Header` is imported by exactly one caller — `src/app/dashboard/layout.tsx`.
  Refactoring is contained.
- The existing `floating` prop already supports immersive landing where
  the 3D scene fills the viewport; preserving it costs nothing.

`Header` shrunk from **469 LOC → 56 LOC**. It now mounts only the
`canvas-toolbar-slot` div + the new `<UserMenu />`. Background, border,
backdrop-blur are gone — the bar still reserves ~52px in the flex column
so page content does not collide with the floating UserMenu.

---

## 2 · Per-fix verification

### Fix 1 — `src/shared/components/UserMenu.tsx` (NEW, 358 LOC)

Built from scratch. Uses already-imported deps only:
`framer-motion` (motion + AnimatePresence + useReducedMotion),
`lucide-react` (Settings, LogOut, Gift, Copy, Check),
`next-auth/react` (useSession, signOut), `react-dom` (createPortal),
internal hooks (`useLocale`, `useAvatar`).

Behavior verified by source read:
- 32×32 avatar trigger with light/dark `tone` palette
- Click → portal dropdown anchored top-right, 240px
- Dropdown sections: identity row → divider → EN/DE language pills →
  divider → Settings → Refer & Earn → divider → Sign out (gentle amber)
- Reduced-motion: `useReducedMotion()` → instantaneous appear, no slide
- Click-outside (capture phase, defeats ReactFlow stopPropagation) closes
- Escape closes + returns focus to trigger
- ARIA: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`,
  `role="menu"`, `role="menuitem"`, `role="radiogroup"` on language pills
- Sign-out purges `buildflow-fp-*` localStorage keys + floor-plan
  sessionStorage to prevent cross-user data leak (preserves existing
  Header behavior)
- `signOutBusy` prevents double-click during redirect
- `referralCopied` 2-second debounce on copy success

### Fix 2 — `src/features/dashboard/components/Header.tsx` (469 → 56 LOC)

Kept structurally; chrome stripped:
- Search button — DELETED
- Inline EN/DE toggle — DELETED
- Inline portal profile dropdown — DELETED (replaced by UserMenu)
- `title`/`subtitle` props — DELETED (zero callers passed them)
- Dark glass background + border + backdrop-blur — DELETED
- 50-line `palette` object — DELETED (UserMenu owns its own palette)

Preserved:
- `canvas-toolbar-slot` div ID (CanvasToolbar.tsx still portals into it)
- `floating` prop (immersive landing absolute positioning)
- `theme` prop (passed through to UserMenu's `tone`)
- `dashboard-header` className (legacy mobile rules still apply for
  44×44 tap targets — preferable to brief's 28×28)

UserMenu wrapper has defensive inline `background: transparent; border:
none` to defeat the legacy `.dashboard-header > div:last-child` mobile
rule in `globals.css:2069` that paints a green status pill on the
settings page (would otherwise leak through).

### Fix 3 — `src/lib/i18n.ts`

Removed dead `nav.searchPlaceholder` key from EN (line 24) and DE (line
2893) dictionaries. `TranslationKey` is `keyof typeof en` so the union
tightens automatically. Verified via strict grep — zero callers
remained after Fix 2 stripped the search button.

Page-specific search keys (`admin.users.searchPlaceholder`,
`workflows.searchPlaceholder`, `command.searchPlaceholder`,
`admin.demoRequests.searchPlaceholder`) are unrelated and preserved —
they back actual search inputs on those pages.

### Fix 4 — LanguageSwitcher fold-in (verification only, no commit)

`LanguageSwitcher.tsx` was never imported by `Header.tsx` or
`layout.tsx`. The dashboard chrome had its own inline `useLocale().setLocale`
call. Confirmed via grep:

```
src/app/page.tsx:18                          ← public landing
src/app/(auth)/register/page.tsx:10          ← auth
src/app/(auth)/login/page.tsx:11             ← auth
src/features/landing/components/light/LightNav.tsx:8  ← public landing
```

All 4 consumers are public/auth pages, not the authenticated dashboard
chrome. `LanguageSwitcher.tsx` is preserved (deletion would break those
4 pages). UserMenu's language pills call `useLocale().setLocale` directly
— same setter path — so the fold-in is by-API not by-component.

### Fix 5 — `src/app/dashboard/layout.tsx`

Single layout file serves all **19** authenticated routes (brief said
12 — actual count higher, all covered):

```
/dashboard                              /dashboard/billing
/dashboard/3d-render                    /dashboard/canvas
/dashboard/admin/live-chat              /dashboard/community
/dashboard/analytics                    /dashboard/compare
/dashboard/feedback                     /dashboard/floor-plan
/dashboard/history                      /dashboard/ifc-viewer
/dashboard/results-v2-preview           /dashboard/results/[executionId]
/dashboard/results/[executionId]/boq    /dashboard/settings
/dashboard/templates                    /dashboard/test-results
/dashboard/workflows
```

`isLightSurface` widened from a single `=== "/dashboard/3d-render"`
check to also match `/dashboard/floor-plan` and any
`/dashboard/results/*` path (Phase 4.2 cream surface). UserMenu
inherits `tone="light"` on those routes, `tone="dark"` everywhere else.

### Fix 6 — Polish pass

- **BetaBanner regression prevented.** Widening `isLightSurface` would
  have hidden BetaBanner on result pages (Fix 5 unintended side effect).
  Decoupled into separate `hideBetaBanner = isImmersive || pathname ===
  "/dashboard/3d-render"` predicate that exactly matches original
  visibility. Phase 4.2 result page → BetaBanner still visible.
- **Mobile tap target.** Legacy `mobile-responsive.css:778` rule
  `.dashboard-header button { min-width:44px; min-height:44px }`
  forces my 32×32 trigger to 44×44 on phones. WCAG / Apple HIG
  minimum. Preferable to the brief's suggested 28×28; embraced.
- **Dropdown viewport-clamp.** `right: Math.max(12, ...)` and
  `maxWidth: "calc(100vw - 24px)"` prevent edge clipping at 375px.
- **Sidebar slim — no-op.** Audited. Sidebar bottom card is already
  lean (usage counter + upgrade CTA, no avatar). No changes needed.
- **Reduced-motion.** `useReducedMotion()` → `transition: { duration: 0 }`
  on dropdown, `transition: "none"` on trigger. No slide, no scale, no
  hover transitions when system pref is set.

---

## 3 · UserMenu spec

```ts
interface UserMenuProps {
  tone?: "light" | "dark"; // default "light"
}
```

Trigger:
- 32×32 round avatar button (44×44 on mobile via legacy CSS rule)
- Light tone: `rgba(255,255,255,0.6)` bg, `rgba(0,0,0,0.08)` border,
  cream avatar inside (#E0E7FF → #C7D2FE gradient, indigo glyph)
- Dark tone: `rgba(255,255,255,0.04)` bg, `rgba(255,255,255,0.12)` border,
  amber avatar inside (existing palette, preserves continuity with the
  legacy header's avatar treatment)
- Hover: border darkens, bg lightens, no transform on touch devices
  (reduced-motion). Mousedown: `scale(0.97)` press feedback.

Dropdown:
- 240px wide, max `100vw - 24px` clamp
- White surface `rgba(255,255,255,0.97)` + 12px backdrop-blur
- Soft shadow `0 8px 24px rgba(0,0,0,0.08)`
- Slide 8px from above with 120ms ease (instant under reduced-motion)
- z-index 9999 (above modals; matches legacy header dropdown z-index)

Sections:
1. **Identity row** (12×14 padding) — 36×36 avatar + name (max width
   ellipsis) + email (mono, secondary, ellipsis)
2. **1px divider** `rgba(0,0,0,0.06)`
3. **`LANGUAGE` mono caption** + 2 inline pills (EN, DE). Active pill:
   teal border + tinted bg + teal text. Click → `setLocale()` from
   `useLocale` — same path the old inline toggle used.
4. **1px divider**
5. **Settings** menuitem → router.push("/dashboard/settings")
6. **Refer & earn** menuitem → fetches `/api/referral`, copies
   `https://trybuildflow.in/register?ref=<code>` to clipboard, shows
   "Link copied" + `<Check>` for 2s
7. **1px divider**
8. **Sign out** menuitem (color `#A05E1A` amber, not red) — purges
   `buildflow-fp-*` localStorage and floor-plan sessionStorage, calls
   `signOut({ callbackUrl: "/login" })`. Disabled state during
   in-flight redirect.

Keyboard:
- Trigger: focusable, Enter/Space opens
- Open: Escape closes + returns focus to trigger
- Tab: standard browser tab through menuitems (full ARIA arrow-key
  pattern is a polish for a future phase)

ARIA:
- Trigger: `aria-haspopup="menu"`, `aria-expanded={open}`,
  `aria-controls="user-menu-dropdown"`, `aria-label="Open profile menu"`
- Dropdown: `id="user-menu-dropdown"`, `role="menu"`,
  `aria-label="Profile menu"`
- Menuitems: `role="menuitem"`
- Language pills: `role="radiogroup" aria-label="Language"` parent,
  `role="radio" aria-checked={active}` children

---

## 4 · Manual test matrix (browserless environment caveat)

I do not have a browser in this environment. The matrix below reflects
**source-verified** expectations — the user must visually validate on
localhost or production after deploy.

| # | Page | UserMenu top-right | Dropdown opens | Lang switch | Sign out | Page content unbroken |
|---|---|---|---|---|---|---|
| 1 | `/dashboard` | floating (immersive) | ✓ source | ✓ source | ✓ source | 3D scene fills viewport |
| 2 | `/dashboard/workflows` | ✓ inherited | ✓ source | ✓ source | ✓ source | unchanged |
| 3 | `/dashboard/canvas` | ✓ inherited | ✓ source | ✓ source | ✓ source | canvas-toolbar-slot preserved |
| 4 | `/dashboard/results/[id]` | ✓ light tone | ✓ source | ✓ source | ✓ source | Phase 4.2 cascade/donut untouched |
| 5 | `/dashboard/results/[id]/boq` | ✓ light tone | ✓ source | ✓ source | ✓ source | BOQ visualizer untouched |
| 6 | `/dashboard/ifc-viewer` | ✓ dark tone | ✓ source | ✓ source | ✓ source | viewer untouched |
| 7 | `/dashboard/floor-plan` | ✓ light tone | ✓ source | ✓ source | ✓ source | editor untouched |
| 8 | `/dashboard/settings` | ✓ inherited | ✓ source | ✓ source | ✓ source | settings own header co-exists |
| 9 | `/dashboard/history` | ✓ inherited | ✓ source | ✓ source | ✓ source | unchanged |
| 10 | `/dashboard/templates` | ✓ inherited | ✓ source | ✓ source | ✓ source | unchanged |
| 11 | `/dashboard/community` | ✓ inherited | ✓ source | ✓ source | ✓ source | unchanged |
| 12 | logged out → any | n/a | n/a | n/a | n/a | middleware redirects to /login (unchanged) |

Plus 7 additional routes covered by the same single layout: 3d-render,
analytics, billing, compare, feedback, results-v2-preview, test-results,
admin/live-chat.

---

## 5 · Verification gates (all green)

```bash
# 7.1 — Type-check
$ npx tsc --noEmit
(empty — 0 errors)

# 7.2 — Lint Phase 5 files
$ npx eslint src/shared/components/UserMenu.tsx src/features/dashboard/components/Header.tsx src/app/dashboard/layout.tsx src/lib/i18n.ts
(empty — 0 errors, 0 warnings)

# Wider lint sweep — 4 errors, all PRE-EXISTING on main:
#   src/shared/components/SessionGuard.tsx (3× require-imports)
#   src/shared/components/ui/BetaBanner.tsx (1× set-state-in-effect)
# Verified by stash + checkout main + lint comparison.

# 7.3 — Build
$ npm run build
✓ Compiled successfully in 9.1s

# 7.4 — Tests
$ npm test -- --run
Test Files  1 failed | 117 passed (118)
     Tests  1 failed | 2597 passed (2598)
# Same single failure as Phase 4.2 baseline: ifc-viewcube-position.test.tsx
# (asserts a regex against IFCViewerPage source; pre-exists on main).

# 7.5 — Search refs gone in chrome
$ grep -rEn 'icon.{0,5}=.{0,5}["\x27](Search|MagnifyingGlass)' src/components/dashboard/ src/features/dashboard/ src/app/
(empty — 0 matches)

# 7.6 — Result page regression check
$ grep -rEn ' as any|@ts-ignore' src/features/result-page/
(empty — 0 matches; Phase 4.2 baseline preserved)

# 7.7 — Console logs in chrome
$ grep -rEn 'console\.log' src/shared/components/UserMenu.tsx src/features/dashboard/components/Header.tsx
(empty — 0 matches)
```

---

## 6 · Bundle delta

New files: 1 (`src/shared/components/UserMenu.tsx`, 358 LOC)
Modified files: 3 (Header.tsx, layout.tsx, i18n.ts)
Removed lines: 434 (Header.tsx body) + 2 (i18n key pair) = **436 lines deleted**
Added lines: 358 (UserMenu) + 56 (Header.tsx new body) + 9 (layout deltas) = **423 lines added**

Net: **−13 LOC** (chrome lighter overall).

Zero new dependencies. `framer-motion`, `lucide-react`, `next-auth/react`,
`sonner`, `react-dom` were all already imported by other surfaces.

---

## 7 · Result page regression check

`grep -rEn ' as any|@ts-ignore' src/features/result-page/` → **0 matches**.
No file under `src/features/result-page/**` was touched in this phase.
Phase 4.2's BOQ cascade, IFC ElementCategoryCascade, Floor Plan
RoomScheduleCascade, Video ShotTimeline + RenderStatsDonut, Image
MetadataCascade, Failure recovery, Pending ETA, LiveStatusStrip,
LiveCostBreakdownDonut all untouched at the source level.

The result page's own `<PageHeader />` (Phase 4.2,
`src/features/result-page/components/PageHeader.tsx`) renders inside
`{children}` — it sits BELOW the now-transparent layout Header, so
the floating UserMenu (top-right of the layout chrome strip) and the
result page's "Run Again / Share" button row (top-right of the result
page's own header) live in different vertical bands. No collision.

---

## 8 · Auth flow verification (source-level)

- Logged-out user hitting any `/dashboard/*` route → `middleware.ts`
  redirects to `/login`. **Untouched.**
- Logged-in user clicks UserMenu → Sign out → `signOut({ callbackUrl:
  "/login" })` → returns to `/login`. **Verified in source.**
- Sign-out path also clears `buildflow-fp-*` localStorage and four
  floor-plan-related sessionStorage keys before the redirect — preserves
  the cross-user-data-leak protection from the legacy Header.
- Settings link uses `router.push("/dashboard/settings")` — unchanged
  from legacy.

---

## 9 · Mobile + reduced-motion spot-check (source-level)

- **Mobile (<768px):** Legacy `.dashboard-header button` rule forces
  trigger to 44×44 (WCAG tap-target minimum). Dropdown
  `maxWidth: "calc(100vw - 24px)"` + `right: Math.max(12, ...)`
  clamping. No layout shift on open (dropdown is `position: fixed`).
- **Reduced-motion:** `useReducedMotion()` → dropdown `duration: 0`,
  trigger `transition: "none"`. Hover effects skipped (no border /
  bg pulse). Verified in source.

---

## 10 · Honest "what still feels off"

1. **Full focus trap is not implemented.** Tab from the avatar trigger
   when dropdown is open moves to the next focusable element in the
   main DOM (since dropdown is portaled to `document.body`). Esc still
   closes correctly and returns focus. This is acceptable for v1; full
   ARIA arrow-key roving menu is a polish for a future phase.
2. **Sign-out toast on failure** uses generic message. Could be more
   specific (e.g. "Network error — please try again"). v1 acceptable.
3. **Avatar fallback for very long names** truncates the email in the
   identity row but renders only the first letter as initial. Could
   render two letters (first + last) for better recognition. v1 acceptable.
4. **The two pre-existing lint errors** (BetaBanner setState-in-effect,
   SessionGuard require-imports) are not regressed by this phase, but
   they remain in the codebase. Out of Phase 5 scope.
5. **The pre-existing IFC viewcube test** still fails (matches Phase 4.2
   baseline). Same caveat as Phase 4.2 — not regressed, not fixed.
6. **No browser-based visual validation** — I can't open a browser in
   this environment. Rutik must visually verify on localhost or post-
   deploy. The §4 matrix is source-verified, not eyes-verified.

---

## 11 · Ship log

```bash
# (filled in after the merge sequence runs)
```
