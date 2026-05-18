# IFC Viewer Header UI Fix + Calculate BOQ Button

**Date:** 2026-05-18
**Branch:** `main` (working tree only — no commits, no pushes)
**Scope:** 3 UI bugs in `/dashboard/ifc-viewer` header — collapse two-row split to one line, remove redundant X-close, add Calculate BOQ primary CTA.

---

## 1. Diagnosis Recap

### a) Header file paths
- **Page wrapper**: `src/features/ifc/components/IFCViewerPage.tsx` — renders `[Upload New] + <Toolbar/>` as flex row (lines 491-545).
- **Toolbar**: `src/features/ifc/components/Toolbar.tsx` — single flex container that holds every tool button + the right-side metadata badge / utility group.

### b) Root cause of the two-row split
`Toolbar.tsx:222` previously set **`flexWrap: "wrap"`** on the toolbar's root flex container. Combined with the `<div style={{ flex: 1 }} />` spacer separating the tool buttons from the right-side group `[badge, panel-toggle, keyboard, X]`, once the tool group exceeded the available width the spacer (a flex item) wrapped onto its own line — taking the entire right-side group with it.

Reproduces deterministically at any viewport narrower than the tool group's natural width.

### c) X-close button location + handler trace
- **JSX**: `Toolbar.tsx:400-404` (the `<ToolBtn icon={X} label="Close Model" onClick={onUnload} />`).
- **Prop chain**: `Toolbar` `onUnload` ← `IFCViewerPage.tsx:535` `onUnload={handleUnload}` ← `handleUnload` callback `IFCViewerPage.tsx:338-349`.
- **`handleUnload` is shared**: it's also bound to the "Upload New" `ArrowLeft` button at `IFCViewerPage.tsx:498-528`. So the handler stays alive — only the X JSX is removed, and `onUnload` prop is dropped from `Toolbar`.

### d) IFC file state holder
- **In-memory**: `IFCViewerPage.tsx:77` — `currentFile: { name: string; buffer: ArrayBuffer } | null` (set by `loadBufferIntoViewer` line 134).
- **Cross-tab / refresh-safe**: `src/features/ifc/lib/ifc-cache.ts` — IndexedDB store `neobim-ifc-cache` / `lastFile` / key `current` holding a `Blob`. Populated by `saveLastIFCFile()` at `IFCViewerPage.tsx:129` on every load.

### e) BOQ workflow route + payload contract
- **Route**: `/dashboard/canvas?template=wf-09&autoAttachIFC=1`
- **Workflow**: `wf-09` "IFC Model → BOQ Cost Estimate" in `src/features/workflows/constants/prebuilt-workflows.ts:422-528` — `IN-004 (IFC Upload) → TR-007 (Quantity Extractor) → TR-008 (BOQ/Cost Mapper) → EX-002 (XLSX Export)` with side-input from `IN-006 (Location)` + `TR-015 (Market Intelligence)`.
- **Auto-attach mechanism**: `src/features/canvas/components/nodes/InputNode.tsx:415-457` — on mount, every `.ifc`-accepting FileUploadInput reads `URLSearchParams.get("autoAttachIFC") === "1"`, dynamically imports `loadLastIFCFile()` from `ifc-cache.ts`, materializes the cached bytes into a `File`, and feeds it through `handleFile()` identical to a drag-drop. **No R2 upload needed** — same-origin IndexedDB is shared between tabs.
- **Same pattern used by** `IntegrationBanner.tsx:36` (window.open) — Calculate BOQ now promotes this from a dismissible banner to a permanent header CTA, using `router.push` for in-tab navigation.

### f) Integration plan
1. Add `useRouter` from `next/navigation` to `IFCViewerPage`.
2. Add `handleCalculateBOQ` callback: guard on `currentFile != null`, flip `boqLaunching` loading state, `router.push("/dashboard/canvas?template=wf-09&autoAttachIFC=1")`.
3. Pass three new props to `Toolbar`: `onCalculateBOQ`, `canCalculateBOQ` (boolean — controls disabled), `boqLaunching` (boolean — controls spinner).
4. Drop the now-unused `onUnload` prop from `Toolbar`'s contract.
5. Inside `Toolbar`, render a new `CalculateBOQButton` (gradient blue primary CTA, `Calculator` icon, `Loader2` while launching) pinned to the toolbar's right edge.

---

## 2. Files Touched

