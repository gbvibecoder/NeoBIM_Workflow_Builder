# BUILDFLOW — Results Page Redesign · Phase 0 Audit

**Date:** 2026-04-25
**Branch:** `main` (commit `c2b1210`)
**Auditor:** Claude (fresh session, source-only read)
**Mode:** Analysis only — no code changes, no servers started, no DB calls.
**Output target:** This file. Nothing else has been written.

---

## Executive summary (read this first, in 2 minutes)

The "shared result page" the user is unhappy with is **`ResultShowcase`**, a 528-line modal overlay rendered on top of `WorkflowCanvas` (`src/features/execution/components/result-showcase/index.tsx`). It is composed of five tabs (`Overview`, `Media`, `Data & Analysis`, `3D Model`, `Export`) and ~6,600 lines of tab/section/hero code under `src/features/execution/components/result-showcase/`. **It is the wrapper, not the dedicated visualizers.**

The flag-gated route at `/dashboard/results/[executionId]/page.tsx` is currently a no-op for production users — `NEXT_PUBLIC_RESULTS_V2` is OFF, so it redirects back to the canvas where the overlay opens (`LegacyResultPage.tsx:36-40`). Production is therefore the canvas-hosted overlay. The `feat/results-v2-cinematic` work is still on disk under `src/features/results-v2/` but unreachable while the flag is OFF, and is the surface that confused "wrapper" with "result content."

**The wrapper does adapt per workflow type today** — `useHeroDetection.ts:48-58` picks one of seven hero kinds (`video > floor-plan-interactive > 3d-model > floor-plan > image > table > text > generic`) and `useShowcaseData.ts:531-542` filters available tabs based on which artifacts exist. Adaptation is real but coarse. The complaints are valid for three reasons:

1. **Jargon is on by default** regardless of workflow. `OverviewTab.tsx:164-169` always renders an `AI-Generated Estimate` pill at the top of every Overview, even for an IFC-export-only run that produces no estimate.
2. **The buttons that route into dedicated visualizers are weak.** The BOQ entry is a small text-only Link (`OverviewTab.tsx:1683-1745`); the Floor Plan Editor entry is a sidebar button inside the Model tab (`ModelTab.tsx:793-844`); and there is **no entry point at all** to `/dashboard/ifc-viewer` for IFC-producing workflows — the `.ifc` file is only surfaced as a download card with a "Rich/Lean" engine badge (`ExportTab.tsx:248-269`).
3. **Cost / price strings live in the wrapper itself.** Raw `$X.XX` USD literals are emitted in `useHeroDetection.ts:192` and `MediaTab.tsx:306` for any video that has `costUsd` set. KPI cost breakdowns are auto-derived in `useShowcaseData.ts:498-513` whenever a metric label contains the words `cost`, `price`, `budget`, etc. — so price tiles can appear in workflows that never asked for them.

**Workflow → result-type matrix** (full table in §1). Eight prebuilt workflows ship today (`prebuilt-workflows.ts:21-769`) plus an open-ended AI-prompt path. The terminal artifact types covered: floor-plan-interactive (`wf-01`, GN-012), photoreal video (`wf-06`, `wf-08`, `wf-11`, GN-009 Kling 3.0), IFC + video (`wf-08`), BOQ table + xlsx (`wf-09`, TR-008+EX-002), 3D massing + IFC (`wf-03`, `wf-04`), interactive HTML 3D (`wf-05`, GN-011), clash report JSON (`wf-12`, TR-016).

**Sacred dedicated visualizers (preservation list — §11).** These are the "movies" — do not redesign:
- BOQ Visualizer at `/dashboard/results/[executionId]/boq` (`src/features/boq/components/BOQVisualizerPage.tsx`).
- Floor Plan Editor at `/dashboard/floor-plan?source=pipeline` (`src/features/floor-plan/components/FloorPlanViewer.tsx` + `src/app/dashboard/floor-plan/page.tsx`).
- IFC Viewer at `/dashboard/ifc-viewer` (`src/features/ifc/components/IFCViewerPage.tsx`).
- Inline-mounted dedicated viewers: `BIMViewer` (GLB), `ArchitecturalViewer` (procedural), `FloorPlanEditor` (canvas-resident editor), `HtmlIframeViewer` (Three.js HTML), `SegmentedVideoPlayer` (background video jobs).
- The dedicated visualizers' data flows: `Execution.tileResults` JSON column, `Execution.metadata` JSONB (quantityOverrides, videoGenProgress, regenerationCounts, diagnostics).

**Safe to change (§11).** Everything inside `src/features/execution/components/result-showcase/**`. The 528-line orchestrator, 5 tabs, hero variants, KPI strip, cost-breakdown auto-derivation, "Powered by" tech chips, "Also Generated" cards, "Execution Complete" timestamp banner. Plus the canvas FAB ("View Results") in `WorkflowCanvas.tsx:1009-1073` if the redesign moves the wrapper off the canvas.

**Jargon to retire** (full list in §4): the `AI-Generated Estimate` / `AI Concept Art` / `Experimental 3D Preview` confidence pills (3 of them, none of which a user asked for); the `Powered by GPT-4o · DALL-E 3 · Kling 3.0` tech-stack chips; the `INTERACTIVE` pill on the BOQ CTA; the `RECOMMENDED` pill on the PDF export card; raw `$` USD literals; the `costUsd` line in the video metadata strip; the `All exports from concept-level pipeline` footer; the `Powered by · BuildFlow Engine` footer of the Model tab sidebar.

**Lifecycle states (§7).** The wrapper handles seven states implicitly: `idle/pre-mount` (canvas), `running` (overlay never opens — the flag waits for `!isExecuting && artifacts.size > 0`, see `WorkflowCanvas.tsx:430-454`), `complete` (happy path, all green), `partial` (`ShowcaseHeader.tsx:117-143` shows amber "X/Y nodes"), `failed` (relies on artifacts existing — if no artifact ever landed, the overlay never opens; the wrapper has no top-level error empty state of its own), `pending video render` (the user-complaint "Initializing 5%" state lives in `HeroSection.tsx:156-236` and `MediaTab.tsx:152-238`), and `not found / forbidden` (only handled by the never-rendered `LegacyResultPage.tsx:43-99`).

**Open questions for Rutik (§12).** Eight, all load-bearing for the redesign brief.

---

## §1 — Workflow → result-type matrix

Source files read end-to-end:
- `src/features/workflows/constants/prebuilt-workflows.ts` (768 lines)
- `src/features/workflows/constants/node-catalogue.ts` (686 lines, 31 nodes catalogued, `LIVE_NODES` set at line 681)

There are 8 prebuilt workflows. The "AI-prompt-generated" path is documented elsewhere as `src/features/canvas/components/panels/AIChatPanel.tsx`; from a result-page perspective it produces a graph of the same node IDs, so the result-type rules below apply identically.

| WF id | Display name | Terminal node(s) | Primary result type | Hero kind picked today | Dedicated visualizer | Deep-link URL? |
|---|---|---|---|---|---|---|
| `wf-01` | Text Prompt → Floor Plan | `GN-012` (Floor Plan Editor) | Interactive 2D floor plan editor (CAD) | `floor-plan-interactive` | `FloorPlanViewer` mounted inside Overview hero (`OverviewTab.tsx:172-217`) + Model tab (`ModelTab.tsx:115-162`) | `/dashboard/floor-plan?source=pipeline` (sessionStorage handoff) |
| `wf-03` | Text Prompt → 3D Building + IFC | `GN-001` + `EX-001` | 3D massing model + IFC4 file | `3d-model` (procedural) | `ArchitecturalViewer` (`ModelTab.tsx:874-903`) + IFC download card (Export tab) | None — viewer is inline-only |
| `wf-04` | Parameters → 3D Massing + IFC | `GN-001` + `EX-001` | Same as wf-03 | `3d-model` | Same | Same |
| `wf-05` | Floor Plan → Interactive 3D Model | `GN-011` (Interactive 3D Viewer) | HTML iframe Three.js scene | `3d-model` (html-iframe) | `HtmlIframeViewer` inline (`ModelTab.tsx:982-1052`) | None — HTML lives in artifact `data.html` blob |
| `wf-06` | Floor Plan → Render + Video | `GN-003` (×2) + `GN-009` (Kling) | Cinematic video + photoreal renders | `video` | `HeroSection` video player (`HeroSection.tsx:21-408`) | None — video URL on R2 |
| `wf-08` | PDF Brief → IFC + Video Walkthrough | `EX-001` + `GN-009` | IFC4 file + video walkthrough | `video` (winning priority over IFC) | `HeroSection` video; IFC only in Export tab | None |
| `wf-09` | IFC Model → BOQ Cost Estimate | `TR-008` + `EX-002` | BOQ table + XLSX/CSV | `table` (with `boqSummary` flag set) | **`BOQVisualizerPage`** at `/dashboard/results/[executionId]/boq` | **YES** — only fully deep-linkable result type |
| `wf-11` | Building Photo → Renovation Video | `GN-009` | Cinematic 15s renovation video | `video` | `HeroSection` video player | None |
| `wf-12` | IFC Upload → Clash Detection | `TR-016` | JSON clash report | falls through to `text` or `generic` | None — no dedicated viewer; renders only as `JsonExplorer` in Data tab (`DataTab.tsx:459-573`) | None |

**Notes / implications for the redesign:**

- **Only `wf-09` (BOQ) has a true deep-linkable URL.** Everything else lives behind `WorkflowCanvas` overlay state. If the redesigned page is meant to be shareable / bookmarkable, only the BOQ flow currently supports that out of the box. (See §12, Q4.)
- **`wf-12` clash detection has no dedicated visualizer at all.** Clashes land as a JSON object inside `DataTab`'s tree explorer. This is a redesign opportunity, not a preservation constraint — but flag in §12 (Q3): is the clash report worth a dedicated surface, or accept JSON-tree?
- **AI-prompt-generated workflows.** The same node catalogue is used; the redesign's hero/tab logic in `useHeroDetection.ts` and `useShowcaseData.ts:531-542` is artifact-type-driven (`video`, `image`, `svg`, `3d`, `html`, `json`, `table`, `kpi`, `text`, `file`), not workflow-id-driven. The matrix above therefore covers AI-generated graphs implicitly: whichever artifact type wins the priority chain determines the hero. There is no `workflowId`-keyed branch anywhere in the wrapper — the redesign should either preserve that artifact-driven approach or introduce a workflow-id keyed override.

