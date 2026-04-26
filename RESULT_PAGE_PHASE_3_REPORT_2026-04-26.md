# Result Page · Phase 3 Report

**Date:** 2026-04-26
**Branch:** `feat/showcase-redesign-v1`
**HEAD:** Phase 3 commit on top of `ac29891`

---

## 1 · DESIGN INTENT

The brief was: stop translating prompts, start originating. Phase 2 was a faithful BOQ-visualizer cousin — light cards, tidy sections, ₹ symbol, gentle failure. All correct. None of it distinct.

I picked **three architectural motifs** and rejected three more:

**Picked:**
1. **Section indices** in monospace (`01 ·`, `02 ·`, `03 ·`) — mirrors how a set of construction drawings is paginated. Now drives every section header on the page. Loud commitment, quiet execution.
2. **Drafting marks** — four small `┌ ┐ └ ┘` brackets at the corners of the hero card, in soft graphite at 42% opacity. Subliminally architectural; stops the card from looking like a div.
3. **Dimension lines** — animated SVG line with end-ticks, drawn left→right via framer-motion `pathLength`. Renders under the BOQ ₹ Cr KPI to read like a *measurement* on a drawing. Captioned with mono `Total Project · ±15% Estimate`.

**Rejected:**
- Literal blueprint blue background — clichéd.
- Isometric building wireframe behind every hero — would compete with the actual content (heroes already SHOW a building when they have one).
- Material chips strip on HeroBoq — would duplicate the real BOQ visualizer's pattern, defeating the whole point of the phase.

The page now reads as **architectural-computational** without forcing the metaphor. A designer reviewing both this page and the BOQ visualizer should recognize them as cousins from the same product — but never confuse the two.

---

## 2 · NEW DEPENDENCIES

**Zero added.** Restraint over reach.

I evaluated three: `lottie-react` for an animated pending-render schematic (~28kB, rejected — hand-coded SVG + framer-motion `pathLength` gives more design control); `@phosphor-icons/react` for richer AEC vocabulary (rejected — building inline custom SVGs like the NorthArrow is more distinctive than off-the-shelf icons, and lucide already has the rest); custom display fonts via `next/font` (rejected for now — Inter handles display weights well; revisit in Phase 4 if a specific weight is missing).

The discipline: a phase whose goal is "make it ours" should use handcrafted primitives, not vendored ones.

---

## 3 · WHAT'S DIFFERENT FROM PHASE 2