| File | Lines changed |
|------|---------------|
| `src/features/ifc/components/Toolbar.tsx` | +269 / −156 (425 LoC restructure) |
| `src/features/ifc/components/IFCViewerPage.tsx` | +17 / −2 |
| **Total** | **+286 / −158** across 2 files |

No other files touched. Forbidden files (`Viewport.tsx`, `enhance/**`, `IFCEnhancePanel.tsx`, `types/ifc-viewer.ts`, `boq/**` internals, `prisma`, billing, `next.config.*`, `tailwind.config.*`, `package.json`) — **untouched**.

---

## 3. Source-Verify Walkthrough — Diff Snippets

### Fix 1 — One-line header (collapse two-row split)

`Toolbar.tsx` root container — switched from wrap to nowrap, and restructured into three pinned regions:

```tsx
<div style={{
  display: "flex", alignItems: "center", gap: 4,
  padding: "6px 12px", background: UI.bg.toolbar,
  backdropFilter: "blur(12px)",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  flexWrap: "nowrap",                    // ← was "wrap"
  minHeight: 48, position: "relative", zIndex: 30,
}}>
  {/* LEFT — pinned: file-metadata badge (was on the right, in row 2) */}
  {hasModel && (
    <>
      <span style={badgeStyle}>
        {modelInfo.schema} · {modelInfo.elementCount} elements · {(modelInfo.fileSize / (1024*1024)).toFixed(1)} MB
      </span>
      <div style={dividerStyle} />
    </>
  )}

  {/* MIDDLE — scrollable tool strip. flex:1 + minWidth:0 + overflowX:auto */}
  <div style={{
    display: "flex", alignItems: "center", gap: 4,
    flex: 1, minWidth: 0,
    overflowX: "auto", overflowY: "hidden",
    scrollbarWidth: "thin",
  }}>
    <ToolBtn icon={FolderOpen} label="Open" .../>
    {/* … Fit All, Fit, Views, Section, Measure+unit, Style, Color By,
        Grid, Layers, Waypoints, EyeOff, Scan, RotateCcw, Screenshot, Download … */}
  </div>

  {/* RIGHT — pinned: panel-toggle + shortcuts + Calculate BOQ */}
  {hasModel && (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <ToolBtn icon={PanelBottomOpen} label="Toggle Panels" active={bottomPanelOpen} onClick={onToggleBottomPanel} />
      <ToolBtn icon={Keyboard} label="Shortcuts" shortcut="?" onClick={onToggleShortcuts} />
      <div style={dividerStyle} />
      <CalculateBOQButton disabled={!canCalculateBOQ} loading={boqLaunching} onClick={onCalculateBOQ} />
    </div>
  )}
</div>
```

The three-region pinned/scroll/pinned pattern guarantees:
- Left badge always visible (no horizontal scroll on it).
- Right CTA always visible (no horizontal scroll on it).
- Middle tool strip scrolls horizontally on narrow viewports instead of wrapping.

### Fix 2 — Remove X-close button

`Toolbar.tsx` — deleted the X close button (was `Toolbar.tsx:400-404`):

```tsx
// REMOVED:
// <ToolBtn
//   icon={X}
//   label="Close Model"
//   onClick={onUnload}
// />
```

Also dropped `onUnload` from `ToolbarProps` and the function signature destructure. `handleUnload` in `IFCViewerPage` is preserved — it's still bound to "Upload New" at `IFCViewerPage.tsx:498-528`.

`IFCViewerPage.tsx` — removed the now-orphaned prop:

```tsx
<Toolbar
  viewportRef={viewportRef}
  modelInfo={modelInfo}
  onOpenFile={handleOpenFile}
- onUnload={handleUnload}            // ← removed
  bottomPanelOpen={bottomPanelOpen}
  …
+ onCalculateBOQ={handleCalculateBOQ}
+ canCalculateBOQ={currentFile !== null}
+ boqLaunching={boqLaunching}
/>
```

### Fix 3 — Calculate BOQ primary CTA

`Toolbar.tsx` — new `CalculateBOQButton` component (gradient blue, `Calculator` icon, `Loader2` while launching, disabled style + tooltip when no IFC):