**Terminal-node → primary-artifact-type lookup** (cross-reference for designers; from `node-catalogue.ts`):

| Catalogue ID | Outputs | Wrapper artifact type seen |
|---|---|---|
| `GN-001` Massing Generator | `geometry, json` | `3d` (procedural) |
| `GN-003` Concept Render | `image` | `image` |
| `GN-007` Image to 3D (SAM 3D) | `geometry (GLB), binary` | `3d` (glb) |
| `GN-008` Text to 3D | `geometry, image` | `3d` (glb) + `image` |
| `GN-009` Video Walkthrough (Kling 3.0) | `binary` (MP4) | `video` |
| `GN-010` Hi-Fi 3D Reconstructor (Meshy v4) | `geometry, image` | `3d` (glb) |
| `GN-011` Interactive 3D Viewer | `binary` (HTML) | `html` (rendered iframe) |
| `GN-012` Floor Plan Editor | `json, geometry, image` | `json` with `interactive: true` flag → `floor-plan-interactive` |
| `TR-007` Quantity Extractor | `json` | `table` (label includes "extracted quantities") |
| `TR-008` BOQ Cost Mapper | `json` | `table` (with `_boqData`/`_totalCost` markers) — drives `boqSummary` |
| `TR-016` Clash Detector | `json` | `json` |
| `EX-001` IFC Exporter | `ifc` | `file` (with `ifcEngine` metadata) |
| `EX-002` BOQ Spreadsheet | `csv` | `file` (.xlsx) |
| `EX-003` PDF Report | `pdf` | `file` (.pdf) |

---

## §2 — Anatomy of the current result page (top to bottom)

The "result page" is `ResultShowcase` rendered by `WorkflowCanvas.tsx:998-1002` inside `<AnimatePresence>`. It mounts when `showShowcase && !isExecuting && artifacts.size > 0`. It does NOT mount during execution.

### 2.1 Entry points (how the user lands on it)

- **Auto-open on completion.** `WorkflowCanvas.tsx:430-454` sets `setShowShowcase(true)` ~500ms after `isExecuting` flips false (with the V2 redirect branch when the flag is on).
- **"View Results" FAB.** `WorkflowCanvas.tsx:1010-1073` — a centered cyan-gradient button that re-opens the showcase. Same flag-gated branch.
- **Tab auto-switch on mount.** `index.tsx:37-44` — when `model3dData` is present and `model3dData.kind !== "floor-plan-interactive"`, the wrapper auto-switches to the `model` tab.

### 2.2 Header (`ShowcaseHeader.tsx`, 156 lines)

| Element | File:line | Data source | Notes |
|---|---|---|---|
| Portal target detection | `ShowcaseHeader.tsx:30-37` | DOM `#canvas-toolbar-slot` | When the showcase opens inside the canvas page, the header content portals into the dashboard's empty top header slot. |
| Back button (`← Back`) | `ShowcaseHeader.tsx:63-97` | i18n `t('showcase.back')` | Calls `onClose` → flips `showShowcase` to false. There is **no separate "back to dashboard" affordance** — Back means "back to the canvas." |
| Project title `<h1>` | `ShowcaseHeader.tsx:100-111` | `currentWorkflow?.name` (defaulted to "Workflow Results" in `useShowcaseData.ts:227`) | Single line, ellipsis. |
| Status pill | `ShowcaseHeader.tsx:113-143` | `successNodes` vs `totalNodes` from `useShowcaseData` | Green "Complete" when all green, amber "X / Y nodes" when partial. **"Honest" partial display is intentional** (`comment at 114-116`). |
| Right-side stats | (intentionally removed) | n/a | `ShowcaseHeader.tsx:147-151` — comment explains they were moved into the body. |

### 2.3 Tab bar (`TabBar.tsx`, 116 lines)

| Element | File:line | Notes |
|---|---|---|
| `availableTabs` filtering | `useShowcaseData.ts:531-542` | overview + export always present; media iff video OR images OR svg; data iff tableData OR jsonData OR kpiMetrics; model iff `model3dData` non-null. |
| 2D-floor-plan relabeling | `TabBar.tsx:94-95` | When `modelTabIs2DFloorPlan` is true (set in `index.tsx:463-466`), the "Model" tab is relabeled to "2D Floor Plan" and the icon swaps from `Box` to `LayoutGrid`. |
| Sticky positioning | `TabBar.tsx:46-62` | Backdrop blur, sticky top under the portaled header. |

### 2.4 Tab content — Overview (`OverviewTab.tsx`, 2302 lines)

This is the heaviest tab — read it as a stack of distinct sections.

| Section | File:line | Data source | What it does |
|---|---|---|---|
| **`AI-Generated Estimate` confidence pill** | `OverviewTab.tsx:164-169` | hardcoded — always rendered | Calls `<ConfidenceBadge tone="ai-estimate" fullWidth ...>`. **No conditional logic.** Shows for every workflow including IFC-exporter-only runs that produce no estimate. |
| Floor-plan-interactive hero | `OverviewTab.tsx:172-217` | `data.model3dData.kind === "floor-plan-interactive"` | Mounts `FloorPlanViewer` (the dedicated CAD editor) directly inside the Overview tab via dynamic import (`OverviewTab.tsx:34-37`). Header bar with stats + "Open Full Editor" button → `window.open("/dashboard/floor-plan?source=pipeline")` (line 199). |
| FloorPlanHero (SVG) | `OverviewTab.tsx:295-658` | `hero.type === "floor-plan"` and `data.svgContent` | Inline-renders DOMPurified SVG with zoom/pan controls, room sidebar, "Download SVG" + "Open 3D Editor" buttons (latter switches to `model` tab). |
| VideoHero | `OverviewTab.tsx:228-234`, `HeroSection.tsx:21-408` | `hero.type === "video"` | Delegates to `HeroSection` (covered in §2.4.1). |
| Model3DHero | `OverviewTab.tsx:913-1073` | `hero.type === "3d-model"` | A clickable card that calls `onNavigateTab("model")`. Specs strip shows `Height`, `Footprint`, `GFA` for procedural models. |
| ImageHero | `OverviewTab.tsx:1079-1310` | `hero.type === "image"` | Active image + thumbnail strip + lightbox. |
| TableHero | `OverviewTab.tsx:1316-1467` | `hero.type === "table"` | Preview of first 8 rows + grand-total auto-computation in last numeric column. |
| TextHero | `OverviewTab.tsx:1473-1551` | `hero.type === "text"` | Show-more/less collapse, displays `data.textContent`. |
| **KPI strip / Insight strip** | `OverviewTab.tsx:254-258` | `data.kpiMetrics` (from `kpi`-type artifacts) OR derived `hero.insights` | Renders `KpiStrip` (max 8) or `InsightStripSection`. KPIs come from artifacts where `data.metrics` is an array (`useShowcaseData.ts:286-294`). |
| **Compact execution banner** | `OverviewTab.tsx:1755-1827` | `data.executionMeta` | "Execution Complete · Apr 25, 8:30 PM" + duration + "X/Y nodes". |
| **BOQ Visualizer CTA** | `OverviewTab.tsx:264, 1667-1749` | `data.boqSummary` (set when TR-008 ran, `useShowcaseData.ts:311-332`) | `<Link href="/dashboard/results/${executionId}/boq">` cyan pill with `Sparkles` icon, currency-formatted cost (`Cr` / `L` / formatted INR), GFA, region, and an `INTERACTIVE` uppercase chip on the right. |
| **TechChips ("Powered by ...")** | `OverviewTab.tsx:1833-1900` | `data.pipelineSteps` keyword-matched against `TECH_MAP` (line 1833-1844) | Lists `GPT-4o`, `DALL-E 3`, `Kling 3.0`, `Three.js`, `Meshy v4`, `web-ifc`, `IFC4`, `Google Maps`. **Vendor name-dropping** — pure decoration, no functional value to the end user. |
| **SupportingCards ("Also Generated")** | `OverviewTab.tsx:1957-2216` | `data.pipelineSteps` filtered by hero artifact type via `HERO_ARTIFACT_TYPES` map (line 1946-1955) | Cards for non-hero artifacts. Each card calls `onNavigateTab(item.targetTab)`. Adds an "export" card if not already present. |
| Pipeline visualization | `OverviewTab.tsx:277-286` | `data.pipelineSteps` | Calls `PipelineViz` — horizontal beads-on-a-string of node statuses. |

#### 2.4.1 `HeroSection.tsx` (the video hero)

