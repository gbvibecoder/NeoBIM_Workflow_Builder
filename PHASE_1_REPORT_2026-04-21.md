# PHASE 1 REPORT — IFC Enhance Scaffold + Viewport Handle Opening

**Date:** 2026-04-21
**Branch:** `feat/ifc-enhance-phase-1-scaffold` (created off `ifc-enhancer`)
**Commit state:** Uncommitted working tree (as instructed).

---

## 1 · Status

**PHASE 1 COMPLETE.**

All scaffold work specified in the prompt is in place: `ViewportHandle` is opened, the worker pushes wall Psets at parse time, the old "Enhance" tab is renamed to "Editor", and a new 4th "Enhance" tab is wired to a placeholder `IFCEnhancePanel`. No tier logic; no new dependencies; no touched files outside the permitted list. `npx tsc --noEmit` is clean; `npm run build` succeeds; dev server compiles and serves `/dashboard/ifc-viewer` with HTTP 200.

---

## 2 · Branch

```
git branch --show-current
→ feat/ifc-enhance-phase-1-scaffold
```

---

## 3 · Git diff stat

Working-tree vs HEAD (`ifc-enhancer`) — no commits on the new branch yet (per the rule):

```
 src/features/ifc/components/IFCViewerPage.tsx  |  54 ++++++++----
 src/features/ifc/components/Viewport.tsx       | 125 +++++++++++++++++++++++++
 src/features/ifc/components/ifc-worker.ts      | 104 +++++++++++++++++++++
 src/types/ifc-viewer.ts                        |  64 +++++++++++++
 4 files changed, 332 insertions(+), 15 deletions(-)
```

Additionally, one **new file** (untracked):

```
?? src/features/ifc/components/IFCEnhancePanel.tsx
```

Also present from Phase 0 (untracked, not part of this phase):

```
?? IFC_ENGINE_AUDIT_2026-04-21.md
```

---

## 4 · Files touched

| File | Purpose |
|---|---|
| `src/types/ifc-viewer.ts` | Added `three` type imports; added `SceneRefs` interface; added `EnhancementTier` type; extended existing `ViewportHandle` with 7 additive method signatures (`getSceneRefs`, `getMeshMap`, `getTypeMap`, `getSpaceBounds`, `mountEnhancements`, `unmountEnhancements`, `getPropertySets`). Existing methods untouched. |
| `src/features/ifc/components/Viewport.tsx` | Added `SceneRefs`/`EnhancementTier`/`PropertySet` type imports; added `enhancementGroupRef`, `enhancementTierGroupsRef`, `wallPsetsRef`; created `enhancementGroup` in scene setup and added it to the scene after `measureGroup`; extended the worker `metadata` message handler to ingest `wallPsetEntries`; extended `clearModel` to clear `wallPsetsRef` and dispose any mounted tier groups; added the 7 new imperative methods inside the existing `useImperativeHandle` block. |
| `src/features/ifc/components/ifc-worker.ts` | Added `WallPsetEntry` interface; added `extractWallPsets()` function that single-pass walks `IFCRELDEFINESBYPROPERTIES` and pulls `Pset_WallCommon.IsExternal` + `.FireRating` for every `IFCWALL` / `IFCWALLSTANDARDCASE`; called it from `handleParse` after `buildSpatialTree()`; attached the result (as `wallPsetEntries`) to the `metadata` message. |
| `src/features/ifc/components/IFCViewerPage.tsx` | Added `IFCEnhancePanel` import; introduced `SidebarTab` union type; renamed tab identifier `"enhance"` → `"editor"`; introduced new tab identifier `"enhance-ai"`; updated tab header rendering (now `Tree · Properties · Editor · Enhance` in that order, with the Sparkles cyan accent moved to the new Enhance tab); updated auto-switch on first-load from `"enhance"` to `"editor"`; wired `IFCEnhancePanel` as the content for the new `"enhance-ai"` tab; updated `CollapsedRail` to use the shared `SidebarTab` union and include both Editor and Enhance rows. `IFCEnhancerPanel` internals **not** modified — only its mount site moved from `tab==="enhance"` to `tab==="editor"`. |
| `src/features/ifc/components/IFCEnhancePanel.tsx` **(new)** | Placeholder panel for the new "Enhance with AI" tab. Shows a Sparkles-badged header and a "Coming soon — PBR materials, lighting, roof synthesis, procedural context, AI-placed furniture, photoreal hero shots — your .ifc file is never modified" message. Holds `viewportRef` in its signature for Phase-2+ wiring. No tier logic. |

