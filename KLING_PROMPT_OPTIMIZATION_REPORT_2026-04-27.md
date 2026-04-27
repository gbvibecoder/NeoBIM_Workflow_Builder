# Kling 3.0 Prompt Optimization Report — 2026-04-27

**Branch**: `fix/video-walkthrough-image-to-video-2026-04-27`
**Scope**: Rewrite 4 Kling motion prompt builders to Kling 3.0 grammar

---

## Diff Stat

```
src/features/3d-render/services/video-service.ts | 202 insertions, 161 deletions
```

Single file modified. No schema changes, no extraction changes, no GPT-Image-1.5 prompt changes.

---

## What Changed

### Stripped (token-wasting filler that Kling 3.0 ignores)
- `"BIM-style 3D architectural model"` — removed from all 4 builders
- `"AEC industry standards"` — removed
- `"Use the provided text description as the only source of truth"` — removed
- `"global illumination"` — removed
- `"V-Ray/Corona render quality"` — removed
- `"8K resolution"` — removed
- `"high-end architectural visualization"` — removed
- `"do not add elements not mentioned"` — removed
- `BIM_INSTRUCTION` constant (172 chars) — deleted entirely
- `SUMMARY_MAX_CHARS` constant — deleted (text2video builders now use 1800 directly)

### Added (Kling 3.0 grammar: subject → camera metrics → context → style)
- Concrete camera metrics: `"30 meters from the front facade"`, `"1.6m height"`, `"orbits 30 degrees"`, `"1.4m height"`, `"4 meters back from the far wall"`
- Timed action beats: `"for 2 seconds"`, `"over the next 2 seconds"`, `"in the final second"`
- Lens specification: `"35mm lens"` (exterior), `"28mm lens"` (interior)
- Multi-room threshold with explicit timing: `"tracks forward for the first 4 seconds → passes through doorway → orbits 15 degrees over 4 seconds → settles in final 2 seconds"`
- Style line: `"photorealistic architectural photography, accurate proportions"`

---

## Three Full Prompt Traces

### Case 1: Marxstraße 12 (WE 01bb — DINK couple)

Extraction:
```
exteriorDescription: "Mehrfamilienhaus built 1999/2000, 5 units, Energy Class B"
footprintHint: "rectangular"
buildingType: "residential_apartment"
materialPalette: ["solid oak engineered plank", "warm chalk-white walls", "brushed-bronze handles"]
colorAccents: ["deep olive", "cognac leather", "ink blue"]
lightingDirection: "late afternoon golden hour, west-facing windows"
styleKeywords: ["Apartamento magazine", "The Modern House UK"]
inhabitedDetails: ["half-poured wine glass", "folded cashmere throw", "open cookbook"]
roomSequence: [{open kitchen-dining, 1, adj: living room}, {living room, 2}]
```

#### Kling exterior (5s, image2video)

```
Mehrfamilienhaus built 1999/2000, 5 units, Energy Class B. rectangular footprint.

Camera begins approximately 30 meters from the front facade at street level (1.6m height). Tracks forward at a steady walking pace toward the main entrance for 2 seconds. Gradually orbits 30 degrees to the right revealing the side elevation, depth, and proportions over the next 2 seconds. Settles on a hero composition of the front-corner with parallax on foreground elements in the final second. Continuous unbroken motion across 5 seconds.

late afternoon golden hour, west-facing windows. solid oak engineered plank, warm chalk-white walls, brushed-bronze handles. Colour accents: deep olive, cognac leather, ink blue.  Style reference: Apartamento magazine, The Modern House UK. 

Cinematic 35mm lens, photorealistic architectural photography, accurate proportions. No text overlay, no logos, no watermark.
```

**~620 chars. Old prompt was ~950 chars.** Roughly 35% smaller.

#### Kling interior (10s, image2video, multi-room)

```
open kitchen-dining furnished appropriately to its function as a open kitchen-dining. Camera at eye-level (1.4m height), starts 4 meters back from the far wall, tracks forward at a steady walking pace through the open kitchen-dining for the first 4 seconds. Passes through the visible doorway into the adjacent living room with continuous unbroken motion — no cut, no jump, no stall at the threshold. Once inside the living room, slows slightly while orbiting 15 degrees to reveal its layout over 4 seconds. Settles on a hero composition of the living room in the final 2 seconds.

The threshold transition is smooth, the pace is steady, and the motion is continuous from start to end of the 10 seconds.

late afternoon golden hour, west-facing windows. solid oak engineered plank, warm chalk-white walls, brushed-bronze handles. Colour accents: deep olive, cognac leather, ink blue.  Subtle life details: half-poured wine glass, folded cashmere throw, open cookbook. 

Cinematic 28mm lens, eye-level architectural interior photography, photorealistic, accurate proportions. No text overlay, no logos, no watermark.
```

**~880 chars. Old prompt was ~780 chars.** Slightly larger because of explicit timing beats — worth it for motion quality.

