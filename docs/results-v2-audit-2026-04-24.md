# Results V2 — Phase A Audit

**Date:** 2026-04-24
**Branch:** `feat/results-v2-cinematic`
**Author:** Claude Code (ultrathink mode)
**Scope:** Read-only audit of the current execution-result surface. No source
files are modified in this phase.

---

## A.1 File & Route Inventory

### Routes

| Route | File | Purpose |
|---|---|---|
| `/dashboard/canvas?id=<workflowId>` | `src/features/canvas/components/WorkflowCanvas.tsx:990` | Host page that, after a run completes, mounts the `ResultShowcase` overlay on top of the canvas (image-3 shows this surface despite the URL being `/dashboard/canvas`). |
| `/dashboard/results/[executionId]/boq` | `src/app/dashboard/results/[executionId]/boq/page.tsx` | Sub-route for the full-screen BOQ visualizer. **No `page.tsx` exists at the `[executionId]` root** — `/dashboard/results/[id]` is currently a 404. |

> Implication: the flag-gated `/dashboard/results/[executionId]/page.tsx` that
> V2 introduces is a **net-new route**. "Legacy path = bit-identical to
> production" therefore means: with flag OFF, the new page renders the existing
> `ResultShowcase` in a full-page standalone wrapper so the surface exists for
> deep-linking without changing the canvas overlay behavior.

### Result-Showcase source tree (current)