**Files explicitly NOT touched** (per §2 rules): `IFCEnhancerPanel.tsx`, `src/app/api/enhance-ifc/route.ts`, `src/features/ifc/services/ifc-enhancer.ts`, `src/features/ifc/services/ifc-planner.ts`, `src/features/ifc/services/ifc-exporter.ts`, any workflow-node handler, anything under `neobim-ifc-service/`, `package.json`, `package-lock.json`.

---

## 5 · `npx tsc --noEmit` output

```
(empty — exit=0, zero errors, zero warnings)
```

Verbatim. `tsc` produced no stdout or stderr.

---

## 6 · `npm run build` output (tail ~42 lines)

```
├ ○ /dashboard/analytics
├ ○ /dashboard/billing
├ ○ /dashboard/canvas
├ ○ /dashboard/community
├ ○ /dashboard/compare
├ ○ /dashboard/feedback
├ ○ /dashboard/floor-plan
├ ○ /dashboard/history
├ ○ /dashboard/ifc-viewer     ← target route, statically generated
├ ƒ /dashboard/results/[executionId]/boq
├ ○ /dashboard/settings
├ ○ /dashboard/templates
├ ○ /dashboard/test-results
├ ○ /dashboard/workflows
├ ○ /demo
├ ○ /forgot-password
├ ○ /login
├ ƒ /onboard
├ ○ /pricing
├ ○ /privacy
├ ○ /register
├ ○ /reset-password
├ ƒ /share/[slug]
├ ○ /sitemap.xml
├ ○ /templates
├ ● /templates/[slug]
│ ├ /templates/pdf-brief-to-ifc-to-video-walkthrough
│ ├ /templates/text-prompt-to-floor-plan
│ ├ /templates/floor-plan-to-render-to-video-walkthrough
│ └ [+6 more paths]
├ ○ /terms
├ ○ /thank-you/subscription
├ ○ /verify-email
└ ○ /workflows


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

**Build warnings:** One pre-existing `Critical dependency` informational notice from `@opentelemetry/instrumentation` (transitive of `@sentry/nextjs`) that was already in the baseline. Not caused by Phase 1 changes. No new warnings.

---

## 7 · Manual verification results

§5.8 asks for interactive browser-side checks. I'm executing from a terminal with no interactive browser, so I ran the **machine-verifiable slice** honestly and am flagging the remainder for VibeCoders to exercise.

| # | Check | Result | Evidence |
|---:|---|---|---|
| 1 | Open `/dashboard/ifc-viewer` | ✅ HTTP 200 | `curl -sS http://localhost:3000/dashboard/ifc-viewer` → `status=200 size=100812`. Route compiled under `npm run dev` without runtime errors (log: `GET /dashboard/ifc-viewer 200 in 40ms`). |
| 2 | Upload `basic.ifc` and see 3D render | ⚠️ **NOT CHECKED — no browser** | Requires a logged-in interactive session. Hand-over to VibeCoders. |
| 3 | Tab bar reads `Tree · Properties · Editor · Enhance` | ✅ (source-verified) | `IFCViewerPage.tsx:616` → `(["tree", "properties", "editor", "enhance-ai"] as const)` with labels `Tree`, `Properties`, `Editor`, `Enhance` at `:619-622`. |
| 4 | Editor panel loads intact (14 sections, Add Floor etc.) | ⚠️ **NOT CHECKED — no browser** | `IFCEnhancerPanel` internals are byte-identical (no edit made). Mount site moved from `tab==="enhance"` to `tab==="editor"` at `IFCViewerPage.tsx:699-704`. Props unchanged (`sourceFile`, `onApplyToViewer`). |
| 5 | Enhance tab shows the "Coming soon" placeholder | ⚠️ **NOT CHECKED — no browser** | Source-verified: `IFCEnhancePanel.tsx` renders a Sparkles header + placeholder copy; mounted at `IFCViewerPage.tsx:705-710` gated on `tab==="enhance-ai"`. |
| 6 | Tree and Properties tabs still work | ⚠️ **NOT CHECKED — no browser** | No changes to those tabs' content or wiring. Tab switching logic unchanged. |
| 7 | `viewportRef.current?.getMeshMap()` returns non-empty after load (console-log) | ⚠️ **NOT CHECKED — no browser** | I deliberately did NOT add a temporary `console.log` because I couldn't interactively verify and remove it. The method is implemented at `Viewport.tsx` in the imperative-handle block and returns `meshMapRef.current` (same map `selectElement` already reads from for selection). |
| 8 | No regressions: orbit, zoom, section, measure, view cube, context menu, screenshot | ⚠️ **NOT CHECKED — no browser** | Zero changes to orbit / raycast / context-menu / section-plane / measurement / view-cube / screenshot code paths. The only runtime addition to the scene graph is an empty `enhancementGroup` with no children — it has no render cost until `mountEnhancements` is called. |
| 9 | Add Floor on basic.ifc via the Editor still works | ⚠️ **NOT CHECKED — no browser** | `IFCEnhancerPanel.tsx` untouched; mount props unchanged. No reason to regress, but flag for VibeCoders manual confirmation. |