| Element | File:line | Data source |
|---|---|---|
| `videoJobId` early-return path | `HeroSection.tsx:74-119` | `data.videoData.videoJobId` (set by VIDEO_BG_JOBS pipeline) | Mounts `SegmentedVideoPlayer` from `src/features/canvas/components/artifacts/SegmentedVideoPlayer.tsx`. |
| Render-phase indicators | `HeroSection.tsx:24-29, 211-234` | `videoGenProgress.phase` | Four phases: "Exterior Pull-in", "Building Orbit", "Interior Walkthrough", "Section Rise". |
| **"Initializing X%" copy** (the one in the user's complaint screenshot) | `HeroSection.tsx:184-185`, `MediaTab.tsx:184-185` | Falls back to `t('showcase.initializing')` from `i18n.ts:1898` ("Initializing") when `videoGenProgress.phase` is undefined | Same string lives in both files. |
| `cinematicWalkthrough` overlay strip | `HeroSection.tsx:345-403` | `videoData.durationSeconds`, `shotCount` or `segments.length` | Includes Download + Fullscreen buttons. |

### 2.5 Tab content — Media (`MediaTab.tsx`, 1002 lines)

| Section | File:line | Notes |
|---|---|---|
| **`AI Concept Art — Not Photorealistic` confidence pill** | `MediaTab.tsx:122-128` | Hardcoded; always rendered when Media tab visible. |
| `CreateVideoCTA` (purple gradient) | `MediaTab.tsx:131-138, 835-1002` | Visible when 3D model exists but no video; calls `handleCreateVideoWalkthrough` (an inline GN-009 invocation, `index.tsx:64-289`). Status badge says "HD · 1080p" + "Kling 3.0 · ~3-8 min". |
| `videoJobId` background-job stream | `MediaTab.tsx:144-149` | Mounts `SegmentedVideoPlayer`. |
| Legacy generation progress | `MediaTab.tsx:151-239` | The "Initializing X%" + phase chips card; uses `GeneratingVideoBackdrop` (a blurred looping sample video behind progress). |
| Inline `<video>` player + metadata strip | `MediaTab.tsx:241-330` | Strip shows: `Duration`, `Shots`, `Pipeline`, `Cost: $X.XX` (line 306, raw USD literal). |
| `VideoExportButtons` | `MediaTab.tsx:319-330, 690-830` | Three buttons: Download MP4 (green/amber gradient), Preview Full Screen, Share Link. |
| Image gallery | `MediaTab.tsx:333-468` | Grid layout, hover reveals download/fullscreen. |
| SVG floor plan inline | `MediaTab.tsx:470-517` | Same DOMPurified SVG render as in OverviewTab's FloorPlanHero (duplicate logic). |
| Lightbox | `MediaTab.tsx:519-625` | Black overlay, ESC-to-close, download + close buttons. |

### 2.6 Tab content — Data & Analysis (`DataTab.tsx`, 647 lines)

| Section | File:line | Notes |
|---|---|---|
| KPI Strip (full) | `DataTab.tsx:24-33` | Reuses `KpiStrip` with `maxItems=20`. |
| **Cost Breakdown** | `DataTab.tsx:36-44` | Renders `CostBreakdownBars` from `useShowcaseData.ts:498-513`. **Auto-derived** when ≥2 KPIs match the keyword regex `cost\|price\|budget\|expense\|total\|amount\|rate`. |
| Compliance Badges | `DataTab.tsx:47-55` | Auto-derived from KPIs whose label matches `compliance\|pass\|fail\|check\|status\|approved\|code` (`useShowcaseData.ts:516-529`). |
| Tables | `DataTab.tsx:58-71, 157-454` | TR-007 quantity tables get inline `<input type="number">` editing; corrections POST to `/api/quantity-corrections` (line 356-372). Last-column auto-sums into a `tfoot` grand total (line 197-208). |
| JSON Explorer | `DataTab.tsx:73-86, 459-647` | Collapsible tree view for any `json` artifact (e.g. clash reports, market prices, building features). |

### 2.7 Tab content — 3D Model (`ModelTab.tsx`, 1072 lines)

The most heterogeneous tab — branches on `model.kind`.

| Branch | File:line | Mounts |
|---|---|---|
| `floor-plan-interactive` | `ModelTab.tsx:115-162` | `FloorPlanViewer` (the full CAD editor with toolbar). Stats strip shows rooms / area / walls / doors / windows. |
| `floor-plan-editor` | `ModelTab.tsx:165-208` | `FloorPlanEditor` (`src/features/canvas/components/artifacts/FloorPlanEditor.tsx`); has a "Generate 3D" button that switches to a Three.js HTML rendering. |
| `html-iframe` (with rooms) | `ModelTab.tsx:213-225` | `HtmlIframeViewer` inside `FloorPlanLayout` (the layout wrapper with stats strip + bottom toolbar + room sidebar). |
| `procedural` | `ModelTab.tsx:874-903` | `ArchitecturalViewer` (Three.js procedural massing). |
| `glb` | `ModelTab.tsx:905-922` | `BIMViewer` (always — even when no metadata, for SSAO/bloom/HDRI). |
| `html-iframe` (no rooms) / SVG fallback | `ModelTab.tsx:227-301` | `HtmlIframeViewer` or DOMPurified SVG. |

`FloorPlanLayout` (`ModelTab.tsx:320-870`) provides the shared toolbar (`Orbit / Top / Walk / Labels / Reset / AI Render`) plus a sidebar with `ROOM EXPLORER` list, `Building Specs` grid, and an **"Open in Floor Plan Editor"** CTA (`ModelTab.tsx:793-844`) that handoffs geometry via `sessionStorage` and opens `/dashboard/floor-plan?source=pipeline`. Footer shows `BuildFlow Engine` (i18n key `showcase.buildflowEngineFooter`) — pure branding.

The **"Experimental 3D Preview" confidence pill** is here too (`ModelTab.tsx:244-249`) — only on procedural / GLB / non-floor-plan branches.

### 2.8 Tab content — Export (`ExportTab.tsx`, 754 lines)

A grid of download cards, ordered by priority:

| Card order | File:line | Notes |
|---|---|---|
| 1. PDF Full Report (primary) | `ExportTab.tsx:124-134, 312-398` | "RECOMMENDED" pill. Calls `generatePDFReport` from `src/services/pdf-report.ts`. |
| 2. Video MP4 | `ExportTab.tsx:137-147` | |
| 3+. Image renders (one per URL) | `ExportTab.tsx:149-160` | |
| 4. SVG floor plan | `ExportTab.tsx:162-172` | |
| 5. CSV table data | `ExportTab.tsx:174-185` | |
| 6. JSON structured data | `ExportTab.tsx:187-197` | |
| 7. Text report | `ExportTab.tsx:199-210` | |
| 8+. File artifacts (IFC, etc.) | `ExportTab.tsx:212-269` | IFC-only `Rich/Lean` `IfcEngineBadge` chip (line 248-269, 683-714). |
| Footer counts | `ExportTab.tsx:434-450` | "X total · Y downloadable · `All exports concept-level`" (i18n `showcase.allExportsConceptLevel`). |

### 2.9 Floating "Behind the Scenes" pill

This is **not** part of the showcase wrapper. It is `ExecutionDiagnosticsPanel` from `src/components/diagnostics/ExecutionDiagnosticsPanel.tsx` (header text "Behind the Scenes" at line 146), mounted independently in `WorkflowCanvas.tsx:1007` and again in `/dashboard/results/[id]/boq/page.tsx:147`. It floats bottom-right during AND after execution and reads `useExecutionStore.currentTrace`.

The user's brief lists the "Behind the Scenes" pill as part of the result-page noise. **It is not removable from inside the wrapper** — the redesign needs to either keep it (it's per-execution diagnostics, not per-page) or remove it from the canvas integration too.

---

## §3 — Dedicated-visualizer entry-point inventory

This is the section closest to the user's "buttons feel weak" complaint. Every route into a dedicated visualizer:

| # | Visualizer | Entry surface | Visual treatment | First-glance prominence | Target |
|---|---|---|---|---|---|
| 1 | **BOQ Visualizer** | `BOQVisualizerCTA` (`OverviewTab.tsx:1683-1745`) | Cyan-gradient pill, ~14px text "Open BOQ Visualizer", small Sparkles icon, INTERACTIVE chip. Total height ~52px. | **Medium** — visible inline in Overview but easy to miss between KPI strip and tech chips. Not a hero. | `/dashboard/results/${executionId}/boq` (deep-link) |
| 2 | **Floor Plan Editor (interactive workflow)** | `OverviewTab.tsx:195-209` "Open Full Editor" button (top-right of header bar) | Solid cyan button, 11px text, opens new tab. | **Low** — a small button in a 32px header bar above the embedded editor. Most users won't notice it because the editor below is already interactive. | `/dashboard/floor-plan?source=pipeline` (sessionStorage handoff) |
| 3 | **Floor Plan Editor (SVG workflow)** | `OverviewTab.tsx:589-617` "Open 3D Editor" button (bottom-right of SVG hero) | Glass cyan button, 11px text. Only visible when `has3DEditor` is true (when a `model3dData` exists alongside SVG). | **Low** — overlay button on the SVG canvas. | Switches to `model` tab — does NOT navigate out. |
| 4 | **Floor Plan Editor (Model tab sidebar)** | `ModelTab.tsx:793-844` "Open in Floor Plan Editor" button | Linear-gradient blue/violet button, 12px text + subtitle "CAD editor with Vastu & BOQ analysis", external-link icon. Full-width sidebar bottom. | **Medium-low** — sits below the Building Specs grid, easy to miss because most users don't click into the sidebar. | `/dashboard/floor-plan?source=pipeline` (new tab) |
| 5 | **3D Model viewer** | `Model3DHero` entire card (`OverviewTab.tsx:929`) | Whole 320px-min hero card is clickable; "Explore 3D Model →" CTA. | **High** for procedural-model workflows — the hero IS the entry point. | Switches to `model` tab — internal. |
| 6 | **IFC Viewer (`/dashboard/ifc-viewer`)** | **None — there is no entry point.** | n/a | n/a — IFC files only land as a download card with `Rich/Lean` engine badge in Export tab (`ExportTab.tsx:212-269`). | The standalone IFC viewer at `/dashboard/ifc-viewer/page.tsx` only accepts IFC uploads via `UploadZone`; it has no `?executionId=...` or artifact-aware mount path. |
| 7 | **Video walkthrough viewer (theater mode)** | "Theater Mode" / "Preview Full Screen" buttons | `MediaTab.tsx:272-289` (icon-only top-right), and `MediaTab.tsx:319-330` (full-width export row). | **Medium** — hover-revealed on the inline player but explicit in the export row. | Calls `setVideoPlayerNodeId` → mounts `FullscreenVideoPlayer` overlay (`WorkflowCanvas.tsx:1078-1087`). |
| 8 | **Image gallery / lightbox** | `<img onClick>` in MediaTab + ImageHero | Click-to-zoom; no explicit button label. | **Low** — entirely implicit. | Inline lightbox component, not a route. |
| 9 | **PDF report** | "PDF Full Report" featured card + RECOMMENDED chip | `ExportTab.tsx:312-398` — full-width hero card. | **High** — only download surface that gets hero treatment. | Generates PDF client-side via `src/services/pdf-report.ts`. |
| 10 | **3D Architectural Viewer (Fullscreen)** | Within `Model3DHero` and `ModelTab` for procedural | n/a (mounted in-place) | High — this IS the model tab content. | Inline component. |

**Findings for redesign:**

