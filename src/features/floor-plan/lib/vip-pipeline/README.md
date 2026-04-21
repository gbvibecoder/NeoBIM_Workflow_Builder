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

Stage 2: Image Generation
  GPT Image 1.5 produces a 2D floor plan image. (Imagen 4 was
  removed in Phase 2.0a — its output wasn't consumed downstream
  and it hallucinated labels like "TECHNFICALL" / "KITCHAN".)

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

The orchestrator wraps all stages in try/catch. On success:
1. Returns `{ success: true, project, qualityScore, retried }`
2. VipJob transitions to COMPLETED with resultProject

On failure:
1. Returns `{ success: false, shouldFallThrough: true }`
2. Route handler falls through to PIPELINE_REF (safety net)

VIP errors never 500 the endpoint. PIPELINE_REF is the fallback.

## API Keys

Each stage reads its required API key from `process.env` directly:
- `OPENAI_API_KEY` — GPT-Image-1, GPT-4o Vision
- `ANTHROPIC_API_KEY` — Claude Sonnet (jury + quality gate)

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
├── logger.ts             — VIPLogger (ANSI dev / JSON prod)
├── stage-1-prompt.ts     — Prompt intelligence
├── stage-2-images.ts     — Parallel image generation
├── stage-3-jury.ts       — Vision jury (Claude Sonnet)
├── stage-4-extract.ts    — Room extraction (GPT-4o Vision)
├── stage-5-synthesis.ts  — Synthesis via existing code
├── stage-6-quality.ts    — Architect critic (Claude Sonnet)
├── stage-7-deliver.ts    — StripPackResult → FloorPlanProject
└── README.md             — This file
```

## Observability

Every VIP pipeline run is persisted in the `VipGeneration` Postgres table
(`vip_generations`). The admin API at `GET /api/admin/vip-generations`
exposes pagination and filtering by status/userId.

Console output uses VIPLogger:
- Dev: colored ANSI box-drawing (human-readable)
- Prod: single-line JSON per event (grep-friendly)

**Future**: Phase 1.7 will add Upstash Redis hot counters for real-time
success rate / latency percentiles and a Grafana-style admin dashboard.

## Provider Configuration

Stage 2 runs a single image generator:
- **gpt-image-1.5** (OpenAI) — $0.034/image

History:
- Phase 1.5 added `imagen-4.0-generate-001` (Google, $0.04/image) in
  parallel with GPT Image 1.5.
- Phase 2.0a removed Imagen — its output was consumed nowhere
  downstream (extraction uses GPT Image 1.5 exclusively because
  Imagen hallucinated labels like "TECHNFICALL" / "KITCHAN"). Saves
  ~$0.04/generation.
- Nano Banana Pro (`gemini-3-pro-image-preview`) was removed in
  Phase 1.5: preview model, frequent 503s, 3.9x more expensive.

To re-add a provider, create a new file in `providers/` and add one line
to the `PROVIDERS` registry in `stage-2-images.ts`.

## Retention Policy

VipGeneration grows ~1k rows/day at steady state. Plan to add a 90-day
retention policy (Postgres scheduled function or Vercel cron job) before
we hit 100k rows. Not blocking Phase 1.2 — implement in Phase 1.7
alongside the metrics dashboard.

Until then, the `@@index([userId, createdAt(sort: Desc)])` compound index
keeps admin queries fast up to ~365k rows.

## Phase Plan

- **Phase 1.1**: Scaffolding — types, stubs, feature flag
- **Phase 1.2** (current): Observability — VIPLogger, VipGeneration table, admin API
- **Phase 1.3**: Stage 1 (Prompt Intelligence) + Stage 4 (Room Extraction)
- **Phase 1.4**: Stage 2 (Image Generation) — start with GPT-Image-1 only
- **Phase 1.5**: Stage 3 (Vision Jury) + add Gemini Imagen (removed in Phase 2.0a)
- **Phase 1.6**: Stage 5 (Synthesis) + Stage 7 (Delivery)
- **Phase 1.7**: Stage 6 (Quality Gate) + retry loop + Redis counters + dashboard + retention