**Honest note to reviewer:** the build, type-check, and dev-server compile-and-serve pass all machine-checkable gates. Any regression at rows 4, 5, 6, 8, 9 would surface instantly on a first interactive upload — I recommend VibeCoders runs §5.8 steps 1-9 against `basic.ifc` before merging.

---

## 8 · Changes to `ViewportHandle`

Additions are purely additive — existing methods untouched. New types defined **before** the interface:

```ts
export interface SceneRefs {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  modelGroup: Group;
}

export type EnhancementTier = 1 | 2 | 3 | 4;
```

New method signatures appended to `ViewportHandle`:

```ts
/* ── Enhance feature surface (Phase 1 scaffold) ──
   See IFC_ENGINE_AUDIT_2026-04-21.md §7 Risk 1 for the origin of this
   contract. Every method must be safe to call before a model is loaded. */

getSceneRefs: () => SceneRefs | null;
getMeshMap: () => ReadonlyMap<number, Mesh[]>;
getTypeMap: () => ReadonlyMap<number, number>;
getSpaceBounds: () => Map<number, Box3>;
mountEnhancements: (nodes: Object3D[], opts: { tier: EnhancementTier }) => void;
unmountEnhancements: (tier?: EnhancementTier) => void;
getPropertySets: (expressID: number) => Promise<PropertySet[]>;
```

All seven are safe before model load:
- `getSceneRefs` returns `null` if any ref is nil.
- `getMeshMap` / `getTypeMap` return the live `Map` (empty until parse lands).
- `getSpaceBounds` walks the empty map and returns an empty `Map<number, Box3>`.
- `mountEnhancements` / `unmountEnhancements` early-return when `enhancementGroupRef.current` is null.
- `getPropertySets` resolves `[]` when `workerRef.current` is null.

---

## 9 · Worker extension diff (new lines for Pset extraction)

New type:

```ts
interface WallPsetEntry {
  isExternal: boolean | null;
  fireRating: string | null;
}
```

New function (`ifc-worker.ts`, placed between `buildSpatialTree()` and `handleGetProperties()`):