- **Dedicated visualizers that have weak entry points: BOQ (small pill), Floor Plan Editor (3 separate small buttons), IFC Viewer (no entry).** This matches the user's "buttons feel weak" complaint.
- **The IFC Viewer at `/dashboard/ifc-viewer` is currently disconnected from the workflow result flow.** A user who runs `wf-08` (PDF Brief → IFC + Video) ends up with an IFC file in the Export tab download grid but no way to open it in the dedicated viewer — they must download the file and re-upload it. This is a clear redesign target.
- **The BOQ entry's prominence is asymmetric to its value.** BOQ is the *only* result type with a true deep-linkable URL and a polished standalone visualizer (`BOQVisualizerPage.tsx`, ~14 components in `src/features/boq/components/`). Yet its entry is a 14px text pill in the middle of the Overview. It deserves hero treatment for BOQ-bearing workflows.
- **No "Re-run" or "Iterate" CTA exists anywhere on the wrapper.** A user who wants to regenerate the same workflow with a tweaked input must navigate back to the canvas. (Re-run on individual nodes does exist via `regenerateNode` in `useExecution.ts`, but not at workflow level.)

---

## §4 — Jargon & noise inventory

### 4.1 Cost / price / currency references

| # | File:line | Text / construct | Always shown? | Notes |
|---|---|---|---|---|
| 1 | `useHeroDetection.ts:191-194` | `value: \`$${data.videoData.costUsd.toFixed(2)}\`` | When `videoData.costUsd != null` | Displayed as an Insight metric in the Overview hero "Insights" strip. Raw USD literal. |
| 2 | `MediaTab.tsx:306` | `{ label: t('showcase.cost'), value: \`$${data.videoData.costUsd.toFixed(2)}\` }` | When videoData has costUsd | Renders in the metadata strip below the inline video. **Same USD literal as above.** |
| 3 | `useShowcaseData.ts:498-513` (CostBreakdown derivation) + `DataTab.tsx:36-44` | `CostBreakdownBars` auto-rendered when ≥2 KPIs match `cost\|price\|budget\|expense\|total\|amount\|rate` regex | Whenever the heuristic matches | This is the bar-chart price tile. **Heuristic-driven**, not workflow-driven — a metric named "Total Floor Area" would qualify because it contains "total". Likely a source of false-positive price tiles. |
| 4 | `OverviewTab.tsx:1668-1675` | `BOQVisualizerCTA` — `${currencySymbol}${(boq.totalCost / 10000000).toFixed(1)} Cr` etc. | Only when `boqSummary` is set (TR-008 ran) | This one is intentional — it's the BOQ entry. INR-formatted, locale-aware. **Keep.** |
| 5 | `DataTab.tsx:203` | `parseFloat(String(val).replace(/[,$]/g, ""))` | Internal heuristic (grand-total computation) | Strips `$` and `,` from cells when summing the last column. Only an issue if the raw cell content is a USD literal. |
| 6 | `OverviewTab.tsx:1327` | Same `[,$]` strip in TableHero grand-total | Internal | Same. |
| 7 | `BOQVisualizerPage.tsx:103-130, 162-200` | `₹` literals throughout | BOQ visualizer (preserved) | This is the dedicated visualizer's own formatting — out of scope for the redesign. |

### 4.2 AI / disclaimer banners

| # | File:line | Tone | Label (i18n key) | Tooltip (i18n) | Always shown? |
|---|---|---|---|---|---|
| 1 | `OverviewTab.tsx:164-169` | `ai-estimate` | `confidence.aiEstimate` → "AI-Generated Estimate" | `confidence.aiEstimateTooltip` → "These KPIs are AI-inferred from your inputs. Verify critical numbers before contract or construction use." | Yes — fullWidth banner at top of every Overview tab. |
| 2 | `MediaTab.tsx:122-128` | `ai-concept` | `confidence.aiConcept` → "AI Concept Art — Not Photorealistic" | `confidence.aiConceptTooltip` → "Generated with DALL-E 3 for concept exploration. Not to scale. Not architecturally accurate." | Yes — fullWidth at top of Media tab. |
| 3 | `ModelTab.tsx:244-249` | `experimental` | `confidence.experimental3d` → "Experimental 3D Preview" | `confidence.experimental3dTooltip` → "Procedurally generated preview. Geometry is approximate and still improving." | Yes — small pill (not fullWidth) on procedural / GLB branches. |
| 4 | `node-catalogue.ts:212` (TR-008 description) | n/a | "AI-estimated — verify with a quantity surveyor before tendering" | n/a | Visible in the catalogue card in the canvas left panel. Out of scope for result page. |

The `ConfidenceBadge` component is at `src/shared/components/ui/ConfidenceBadge.tsx` (88 lines) — it has four tones (`ai-estimate`, `ai-concept`, `experimental`, `preliminary`). Three of the four are wired into the wrapper.

### 4.3 Estimate / approximation language (in-page copy)

