# Results V2 — Phase B Design Doctrine

**Date:** 2026-04-24
**Branch:** `feat/results-v2-cinematic`
**Depends on:** `docs/results-v2-audit-2026-04-24.md`

This doctrine is the contract Phase C builds to. It is deliberately specific —
every pixel, timing, and hex value has been decided here so the implementation
phase is mechanical, not interpretive.

---

## B.1 Layout Architecture (top-to-bottom)

```
┌──────────────────────────────────────────────────────────────┐
│ ExperienceHeader               56px, sticky, z-40             │
│  ← back · ✦ workflow name · status pill · share · download-all│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   CinematicHero              65vh desktop / 55vh tablet /   │
│                              90vh mobile, full-bleed         │
│   — selectHero(result) picks one of 6 variants —            │
│                                                              │
│   overlay (bottom-left):  workflow name, Inter 600 clamp()   │
│   overlay (bottom-right): shot chips (derived, not hardcoded)│
│   motion:  blur-up reveal 600ms, parallax drift < 8px        │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ ArtifactRibbon               72px, sticky below hero, z-30    │
│  [▶ Video] [🏠 3D] [📐 Plan] [📊 BOQ] [📄 PDF] [🖼 Renders]  │
│  horizontal scroll on mobile, active = accent glow           │
├──────────────────────────────────────────────────────────────┤
│ OverviewPanel                workflow summary + MetricStrip   │
│   one star metric (giant) + 3 supporting (small)             │
├──────────────────────────────────────────────────────────────┤
│ GeneratedAssetsPanel         adaptive grid                    │
│   video-primary: renders + floor plan row                    │
│   ifc-primary:   renders + plan + kpi                         │
│   plan-primary:  room schedule + BOQ summary                 │
├──────────────────────────────────────────────────────────────┤
│ BehindTheScenesPanel         horizontal node timeline         │
│   lucide icon per catalogueId + hover reveals the artifact   │
├──────────────────────────────────────────────────────────────┤
│ DownloadCenterPanel          categorized download rows        │
│   Video · 3D Model · Documents · Drawings · Raw Files        │
├──────────────────────────────────────────────────────────────┤
│ AINotesPanel                 models used + estimate notice    │
│   pill row: [GPT-4o] [DALL-E 3] [Kling 3.0]                   │
│   the orange "AI-Generated Estimate" disclaimer lives here    │
│   as a single quiet line, not a banner stealing the hero     │
└──────────────────────────────────────────────────────────────┘
```

Every panel is **one screen maximum** — if content exceeds `65vh`, it becomes
scrollable *inside* the panel rather than pushing the page further. The
ArtifactRibbon stays sticky so the user can hop back to the hero or any asset
from any scroll depth.

---

## B.2 Hero Variants

### HeroVideo — the one users see most (image-3 remediation)

| Property | Spec |
|---|---|
| Container aspect | `aspect-[21/9]` on desktop, `aspect-[16/10]` on tablet/mobile — never letterboxed inside a smaller frame |
| Height | `min-h-[65vh]` desktop · `min-h-[55vh]` tablet · `min-h-[82vh]` mobile portrait |
| `<video>` attrs | `autoPlay muted loop playsInline preload="metadata" crossOrigin="anonymous"` |
| Controls | Custom overlay at hover (top ≥10 s after load idle): play/pause · seek scrubber with gradient-fill progress · volume · fullscreen · download |
| Caption | Bottom-left, Inter 600, `clamp(22px, 2.4vw, 36px)`, tracking -0.02 em → workflow name |
| Shot chips | Bottom-right row. **Derived** from `videoData.segments[].label` or from the pipeline's actual render nodes — no hardcoded "Exterior Pull-in / Building Orbit / Interior Walkthrough / Section Rise". If `segments` is empty, fall back to `${shotCount} cinematic shots` |
| Loading state | **No spinner void.** `HeroVideoSkeleton`: gradient-mesh ambient field in accent color + shimmer on the caption slot + thin 2 px progress bar at the very bottom edge. Copy: "Rendering cinematic walkthrough" (no %). |
| Reveal | On first playable frame (`onLoadedData`) → `filter: blur(18px) → blur(0)` over 600 ms, ease-out |
| Parallax | Scroll-linked `translate-y` up to 8 px, never more (avoid motion sickness) |
| **Price scrub** | `stripPrice()` applied to the artifact payload before the caption reads any label. Zero `$` allowed. |

### HeroImage — render-primary workflows

| Property | Spec |
|---|---|
| Source | `allImageUrls[0]` (priority: `aiRenderUrl > heroImageUrl > first image artifact`) |
| Aspect | `aspect-[16/9]`, `object-cover`, 65 vh |
| Ken Burns | `scale: 1.00 → 1.04` over 20 s, `direction: alternate`, paused under `useReducedMotion()` |
| Parallax | `translateY` 0 → 40 px, linear to scroll |
| Overlay | Bottom-left: workflow name + secondary render thumbnails (up to 3) as 48 px circles |
| Next/prev | If `allImageUrls.length > 1`, ← → keys + on-hover arrows cycle |