```tsx
function CalculateBOQButton({
  disabled, loading, onClick,
}: { disabled: boolean; loading: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const isDisabled = disabled || loading;
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      title={disabled ? "Upload an IFC first" : "Run the BOQ cost-estimation workflow with this IFC"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...boqBtnBase,                       // gradient #4F8AFF→#6E7CFF, white text, glow shadow
        ...(isDisabled ? boqBtnDisabled : {}),
        ...(hover && !isDisabled ? { /* brighter gradient + lift */ } : {}),
      }}
    >
      {loading
        ? <Loader2 size={14} className="animate-spin" />
        : <Calculator size={14} strokeWidth={2.2} />}
      <span>Calculate BOQ</span>
    </button>
  );
}
```

`IFCViewerPage.tsx` — new callback launching the existing BOQ workflow:

```tsx
const handleCalculateBOQ = useCallback(() => {
  if (!currentFile || boqLaunching) return;
  setBoqLaunching(true);
  router.push("/dashboard/canvas?template=wf-09&autoAttachIFC=1");
}, [currentFile, boqLaunching, router]);
```

---

## 4. BOQ Workflow Integration — Route + Payload

- **Route**: `/dashboard/canvas?template=wf-09&autoAttachIFC=1`
- **Payload mechanism**: same-origin IndexedDB. The IFC's `ArrayBuffer` is already persisted to `neobim-ifc-cache.lastFile.current` by `loadBufferIntoViewer → saveLastIFCFile` at IFCViewerPage `loadBufferIntoViewer` (line 128-130) on every successful load. The canvas-side consumer `InputNode.tsx:415-457` reads `?autoAttachIFC=1`, calls `loadLastIFCFile()`, and feeds the bytes into the wf-09 template's `IN-004 IFC Upload` node via the same `handleFile()` path as drag-drop.
- **No R2 upload needed** — IndexedDB is same-origin and shared between this tab and the canvas tab opened by `router.push`.
- **Disabled state**: when `currentFile === null` (i.e. no IFC loaded), the button renders disabled with tooltip "Upload an IFC first".
- **Loading state**: between click and route resolution, `boqLaunching=true` swaps the `Calculator` icon for a spinning `Loader2`. The state is local to `IFCViewerPage`; on route navigation the page unmounts so the spinner naturally clears.

---

## 5. `npx tsc --noEmit` Output

```
$ npx tsc --noEmit
(no output — exit code 0, zero errors)
```

Full output is empty — strict TypeScript passes cleanly.

---

## 6. `npm run build` Output (tail)