```ts
function extractWallPsets(): Map<number, WallPsetEntry> {
  const result = new Map<number, WallPsetEntry>();
  if (!api || modelID < 0) return result;

  /* Index walls so the rel walk can early-reject non-wall elements. */
  const wallExpressIDs = new Set<number>();
  for (const [eid, tid] of typeMap.entries()) {
    if (tid === IFCWALL || tid === IFCWALLSTANDARDCASE) {
      wallExpressIDs.add(eid);
      result.set(eid, { isExternal: null, fireRating: null });
    }
  }
  if (wallExpressIDs.size === 0) return result;

  try {
    const propRels = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
    for (let i = 0; i < propRels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, propRels.get(i), false);
        const related = rel?.RelatedObjects;
        if (!related) continue;

        const relatedWallIDs: number[] = [];
        const len = related.length ?? related.size?.() ?? 0;
        for (let j = 0; j < len; j++) {
          const ref = related[j] ?? related.get?.(j);
          const refID = typeof ref === "object" ? ref.value : ref;
          if (typeof refID === "number" && wallExpressIDs.has(refID)) relatedWallIDs.push(refID);
        }
        if (relatedWallIDs.length === 0) continue;

        const psetRef = rel.RelatingPropertyDefinition;
        const psetID = typeof psetRef === "object" ? psetRef.value : psetRef;
        if (!psetID) continue;

        const pset = api.GetLine(modelID, psetID, false);
        if (!pset || pset.type !== IFCPROPERTYSET) continue;
        if (safeString(pset.Name) !== "Pset_WallCommon") continue;

        const props = pset.HasProperties;
        if (!props) continue;

        let isExternal: boolean | null = null;
        let fireRating: string | null = null;
        const propsLen = props.length ?? props.size?.() ?? 0;
        for (let k = 0; k < propsLen; k++) {
          const propRef = props[k] ?? props.get?.(k);
          const propID = typeof propRef === "object" ? propRef.value : propRef;
          if (!propID) continue;
          try {
            const prop = api.GetLine(modelID, propID, false);
            if (!prop || prop.type !== IFCPROPERTYSINGLEVALUE) continue;
            const name = safeString(prop.Name);
            const nominal = prop.NominalValue;
            const rawVal = nominal != null
              ? (typeof nominal === "object" && "value" in nominal ? nominal.value : nominal)
              : null;
            if (name === "IsExternal") {
              if (rawVal === true || rawVal === 1 || rawVal === ".T." || rawVal === "T") isExternal = true;
              else if (rawVal === false || rawVal === 0 || rawVal === ".F." || rawVal === "F") isExternal = false;
            } else if (name === "FireRating") {
              fireRating = rawVal == null ? null : String(rawVal);
            }
          } catch { /* skip property */ }
        }

        for (const wallID of relatedWallIDs) result.set(wallID, { isExternal, fireRating });
      } catch { /* skip rel */ }
    }
  } catch { /* no rels */ }

  return result;
}
```

Hook into `handleParse` (after `buildSpatialTree()`):

```ts
/* ── Extract Pset_WallCommon for every wall (Tier 1 classifier input) ── */
const wallPsets = extractWallPsets();

/* ── Send metadata ── */
post({
  type: "metadata",
  typeEntries: [...typeMap.entries()],
  storeyEntries: [...storeyMap.entries()],
  storeyIndexEntries: [...storeyIndexMap.entries()],
  wallPsetEntries: [...wallPsets.entries()],        // ← new field
});
```

Main-thread ingestion (in `Viewport.tsx` inside `worker.onmessage` → `case "metadata"`):

```ts
if (Array.isArray(msg.wallPsetEntries)) {
  for (const [eid, entry] of msg.wallPsetEntries) {
    wallPsetsRef.current.set(eid, entry);
  }
}
```

**Performance:** The extraction is O(rels + walls·props). On the typical `basic.ifc` fixture (~199 elements, ~72 walls, ~300-400 rels) the inner loop runs once per rel with an O(1) wall-ID set check — well inside the 200 ms budget. On a 147 MB realistic model the same algorithm stays linear in rels; worst-case contention is the same `GetLine` calls the existing selection path already performs on demand.

---

## 10 · Decisions made (ambiguities resolved)

1. **New types file location.** The prompt said "add supporting imports at the top of the file as needed." I placed `import type { Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh, Box3, Object3D } from "three"` right after the `/* ─── IFC Viewer Types ─── */` banner (before any existing exports) so the types file imports look natural. Also re-exported `PropertySet` is already defined further down, so I reference it via `PropertySet` directly (not `import("./ifc-viewer").PropertySet`) — cleaner, same type.

2. **Single `ViewportHandle` interface — no separate `ViewportEnhanceHandle` type.** The prompt explicitly said "do not create a separate `ViewportEnhanceHandle` that must be separately awaited — it's just a grouping comment in the code." I extended the existing interface with a grouping comment block (`/* ── Enhance feature surface (Phase 1 scaffold) ── */`). No second type emitted.

3. **CollapsedRail got a new row for "Editor".** The pre-existing collapsed rail had three icons (Enhance + Tree + Properties). When the tab list grew to four, the rail would silently lose access to the "Editor" (old Enhance) tab. I added a fourth item `{ id: "editor", label: "Editor", char: "✎" }` so both tabs are reachable when collapsed. The Sparkles icon stays on the new AI Enhance row only.

