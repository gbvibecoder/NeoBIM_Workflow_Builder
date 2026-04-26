# Result Page · Phase 3 — Intent Doc

**Date:** 2026-04-26
**Branch:** `feat/showcase-redesign-v1`
**Charter (from Rutik):** "Full creative liberty. Make it distinct from BOQ visualizer. AEC craft. Lively. Lived-in. Feature-rich. Make me say ok damn."

## Phase 2's wins (do NOT regress)

Single scrollable column · no tabs · light theme on `#FAFAF8` · ₹ not $ · gentle failure UX (amber for partial, red only for full failure) · floating diagnostics pill bottom-right · no Diagnostics tab · BOQ-visualizer-imported `formatINR`/`AnimatedNumber`/`InteractiveDotGrid`. **All preserved.**

## Phase 2's failure (the brief for Phase 3)

Visually correct but generic. Reads as a BOQ-visualizer cousin. Sections feel like SaaS templates. Heroes lack personality. No AEC vocabulary. No microcopy character.

## Phase 3 design direction (decided, not negotiable inside the page)

### Visual identity = Architectural-Computational

The page should read like it belongs to a CAD-adjacent product, not a generic SaaS dashboard. The vocabulary is: drafting marks, dimension lines, section indices, north arrows, monospace technical labels, isometric line drawings, material samples.

### Three motifs I'm picking (not all of them — restraint)

1. **Section indices** in architectural section-marker style: `01 ·`, `02 ·`, `03 ·` next to each section header, slightly oversized in monospace. Mirrors the way a set of construction drawings is paginated.
2. **Drafting marks at card corners** — small `┌` `┐` `└` `┘` brackets in soft graphite, 1px, low opacity. Subliminally architectural; stops a card from looking like a div.
3. **Dimension-line typography** for primary numbers — KPIs get a horizontal underline with end-tick marks underneath, like a dimensional callout on a drawing. The line *draws in* on first reveal (animated `pathLength` 0→1).

### Three motifs I'm rejecting (and why)

- ❌ Literal blueprint blue background — clichéd, dated, and the BOQ visualizer already proved white-on-warm-grey reads better.
- ❌ Isometric building wireframe watermark behind every hero — would compete with actual content, and the floor-plan / 3D-model heroes already SHOW a building.
- ❌ Material chips strip on HeroBoq — Rutik already has this in the BOQ visualizer; doubling it on the result page would be the "BOQ clone" failure mode this phase exists to fix.

### Hero personality (each variant gets distinct character)

| Variant | Distinct personality |
|---|---|
| **HeroBoq** | Dimension-line ₹ Cr at 88px Inter Display, mono `Cost / m²` callout, drawn-underline animation, NO material chips (ceded to BOQ visualizer). |
| **HeroFloorPlan** | Embedded floor plan stays. Header stat row gets a north-arrow icon + drafting-style room-count callout. |
| **HeroVideo** | Full-bleed player + monospace timecode caption (`00:15s · 4 shots · 1080p`), shutter-style icon for the play hint, "Recording on Kling" chip in the corner. |
| **HeroIFC** | (Created fresh — Phase 2 had no dedicated IFC hero, only Model3D.) Engine badge in monospace tag style: `[ IfcOpenShell · RICH ]`. |
| **HeroModel3D** | Stats grid gets monospace dimension labels (`23.5 m × 18.0 m`), drafting-mark accents at card corners. |
| **HeroFailure** | Quiet. No icon tile shouting. Mono error block. Two CTAs. |
| **HeroPending** | Phase chips become section markers (`A · Exterior Pull-in`, `B · Building Orbit`, etc.) in mono. |

### Microcopy refresh (every user-facing string reviewed)

| Phase 2 | Phase 3 |
|---|---|
| `Loading IFC Viewer…` | `Reconstructing the model…` |
| `No IFC found in this execution` | `This run didn't ship an IFC. Open diagnostics to see why.` |
| `Numbers behind the result` | `By the numbers` |
| `Hand off to clients, downstream tools, or your team.` | `Hand it off — to clients, to Revit, to anyone.` |
| `What ran to produce this` | `The trail your run left` |
| `No outputs yet` | `This run finished empty-handed. The diagnostics panel will tell you what happened.` |
| `Open Floor Plan Editor` | (kept — already specific) |
| `Run Again` | (kept — Linear-style verb, no need to fancy it) |
| `Initializing the pipeline` | `Drawing the first frame…` |
| `Generating your cinematic walkthrough` | `Composing your walkthrough — the renderer makes it look easy.` |

Tone: dry, grounded, occasionally wry. Never warm. Never marketing.

### Functional additions (3 picked, 1 deferred)

I'm shipping:
1. **Annotate** — small "Add note" in PageHeader that opens an inline textarea. Note persists per-execution to **localStorage** (key `result-page:note:<executionId>`). No API change. Note shows as an italic line under the page title once written. Limitation noted in PRODUCT QUESTIONS — to make notes sync across devices we'd need a `userNote` field on `Execution.metadata` and an allowlist update on the existing PATCH endpoint. Not silently building that.
2. **Smart share** — replaces Phase 2's plain "Copy link." A dropdown that copies one of three URLs: the result page itself, a deep-link that auto-opens the BOQ visualizer (`?open=boq`), or a deep-link that auto-opens the floor-plan editor (`?open=editor`). The deep-link variants only render when applicable. Receiver lands on the dedicated visualizer, not the wrapper. Implementation reads URL params on mount and `router.push()`-es to the dedicated visualizer route.
3. **Quality fingerprint** — a compact 3-stat widget in the PageHeader: `STEPS 3/3 · DURATION 36s · ARTIFACTS 7`. Architects glance at this when revisiting a run and immediately know if it's worth re-opening. Uses the existing pipeline-step + duration data; zero new data plumbing.

I'm deferring:
- **Compare with previous run** — meaningful only when there are repeat runs of the same workflow with different inputs. Today's data model doesn't track input deltas (only artifact deltas), so a "compare" view would be a count comparison without much insight. Phase 4 work.
- **Regenerate single artifact** — the existing `regenerateNode` plumbing in `useExecution` is canvas-coupled. Calling it from a non-canvas page is doable but risky for one-shot. Phase 4.

### Animation pass

- **Page-settling**: hero box-shadow lifts from `0` to its final value over 600ms, after content appears. Like a drawing being placed on a desk.
- **Drawn-underline on KPI**: `pathLength` 0→1 over 700ms, after first viewport entry. Reduced-motion safe.
- **No ambient cursor-following dot grid** — `InteractiveDotGrid` already does this from the BOQ visualizer; doubling it would muddy the page. Removed in this phase.
- **Microinteractions** on hover: CTA cards lift 2px + soft shadow, no rotation gimmicks.

### Dependencies

**Zero new dependencies.** Considered Lottie (`lottie-react`, ~28kB) for the pending hero — the schematic-line drawing it would enable is achievable with hand-coded SVG + framer-motion `pathLength` for less bundle weight and more design control. Considered Phosphor icons — lucide-react already has Compass / Ruler / Building / Hammer; the missing AEC-specific ones (HardHat, Crane) I'm building as inline SVGs which will be more distinctive than off-the-shelf anyway.

The discipline: **handcrafted SVG primitives beat off-the-shelf icons for a phase whose goal is distinctiveness.**

— END INTENT —