| Surface | Phase 2 | Phase 3 |
|---|---|---|
| Background | Canvas-based mouse-following dot grid (BOQ visualizer's `InteractiveDotGrid`) | Static `PageBackground.tsx` — major grid (96px) + minor dot grid (24px), slow drift on `prefers-reduced-motion: no-preference` only. Doesn't compete with hover affordances. |
| Section headers | Title + subtitle + icon | `01 ·` index in mono + icon + UPPERCASE label + bold title + subtitle. Five sections, indexed sequentially, like drawing-set pagination. |
| Hero corner treatment | Plain rounded card | DraftingMarks at all four corners |
| BOQ KPI | 64px ₹ Cr number, plain | 88px ₹ Cr number with stylistic-set figures, animated DimensionLine underneath, mono `Total Project · ±15% Estimate` caption |
| Video hero metadata | Three labeled stats (Duration / Shots / Pipeline) | Single monospace timecode caption: `15.000s · 4 shots · kling · 1080p` — frame-counter feel |
| Page header date | "26 Apr 2026, 3:42 pm" plaintext | `26 APR 2026 · 15:42` in monospace (technical metadata feel) |
| Page header content | Project title + status pill + date | Title (with NorthArrow when floor-plan workflow) + StatusPill + mono date + QualityFingerprint widget + saved note rendered in serif italic underneath |
| Share button | Single "Copy link" | Smart-share dropdown with up to 4 deep-link targets based on artifacts (wrapper / BOQ / Editor / IFC) |
| Annotation | None | `AnnotateButton` + 400-char textarea, ⌘+Enter saves, persists per-execution to localStorage |
| Quality at-a-glance | Status pill only | `STEPS 3/3 · DURATION 36s · ARTIFACTS 7` mono pill in header |
| Loading copy | "Reading the trail" was not present; was "Loading…" | Replaced with thematic "Reading the trail" / "Drawing the first frame" / "Composing your walkthrough — the renderer makes it look easy" / etc. |
| 404 copy | "We couldn't find this result" | "Nothing under this address · Run ID isn't on the books" |
| Failure copy | "This run didn't complete." | "Something stopped this run before it finished." (less didactic, more honest) |

---

## 4 · FUNCTIONAL ADDITIONS

I shipped **3 of the menu's 7**, fully integrated. Two deferred to Phase 4 with reasons.

### 4.1 · Annotate · `components/features/AnnotateButton.tsx`
Sticky-note icon in the page header. Click → 400-char textarea. ⌘+Enter saves to localStorage at key `result-page:note:<executionId>`. Once a note exists, it renders as a serif italic pull-quote under the page title — a deliberate type contrast with the sans-serif body, like a margin note on a drawing. The icon button gains a soft amber dot indicator when a note is present.

**Test it:** open any result page → click sticky-note icon → write something → ⌘+Enter → reload page → note still there.

### 4.2 · Smart Share · `components/features/SmartShareButton.tsx`
Replaces Phase 2's plain "Copy link." Dropdown surfaces only the deep-link targets that this run actually has artifacts for — so a video-only workflow doesn't show "Open in IFC Viewer." Targets: wrapper page · BOQ Visualizer · Floor Plan Editor · IFC Viewer. Recipient lands on the dedicated visualizer directly, not the wrapper.

The redirect machinery lives in the orchestrator's `useEffect` — when the page mounts with `?open=boq|editor|ifc` and the matching artifact exists, `router.replace()` fires and hands off without flicker. Falls through gracefully if the requested target doesn't apply.

**Test it:** open a BOQ-bearing result → Share dropdown → "BOQ Visualizer · COPY" → paste URL in another tab → arrives directly on the BOQ visualizer.

### 4.3 · Quality Fingerprint · `components/features/QualityFingerprint.tsx`
Compact `STEPS 3/3 · DURATION 36s · ARTIFACTS 7` pill in the page header. Mono technical-label styling, color-coded steps tag (teal when 100%, amber when partial, red when 0).

**Test it:** scroll through past runs in the dashboard's history; you can read the fingerprint at a glance without re-opening each one.

### Deferred (Phase 4)
- **Compare with previous run** — meaningful only when the data model tracks input deltas across runs of the same workflow, which it doesn't today. A count-comparison without input context would be hollow.
- **Regenerate single artifact** — `useExecution.regenerateNode` is canvas-coupled. Calling it from a non-canvas page is doable but risky in one-shot.

---

## 5 · MICROCOPY CHANGES (full inventory)

| File | Phase 2 | Phase 3 |
|---|---|---|
| `DedicatedVisualizerEntries.tsx` label | "Open in" | "Deep links" |
| same · title | "Dedicated workspaces" | "Hand off to the right surface" |
| same · subtitle | "Hand off to the right surface for deeper editing or analysis." | "The result was made here. The work happens over there." |
| `GeneratedAssetsSection.tsx` label | "Generated assets" | "Renders" |
| same · title | "X concept renders" | "X renders, drying" |
| same · subtitle | "Hi-resolution PNGs ready to download or share with the client." | "Hi-resolution PNGs. Click a render to inspect, hover to grab." |
| `DataPreviewSection.tsx` label | "Data & analysis" | "Data" |
| same · title | "Numbers behind the result" | "By the numbers" |
| same · subtitle | "Key metrics, structured data, and tables your downstream tools can consume." | "Metrics, tables, and structured payloads — the parts your downstream tools can read directly." |
| `ExportsSection.tsx` label | "Downloads" | "Exports" |
| same · title | "Export this run" | "Take it with you" |
| same · subtitle | "Hand off to clients, downstream tools, or your team." | "Hand it off — to clients, to Revit, to anyone." |
| `PipelineTimelineSection.tsx` label | "Pipeline" (kept) | "Pipeline" (kept) |
| same · title | "What ran to produce this" | "The trail your run left" |
| same · subtitle | "X steps · Y succeeded" | "X steps · Y succeeded · open Diagnostics for the deep trace" |
| `PartialBanner.tsx` chip | "Mostly finished · X/Y steps" | mono · "0X/0Y · partial run" |
| same · body | "Most of your workflow finished cleanly. The {x} hit a snag — your {y} are all ready below." | "Most of the run cleared. The {x} stalled — your {y} are intact below." |
| same · disclosure | "What didn't finish — {label}" | "The step that stalled · {label}" |
| `FailureSection.tsx` chip | "Run did not complete" | mono · "Run terminated · 00 artifacts" |
| same · title | "This run didn't complete." | "Something stopped this run before it finished." |
| same · body fallback | "The execution didn't produce any artifacts and no specific error message was recorded. Open the diagnostics panel below for the per-node trace, then retry from the canvas to fix the upstream input." | "No specific error was recorded for this run. Open Diagnostics (bottom-right) — the per-node trace usually tells the story. Then retry from the canvas with whatever needs to change." |
| `PendingSection.tsx` headline (rendering) | "Rendering your cinematic walkthrough" | "Composing your walkthrough — the renderer makes it look easy" |
| same · headline (initial) | "Generating your cinematic walkthrough" | "Drawing the first frame" |
| same · subhead init | "Initializing the pipeline" | "Loading the scene" |
| same · footer | "Cinematic walkthroughs typically take 3-8 minutes. You can leave this page and return — progress is saved." | "Three to eight minutes is usual. Close this tab if you need to — when you come back, the render will have kept going." |
| `NotFound.tsx` title | "We couldn't find this result" | "Nothing under this address" |
| same · description | "The execution may have been deleted, or it belongs to a different account." | "Run ID isn't on the books — deleted, or it belongs to a different account." |
| Status pill (loading) | "Loading" | "Reading the trail" |
| Status pill (partial) | "X/Y nodes · view details below" | "X/Y steps · see below" |
| Status pill (failed) | "Did not complete" (kept) | (kept) |

---

## 6 · VERIFICATION

```
$ npx tsc --noEmit
(0 errors)

$ npx eslint src/features/result-page/
(0 errors, 0 warnings)

$ grep -rE '"\$[0-9]|>\$[0-9]' src/features/result-page/
(0 matches)

$ grep -rEn ' as any|@ts-ignore|: any\b' src/features/result-page/
(0 matches)

$ npm run build
✓ Compiled successfully
ƒ /dashboard/results/[executionId]   (server-rendered on demand)
○ /dashboard/ifc-viewer              (prerendered static)
○ /dashboard/floor-plan              (prerendered static)
ƒ /dashboard/results/[executionId]/boq (server-rendered on demand)
```

**Bundle delta:** 0 kB (zero new dependencies). New code is pure component additions inside `src/features/result-page/` — same source folder Phase 2 already counted toward.

**Files added (12):**
```
src/features/result-page/
├── components/aec/
│   ├── DraftingMarks.tsx
│   ├── DimensionLine.tsx
│   ├── MonoLabel.tsx
│   ├── NorthArrow.tsx
│   ├── PageBackground.tsx
│   └── SectionIndex.tsx
├── components/features/
│   ├── AnnotateButton.tsx
│   ├── QualityFingerprint.tsx
│   └── SmartShareButton.tsx
docs/result-page-phase-3-intent-2026-04-26.md
RESULT_PAGE_PHASE_2_DIAGNOSTIC_2026-04-26.md (kept from Phase 2 fix)
RESULT_PAGE_PHASE_3_REPORT_2026-04-26.md     (this file)
```

**Files modified (12):** `index.tsx`, `PageHeader.tsx`, all 9 sections, `empty/NotFound.tsx`.

**Preservation list (audit §11.1):** verified untouched.

---

## 7 · WHAT I'D DO IN PHASE 4

Honest critique of Phase 3 — what I'd push further:

1. **Hero personality is uneven.** BoqVariant got the most love (DimensionLine + 88px display KPI). VideoVariant got the mono timecode treatment. The other variants (HeroFloorPlanInteractive, HeroFloorPlanSvg, Model3DVariant, ImageVariant, ClashVariant, TableVariant, TextVariant, GenericVariant) inherited the DraftingMarks corner treatment via the outer wrapper but didn't get bespoke moves. A Phase 4 round should give each one a signature detail.

2. **Compare with previous run.** Genuinely useful, but needs a small data-model addition first — capture the *input prompt / parameters* on each Execution row so a comparison is meaningful (not just "this run had 4 nodes, that one had 4 nodes too"). Worth scoping.

3. **Annotate's localStorage limit.** Notes don't sync across devices. To fix: add `userNote?: string` to `ExecutionMetadata` in `src/types/execution.ts`, allow it in the `/api/executions/[id]/metadata` PATCH validator, hydrate it through `useResultPageData`. Mechanical change, intentionally not silent-shipping it (see § 8).

4. **The drafting paper background drifts**, but only barely — could use a small mouse-position parallax that's *less* than the BOQ visualizer's full glow follow but *more* than zero. Low-priority polish.

5. **Smart-share could also generate a ChatGPT-style screenshot** of the hero card via `html2canvas` for posting to Slack. Nice-to-have, not essential.

6. **A "compare this run to your benchmark"** widget for BOQ workflows — show the user's ₹/m² against the regional benchmark with a small bar. The data is already there in BOQ's `benchmarkLow` / `benchmarkHigh`. Could reuse the BOQ's `BenchmarkBar` directly.

7. **An optional "isometric building outline" silhouette** behind the BoqVariant — but only when run on workflows that produced a 3D massing. Current rejection of "watermark behind every hero" was right; rejection of "watermark behind some heroes" might have been over-cautious.

---

## 8 · PRODUCT QUESTIONS FOR RUTIK

Three things I wanted to build but stopped at, because they need product input:

**Q1 · Notes that sync across devices.** Today's annotation persists in localStorage only. To make it follow the user across browsers, we'd add a `userNote?: string` to `ExecutionMetadata` (`src/types/execution.ts`) and update the `/api/executions/[id]/metadata` PATCH allowlist validator (`src/app/api/executions/[id]/metadata/route.ts:29-158`) to accept it. Trivial code change, but it's a schema-adjacent decision: do you want notes server-persistent (and visible in admin queries / community publishing flows), or are they intentionally local-only as "private scratchpad"?

**Q2 · Compare with previous run.** Currently we don't capture the user's input prompt on `Execution`. To make "compare" meaningful, we'd want each execution to remember its inputs (text prompt, uploaded file hashes, parameter values). This is a real schema addition. Worth doing if you see users iterating ("does this prompt produce more rooms?"). Skip if usage is mostly one-shot per workflow.

**Q3 · "Run again with tweaks."** Phase 1 deferred this; Phase 3 still defers. The simplest version is: clicking "Run Again" lands on the canvas with the workflow loaded AND the input nodes' previous values pre-filled. The plumbing exists (`prefill-from-execution` sessionStorage flag set by the header), but the *canvas-side reader* needs to be wired. That's a 1-2 hour change in `WorkflowCanvas.tsx` to read the flag on mount and hydrate `InputNode` value props. Worth doing if you observe users actually re-running with tweaks.

— END REPORT —
