# Visual Intelligence Pipeline (VIP) — Approach #17

## Core Bet

Image models know spatial layout (trained on millions of real floor plans).
Our existing code knows CAD geometry. We make them collaborate:

- **Image models** decide WHERE rooms go (as rectangles)
- **Existing code** (wall-builder, door-placer, window-placer) synthesizes walls, doors, windows

We do NOT extract walls, doors, or windows from generated images.
Only room rectangles + labels. This is a 10x reduction in failure surface.

## 7-Stage Pipeline

```
Stage 1: Prompt Intelligence
  Parse user prompt → enrich into architect brief → synthesize
  model-specific image generation prompts (2–5 models).

Stage 2: Parallel Image Generation
  Fire all image models in parallel (GPT-Image-1, Gemini Imagen,
  NanoBanana Pro, etc.). Each produces a floor plan image.

Stage 3: Vision Jury
  Claude Sonnet evaluates all generated images and picks the best
  one based on architectural quality, room coverage, and layout logic.

Stage 4: Room Extraction
  GPT-4o Vision extracts room rectangles ONLY from the winning image.
  Output: normalized (0–1) coordinates per room. No walls, no doors.

Stage 5: Synthesis
  Scale normalized rooms to plot dimensions (feet, Y-UP, SW origin).
  Feed into existing buildWalls() / placeDoors() / placeWindows().
  Output: StripPackResult (compatible with existing converter).

Stage 6: Quality Gate
  Claude Sonnet as architect critic. Checks proportions, adjacency,
  natural light access, circulation. Returns pass/fail + issues.
  If fail: retry Stage 4 with feedback (max 2 retries).

Stage 7: Delivery
  StripPackResult → toFloorPlanProject() → FloorPlanProject.
  Uses the existing strip-pack converter (no new converter needed).
```

## Coordinate Convention

- Stages 1–6: feet, Y-UP, origin at SW corner of plot (matches strip-pack engine)
- Stage 7: millimeters, Y-UP, origin at bottom-left (FloorPlanProject format)
- Normalized coordinates (0–1) used in Stages 4–5 as intermediate format

## Fail-Safe Design

The orchestrator wraps all stages in try/catch. If ANY stage throws:
1. Error is logged with stage context
2. Returns `{ success: false, shouldFallThrough: true }`
3. Route handler falls through to PIPELINE_REF (current production)

VIP errors never 500 the endpoint. PIPELINE_REF is the safety net.

## API Keys

Each stage reads its required API key from `process.env` directly:
- `OPENAI_API_KEY` — GPT-Image-1, GPT-4o Vision
- `ANTHROPIC_API_KEY` — Claude Sonnet (jury + quality gate)
- `GOOGLE_AI_API_KEY` — Gemini Imagen

No API keys are passed through the orchestrator config.

## Feature Flag

`PIPELINE_VIP=true` in `.env.local` enables the pipeline.
When enabled, VIP runs first. On failure, falls through to PIPELINE_REF.
When disabled (default), the pipeline is completely skipped.

## File Structure

```
vip-pipeline/
├── types.ts              — All VIP-specific interfaces
├── orchestrator.ts       — runVIPPipeline() entry point
├── stage-1-prompt.ts     — Prompt intelligence
├── stage-2-images.ts     — Parallel image generation
├── stage-3-jury.ts       — Vision jury (Claude Sonnet)
├── stage-4-extract.ts    — Room extraction (GPT-4o Vision)
├── stage-5-synthesis.ts  — Synthesis via existing code
├── stage-6-quality.ts    — Architect critic (Claude Sonnet)
├── stage-7-deliver.ts    — StripPackResult → FloorPlanProject
└── README.md             — This file
```

## Phase Plan

- **Phase 1.1** (current): Scaffolding — types, stubs, feature flag
- **Phase 1.2**: Stage 1 (Prompt Intelligence) + Stage 4 (Room Extraction)
- **Phase 1.3**: Stage 2 (Image Generation) — start with GPT-Image-1 only
- **Phase 1.4**: Stage 3 (Vision Jury) + add Gemini Imagen
- **Phase 1.5**: Stage 5 (Synthesis) + Stage 7 (Delivery)
- **Phase 1.6**: Stage 6 (Quality Gate) + retry loop
- **Phase 1.7**: Add NanoBanana Pro, tuning, A/B testing vs PIPELINE_REF