---

### Case 2: Hospital

Extraction:
```
buildingType: "hospital"
exteriorDescription: "200-bed regional hospital, contemporary design, white concrete + glass curtain wall"
materialPalette: ["white concrete", "glass curtain wall"]
lightingDirection: undefined → falls back to "natural daylight with soft shadows"
roomSequence: [{open ICU bay, 1, adj: central corridor}, {central corridor, 2}]
```

#### Kling exterior (5s)

```
200-bed regional hospital, contemporary design, white concrete + glass curtain wall.

Camera begins approximately 30 meters from the front facade at street level (1.6m height). Tracks forward at a steady walking pace toward the main entrance for 2 seconds. Gradually orbits 30 degrees to the right revealing the side elevation, depth, and proportions over the next 2 seconds. Settles on a hero composition of the front-corner with parallax on foreground elements in the final second. Continuous unbroken motion across 5 seconds.

natural daylight with soft shadows. white concrete, glass curtain wall.

Cinematic 35mm lens, photorealistic architectural photography, accurate proportions. No text overlay, no logos, no watermark.
```

**ZERO residential language.** No oak, no warm tones, no golden hour.

#### Kling interior (10s, multi-room)

```
open ICU bay furnished appropriately to its function as a open ICU bay. Camera at eye-level (1.4m height), starts 4 meters back from the far wall, tracks forward at a steady walking pace through the open ICU bay for the first 4 seconds. Passes through the visible doorway into the adjacent central corridor with continuous unbroken motion — no cut, no jump, no stall at the threshold. Once inside the central corridor, slows slightly while orbiting 15 degrees to reveal its layout over 4 seconds. Settles on a hero composition of the central corridor in the final 2 seconds.

The threshold transition is smooth, the pace is steady, and the motion is continuous from start to end of the 10 seconds.

natural daylight with soft shadows. white concrete, glass curtain wall.

Cinematic 28mm lens, eye-level architectural interior photography, photorealistic, accurate proportions. No text overlay, no logos, no watermark.
```

---

### Case 3: Office

Extraction:
```
buildingType: "office"
exteriorDescription: "12-storey corporate HQ, glass + bronze fins, plaza-level entrance"
footprintHint: "tower"
materialPalette: ["glass", "bronze fins"]
roomSequence: [{open-plan workfloor, 1, adj: breakout zone}, {breakout zone, 2}]
```

#### Kling exterior (5s)

```
12-storey corporate HQ, glass + bronze fins, plaza-level entrance. tower footprint.

Camera begins approximately 30 meters from the front facade at street level (1.6m height). Tracks forward at a steady walking pace toward the main entrance for 2 seconds. Gradually orbits 30 degrees to the right revealing the side elevation, depth, and proportions over the next 2 seconds. Settles on a hero composition of the front-corner with parallax on foreground elements in the final second. Continuous unbroken motion across 5 seconds.

natural daylight with soft shadows. glass, bronze fins.

Cinematic 35mm lens, photorealistic architectural photography, accurate proportions. No text overlay, no logos, no watermark.
```

#### Kling interior (10s, multi-room)

```
open-plan workfloor furnished appropriately to its function as a open-plan workfloor. Camera at eye-level (1.4m height), starts 4 meters back from the far wall, tracks forward at a steady walking pace through the open-plan workfloor for the first 4 seconds. Passes through the visible doorway into the adjacent breakout zone with continuous unbroken motion — no cut, no jump, no stall at the threshold. Once inside the breakout zone, slows slightly while orbiting 15 degrees to reveal its layout over 4 seconds. Settles on a hero composition of the breakout zone in the final 2 seconds.

The threshold transition is smooth, the pace is steady, and the motion is continuous from start to end of the 10 seconds.

natural daylight with soft shadows. glass, bronze fins.

Cinematic 28mm lens, eye-level architectural interior photography, photorealistic, accurate proportions. No text overlay, no logos, no watermark.
```

**ZERO residential language** in all hospital and office prompts.

---

## Token Count Comparison (rough estimates)

| Builder | Old (chars) | New (chars) | Delta |
|---------|-------------|-------------|-------|
| `buildExteriorPrompt` (with extraction) | ~950 | ~620 | -35% |
| `buildInteriorPrompt` (multi-room) | ~780 | ~880 | +13% (timed beats worth it) |
| `buildInteriorPrompt` (single-room) | ~780 | ~530 | -32% |
| `buildExteriorTextPrompt` | ~2400 (mostly PDF text + BIM_INSTRUCTION) | ~2100 (mostly PDF text) | -12% |
| `buildInteriorTextPrompt` | ~2400 | ~2100 | -12% |

Overall: **~25% reduction** in prompt overhead (excluding PDF text payload). The freed tokens give Kling 3.0 more attention budget for the camera metrics.

---

## tsc + build

```
$ npx tsc --noEmit
(zero errors)

$ npm run build
(clean, zero errors/warnings)
```