| # | File:line | Text |
|---|---|---|
| 1 | `OverviewTab.tsx:222` | `Estimated Total` (the fallback insight label when costBreakdown sums) |
| 2 | `ExportTab.tsx:447-449` | `t('showcase.allExportsConceptLevel')` — i18n key suggests "All exports concept-level" |
| 3 | `ModelTab.tsx:863` | Footer "BuildFlow Engine" (not jargon per se but pure branding) |
| 4 | `OverviewTab.tsx:1878-1898` | "Powered by · GPT-4o · DALL-E 3 · Kling 3.0 · Three.js · Meshy v4 · web-ifc · IFC4 · Google Maps" (TechChips) — vendor name-dropping |
| 5 | `OverviewTab.tsx:2001` | SectionLabel `"Also Generated"` (hardcoded English, NOT i18n'd — see §10) |
| 6 | `ExportTab.tsx:133, 370` | `RECOMMENDED` chip on PDF card — internal classification surfaced to user |
| 7 | `OverviewTab.tsx:1743` | `INTERACTIVE` uppercase chip on BOQ CTA — same |
| 8 | `MediaTab.tsx:988, 996` | `HD · 1080p` and `Kling 3.0 · ~3-8 min` chips on CreateVideoCTA |

### 4.4 Internal jargon / technical labels exposed

| # | File:line | Text | Why it's leaking |
|---|---|---|---|
| 1 | `ExportTab.tsx:687-688, 712` | `Rich` / `Lean` IFC engine badges | Engineering distinction (`ifcopenshell` vs `ifc-exporter` TS fallback) — useful to BIM pros but jargon to general users. |
| 2 | `ExportTab.tsx:251-256` | "Python IFC service unavailable...rebar, curtain-wall, and MEP detail are reduced..." | Long technical tooltip on the Lean badge. |
| 3 | `OverviewTab.tsx:1880-1898` | "Powered by ..." vendor chips | Engineering bragging — not a value prop for a user who came for a floor plan. |
| 4 | `ModelTab.tsx:621` | Bottom-left controls hint: `Left drag: Orbit · Right drag: Pan · Scroll: Zoom · Click: Focus room` | Reasonable but uses 11px monospace; visual treatment makes it look like dev console output. |
| 5 | `OverviewTab.tsx:74` | Execution timestamp uses `en-US` formatter only (`OverviewTab.tsx:1786, 1790`) | Hardcoded locale, not respecting `useLocale()`. Both i18n leak AND noise — execution time isn't core to the result. |
| 6 | `LegacyResultPage.tsx:74` | `Execution {executionId.slice(0, 10)}…` | The 10-char execution-id slice is shown to the user as a fallback header. CUID prefix is meaningless to anyone but engineers. |

---

## §5 — Per-workflow rendering: does the page adapt today?

The wrapper IS adaptive — but adaptation is artifact-type-driven (in `useHeroDetection.ts:48-58` and `useShowcaseData.ts:531-542`), not workflow-id-driven. Here is what each workflow lands on today:

### 5.1 wf-01 (Text Prompt → Floor Plan Editor)

- **Hero kind chosen:** `floor-plan-interactive` (priority 2, beats `3d-model`).
- **What renders:** `OverviewTab.tsx:172-217` — header bar with stats + "Open Full Editor" button + the actual `FloorPlanViewer` mounted full-height inside Overview.
- **Tabs available:** `overview`, `data` (room schedule + BOQ quantities are JSON), `model` (also mounts `FloorPlanViewer`), `export`. **Media** is absent because no images.
- **Adaptation grade:** Good. The dedicated CAD editor IS the Overview hero. The "Open Full Editor" external-tab button is the only entry point and is small (11px, top-right of a 32px header bar). **The wrapper here is mostly out of the way already** — but the AI-Generated Estimate banner above it is noise.

### 5.2 wf-06 (Floor Plan → Render + Video)

- **Hero kind chosen:** `video` (priority 1).
- **What renders:** `HeroSection.tsx:21-408` video player at top, then KPIs, then CompactBanner, then BOQ-CTA (skipped — no TR-008), then TechChips ("Powered by DALL-E 3 · Kling 3.0 · GPT-4o"), then SupportingCards (image, text), then Pipeline.
- **Tabs available:** all five.
- **Adaptation grade:** Decent — video gets hero treatment. But the AI Concept Art pill in Media tab (showing image renders that ARE explicitly concept renders) is redundant.

### 5.3 wf-08 (PDF Brief → IFC + Video)

- **Hero kind chosen:** `video` (priority 1 — beats the IFC `file` artifact entirely; IFC has no hero kind because it's neither `3d` nor `image` etc.).
- **What renders:** Video hero. IFC file lands as a card in Export tab with `Rich/Lean` badge. The text from the brief lands in TextHero only if no video and no other higher-priority artifact wins (here video wins, so the brief text only shows up via SupportingCards link).
- **Tabs available:** overview, media, data (text content), export. No `model` because no 3D artifact (the IFC file isn't a `3d` artifact).
- **Adaptation grade:** **Weak.** A user who came to BuildFlow for a BIM model walks out with a video as the hero. The IFC file — arguably the more valuable deliverable for an architect — is buried as one of N download cards. **No way to open the IFC file in the IFC viewer.**

### 5.4 wf-09 (IFC Model → BOQ)

- **Hero kind chosen:** `table` (priority 6 — only because no video, no 3D, no SVG, no images).
- **What renders:** `TableHero` (`OverviewTab.tsx:1316-1467`) showing first 8 rows of the BOQ table + grand total in the header. KPIs strip if any. **`BOQVisualizerCTA`** appears below as the prominent path forward. Tech chips show "web-ifc" and "GPT-4o".
- **Tabs available:** overview, data (full BOQ table with quantity overrides for TR-007), export (XLSX from EX-002).
- **Adaptation grade:** **OK but the entry signal is weak.** The BOQ visualizer card (ranked the lowest of priority 6) is the actual "go here" path, but it's positioned below the table preview as an afterthought-pill. For a workflow whose entire purpose is "open the BOQ visualizer," this is inverted: the CTA should be the hero.

### 5.5 wf-11 (Building Photo → Renovation Video)

- **Hero kind chosen:** `video`.
- **What renders:** Same as wf-06 — video hero, Powered-by chips list "GPT-4o · Kling 3.0", supporting card for the original photo (image), text analysis in Data tab.
- **Adaptation grade:** Acceptable. Video is the right hero; nothing else competes.

### 5.6 wf-03 / wf-04 (Text/Params → 3D Massing + IFC)

- **Hero kind chosen:** `3d-model` (priority 3, since no video / no floor-plan-interactive).
- **What renders:** `Model3DHero` clickable card → routes to Model tab → mounts `ArchitecturalViewer` (procedural). IFC lands in Export tab.
- **Adaptation grade:** Decent for the 3D model. **Same IFC-orphaning problem as wf-08:** the IFC file has no entry into the dedicated `/dashboard/ifc-viewer`.

### 5.7 wf-05 (Floor Plan → Interactive 3D)

- **Hero kind chosen:** `3d-model` (kind: `html-iframe`).
- **What renders:** `Model3DHero` → Model tab → `HtmlIframeViewer` inside `FloorPlanLayout` with stats strip, room sidebar, walk/orbit/top toolbar.
- **Adaptation grade:** Good. The Model tab does the heavy lifting; the Overview tab's hero card sells "click here to explore."

### 5.8 wf-12 (IFC Upload → Clash Detection)

- **Hero kind chosen:** Falls through to `text` (priority 7) only if the clash report includes a text summary; otherwise `generic` (priority 8) — no hero artifact at all, just CompactBanner + KPIs (none) + BOQ-CTA (skipped) + TechChips + SupportingCards (the clash JSON).
- **What renders:** Mostly empty Overview tab. The clash report JSON lives in Data tab's `JsonExplorer` (collapsible tree).
- **Adaptation grade:** **Bad.** A clash-detection result is conceptually a list of clashes — a table or even a 3D-positioned overlay would be the right surface. JSON tree is what engineers see in dev tools. The wrapper doesn't have a clash-specific surface and no dedicated visualizer exists either.

### 5.9 Summary of adaptation gaps

- IFC-bearing workflows (wf-03, wf-04, wf-08): IFC has no hero kind and no entry to the dedicated viewer.
- Clash detection (wf-12): No appropriate surface.
- BOQ workflow (wf-09): BOQ entry is too quiet for the workflow's defining purpose.
- All workflows: jargon banners (`AI-Generated Estimate`, etc.) are unconditional.

---

## §6 — Data shape: what the result page actually receives

### 6.1 API contract

| Route | Method | File:line | Returns |
|---|---|---|---|
| `/api/executions` | GET | `src/app/api/executions/route.ts:10-67` | `{ executions: [{...execution, artifacts: [{id, type, data, metadata, tileInstanceId, nodeId, nodeLabel, title, createdAt}]}] }` |
| `/api/executions` | POST | `route.ts:69-115` | `{ execution }` — creates `RUNNING` row |
| `/api/executions/[id]` | GET | `[id]/route.ts:10-57` | `{ execution: {...row, workflow:{id,name}, artifacts: [...]} }` |
| `/api/executions/[id]` | PUT | `[id]/route.ts:60-102` | Updates status / tileResults / errorMessage; sets `completedAt` when terminal. |
| `/api/executions/[id]/metadata` | PATCH | `[id]/metadata/route.ts:29-158` | Top-level merge of `quantityOverrides`, `videoGenProgress`, `diagnostics` into `Execution.metadata` JSONB. **Rejects `regenerationCounts`** (server-managed only — line 59-68). |
| `/api/executions/[id]/artifacts` | POST | `[id]/artifacts/route.ts:10-52` | Appends `{nodeId, nodeLabel, type, title, data, createdAt}` into the `tileResults` JSON column. |

### 6.2 Prisma models (from `prisma/schema.prisma`)

```
Execution {
  id, workflowId, userId,
  status: ExecutionStatus (PENDING|RUNNING|SUCCESS|PARTIAL|FAILED) — line 316-322,
  startedAt, completedAt,
  tileResults Json @default("[]"),       ← THE actual artifact storage
  errorMessage,
  metadata Json?,                         ← Per-execution UI state
  artifacts: Artifact[],                  ← Relational table (currently UNUSED)
}

Artifact {
  id, executionId, tileInstanceId,
  type: ArtifactType (TEXT|JSON|IMAGE|THREE_D|FILE|TABLE|KPI|VIDEO) — line 324-333,
  dataUri?, data?, metadata Json,
}
```

**Critical finding:** the Prisma `Artifact` table is empty in production. Per the comments in `[id]/route.ts:36-38`:
> `// Build artifacts from tileResults JSON (where useExecution actually stores them) // The Artifact Prisma relation is empty because the write path uses tileResults JSON`

Every artifact is encoded as a JSON entry inside `Execution.tileResults`. The route handlers map these into "artifact-shaped" objects on read. Any redesign that wants to query artifacts by type (e.g., "give me all video artifacts for this user") cannot use the Artifact table — it must JSON-traverse `tileResults`.

### 6.3 Zustand state (`src/features/execution/stores/execution-store.ts`, 540 lines)

The wrapper does NOT consume the API directly. It reads from the in-memory store:

| Field | Purpose | Hydration |
|---|---|---|
| `currentExecution` | Active row | Set by `useExecution.runWorkflow` after POST /api/executions; or by `restoreArtifactsFromDB` after canvas mount |
| `artifacts: Map<tileInstanceId, ExecutionArtifact>` | The live artifact map driving `useShowcaseData` | Hydrated in `WorkflowCanvas.tsx:200-267` via `restoreExecutionArtifacts` → fetch `/api/executions?workflowId=X&limit=1` → `restoreArtifactsFromDB(latest.artifacts)` |
| `videoGenProgress: Map<nodeId, {progress, status, phase, ...}>` | Live render progress | Polled inside `useExecution`; persisted via debounced PATCH; hydrated on mount via `hydrateVideoGenProgress` |
| `quantityOverrides: Map<tileInstanceId, Map<rowIdx, value>>` | TR-007 user corrections | PATCH-persisted; hydrated via `hydrateQuantityOverrides` |
| `regenerationCounts: Map<tileInstanceId, number>` | Per-node regen cap (3 max) | Server-managed via `/api/execute-node`; hydrated via `hydrateRegenerationCounts` |
| `currentTrace: ExecutionTrace \| null` | Universal "Behind the Scenes" trace | Hydrated via `hydrateDiagnostics` |
| `currentDbExecutionId` | Session-only DB exec id pointer | Set on canvas mount |

Persistence pattern (`execution-store.ts:166-221`): debounced 500ms `flushPersist()` PATCH per field that changed. Field-aware to avoid multi-tab clobber.

### 6.4 Where do video URLs / IFC URLs / images live?

- **Video URLs:** R2-uploaded MP4. Stored in `tileResults[i].data.videoUrl` (or `persistedUrl` for VIDEO_BG_JOBS pipeline). See `useShowcaseData.ts:272-273`.
- **IFC URLs:** R2 OR data-URI for TS-fallback. `tileResults[i].data.downloadUrl` OR `tileResults[i].data._ifcContent` (raw STEP text). See `ExportTab.tsx:217-244`.
- **Image URLs:** R2-uploaded PNG (DALL-E 3). `tileResults[i].data.url`. See `useShowcaseData.ts:251-255`.
- **PDF blobs:** Generated client-side at request time via `src/services/pdf-report.ts` (`ExportTab.tsx:30-48`). Not stored.
- **3D HTML:** Inline `tileResults[i].data.html` (raw HTML) and a downloadUrl pointing at an R2-hosted `.html`.
- **GLB models:** `tileResults[i].data.glbUrl` on R2. Proxied through `/r2-models/` per `next.config.ts` rewrites.
- **Floor plan project (GN-012):** Inline JSON in `tileResults[i].data.floorPlanProject`. Not on R2 (stored entirely in the tileResults JSON column).
- **BOQ summary** (the `boqSummary` derivation): also from the BOQ table artifact's `data._boqData`, `_totalCost`, `_gfa`, `_region`, `_currencySymbol` keys (`useShowcaseData.ts:311-332`).

**Implication:** The redesign has read access to everything via the existing artifact map. Nothing new needs to be added to the API contract.

---

## §7 — Lifecycle state matrix

The wrapper's lifecycle is **artifacts-driven**, not status-driven. Here is what the user sees in each state:

| State | Trigger | Wrapper behavior | File:line |
|---|---|---|---|
| **`idle / pre-execution`** | Canvas open, no run started | Wrapper not mounted. `<ResultShowcase>` is gated on `showShowcase && !isExecuting && artifacts.size > 0` | `WorkflowCanvas.tsx:998-1002` |
| **`running`** | `isExecuting === true` | Wrapper not mounted. Per-node updates flow into the canvas (node statuses go green/amber/red; ExecutionLog pill shows). | `WorkflowCanvas.tsx:430-454` (the `prevExecutingRef` gate ensures the showcase only opens AFTER `wasExecuting && !isExecuting && artifacts.size > 0`) |
| **`complete (SUCCESS)`** | All nodes green | Auto-opens showcase 500ms after `isExecuting` flips false. Header pill: green "Complete". | `index.tsx`, `ShowcaseHeader.tsx:114-122` |
| **`partial (PARTIAL)`** | Some nodes green, some red | Same auto-open. Header pill: amber "X / Y nodes". `t('showcase.partialSuffix')`. | `ShowcaseHeader.tsx:117-122, 138-141` |
| **`failed (FAILED)` — full failure** | All nodes red, **no artifacts** | **Wrapper does NOT open** because `artifacts.size > 0` is false. The user sees the canvas with red nodes and the ExecutionLog pill — no result page at all. There is no top-level "result page failure" UI. | `WorkflowCanvas.tsx:1011` (FAB also gated on `artifacts.size > 0`) |
| **`failed (FAILED)` — partial failure with artifacts** | Some nodes succeeded before the failure | Same as `partial` — opens, shows amber X/Y. `errorMessage` from the API is **not surfaced** anywhere in the wrapper. | The wrapper has no `errorMessage` reader — see `useShowcaseData.ts` (no reference). |
| **`pending video render`** (the user's complaint screenshot) | Video node present, `videoGenProgress.status === "submitting" / "processing" / "rendering"` | Hero shows blurred backdrop + spinner + "Initializing X%" + four phase chips. Renders in BOTH HeroSection AND MediaTab (duplicate logic). | `HeroSection.tsx:156-236`, `MediaTab.tsx:152-238` |
| **`failed (video-specific)`** | `videoGenProgress.status === "failed"` | Hero shows "!" badge + failure message + "Retry Video" button. No top-level page-failure variant. | `HeroSection.tsx:237-288` |
| **`not found / forbidden`** | Direct navigation to `/dashboard/results/[bad-id]` (only reachable when `RESULTS_V2 === "true"`, which is OFF in prod) | `LegacyResultPage.tsx:43-99` renders "We couldn't find this result" empty state with a Go-to-dashboard link. | `LegacyResultPage.tsx:43-99` (currently unreachable in prod because the `RESULTS_V2` flag is OFF and the route redirects to canvas before this state path) |
| **`no artifacts at all`** (e.g., dry run) | `artifacts.size === 0` after `isExecuting` flip | Wrapper not mounted; FAB not shown. User sees only the canvas. | `WorkflowCanvas.tsx:998-1011` |

**Findings:**

- The wrapper is **opened reactively from canvas state**, not from a route param. Even the V2 route redirects back to the canvas when the flag is off. There is no first-class "result URL" today except `/dashboard/results/[id]/boq`.
- **Hard failures are invisible at the result-page level.** A user whose entire workflow failed sees red nodes on the canvas but never enters the wrapper. The wrapper has no "this run errored, here's why" surface — that responsibility lives in `ExecutionLog` + the per-node `errorMessage` overlay.
- **The "Initializing 5%" state from the original user complaint is the `videoGenProgress.status === "submitting"` branch with `progress = 0` and `phase = undefined`.** Both `HeroSection.tsx:184-185` and `MediaTab.tsx:184-185` render `${videoGenProgress.phase ?? t('showcase.initializing')} — ${progress}%`. If a video is still rendering when the user lands, this is what they'll see. The screenshot was capturing a real product state.

---

## §8 — Mobile / responsive behavior

| File:line | Breakpoint | What changes |
|---|---|---|
| `OverviewTab.tsx:75-160` | `@media (max-width: 768px)` | `fp-hero-layout` becomes column; `fp-room-sidebar` becomes 100% wide max-220px; `insight-grid` collapses to 2-col; `supporting-grid` to 1-col; `model3d-hero` min-height 240px; image overlay controls become column. |
| `OverviewTab.tsx:146-160` | `@media (max-width: 480px)` | `fp-hero-layout` shrinks to 35vh; `insight-grid` to 1fr 1fr (2-col); insight-card shrinks; insight-value to 22px. |
| `MediaTab.tsx` | n/a | **No `@media` blocks.** Image gallery uses `repeat(auto-fill, minmax(320px, 1fr))` — auto-collapses but doesn't optimize for mobile. |
| `DataTab.tsx` | n/a | **No mobile styles.** Tables use `overflowX: auto` so they scroll horizontally on mobile. |
| `ModelTab.tsx` | n/a | **No mobile styles.** `model-tab-container` uses `display: flex` with sidebar fixed at 260px — sidebar will compete with the viewer on tablet/phone. |
| `ExportTab.tsx` | n/a | Grid uses `repeat(auto-fill, minmax(280px, 1fr))` — collapses naturally. |
| `TabBar.tsx:60-61` | n/a | `overflowX: auto` on the tab bar — tabs scroll horizontally if they don't fit. |
| `ShowcaseHeader.tsx` | n/a | Uses `flex-shrink: 0` and `text-overflow: ellipsis` — graceful but no breakpoint-specific layout. |

Touch handling for the Floor Plan SVG hero: `OverviewTab.tsx:393-456` (touch start/move/end with pinch-to-zoom for the SVG).

**Implications for redesign:** The wrapper has partial mobile support — Overview is the most polished, Model and Data tabs have the largest desktop-bias. The dedicated visualizers (`FloorPlanViewer`, `BIMViewer`, etc.) have their own mobile strategies and are out of scope.

---

## §9 — Performance & bundle observations

(Static observations only — no measurements taken.)

| Concern | File:line | Notes |
|---|---|---|
| Heavy components dynamically imported | `OverviewTab.tsx:34-37` | `FloorPlanViewer` lazy-loaded. |
| Heavy components dynamically imported | `MediaTab.tsx:14` (static import of `SegmentedVideoPlayer`) | NOT lazy. |
| Heavy components dynamically imported | `ModelTab.tsx:13-36` | `ArchitecturalViewer`, `Building3DViewer`, `BIMViewer`, `FloorPlanEditor`, `FloorPlanViewer` all `dynamic({ ssr: false })`. |
| Heavy components dynamically imported | `index.tsx:184, 263, 346, 365` | `useExecution.ts` modules dynamically imported on demand for the video CTA path. |
| Video preloading | `MediaTab.tsx:253` | `<video controls autoPlay muted playsInline crossOrigin="anonymous">` — autoplay with muted, no `preload="metadata"` set. The `<video>` defaults to `auto` (browser-decided). |
| Video preloading | `HeroSection.tsx:137-155` | Same pattern. |
| Image optimization | `OverviewTab.tsx:1117-1136`, `MediaTab.tsx:367-383`, `HeroSection.tsx:289-302` | Plain `<img>` with `eslint-disable next/no-img-element` comments. **Not using `next/image`.** This is intentional based on R2 presigned URLs but still leaves perf on the table for AVIF/WebP. |
| DOMPurify SSR guards | `OverviewTab.tsx:312-320`, `MediaTab.tsx:43-47`, `ModelTab.tsx:69-74` | All wrap with `typeof window !== "undefined"` — correct. |
| Tab transition AnimatePresence | `index.tsx:475-524` | All five tabs share a single AnimatePresence; switches are 200ms. |
| `<style>` blocks injected | `OverviewTab.tsx:74-160`, `ExportTab.tsx:452-458`, `MediaTab.tsx:464-466` | Inline `<style>` tags emit CSS. Functional but breaks SSR caching slightly. |

**Implications for redesign:** A standalone result *route* (off the canvas) would benefit from server components for the static parts (header, KPIs) and client components only for interactive surfaces. The current wrapper is fully `"use client"` because it lives on the canvas page.

---

## §10 — Accessibility, i18n, edge cases

### 10.1 i18n

The wrapper uses `useLocale()` from `src/hooks/useLocale.ts` extensively. Coverage examples (from `src/lib/i18n.ts`):

- `showcase.back`, `showcase.complete`, `showcase.partialSuffix`, `showcase.viewResults`
- `showcase.tabOverview`, `showcase.tabMedia`, `showcase.tabData`, `showcase.tabModel`, `showcase.tabExport`
- `showcase.executionComplete`, `showcase.nodes`, `showcase.duration`, `showcase.shots`, `showcase.cost`, `showcase.pipeline`
- `showcase.cinematicWalkthrough`, `showcase.fullscreen`, `showcase.theaterMode`, `showcase.downloadMP4`, `showcase.shareLink`
- `showcase.kpiTitle`, `showcase.costBreakdown`, `showcase.complianceChecks`, `showcase.tables`, `showcase.structuredData`
- `showcase.no3dModel`, `showcase.buildingSpecs`, `showcase.specHeight`, `showcase.specFootprint`, `showcase.specGfa`, etc.
- `showcase.pdfFullReport`, `showcase.svgFloorPlan`, `showcase.tableDataCsv`, `showcase.jsonDataExport`, `showcase.textReport`
- `showcase.initializing`, `showcase.renderingWalkthrough`, `showcase.videoRenderingFailed`, `showcase.retryVideo`
- `confidence.aiEstimate`, `confidence.aiEstimateTooltip`, `confidence.aiConcept`, `confidence.aiConceptTooltip`, `confidence.experimental3d`, `confidence.experimental3dTooltip`

### 10.2 Hardcoded English strings (NOT i18n'd) found in the wrapper

| File:line | String |
|---|---|
| `ShowcaseHeader.tsx:147-150` (comment only) | "intentionally removed" — n/a |
| `OverviewTab.tsx:208` | "Open Full Editor" |
| `OverviewTab.tsx:616` | "Open 3D Editor" |
| `OverviewTab.tsx:747` | "Room Details" |
| `OverviewTab.tsx:854` | "Total" (room sidebar footer) |
| `OverviewTab.tsx:873` | "rooms · floors" sentence assembled with hardcoded English plurals |
| `OverviewTab.tsx:1184` | "Download" |
| `OverviewTab.tsx:1206` | "Fullscreen" |
| `OverviewTab.tsx:1462` | "+N more rows — view in Data tab" |
| `OverviewTab.tsx:1723` | "Open BOQ Visualizer" |
| `OverviewTab.tsx:1743` | "INTERACTIVE" |
| `OverviewTab.tsx:1878` | "Powered by" |
| `OverviewTab.tsx:1834-1843` | TECH_MAP names: "GPT-4o", "3D AI Studio", "DALL-E 3", "Kling 3.0", "Meshy v4", "GPT-4o + SVG", "Three.js", "web-ifc", "IFC4", "Google Maps" |
| `OverviewTab.tsx:2001` | "Also Generated" |
| `MediaTab.tsx:988` | "HD · 1080p" |
| `MediaTab.tsx:996` | "Kling 3.0 · ~3-8 min" |
| `MediaTab.tsx:1021` | "No 3D viewer content available" |
| `ModelTab.tsx:155-156` | "Floor plan project data not available in mock mode...." |
| `ModelTab.tsx:173` | "Mode" / "2D Editor" / "Interactive 3D" |
| `ModelTab.tsx:194` | "Back to Editor" |
| `ModelTab.tsx:200` | "Generated 3D Floor Plan" |
| `ModelTab.tsx:451` | "AI Photorealistic Visualization" |
| `ModelTab.tsx:451` | "DALL-E 3 HD" |
| `ModelTab.tsx:477-479` | "ROOMS", "AREA", "SIZE" |
| `ModelTab.tsx:517-523` | "AI Render", "Orbit", "Top", "Walk", "Labels", "Reset", "AI Render..." |
| `ModelTab.tsx:621` | "Left drag: Orbit · Right drag: Pan ..." |
| `ModelTab.tsx:653` | "ROOM EXPLORER" |
| `ModelTab.tsx:742` | "rooms detected" |
| `ModelTab.tsx:757` | "Building Specs" |
| `ModelTab.tsx:761-764` | "Width", "Depth", "Area", "Walls" |
| `ModelTab.tsx:829` | "Open in Floor Plan Editor" |
| `ModelTab.tsx:836` | "CAD editor with Vastu & BOQ analysis" |
| `ModelTab.tsx:1021` | "No 3D viewer content available" |
| `ExportTab.tsx:32, 42, 44` | "Generating PDF report...", "PDF report downloaded", "PDF generation failed" — toast strings, not i18n'd |
| `ExportTab.tsx:687` / `ExportTab.tsx:712` | "Rich" / "Lean" |
| `ExportTab.tsx:692-693` | aria-label: "Generated via IfcOpenShell" / "Generated via TypeScript fallback" |
| `index.tsx:248` | "Video walkthrough ready!" toast |

### 10.3 Accessibility

| Surface | a11y treatment |
|---|---|
| Tab bar | `role="tablist"`, `role="tab"`, `aria-selected`, `tabIndex` (`TabBar.tsx:44, 68-71`) — correct. |
| ConfidenceBadge | `role="note"`, `aria-label` (`ConfidenceBadge.tsx:50-52`) — correct. |
| Lightbox | `role="dialog"`, `aria-modal="true"`, `aria-label` (`OverviewTab.tsx:1257-1259`) — correct in OverviewTab; not present in MediaTab lightbox (`MediaTab.tsx:519-625` — no role attrs). |
| Buttons | Most use plain `<button>` with `aria-label` only sporadically (e.g. CreateVideoCTA at `MediaTab.tsx:853`). |
| Keyboard nav | The CompactBanner, BOQ CTA, SupportingCards, and Model3DHero use `<button>` and `<Link>` correctly — tabbable. ESC handler exists for the Image lightbox (`OverviewTab.tsx:1088-1094`). |
| Reduced motion | **No `prefers-reduced-motion` checks anywhere in the wrapper.** Framer-motion animations (rotate, spring, x: [0, 4, 0]) all run unconditionally. The dedicated `BOQVisualizerPage.tsx:5` does import `useReducedMotion` from framer-motion — but the wrapper does not. |
| RTL | No RTL-specific code anywhere in the wrapper. The dashboard sidebar may handle it elsewhere, but the showcase is LTR-bound (e.g. `ShowcaseHeader.tsx:46` uses `display: "flex"` with no `direction` reset). |

### 10.4 Touch input

`OverviewTab.tsx:393-456` — full pinch/pan/zoom for SVG floor plan hero. Other heroes inherit react-flow / native touch from the dedicated visualizers they delegate to.

---

## §11 — Preservation list and safe-to-change list

### 11.1 PRESERVATION LIST (do not touch in the redesign)

These are the "movies." The redesigned wrapper must link to them, not replace them.

| # | Surface | Path | Why preserved |
|---|---|---|---|
| 1 | **BOQ Visualizer** | `src/features/boq/components/BOQVisualizerPage.tsx` (~620 lines) + ~20 sibling components in `src/features/boq/components/` | Canonical BOQ surface. Has its own price controls, charts (donut + bar + MEP), hero stats, IFC quality card, NL summary, Excel/PDF exports. Lives at `/dashboard/results/[executionId]/boq`. Redesigned wrapper must link in, never re-render its content. |
| 2 | **BOQ route page** | `src/app/dashboard/results/[executionId]/boq/page.tsx` (150 lines) | The deep-link entry. Hydrates execution diagnostics + walks `tileResults` for table+excel+pdf artifacts. |
| 3 | **Floor Plan Editor** | `src/features/floor-plan/components/FloorPlanViewer.tsx` (~30+ child components) + `src/app/dashboard/floor-plan/page.tsx` | Canonical floor-plan surface. Canvas tools: Draw Wall, Place Door, Place Window. The redesign must keep "Open in Floor Plan Editor" CTAs pointing here. |
| 4 | **IFC Viewer** | `src/features/ifc/components/IFCViewerPage.tsx` + `src/features/ifc/components/Viewport.tsx` (web-ifc WASM) + `src/app/dashboard/ifc-viewer/page.tsx` | Canonical IFC surface. Currently disconnected from the result flow — the redesign should add an entry, not modify the viewer. |
| 5 | **Inline-mounted dedicated viewers (in Model tab)** | `src/features/canvas/components/artifacts/BIMViewer.tsx`, `ArchitecturalViewer/`, `Building3DViewer.tsx`, `FloorPlanEditor.tsx`, `SegmentedVideoPlayer.tsx`, `FullscreenVideoPlayer.tsx`, `FullscreenArtifactViewer.tsx` | These are the 3D / video / floor-plan viewers the wrapper delegates to. The wrapper imports and mounts them; redesign must keep doing so (or move them to a different mount point). |
| 6 | **HtmlIframeViewer** | `src/features/execution/components/result-showcase/tabs/ModelTab.tsx:982-1052` | Strictly speaking inside the wrapper, BUT it embeds the GN-011 generated Three.js HTML AND it injects the PostMessage handler at line 924-980 that drives the Orbit/Top/Walk toolbar. Treat as preserved unless you intentionally redesign the GN-011 contract. |
| 7 | **Quantity-correction edit flow** | `DataTab.tsx:301-401` (TR-007 quantity edit + persist) | The inline cell-edit + POST `/api/quantity-corrections` flow is the BOQ accuracy learning loop. The user can override extracted quantities; corrections feed back. Critical to revenue feature. |
| 8 | **Execution metadata persistence** | `src/features/execution/stores/execution-store.ts:166-221` (`schedulePersist` debounce flow) + `src/app/api/executions/[id]/metadata/route.ts` | quantityOverrides / videoGenProgress / regenerationCounts / diagnostics. Survives page reload. Don't disturb the schedulePersist contract. |
| 9 | **Video generation polling** | `src/features/execution/hooks/useExecution.ts` (2,223 lines — partial read) including `retryPollVideoGeneration`, `retryRenderClientWalkthrough` | The pending-video-render lifecycle is driven by these polling functions. The wrapper consumes their state via `useVideoJob` and `videoGenProgress`. Redesign must not reimplement. |
| 10 | **Artifact data shape** | `tileResults` JSON column + `Execution.metadata.{quantityOverrides, videoGenProgress, regenerationCounts, diagnostics}` JSONB | Read-only contract from the redesign's perspective. |
| 11 | **`ExecutionDiagnosticsPanel` ("Behind the Scenes")** | `src/components/diagnostics/ExecutionDiagnosticsPanel.tsx` | Mounted by the canvas AND the BOQ route. Per-execution diagnostic surface. Redesign should decide whether to mount it on the new wrapper, but the component itself is preserved. |
| 12 | **Confidence badge component (the primitive)** | `src/shared/components/ui/ConfidenceBadge.tsx` (88 lines) | The primitive itself is fine. **The instances mounted in the wrapper** (3 of them) are candidates for removal — the component is reusable for legal disclaimers in the BOQ visualizer or elsewhere. |

### 11.2 SAFE-TO-CHANGE LIST

The redesign can freely modify:

| Surface | Path | Notes |
|---|---|---|
| Wrapper orchestrator | `src/features/execution/components/result-showcase/index.tsx` (528 lines) | Remove, restructure, replace with route-based composition. |
| All 5 tab components | `src/features/execution/components/result-showcase/tabs/*.tsx` (5,777 lines total) | Replace with workflow-tailored surfaces. |
| Hero variants | `src/features/execution/components/result-showcase/sections/HeroSection.tsx` and the `*Hero` functions in OverviewTab | Redesign per workflow type. |
| KPI strip / Cost breakdown / Compliance badges | `src/features/execution/components/result-showcase/sections/KpiStrip.tsx`, `CostBreakdownBars.tsx`, `ComplianceBadges.tsx` | Auto-derivation logic in `useShowcaseData.ts:498-529` is heuristic-driven and prone to false positives — safe to scrap or rewrite. |
| Showcase header + tab bar | `ShowcaseHeader.tsx`, `TabBar.tsx`, `constants.ts` | Replace with a route-based header. |
| `useShowcaseData` and `useHeroDetection` hooks | `useShowcaseData.ts` (567 lines), `useHeroDetection.ts` (292 lines) | Re-author for workflow-id-aware adaptation if desired. |
| The "Powered by" tech chips | `OverviewTab.tsx:1833-1900` | Pure decoration — remove or relocate. |
| The "Also Generated" supporting cards | `OverviewTab.tsx:1957-2216` | Remove or replace with workflow-specific layouts. |
| Compact execution banner | `OverviewTab.tsx:1755-1827` | Replace or remove. |
| Three confidence pills (`AI-Generated Estimate`, `AI Concept Art`, `Experimental 3D Preview`) | `OverviewTab.tsx:164-169`, `MediaTab.tsx:122-128`, `ModelTab.tsx:244-249` | Subject to Q2 in §12. |
| Tab auto-switch on 3D | `index.tsx:37-44` | Reconsider. Currently auto-switches to Model unless floor-plan-interactive. |
| Canvas FAB ("View Results") | `WorkflowCanvas.tsx:1009-1073` | If the redesign moves the wrapper off-canvas, this FAB becomes a navigate-to-route button. |
| Auto-open behavior | `WorkflowCanvas.tsx:430-454` | Currently auto-opens the overlay; with a real route this becomes `router.push`. |
| Legacy fallback page | `src/app/dashboard/results/[executionId]/LegacyResultPage.tsx` (101 lines) | Zero-regression fallback only; replace when V2 is real. |
| The flag-gated route shim | `src/app/dashboard/results/[executionId]/page.tsx` (32 lines) | Replace with the real new route. |
| Existing V2 surface (currently dormant) | `src/features/results-v2/**` (~25 files) | Already on disk; the redesign may cherry-pick or discard. |

### 11.3 Off-limits operationally (not technical, but listed for §0.1 hygiene)

- The dedicated visualizers' content models (BOQ table rows, floor-plan project schema, IFC element tree) — out of scope.
- The execution engine, node handlers, prompt logic — irrelevant to the result page.
- Stripe / Razorpay / billing pages.
- Auth + middleware.

---

## §12 — Open questions for Rutik

These need a product decision before a redesign brief can be written. Order is by impact-to-redesign.

1. **Per-workflow primary KPI per result type.** For each workflow, what is the *one number* (or nothing) you want hero-emphasized?
   - `wf-09` (BOQ): is it `Total Cost` (₹ Cr) or `Cost / m²` (₹/m²) or both? Or do you want the BOQ table preview itself as hero (no KPI)?
   - `wf-08` / `wf-03` / `wf-04` (IFC + 3D): is it `Total GFA` or `Floors` or none?
   - `wf-06` / `wf-11` (Video): is the video itself the "KPI" (no number)?
   - The current heuristic-derived KPI strip should probably be removed once these are decided.

2. **The three "AI-Generated Estimate / AI Concept / Experimental 3D" confidence pills — legal requirement or polite caveat?**
   - If legal (e.g. compliance with India advertising guidelines): they stay, but we tighten copy and reduce visual weight.
   - If polite caveat: they go. The product is no longer beta; users have paid for what they got.
   - Particularly: the BOQ pipeline is described in `node-catalogue.ts:212` as "AI-estimated — verify with a quantity surveyor before tendering". Is that legally binding language or marketing softener?

3. **Clash detection (wf-12) — does it deserve a dedicated visualizer?**
   - Today the clash report renders as a JSON tree. A 3D-overlay viewer (highlighting clashes inside the IFC viewer) would be a major new feature, not a redesign.
   - Acceptable answers: (a) build a dedicated `/dashboard/results/[id]/clashes` viewer (out of redesign scope, file as separate effort), (b) keep JSON-tree but hero-promote a "clash count + severity" stat in the wrapper, (c) scope-cut wf-12 from the redesign.

4. **Should the redesigned page be deep-linkable / shareable, or auth-gated?**
   - Today only `/dashboard/results/[id]/boq` is deep-linkable, and it's auth-gated.
   - If you want a public-share variant (like the existing video-share-link flow at `/api/share/video`), that's a database + auth design decision, not a UI one.

5. **"Re-run this workflow" CTA — yes or no?**
   - The result page is the natural place for "I love this; do it again with a different prompt" or "I hate this; tweak input X and rerun." Not present today.
   - If yes: same workflow + modified inputs (prefill canvas with this run's inputs, edit, run)? Or a "branch from here" semantic that creates a new workflow?

6. **"Behind the Scenes" pill — keep, hide, or move?**
   - Currently floats bottom-right on canvas + on the BOQ visualizer. The user listed it as result-page noise. But the trace it surfaces (per-node timings, data-flow JSON, smart summaries) is genuinely useful for power users debugging a pipeline.
   - Options: (a) keep but move into a "Diagnostics" tab on the new wrapper, (b) remove from the result page entirely and keep only on canvas, (c) gate behind a "developer mode" toggle.

7. **IFC viewer integration — do we expose a "Open in IFC Viewer" entry point for IFC-bearing workflows (wf-03, wf-04, wf-08)?**
   - Today `/dashboard/ifc-viewer` is upload-only.
   - To wire it up the redesign needs a `?executionId=...` (or `?artifactId=...`) mount path that pulls the IFC file from `tileResults` and feeds it to the viewer.
   - Confirm this is a desired Phase 1 scope or defer to a follow-up.

8. **Mobile fidelity — what's the bar?**
   - OverviewTab has @media breakpoints down to 480px; ModelTab and DataTab don't. The dedicated visualizers (FloorPlanViewer, BIMViewer) have their own mobile strategies. Is the redesign aiming for "looks great on iPad / acceptable on phone" or "first-class phone experience"?

---

## Appendix A — File inventory (lines read end-to-end vs. partial)

End-to-end:
- `src/features/workflows/constants/prebuilt-workflows.ts` (768)
- `src/features/workflows/constants/node-catalogue.ts` (686)
- `src/app/dashboard/results/[executionId]/page.tsx` (32)
- `src/app/dashboard/results/[executionId]/LegacyResultPage.tsx` (101)
- `src/app/dashboard/results/[executionId]/boq/page.tsx` (150)
- `src/features/execution/components/result-showcase/index.tsx` (528)
- `src/features/execution/components/result-showcase/ShowcaseHeader.tsx` (156)
- `src/features/execution/components/result-showcase/TabBar.tsx` (116)
- `src/features/execution/components/result-showcase/constants.ts` (43)
- `src/features/execution/components/result-showcase/useShowcaseData.ts` (567)
- `src/features/execution/components/result-showcase/useHeroDetection.ts` (292)
- `src/features/execution/components/result-showcase/sections/HeroSection.tsx` (408)
- `src/features/execution/components/result-showcase/sections/KpiStrip.tsx` (116)
- `src/features/execution/components/result-showcase/sections/CostBreakdownBars.tsx` (83)
- `src/features/execution/components/result-showcase/sections/PipelineViz.tsx` (115)
- `src/features/execution/components/result-showcase/sections/ComplianceBadges.tsx` (100)
- `src/features/execution/components/result-showcase/tabs/DataTab.tsx` (647)
- `src/features/execution/components/result-showcase/tabs/ModelTab.tsx` (1072)
- `src/features/execution/components/result-showcase/tabs/ExportTab.tsx` (754)
- `src/features/execution/stores/execution-store.ts` (540)
- `src/app/api/executions/route.ts` (116)
- `src/app/api/executions/[id]/route.ts` (102)
- `src/app/api/executions/[id]/artifacts/route.ts` (52)
- `src/app/api/executions/[id]/metadata/route.ts` (158)
- `src/app/dashboard/floor-plan/page.tsx` (143)
- `src/app/dashboard/ifc-viewer/page.tsx` (31)
- `src/shared/components/ui/ConfidenceBadge.tsx` (88)

Partial (first N lines + targeted spot-reads):
- `src/features/execution/components/result-showcase/tabs/OverviewTab.tsx` (lines 1-1500 + 1500-2303 — full coverage)
- `src/features/execution/components/result-showcase/tabs/MediaTab.tsx` (lines 1-600 + 600-1003 — full coverage)
- `src/features/canvas/components/WorkflowCanvas.tsx` (1136 lines — read 200-450, 980-1080)
- `src/features/boq/components/BOQVisualizerPage.tsx` (lines 1-200; rest scanned for jargon only)
- `prisma/schema.prisma` (980 lines — read 1-300, plus targeted enum greps for ArtifactType/ExecutionStatus/WorkflowComplexity at 310-333)

Searched but not read in full (used for cross-reference):
- `src/features/execution/hooks/useExecution.ts` (2223 lines — searched for poll function names + behind-the-scenes refs)
- `src/lib/i18n.ts` (~5000 lines — grepped for confidence + showcase keys)
- `src/components/diagnostics/ExecutionDiagnosticsPanel.tsx` (header text only)
- `src/features/results-v2/**` (file list only — explicitly excluded per §0.1)

---

## Appendix B — Cross-reference: artifact types ↔ tab/hero treatment

| Artifact type (Prisma `ArtifactType` + extras) | Showcase string type | Default tab | Hero priority | Display path |
|---|---|---|---|---|
| `text` | `text` | data | 7 | `TextHero` if winning, otherwise quote-blocked in Data tab |
| `image` (DALL-E renders) | `image` | media | 5 | `ImageHero` (gallery + lightbox) or thumbnail strip in MediaTab |
| `video` (MP4) | `video` | media | 1 | `HeroSection` video player or MediaTab full player |
| `kpi` (KPI metric set) | `kpi` | data | n/a (always strip-displayed) | `KpiStrip` in Overview + Data |
| `table` | `table` | data | 6 | `TableHero` preview + full editable in Data |
| `json` | `json` | data | n/a unless `data.interactive === true && floorPlanProject` (then floor-plan-interactive priority 2) | `JsonExplorer` tree |
| `svg` | `svg` | media | 4 (`floor-plan` kind) | DOMPurified inline render in Overview FloorPlanHero + MediaTab |
| `3d` | `3d` (procedural / glb) | model | 3 | `Model3DHero` in Overview, full viewer in Model |
| `html` (GN-011) | `html` (html-iframe) or floor-plan-editor | model | 3 | `HtmlIframeViewer` in Model |
| `file` (IFC, PDF, XLSX) | `file` | export | n/a | Card in Export tab; `Rich/Lean` badge for IFC |

Hero-priority chain (full): `1 video > 2 floor-plan-interactive > 3 3d-model > 4 floor-plan > 5 image > 6 table > 7 text > 8 generic`. Source: `useHeroDetection.ts:48-58`.

---

## Appendix C — Glossary (terms used in this audit)

- **Wrapper / Result page:** `ResultShowcase` overlay (`src/features/execution/components/result-showcase/`). The thing being redesigned.
- **Dedicated visualizer:** A workflow-result-specific surface like `BOQVisualizerPage`, `FloorPlanViewer`, `IFCViewerPage`, `BIMViewer`. Sacred per §0.1.
- **Artifact:** A `tileResults[i]` entry — `{ nodeId, nodeLabel, type, title, data, createdAt }`. Backed by `Execution.tileResults` JSON, NOT the Prisma `Artifact` table (which is empty).
- **Catalogue ID / nodeId:** `IN-001`, `TR-007`, `GN-009`, `EX-001` etc. Maps to a `NodeCatalogueItem`. **Do not confuse with `tileInstanceId`** (per-instance random ID like `gn-009-cta-{generateId}`).
- **Behind the Scenes / Diagnostics:** `ExecutionDiagnosticsPanel` (separate from the wrapper). Surfaces per-node timings + data flow + smart summaries from `Execution.metadata.diagnostics`.
- **Hero kind:** One of `video, floor-plan-interactive, 3d-model, floor-plan, image, table, text, generic` — picked by `useHeroDetection.ts:48-58`.
- **`tileInstanceId`:** The per-canvas-node random ID (e.g. `gn-009-abc1234`). Used as the key for the `artifacts` Map in the execution store.

— END OF AUDIT —