```
> workflow_builder@0.1.0 build
> prisma generate && next build

Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma/schema.prisma.
✔ Generated Prisma Client (v7.7.0) to ./node_modules/@prisma/client in 148ms

Warning: Custom Cache-Control headers detected for the following routes:
  - /_next/static/:path*

(pre-existing warning, unrelated to this change)

▲ Next.js 16.2.3 (Turbopack)
- Environments: .env.local
- Experiments (use with caution):
  · optimizePackageImports
  · serverActions

  Creating an optimized production build ...
✓ Compiled successfully in 9.8s
  Running TypeScript ...
  Finished TypeScript in 14.9s ...
  Collecting page data using 9 workers ...
  Generating static pages using 9 workers (0/178) ...
  Generating static pages using 9 workers (44/178)
  Generating static pages using 9 workers (88/178)
  Generating static pages using 9 workers (133/178)
✓ Generating static pages using 9 workers (178/178) in 400ms
  Finalizing page optimization ...

Route (app)
…
├ ○ /dashboard/ifc-viewer
…

ƒ Proxy (Middleware)
○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

- ✓ Compiled successfully in 9.8s
- ✓ TypeScript pass: 14.9s, zero errors
- ✓ 178/178 static pages generated
- Only warning is pre-existing (`Custom Cache-Control headers ... /_next/static/:path*`), unrelated to this change.

---

## 7. Manual Verification Checklist (Rutik to screenshot/verify)

Dev server: `npm run dev` (uses `next dev --webpack` — Turbopack is incompatible with konva per `feedback_turbopack_konva_incompat`). Navigate to `/dashboard/ifc-viewer` after login.

- [ ] **Header on wide viewport (>1440px)** — Toolbar renders as ONE line: `[Upload New] [badge] | [Open] [Fit All] [Fit] [Views] [Section] [Measure m] [Style] [Color By] [Grid] [Layers] [Ortho] [Hide] [Isolate] [Show All] [Screenshot] [Download] [PanelToggle] [Shortcuts] | [Calculate BOQ]`. No second row anywhere. Badge `IFC2X3 · 779 elements · 20.3 MB` sits to the LEFT of `Open`, not on a second row.
- [ ] **Header on narrow viewport (~1024px)** — Same single-line layout. Badge stays pinned LEFT, Calculate BOQ stays pinned RIGHT, middle tool strip becomes horizontally scrollable (thin scrollbar). No wrapping.
- [ ] **No X-close button anywhere** — Visually scan the entire toolbar; the only "close model" entry point is the `Upload New` button at top-left.
- [ ] **Calculate BOQ — enabled state (IFC loaded)** — Button visible top-right with filled blue gradient + Calculator icon + "Calculate BOQ" text. Hover: brighter gradient + lift.
- [ ] **Calculate BOQ — disabled state (no IFC)** — Open the page with no model loaded (or click Upload New to clear). Button renders muted blue with `Upload an IFC first` tooltip on hover. Click does nothing.
- [ ] **Click Calculate BOQ → routes to BOQ workflow with IFC attached** — Spinner replaces Calculator icon briefly. Page navigates to `/dashboard/canvas?template=wf-09&autoAttachIFC=1`. Canvas loads wf-09 template ("IFC Model → BOQ Cost Estimate"). Console shows `[IFC auto-attach] <node-id>: attaching <filename> (<N> bytes)`. The `IN-004 IFC Upload` node has the IFC file already attached — no re-upload required. Click `Run` → BOQ pipeline executes → result page shows BOQ in ₹.
- [ ] **Existing viewer features unaffected**:
  - [ ] **Section** dropdown — pick X/Y/Z → cutting plane appears.
  - [ ] **Measure** — click → cursor enters measure mode → click two points → measurement shows in current unit (toggle `m` ↔ `ft` updates display).
  - [ ] **Views** dropdown — Front/Back/Left/Right/Top/Bottom/Iso all switch camera correctly.
  - [ ] **Style** dropdown — Shaded / Wireframe / X-Ray all switch render mode.
  - [ ] **Color By** dropdown — Default / By Storey / By Category.
  - [ ] **Grid, Edges, Orthographic** toggles work.
  - [ ] **Hide / Isolate / Show All** + their keyboard shortcuts (H / I / A).
  - [ ] **Screenshot (P)** downloads a PNG.
  - [ ] **Export CSV** downloads `ifc-elements-<timestamp>.csv`.
  - [ ] **Enhance tab** in right sidebar (Phase 4a) — switches and renders without crashing.
  - [ ] **Refresh page** — IFC restores from IndexedDB (the `restoreFromCache` flow); Calculate BOQ remains enabled.

---

## 8. Ambiguities Resolved + Snags

1. **Spec listed only `Open, Fit All, …, download, [div], Calculate BOQ, [user avatar]` on the right — silent on `PanelToggle` and `Keyboard` shortcuts buttons.** Spec also said "ZERO regressions on existing IFC viewer functionality." I kept both `PanelToggle` and `Keyboard` buttons (placed just before Calculate BOQ on the right) because removing them would be a regression. They're small icon buttons; they don't compete with the primary CTA visually.

2. **"User avatar" in the spec's order is outside this component.** It's rendered by the dashboard layout, not by `IFCViewerPage` or `Toolbar`. Calculate BOQ being the right-most item INSIDE the toolbar matches the spec's intent — the avatar sits in the dashboard's page chrome to the right of the entire toolbar.

3. **No R2 upload needed.** Spec said "if BOQ workflow expects R2 key and IFC is only in-memory, upload via existing R2 upload helper first." Diagnosis showed wf-09's `IN-004 IFC Upload` node consumes the IFC via the existing `autoAttachIFC=1` query-param mechanism that reads same-origin IndexedDB — already populated by every viewer load. So Calculate BOQ navigates immediately; no upload-progress toast required.

4. **`IntegrationBanner` retained.** Spec said "ZERO regressions." The IntegrationBanner is dismissed-by-default but can be reopened by clearing the `buildflow-ifc-viewer-banner-dismissed` localStorage key. The new Calculate BOQ header CTA is a permanent surface; the banner is a one-time prompt. Both coexist without conflict — same destination route.

5. **`animate-spin` Tailwind utility.** I used `className="animate-spin"` on the `Loader2` icon rather than embedding `@keyframes spin` inline. Tailwind v4 (project default) ships `animate-spin` as a default utility — no extra setup needed. Sibling admin pages embed their own `@keyframes spin` because they pre-date Tailwind v4; the cleaner pattern is the utility class.

6. **`flexWrap: "nowrap"` vs container scroll.** Naïvely applying `overflowX: auto` to the whole toolbar would let the right-pinned Calculate BOQ scroll off-screen. Instead I split the toolbar into three regions: left badge (pinned, `flexShrink: 0`), middle tool strip (`flex: 1; min-width: 0; overflow-x: auto`), right utility + CTA (pinned, `flexShrink: 0`). This guarantees the primary CTA is always reachable while the tool buttons gracefully scroll on narrow viewports.

---

## Working-tree status

```
src/features/ifc/components/IFCViewerPage.tsx |  19 +-
src/features/ifc/components/Toolbar.tsx       | 425 ++++++++++++++++----------
2 files changed, 288 insertions(+), 156 deletions(-)
```

No commits, no pushes. Per `feedback_no_auto_push` — Rutik controls all git timing.

---

## Follow-up 2026-05-18 — Remove redundant right-side icons

### Diagnosis (3 lines)
Live test on `/dashboard/ifc-viewer` showed the Calculate BOQ CTA clipped behind the dashboard's user-avatar circle — only "Calculate" was visible. Root cause: the right-pinned group held three items (Panel-Toggle icon + Keyboard-Shortcuts icon + divider + Calculate BOQ button), and the two icons reserved ~80px that the CTA needed to render its full label without bumping into the avatar. Fix: delete both icons from the right group — bottom panel + shortcuts overlay still toggle via their existing non-header triggers (`[` key, `?` key, in-panel minimize/expand, CollapsedRail tabs).

### LoC delta (this follow-up only)

| File | Δ |
|------|---|
| `src/features/ifc/components/Toolbar.tsx` | +12 / −15 (net −3) |
| `src/features/ifc/components/IFCViewerPage.tsx` | +0 / −2 |
| **Total this follow-up** | **+12 / −17** |

Cumulative across both phases (`git diff --stat`): 2 files changed, +297 / −171.

### What's gone vs what stays

**Removed** (visible header buttons only):
- `<ToolBtn icon={PanelBottomOpen} label="Toggle Panels" .../>` — right group, Toolbar.tsx
- `<ToolBtn icon={Keyboard} label="Shortcuts" shortcut="?" .../>` — right group, Toolbar.tsx
- `PanelBottomOpen` and `Keyboard` from the `lucide-react` import — both now unused
- `bottomPanelOpen: boolean` and `onToggleBottomPanel: () => void` from `ToolbarProps` — used only by the removed button
- `bottomPanelOpen={...}` and `onToggleBottomPanel={...}` props from the `<Toolbar/>` call site in IFCViewerPage

**Kept** (still functional, just not header-triggered):
- `useState(true)` for `bottomPanelOpen` — still owns the right-sidebar expand/collapse state.
- `useState(false)` for `showShortcuts` — still owns the modal visibility.
- `showShortcuts` + `onToggleShortcuts` props on Toolbar — the **shortcuts modal JSX lives inside Toolbar.tsx** (lines 525+) and still listens to `showShortcuts` / closes via `onToggleShortcuts`. Removing these props would tear out the modal.
- All keyboard handlers in `IFCViewerPage.tsx:400-470` — `?` and `[` still wired.

### Non-header triggers that still work

Cited file:line in `src/features/ifc/components/IFCViewerPage.tsx`:

- **Shortcuts overlay opens**: keyboard `?` → `IFCViewerPage.tsx:420-422` (`if (e.key === "?") setShowShortcuts((p) => !p)`)
- **Shortcuts overlay closes**: keyboard `Escape` → `IFCViewerPage.tsx:469` (`setShowShortcuts(false)`), OR clicking the overlay backdrop / `X` inside the modal → `Toolbar.tsx:537` and `Toolbar.tsx:553` (both call `onToggleShortcuts`).
- **Bottom panel toggles**: keyboard `[` → `IFCViewerPage.tsx:424-426` (`if (e.key === "[") setBottomPanelOpen((p) => !p)`).
- **Bottom panel opens automatically**: load-complete callback → `IFCViewerPage.tsx:268`; tree-pick auto-switch → `IFCViewerPage.tsx:300`.
- **Bottom panel collapses**: in-panel minimize button → `IFCViewerPage.tsx:775` (`onClick={() => setBottomPanelOpen(false)}`).
- **Bottom panel expands from collapsed rail**: `CollapsedRail` tab-click + dedicated expand button → `IFCViewerPage.tsx:850, 852` (`setBottomPanelOpen(true)` / `onExpand={() => setBottomPanelOpen(true)}`).

So both surfaces remain fully functional after the header buttons are gone.

### `npx tsc --noEmit` tail

```
$ npx tsc --noEmit
(no output — exit code 0, zero errors)
```

### `npm run build` tail (last lines)

```
Loaded Prisma config from prisma.config.ts.
✔ Generated Prisma Client (v7.7.0) to ./node_modules/@prisma/client in 146ms
▲ Next.js 16.2.3 (Turbopack)
- Environments: .env.local
- Experiments (use with caution):
  · optimizePackageImports
  · serverActions

  Creating an optimized production build ...
✓ Compiled successfully in 10.4s
  Running TypeScript ...
  Finished TypeScript in 15.0s ...
  Collecting page data using 9 workers ...
  Generating static pages using 9 workers (0/178) ...
  Generating static pages using 9 workers (44/178)
  Generating static pages using 9 workers (88/178)
  Generating static pages using 9 workers (133/178)
✓ Generating static pages using 9 workers (178/178) in 392ms
  Finalizing page optimization ...

(... routes table, including /dashboard/ifc-viewer ...)

ƒ Proxy (Middleware)
○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

- ✓ Compiled successfully in 10.4s
- ✓ TypeScript pass: 15.0s, zero errors
- ✓ 178/178 static pages generated
- Only warning is the pre-existing custom-Cache-Control one, unrelated.

### Manual verification checklist (Rutik)

- [ ] **Calculate BOQ fully visible on wide viewport** — full text "Calculate BOQ" + Calculator icon rendered, no clipping, no overlap with the dashboard user-avatar circle on the far right.
- [ ] **Calculate BOQ click → routes to BOQ workflow** — navigates to `/dashboard/canvas?template=wf-09&autoAttachIFC=1`; canvas loads wf-09 template; `IN-004 IFC Upload` node has the IFC pre-attached (console: `[IFC auto-attach] ... attaching <filename>`).
- [ ] **Bottom panel still opens** — click any tab (Tree / Properties / Editor / Enhance) on the right rail OR press `[` keyboard shortcut; the right sidebar expands. Press `[` again to collapse.
- [ ] **Shortcuts overlay still opens** — press `?` while no input is focused; overlay shows. Press `?` again, or `Escape`, or click the `X` inside the modal to close.
- [ ] **All other toolbar buttons unchanged** —
  - [ ] `Open` opens the file picker
  - [ ] `Fit All` (F) re-centers
  - [ ] `Fit` (V) — fit-to-selection chip with `Maximize` icon next to Fit All
  - [ ] `Views ▾` — Front/Back/Left/Right/Top/Bottom/Iso
  - [ ] `Section ▾` (S) — X/Y/Z section plane cycles
  - [ ] `Measure` (M) + `m`/`ft` unit toggle
  - [ ] `Style ▾` — Shaded / Wireframe / X-Ray
  - [ ] `Color By ▾` — Default / By Storey / By Category
  - [ ] `Toggle Grid`
  - [ ] `Toggle Edges` (Layers icon)
  - [ ] `Orthographic / Perspective` (Waypoints icon)
  - [ ] `Hide Selected` (H), `Isolate Selected` (I), `Show All` (A)
  - [ ] `Screenshot` (P)
  - [ ] `Export CSV` (Download icon)
- [ ] **Upload New (left rail) still swaps the model** — click it, file picker opens via existing `handleUnload` → upload flow. Cached IFC is cleared.
- [ ] **At narrow viewports (~1024px)** — the middle tool strip becomes horizontally scrollable; Calculate BOQ stays pinned right, still fully visible, still no overlap.

### Ambiguity resolved
The instruction said "Drop these 4 fields from ToolbarProps IF AND ONLY IF they are not used anywhere else inside Toolbar.tsx ... Grep inside Toolbar.tsx first." Grep showed `showShortcuts` is used at `Toolbar.tsx:525` (modal visibility gate) and `onToggleShortcuts` at `Toolbar.tsx:537, 553` (modal backdrop click + X close). So I kept the shortcuts pair on the prop interface and only dropped the bottom-panel pair. The header buttons for both surfaces are gone either way — the props that survived are wired exclusively to the modal that lives inside Toolbar.tsx, not to any header button.