| File | LOC | Purpose |
|---|---|---|
| `src/features/execution/components/result-showcase/index.tsx` | 528 | Top-level composer; owns tab state, video-create/retry CTAs, and persistence side-effects. Wraps each tab in `ErrorBoundary`. |
| `src/features/execution/components/result-showcase/ShowcaseHeader.tsx` | 5.5 KB | Portal-aware header (renders into `#canvas-toolbar-slot` when inside canvas, else stand-alone). Back arrow · title · artifact count · node-success chip. |
| `src/features/execution/components/result-showcase/TabBar.tsx` | 3.7 KB | Horizontal tab bar (`overview / media / data / model / export`). |
| `src/features/execution/components/result-showcase/useShowcaseData.ts` | 568 | Central selector — reads `useExecutionStore.artifacts` (Map) + `useWorkflowStore.nodes` and projects into a single `ShowcaseData` record (hero image, video, KPI, tables, 3D kind, files, compliance, BOQ summary, available tabs). |
| `src/features/execution/components/result-showcase/useHeroDetection.ts` | ~320 | Picks a hero "type" and a short `insights[]` list. **Source of the forbidden `$1.54 Cost` tile** (line 189–194 → `$${videoData.costUsd.toFixed(2)}`). |
| `src/features/execution/components/result-showcase/constants.ts` | 44 | Colors, tab ids, category palette. |
| `src/features/execution/components/result-showcase/sections/HeroSection.tsx` | 409 | Current hero renderer. **Source of the cramped video box** (`maxHeight: 400`) and the "Rendering Walkthrough — Initializing — 5%" spinner. |
| `src/features/execution/components/result-showcase/sections/KpiStrip.tsx` | 3.7 KB | 3-column equal-weight KPI tile strip (image-3 sin #4). |
| `src/features/execution/components/result-showcase/sections/CostBreakdownBars.tsx` | 2.6 KB | Derived-from-KPI cost bars. |
| `src/features/execution/components/result-showcase/sections/PipelineViz.tsx` | 3.7 KB | Node timeline (the "Behind the Scenes" footer pill in image-3 links here). |
| `src/features/execution/components/result-showcase/sections/AnimatedNumber.tsx` | 800 B | Counter primitive. |
| `src/features/execution/components/result-showcase/sections/ComplianceBadges.tsx` | 2.7 KB | Pass/fail chips. |
| `src/features/execution/components/result-showcase/tabs/OverviewTab.tsx` | **77 KB** | Giant component. Renders the orange "AI-Generated Estimate" `ConfidenceBadge` at the very top (line 164). Hosts the hero+insights+secondary artifacts+pipeline viz grid. |
| `src/features/execution/components/result-showcase/tabs/MediaTab.tsx` | 37 KB | Video + image grid; also contains a `$${costUsd}` mention at line 306. |
| `src/features/execution/components/result-showcase/tabs/DataTab.tsx` | 23 KB | Tables, JSON, KPI deep-view. |
| `src/features/execution/components/result-showcase/tabs/ModelTab.tsx` | 44 KB | 3D viewer host. |
| `src/features/execution/components/result-showcase/tabs/ExportTab.tsx` | 26 KB | Download list. |

### Hooks that drive result-page state

| File | Purpose |
|---|---|
| `src/features/execution/hooks/useExecution.ts` (98 KB) | The execution engine client. Orchestrates node dispatch, video polling (`retryPollVideoGeneration`, `retryRenderClientWalkthrough`), and pushes results into `useExecutionStore`. Not directly consumed by V2 — V2 reads the already-written store + API. |
| `src/features/execution/hooks/useVideoJob.ts` | Polls `/api/video-jobs/[id]` for the `VIDEO_BG_JOBS` pipeline (`videoJobId` path). `SegmentedVideoPlayer` consumes the view. |
| `src/features/execution/stores/execution-store.ts` (22 KB) | Zustand: `currentExecution`, `artifacts: Map<nodeId, Artifact>`, `videoGenProgress: Map<nodeId, VideoGenerationState>`, `quantityOverrides`, `currentTrace`. |
| `src/shared/stores/ui-store.ts` | `videoPlayerNodeId` — opens the fullscreen `<VideoPlayer>` modal. |
| `src/features/workflows/stores/workflow-store.ts` | `nodes`, `edges`, `currentWorkflow`. The showcase reads `node.data.status / label / category / catalogueId` to build the pipeline viz. |

### API surfaces the result page depends on

| Endpoint | Shape | Used for |
|---|---|---|
| `GET /api/executions/[id]` | `{ execution: { id, workflowId, status, startedAt, completedAt, tileResults[], metadata, workflow:{id,name}, artifacts:[{tileInstanceId,type,data,metadata,...}] } }` | Page-load hydration. Adapter normalizes the array of `artifacts` to the Map shape `useExecutionStore` uses. Note — `tileResults` is source-of-truth; the `Artifact` Prisma relation is empty. |
| `PATCH /api/executions/[id]/metadata` | Merges `diagnostics / quantityOverrides / videoGenProgress` | Used by existing Overview/Data tabs — V2 preserves the write path untouched. |
| `POST /api/executions/[id]/artifacts` | Appends a tile result | Used by the post-completion video-persist effect in `ResultShowcase/index.tsx` (lines 394–430). |
| `GET /api/video-status?taskId` | `{ isComplete, hasFailed, progress, videoUrl, failureMessage }` | Single-task Kling poll used by the inline `pollSingle` in `ResultShowcase/index.tsx`. |
| `GET /api/video-jobs/[id]` | Job view consumed by `useVideoJob` | `VIDEO_BG_JOBS` pipeline. |

---

## A.2 Workflow Variant Matrix

Sourced from `src/features/workflows/constants/prebuilt-workflows.ts`
(9 prebuilt templates) + `node-catalogue.ts` (42 catalogue entries across
`input / transform / generate / export`).

| # | Workflow (prebuilt id) | Terminal node | Primary artifact reaching the page | Secondary artifacts | Hero variant (V2) |
|---|---|---|---|---|---|
| 1 | `wf-08` PDF Brief → IFC + Video Walkthrough | GN-004 (Video) + EX-001 (IFC) | **video** (Kling MP4, typically 15s, 2 shots) | **file** (IFC), **text** (PDF-extracted brief), **kpi** (room/area estimates) | **HeroVideo** |
| 2 | `wf-01` Text Prompt → Floor Plan | GN-002 (Floor Plan Project) | **json** with `floorPlanProject` + `interactive:true` → `Model3DData.kind="floor-plan-interactive"` | **svg** (SVG plan), **table** (room schedule, BOQ quantities), **text** | **HeroFloorPlan** |
| 3 | `wf-06` Floor Plan → Render + Video Walkthrough (image-2 / image-3 case) | GN-009 (Video) | **video** (Kling MP4) | **image** (DALL-E 3 exterior + interior renders), **text** (floor-plan analysis) | **HeroVideo** |
| 4 | `wf-03` IFC Model → BOQ Cost Estimate | TR-008 (BOQ) | **table** with `_boqData / _totalCost / _gfa / _region / _currencySymbol` | **kpi** (element counts, total-cost-in-INR as qualitative tier), **file** (xlsx/pdf) | **HeroKPI** (animated counters: rooms · area · elements) |
| 5 | `wf-07` Building Photo → Renovation Video | GN-009 (Video) | **video** | **image** (before/after), **text** | **HeroVideo** |
| 6 | `wf-04` Text Prompt → 3D Building + IFC Export | EX-001 (IFC) + GN-001 (Massing) | **3d** with `procedural` or `glb` | **file** (IFC), **kpi** (floors, height, GFA, footprint) | **HeroViewer3D** |
| 7 | `wf-05` Floor Plan → Interactive 3D Model | GN-011 (HTML iframe) or GN-012 (Floor Plan Editor) | **html** artifact → `Model3DData.kind="html-iframe"` or `"floor-plan-editor"` | **image** (source), **json** (geometry) | **HeroViewer3D** |
| 8 | `wf-02` Parameters → 3D Massing + IFC Export | EX-001 + GN-001 | **3d** (`procedural`) | **file** (IFC), **kpi** | **HeroViewer3D** |
| 9 | `wf-09` IFC Upload → Clash Detection | TR-012 / TR-013 (checks) | **kpi** (pass/fail counts) + **table** | **text** (narrative) | **HeroKPI** |
| — | Ad-hoc canvas builds (image-2 shows one) | Any terminal node | Whatever the user wires | — | Dispatched by `selectHero()` |

### Artifact-to-hero mapping (confirmed shapes)

From `useShowcaseData.ts` lines 199–484 and `types/execution.ts`:

```
ArtifactType = "text" | "json" | "image" | "3d" | "file" | "table" | "kpi" | "svg" | "video" | "html"

VideoArtifactData.data:
  { videoUrl, downloadUrl, name, durationSeconds, shotCount?,
    pipeline?, costUsd? (FORBIDDEN), segments?, videoJobId?,
    videoGenerationStatus? }

3D artifact shapes (discriminated after selectModel3D pass):
  procedural  { floors, height, footprint, gfa, buildingType, style? }
  glb         { glbUrl, metadataUrl?, ifcUrl?, thumbnailUrl?, polycount?, topology? }
  html-iframe { url, content, label, roomCount?, wallCount?, geometry?, aiRenderUrl? }
  floor-plan-editor { geometry, sourceImageUrl, url, content, label, aiRenderUrl? }
  floor-plan-interactive { floorPlanProject, boqQuantities, roomSchedule, svgContent, summary }

KpiArtifactData.data:
  { metrics: [{ label, value, unit?, trend? }, ...] }

BOQ summary detection (useShowcaseData:311–332):
  any "table" artifact with _boqData / _totalCost / label matching
  "bill of quantities" / node.catalogueId === "TR-008"
```

---

## A.3 Flaw Taxonomy (from image-3 + source)

### Critical (must fix)

1. **`$1.54 Cost` tile exposed to user.** Origin: `useHeroDetection.ts:189` (`$${data.videoData.costUsd.toFixed(2)}`) + `MediaTab.tsx:306`. Equal-weight third-column KPI tile in image-3. V2 must not read `costUsd` for display anywhere. Forbidden-pattern grep target: `\$[0-9]` plus `/cost|price|usd|dollar/i`.
2. **Cramped video inside a dark void.** `HeroSection.tsx:152` sets `maxHeight: 400` on the `<video>`. Combined with the surrounding padding and the separate "Rendering Walkthrough — Initializing — 5%" state (lines 161–235) that takes the *same* 280–400 px height, the hero is ≤40% of viewport instead of ≥65 vh.
3. **Generic "Initializing — 5%" spinner.** `HeroSection.tsx:182–184` — loads literal `{phase} — {progress}%` with a `Loader2` spinner on a flat gradient. No cinematic blur-up, no reveal choreography.
4. **No hero-level hierarchy.** `OverviewTab` stacks: orange banner → hero → 3-column metric grid → secondary grid → pipeline viz. Every block has equal visual weight.

### Major

5. **3-column equal-weight KPI strip** (Duration / Shots / Cost). `KpiStrip.tsx` gives every metric the same font size, same tile, same padding. There's no star metric.
6. **3 identical "Also Generated" rectangles** (Document / Render / Download Center in image-3). These are flat glass cards with a trailing arrow — no hierarchy, no preview, no use of the actual asset thumbnail.
7. **Orange disclaimer banner above the hero.** `ConfidenceBadge tone="ai-estimate" fullWidth` at `OverviewTab.tsx:164–168`. Shoved above the most important piece of content, burning the cinematic opening moment. V2 moves it to a subdued AINotes panel footnote (still visible, no longer hero-hog).
8. **"Behind the Scenes · 5 nodes · 6m 0s" as bottom-right afterthought.** The pipeline visualization is reduced to a pill in the bottom-right. It deserves its own panel with per-node reveal.

### Polish

9. **Typography monoculture** — no tracking, uniform weights, no tabular-nums on metrics.
10. **No motion.** Page loads static; no entrance stagger, no counter tick, no parallax.
11. **Color flatness** — everything is neutral grey/cyan. The accent color of the terminal node (video/purple, image/green, IFC/blue) is never honored.
12. **Icon monotony** — Lucide used inconsistently, with some emojis leaking into MediaTab (to be verified in V2 against the anti-emoji rule).
13. **No sticky navigation.** Long panels scroll into ambiguity — user can't jump back to the video from the BOQ table.
14. **Mobile: unverified.** Current showcase was built canvas-first — no confirmed 360 px breakpoint.

---

## A.4 State & Data Flow

### While execution is live (canvas overlay path, not V2)

```
WorkflowCanvas         useExecution (98 KB)          execution-store
──────────────        ─────────────────────        ──────────────────
setShowShowcase(true)  dispatch node handlers  →   artifacts Map(nodeId → Artifact)
  on completion         poll Kling status            videoGenProgress Map
                        persist PATCH /metadata      currentExecution / currentTrace
```

The showcase reads the store directly. It's always live.

### Deep-link (V2 target path)

```
GET /dashboard/results/[id]
  ↓ server component
GET /api/executions/[id]                       ← auth()-guarded
  → { execution: { artifacts[], tileResults[], metadata.diagnostics, … } }
  ↓ client hydrate
useExecutionResult(executionId) → normalizes artifacts[] into the same
                                   categorized shape useShowcaseData exposes
                                   (videoData, heroImageUrl, tables, model3dData, etc.)
```

**Video readiness.** Three concurrent signals:

1. `artifact.data.videoGenerationStatus === "complete"` + non-empty `videoUrl` (legacy one-shot path).
2. `artifact.data.videoJobId` present → poll `useVideoJob` → `view.state === "complete"` (new `VIDEO_BG_JOBS` path).
3. `execution-store.videoGenProgress.get(nodeId)?.status === "complete"` (live run path).

V2's `HeroVideo` must consume all three and treat any one as "ready".

**3D readiness.** When `model3dData !== null`. V2 auto-promotes to `HeroViewer3D` when the terminal node produced a 3D/html artifact *and* no video is primary.

**R2 URLs.** Video `persistedUrl` / download URLs come back from Kling webhook → `/api/executions/.../artifacts` POST → `tileResults[].data.persistedUrl`. 3D models use `/r2-models/<key>.glb` proxy rewrites configured in `next.config.ts`. All URLs are public through the rewrites; no signed-URL step at read time.

**Status source of truth.**
- Live run: `useExecutionStore.currentExecution.status`.
- Deep-link: `execution.status` from API.
- V2 treats `status === "success" || "partial"` as "show the result"; `"running"` → HeroSkeleton; `"failed"` with no artifacts → failure state (not scoped to this phase, but the skeleton variant is designed to gracefully accept that case).

---

## A.5 Hero Variant Decision Matrix

`selectHero(result): HeroVariant` is a **pure, deterministic** reducer over
the normalized result shape. Tie-breaker priority (top-down):

```
1. status in ("pending", "running") && no terminal artifacts yet
     → HeroSkeleton

2. videoData.videoUrl || videoData.videoJobId || videoProgress.status="complete"
     → HeroVideo

3. model3dData.kind in ("procedural", "glb", "html-iframe")
     → HeroViewer3D

4. model3dData.kind in ("floor-plan-editor", "floor-plan-interactive")
   || (svgContent && no video && no image)
     → HeroFloorPlan

5. allImageUrls.length > 0
     → HeroImage          (Ken Burns, scroll parallax)

6. kpiMetrics.length >= 2 || boqSummary
     → HeroKPI            (animated counters, gradient mesh)

7. fallback
     → HeroSkeleton       (with "Generating cinematic walkthrough"
                          — NEVER "Initializing — 5%")
```

Invariants the selector **must** guarantee:

- **Deterministic.** Same `ExecutionResult` → same variant, every render.
- **No hidden dependency on hook order.** Pure function of the normalized result.
- **Graceful when empty.** An execution with zero artifacts never crashes
  the hero; falls into `HeroSkeleton`.
- **`costUsd` is never read by `selectHero`, any hero variant, or any
  surrounding strip.** The new `stripPrice()` utility is applied
  defensively before the hero ever sees the artifact metadata.

---

## Entry point for Phase B

With this audit locked, Phase B writes the design doctrine against these
constraints:

- Legacy `ResultShowcase` stays mounted from canvas. Untouched.
- V2 lives under `src/features/results-v2/**` and is rendered only by the
  new `/dashboard/results/[executionId]/page.tsx` behind
  `NEXT_PUBLIC_RESULTS_V2 === "true"`.
- All data reads go through a single normalized `ExecutionResult`, built
  once from either (a) a server-component prefetch of
  `GET /api/executions/[id]` or (b) the live `useExecutionStore` when the
  page is entered mid-run.
- `stripPrice()` is applied once in the normalization step, so no hero or
  panel ever sees `$1.54` even if the artifact payload carries it.