### HeroViewer3D — IFC-primary workflows

| Property | Spec |
|---|---|
| Container | Same dimensions as HeroVideo, dark backdrop `#070809` |
| Engine | Lazy-import existing `@/features/ifc/components/IfcViewer` or `ProceduralModelViewer` based on `model3dData.kind`. **No direct `three` import in results-v2** — we reuse the feature's renderer to avoid duplication. |
| Auto-rotate | Starts at 0.3 rad/s on idle, pauses on pointer interact, resumes after 3 s idle |
| Ground shadow | Enabled via existing renderer props; no new HDRI added |
| Controls | The embedded renderer's own OrbitControls; our overlay adds only a "Reset view" pill |

### HeroFloorPlan — floor-plan-primary workflows

| Property | Spec |
|---|---|
| Renderer | Existing `FloorPlanViewer` (Konva) from `@/features/floor-plan` — direct reuse |
| Entrance | `scale: 0.92 → 1.0` + `opacity: 0 → 1` over 700 ms, `cubic-bezier(0.22, 1, 0.36, 1)` |
| Room labels | Fade in staggered 60 ms apart after the canvas settles |
| Open-in-editor CTA | Small pill at top-right → opens `/dashboard/floor-plan?source=pipeline` in new tab (same handoff pattern already used in `OverviewTab`) |

### HeroKPI — BOQ / analysis-only workflows

| Property | Spec |
|---|---|
| Primary counter | Inter 700, tabular-nums, `clamp(56px, 7vw, 96px)`; example: total-GFA in m² or total elements |
| Counter animation | 0 → target, 900 ms, `ease-out-cubic`; starts 200 ms after mount (not on scroll) |
| Secondary strip | Up to 5 supporting metrics at `32px / 600 weight`, tabular-nums |
| Background | Gradient mesh: 4 radial gradients at 25/25, 75/25, 25/75, 75/75 slowly drifting in a 20 s loop |
| Price tier | If the workflow produced a BOQ total, show a **tier label only** (`"Premium"` / `"Cinematic quality"` / `"4K output"` — picked per hero variant, not derived from cost), never the currency value. Kept inside this panel, not in the hero overlay. |

### HeroSkeleton — loading / in-progress / failed

| Property | Spec |
|---|---|
| Background | Blurred gradient in the workflow's accent color (B.5), 80 % opacity |
| Shimmer | Staggered 700 ms shimmer on where the caption + chips will land |
| Progress | **Thin 2 px line at bottom of container**, filled left-to-right. No circle, no percentage. |
| Copy | "Rendering cinematic walkthrough" / "Building 3D model" / "Generating floor plan" — picked per workflow category. Never "Initializing — 5%". |
| Failed state | Same layout, accent becomes muted red, copy "Generation failed — retry below". The `retry` CTA uses the existing `handleRetryVideo` plumbing, not new infrastructure. |

---

## B.3 Motion Language

| Element | Timing | Easing | Trigger |
|---|---|---|---|
| Section entrance | 500 ms, 40 ms stagger between children | `cubic-bezier(0.22, 1, 0.36, 1)` | IntersectionObserver 10 % visible |
| Hero blur-to-focus | 600 ms | ease-out | `onLoadedData` / first 3D frame / Konva stage-ready |
| Counter tick | 900 ms | ease-out-cubic | 200 ms after mount |
| Hover-lift (cards) | 200 ms | ease-out | pointerenter |
| Panel switch (ribbon click) | 300 ms | `cubic-bezier(0.4, 0, 0.2, 1)` | scroll-to + brief highlight ring |
| Scroll parallax | linear to scroll, `translateY` ≤ 40 px | — | always |
| Micro-bounce (button press) | 120 ms | ease-out | `onPointerDown` → scale 0.97 → 1.0 |
| Gradient mesh drift | 20 s loop, alternate direction | linear | always (paused in reduced-motion) |

**Reduced-motion contract.** `useReducedMotion()` from framer-motion is
checked at `ResultExperience` level and passed as `reducedMotion: boolean` to
every child that gates animation. When true:

- No Ken Burns, no parallax, no gradient drift.
- Entrances become `opacity 0 → 1` (no y translate) at 200 ms.
- Counters snap to target (no tick).
- Video auto-plays but without the blur-up reveal.

---

## B.4 Typography

| Role | Font | Size | Weight | Tracking | Notes |
|---|---|---|---|---|---|
| Hero caption | Inter | `clamp(22px, 2.4vw, 36px)` | 600 | -0.02 em | |
| Section header | Inter | `20px` | 600 | -0.01 em | |
| Sub-section header | Inter | `13px` | 600 | 0.08 em uppercase | |
| Metric — star | Inter | `clamp(56px, 7vw, 96px)` | 700 tabular-nums | -0.02 em | HeroKPI primary |
| Metric — secondary | Inter | `32px` | 700 tabular-nums | -0.01 em | MetricStrip supporting |
| Body | Inter | `15px` | 400 | 0 | leading 1.6 |
| Caption / chips | Inter | `11px` | 500 uppercase | 0.12 em | |
| Code / IDs | JetBrains Mono (already loaded) | `11px` | 500 | 0 | file sizes, durations |