4. **Tab order in CollapsedRail.** I put Enhance first (the flagship feature), then Editor, then Tree, then Properties — preserves the visual prominence the existing collapsed rail gave to "Enhance." The tab-bar header order is `Tree · Properties · Editor · Enhance` per spec.

5. **IsExternal value coercion.** IFC toolchains encode booleans inconsistently (STEP `.T.`/`.F.`, JS `true`/`false`, numeric `1`/`0`, single-char `T`/`F`). I normalize all of them. Anything else leaves `isExternal` as `null` — consumers can treat null as "unknown" and avoid misclassifying as interior.

6. **No temporary `console.log` in the placeholder.** §5.8 suggested adding a transient log to verify `viewportRef.current?.getMeshMap()` returns a non-empty map after load. Since I can't interactively click around to observe it and then remove it (I have no browser), I deliberately did not add one. The imperative method is trivially correct — it returns `meshMapRef.current`, which the existing selection path at `Viewport.tsx:650-657` already reads from with success every click.

7. **Styling of the placeholder.** The prompt's snippet used Tailwind utility classes (`flex h-full flex-col`, `text-muted-foreground`, `bg-white/5`). The existing IFC-viewer components use inline styles keyed off the `UI` constants object (`constants.ts` — `UI.bg.elevated`, `UI.accent.cyan`, etc.) for consistency with the rest of the viewer. I used the `UI`-constants pattern so the placeholder visually matches its neighbors; the content and structure match the prompt's intent exactly.

8. **`enhancementGroup` initialization.** Created in the scene-setup `useEffect` right after `modelGroupRef/edgesGroupRef/measureGroupRef` are added. This means it exists for the entire session (including between file loads) — only its tier-group children are torn down and rebuilt.

---

## 11 · Surprises or snags (things the audit didn't warn about)

1. **The "Enhancer" vertical brand label in the collapsed rail.** `IFCViewerPage.tsx:854` has `<span>Enhancer</span>` as a bottom vertical-writing-mode label on the collapsed rail — pre-existing. It made sense when the only enhancer-like tab was the IFC-text mutator; it still loosely applies (the Editor panel "enhances" IFCs by adding floors/rooms, and the new Enhance tab is visual enhancement). I left it alone to avoid branding churn, but VibeCoders may want to revisit.

2. **`handleApplyEnhancement` and `EnhanceSuccess` name keep their "Enhance" wording.** These live inside `IFCViewerPage.tsx` and connect the **Editor** panel to the viewer (for applying a rewritten IFC). Renaming them to `handleApplyEdit` / `EditSuccess` would ripple into `IFCEnhancerPanel.tsx` which we were explicitly told not to modify. Intentional non-rename; flag for a later cleanup pass.

3. **`propertyCallbacksRef` is now shared by two consumers.** The selection path (`getElementProperties` at `Viewport.tsx:767-776`) and the new handle method `getPropertySets` both use `propertyCallbacksRef` with monotonic `requestIdRef`. No collision (each reqId is unique) and the existing `case "properties"` handler already supports any caller. No changes needed — just worth flagging that Phase 2 authors should not assume `propertyCallbacksRef` is single-use.

4. **Pre-existing `@opentelemetry/instrumentation` Critical-dependency warning.** Surfaces on both `npm run build` and `npm run dev`. Not caused by this phase. Sentry / OpenTelemetry transitive — ignorable.

5. **Dev-server auth middleware returns an HTML redirect shell on unauthenticated `/dashboard/ifc-viewer` hits.** This is fine (it's intended behaviour of the dashboard-layout auth gate), but it means automated HTTP probing can't verify the rendered tab labels without a signed-in session. The rendered DOM only materializes after login + file upload. I source-verified tabs instead.

---

## 12 · Readiness for Phase 2

The foundation is stable: `ViewportHandle` exposes scene refs, mesh/type maps, space bounds, tier-scoped mount/unmount, and per-element property-set fetch; the worker pushes wall Psets at parse time ready for a Tier-1 exterior/interior classifier; the new `IFCEnhancePanel` is mounted at the correct tab with `viewportRef` already plumbed in — Phase 2 can call any of the seven new handle methods directly from inside the panel without further scaffolding.

---

**Report path:**
`/Users/govindbhujbal/work/Hackthon - Workflow Builder/NeoBIM_Workflow_Builder/PHASE_1_REPORT_2026-04-21.md`