`font-variant-numeric: tabular-nums` is non-negotiable on every counter and
metric — mis-aligned digit widths during animation look amateur.

---

## B.5 Color — Per-Workflow Accent

Derived in `lib/workflow-accent.ts` from the **terminal node's category**:

| Terminal category | Start | End | Applied to |
|---|---|---|---|
| video-ending (GN-004 / GN-009) | `#8B5CF6` violet | `#06B6D4` cyan | hero vignette bottom, ribbon active glow, counter glow, primary buttons |
| image-ending (GN-003 / GN-005 / GN-007) | `#10B981` emerald | `#F59E0B` amber | same slots |
| ifc-ending (EX-001) | `#3B82F6` blue | `#6366F1` indigo | same slots |
| boq-ending (TR-008) | `#F59E0B` amber | `#F43F5E` rose | same slots |
| default | `#00F5FF` cyan | `#8B5CF6` violet | same slots |

Neutral palette used everywhere else:

```
BG_BASE         #070809
BG_ELEVATED     #0E1014
BORDER_SUBTLE   rgba(255,255,255,0.06)
BORDER_STRONG   rgba(255,255,255,0.12)
TEXT_PRIMARY    #F5F5FA
TEXT_SECONDARY  #B8B8C8
TEXT_MUTED      #9090A8
```

Accent is applied with **restraint**: vignette bottom-gradient at 24 % opacity,
active-ribbon glow at 40 %, counter text-shadow at 18 %. The interior of every
panel stays neutral so the hero can lead.

---

## B.6 Iconography

**Lucide only.** No emoji in product UI. Exact map for the ribbon + panels:

| Concept | Lucide icon |
|---|---|
| Video | `Film` |
| Play (inline CTA) | `PlayCircle` |
| 3D Model | `Box` |
| Floor Plan | `LayoutGrid` |
| BOQ / table | `Table2` |
| KPI / analysis | `BarChart3` |
| Render / image | `Image` |
| PDF | `FileText` |
| Download | `ArrowDownToLine` |
| Share | `Share2` |
| Back | `ArrowLeft` |
| Success | `CheckCircle2` |
| Error / failed | `AlertTriangle` |
| Clock / duration | `Clock` |
| Layers / nodes | `Layers` |
| Pipeline step | `Circle` (filled for success, outlined for skipped) |
| AI model pill | `Sparkles` |

All icons carry `aria-label` even when decorative alongside text (a redundant
label is still more accessible than `aria-hidden` hiding the whole row from
assistive tech on icon-only buttons).

---

## B.7 What NOT To Do (anti-patterns enumerated)

These are the specific mistakes the current results page makes. None of them
may reappear in V2.

- ❌ Small video centered in a dark void → **hero is full-bleed, min 65 vh desktop.**
- ❌ "$1.54 Cost" or any `$N.NN` string anywhere → **stripPrice() at the edge; grep verified in the report.**
- ❌ Label called "Cost", "Price", "USD" visible to user → blocked by the same scrub, plus `useHeroDetection` parity is not ported.
- ❌ "Initializing — 5%" generic spinner → **HeroVideoSkeleton uses a thin 2 px progress line with a category-scoped copy line.**
- ❌ 3-column boring KPI tiles with equal weight → **one star metric + supporting strip (1:3 visual ratio).**
- ❌ 3 identical "Also Generated" rectangles → **GeneratedAssetsPanel uses real thumbnails/previews and is grid-adaptive per variant.**
- ❌ Orange disclaimer banner above the hero → **AI-Generated Estimate is a single neutral footnote at the bottom of AINotesPanel.**
- ❌ "Behind the Scenes" as bottom-right pill → **promoted to its own panel with per-node hover reveals.**
- ❌ Static page with zero motion → **entrance stagger, counter tick, parallax, gradient drift (all reduced-motion safe).**
- ❌ Generic card grid → **hero-led hierarchy with a sticky ribbon.**
- ❌ Emojis in UI → **Lucide only.**
- ❌ New npm dependencies → **zero adds; we reuse framer-motion, lucide-react, tailwind, Konva, three.js viewers that already ship.**
- ❌ `any`, `@ts-ignore`, `as any` → **zero in new code; discriminated unions carry the variance.**
- ❌ Touching `src/features/ifc/**`, `src/features/floor-plan/lib/vip-pipeline/**`, auth, execution engine, DB schema → **not modified; only imported as read-only dependencies where needed.**

---

## Handoff to Phase C

With B.1–B.7 fixed, Phase C builds the file tree described in the mission prompt
(`src/features/results-v2/**`), wires the flag-gated page at
`/dashboard/results/[executionId]/page.tsx`, and ships the source-verification
report. Phase C adds **no** new architectural decisions — only mechanics.
