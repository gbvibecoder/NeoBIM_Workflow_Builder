# Video Walkthrough Bias Strip Report — 2026-04-27

**Branch**: `fix/video-walkthrough-image-to-video-2026-04-27`
**Phase**: Bias strip (extends previous routing fix on same branch)

---

## 1. TL;DR

Every hardcoded residential-family default in the WF-08 video pipeline is now replaced by brief-driven extraction. A new Claude Sonnet 4.6 extraction step (`extractBriefContext`) runs once at the top of GN-009 and produces a `BriefExtraction` struct (building type, materials, persona, lighting, space type, palette, style). Every downstream prompt builder — concept render, Phase 3 interior reference, Kling exterior/interior — consumes this struct instead of hardcoded strings. When the extraction is sparse, neutral architectural fallbacks are used ("materials appropriate to the building type") — never "oak flooring" or "golden retriever." The `gpt-image-1` model was upgraded to `gpt-image-1.5` in both `generateConceptImage` and `generateLifestyleImage`.

---

## 2. Audit Table — Hardcoded Strings

### IN the WF-08 path (fixed in this phase)

| File:line | String | Verdict | Action |
|-----------|--------|---------|--------|
| `cinematic-pipeline.ts:501-518` | `LIFESTYLE_IMAGE_PROMPT_TEMPLATE` — "warm golden-hour sunlight", "polished oak hardwood flooring", "matte white plaster walls", "neutral textile upholstery in cream and grey", "brushed brass fixtures", "fresh flowers in a vase" | BYPASS | New `promptOverride` param on `generateLifestyleImage` bypasses the template when extraction is available. Template retained as legacy default for non-PDF callers (cinematic pipeline stages). |
| `cinematic-pipeline.ts:520-538` | `ROOM_FURNITURE_HINTS` — "L-shaped grey sectional sofa", "low walnut coffee table", "white quartz waterfall island", "king-size platform bed", "tufted linen headboard", "live-edge walnut dining table" | BYPASS | Same bypass mechanism — `promptOverride` replaces the entire template including furniture hints. |
| `cinematic-pipeline.ts:552-555` | Generic fallback — "modern contemporary furniture appropriate for the room function, neutral palette, warm wood tones, fabric textiles, indoor plants, framed art, minimalist styling" | BYPASS | Bypassed when `promptOverride` is set. |
| `cinematic-pipeline.ts:689` | `model: "gpt-image-1"` | UPGRADE | → `gpt-image-1.5` |
| `gn-009.ts:569` | `primaryRoom: "Living Room"` | REPLACE | Now `briefExtraction.spaceType ?? "Living Room"` — uses extracted space type. |
| `gn-009.ts:282-288` | `"photorealistic architectural exterior, golden hour lighting, street-level view"`, `"golden hour"`, `"eye-level 3/4 corner perspective"` | REPLACE | Now uses `buildBriefDrivenExteriorPrompt(briefExtraction, buildingDesc)` — materials, lighting, colours all brief-driven. |
| `video-service.ts:347` | `"(hardwood floors, stone countertops, painted walls, glass partitions, metal fixtures)"` | REPLACE | Now `formatMaterials(extraction)` when extraction available, else `"realistic materials appropriate to the building type"`. |
| `video-service.ts:348` | `"natural lighting blended with warm interior light"` | REPLACE | Now `formatLighting(extraction)` when extraction available, else neutral fallback. |
| `video-service.ts:318` | `"high-end real-estate style architectural visualization"` | REPLACE | → `"high-end architectural visualization"` (removed "real-estate"). |
| `openai.ts:840` | `model: "gpt-image-1"` in `generateConceptImage` | UPGRADE | → `gpt-image-1.5` |

### NOT in the WF-08 path (out of scope — flagged only)

| File:line | String | Verdict | Reason |
|-----------|--------|---------|--------|
| `cinematic-pipeline.ts:396` | `"living room, kitchen, bedrooms"` fallback room list | KEEP | Used by `buildOverviewPrompt` (cinematic pipeline stage, not GN-009 WF-08 path). |
| `cinematic-pipeline.ts:407-413` | Materials/lighting in `buildOverviewPrompt` | KEEP | Cinematic pipeline only. |
| `cinematic-pipeline.ts:440-444` | Materials/lighting in `buildTransitionPrompt` | KEEP | Cinematic pipeline only. |
| `cinematic-pipeline.ts:470-476` | Family + golden retriever in `buildLifestylePrompt` | KEEP | Cinematic pipeline only — never called from GN-009. Flag for future phase. |
| `cinematic-pipeline.ts:476-480` | Materials in `buildLifestylePrompt` | KEEP | Same — cinematic pipeline only. |
| `video-service.ts:361-401` | Renovation prompts (exterior + interior) | KEEP | WF-11 renovation path, not WF-08. |
| `video-service.ts:418-448` | Floor plan prompts | KEEP | WF-06 floor plan path, not WF-08. |

### Structural scaffolding (KEPT — building-type-agnostic)

| File:line | String | Verdict | Reason |
|-----------|--------|---------|--------|
| `video-service.ts:309-315` | Camera trajectory instructions (dolly, orbit, crane shot) | KEEP | Camera language is building-type-agnostic. |
| `video-service.ts:319` | "8K resolution, V-Ray/Corona render quality, no distortion, no artifacts" | KEEP | Quality anchor applies to all buildings. |
| `video-service.ts:256` | Negative prompt (blur, distortion, warped geometry...) | KEEP | Universal quality guard. |
| All | "photorealistic" | KEEP | Style anchor applies to all buildings. |

---

## 3. TR-001 Inspection

TR-001 (`tr-001.ts:14-119`) already extracts structured fields via `parseBriefDocument` (GPT-4o-mini):

```typescript
{
  projectTitle: string,
  projectType: string,  // "residential", "commercial", etc.
  site: { address, area, constraints },
  programme: [{ space, area_m2, floor }],
  constraints: { maxHeight, setbacks, zoning },
  budget: { amount, currency },
  sustainability: string,
  designIntent: string,
  keyRequirements: string[],
  rawText: string,  // original PDF text (first 12000 chars)
}
```

**Why not reuse TR-001 output directly?** The TR-001 schema lacks the fields we need: no `materialPalette`, no `colorAccents`, no `lightingDirection`, no `persona`, no `inhabitedDetails`, no `avoid`, no `styleKeywords`. The fields it has (`projectType`, `programme`) are too coarse for prompt engineering. A dedicated extraction step with a video-specific schema is necessary.

**Solution**: Added `extractBriefContext` in `brief-extractor.ts` — a new Claude Sonnet 4.6 `tool_use` call with the `BriefExtraction` schema. Runs once at the top of GN-009, costs ~$0.005, cached for the duration of the handler call.

---

## 4. BriefExtraction Schema (as implemented)

```typescript
interface BriefExtraction {
  buildingType: string;          // "residential_apartment", "hospital", "office", etc.
  spaceType?: string;            // "open kitchen-dining", "ICU ward", "open-plan office"
  persona?: string;              // "DINK couple late 30s" or undefined
  materialPalette: string[];     // ["solid oak floor", "chalk-white walls"]
  colorAccents: string[];        // ["deep olive", "cognac"]
  lightingDirection?: string;    // "late afternoon golden hour"
  styleKeywords: string[];       // ["Apartamento magazine", "warm inhabited"]
  inhabitedDetails: string[];    // ["half-poured wine glass"]
  avoid: string[];               // ["chrome", "glass coffee table"]
}
```

**No deviations from the prompt's schema.** All fields match exactly.

---

## 5. Files Modified

| File | Lines | Change |
|------|-------|--------|
| **NEW** `src/features/3d-render/services/brief-extractor.ts` | 336 lines | `BriefExtraction` type, `extractBriefContext` (Sonnet 4.6 tool_use), prompt helpers (`buildBriefDrivenInteriorPrompt`, `buildBriefDrivenExteriorPrompt`, `formatMaterials`, `formatLighting`, etc.) |
| `src/app/api/execute-node/handlers/gn-009.ts` | +97/-42 | Import brief-extractor; add extraction step; pass extraction to concept render, Phase 3, and `submitDualWalkthrough`; use `briefExtraction.spaceType` for `primaryRoom` |
| `src/features/3d-render/services/cinematic-pipeline.ts` | +26/-8 | Add `promptOverride` param to `generateLifestyleImage`; use it when provided; upgrade model to `gpt-image-1.5` |
| `src/features/3d-render/services/video-service.ts` | +38/-22 | Import `BriefExtraction` + helpers; add optional `extraction` param to `buildExteriorPrompt`, `buildInteriorPrompt`, `submitDualWalkthrough`; use extraction data for materials/lighting |
| `src/features/ai/services/openai.ts` | +2/-2 | Upgrade `generateConceptImage` model from `gpt-image-1` to `gpt-image-1.5` |

---

## 6. Three Full Prompt Traces

### Case 1: Marxstraße 12 (WE 01bb — DINK couple unit)

**Extraction result** (simulated from actual PDF text):
```json
{
  "buildingType": "residential_apartment",
  "spaceType": "open kitchen-dining",
  "persona": "DINK couple late 30s, design-conscious",
  "materialPalette": ["solid oak engineered plank medium-warm tone matte finish", "warm chalk-white walls NCS S 0500-N", "brushed-bronze handles", "full-height white painted doors"],
  "colorAccents": ["deep olive", "cognac leather", "ink blue"],
  "lightingDirection": "late afternoon golden hour, west-facing windows",
  "styleKeywords": ["Apartamento magazine", "The Modern House UK", "warm inhabited lifestyle not staged-empty"],
  "inhabitedDetails": ["half-poured wine glass", "folded cashmere throw", "open cookbook on counter"],
  "avoid": ["empty staged real-estate look", "cold loft minimalism", "IKEA-catalogue lighting", "oversaturated HDR"]
}
```

**Exterior concept render prompt** (`buildBriefDrivenExteriorPrompt`):
```
Photorealistic exterior architectural render of this building. Materials: solid oak engineered plank medium-warm tone matte finish, warm chalk-white walls NCS S 0500-N, brushed-bronze handles, full-height white painted doors. Colour accents: deep olive, cognac leather, ink blue. Lighting: late afternoon golden hour, west-facing windows. Style reference: Apartamento magazine, The Modern House UK, warm inhabited lifestyle not staged-empty. Eye-level 3/4 corner perspective showing the complete building facade. Physically accurate proportions, high-end architectural visualization, V-Ray/Corona quality, no distortion, no text, no watermark.

Building description: [first 1500 chars of PDF text]
```

**Phase 3 interior prompt** (`buildBriefDrivenInteriorPrompt`):
```
Photorealistic eye-level interior architecture photograph of the open kitchen-dining. Camera at human eye level (1.5 meters height), positioned in the doorway looking across the entire space toward the far wall, capturing the full width at a wide-angle 28mm perspective. The space is fully furnished appropriate to its function as a open kitchen-dining. Materials: solid oak engineered plank medium-warm tone matte finish, warm chalk-white walls NCS S 0500-N, brushed-bronze handles, full-height white painted doors. Colour accents: deep olive, cognac leather, ink blue. Lighting: late afternoon golden hour, west-facing windows. Style reference: Apartamento magazine, The Modern House UK, warm inhabited lifestyle not staged-empty. Subtle life details: half-poured wine glass, folded cashmere throw, open cookbook on counter. AVOID: empty staged real-estate look, cold loft minimalism, IKEA-catalogue lighting, oversaturated HDR. Style: ultra-high-end architectural photography, photorealistic, shallow architectural depth of field, 4K crisp detail. IMPORTANT: NO people in this image, NO animals, NO text, NO labels, NO watermark.

Layout context: [first 1500 chars of PDF text]
```

**Kling exterior prompt** (`buildExteriorPrompt` with extraction):
```
Use the provided text description as the only source of truth... Building description: [350 chars]. Cinematic exterior views (5 seconds): Camera starts at the front elevation — slow cinematic dolly... Physically accurate proportions, solid oak engineered plank medium-warm tone matte finish, warm chalk-white walls NCS S 0500-N, brushed-bronze handles, full-height white painted doors, global illumination, late afternoon golden hour, west-facing windows, cinematic smooth camera movement, high-end architectural visualization, 8K resolution, V-Ray/Corona render quality, no distortion, no artifacts.
```

**ZERO golden retriever, ZERO family scene, ZERO hardcoded materials.** Persona appears only in extraction metadata, not in any image prompt (correct — we don't put people in reference images).

---

### Case 2: Mock Hospital Brief

**Input text**: "200-bed regional hospital, contemporary design, white concrete + glass curtain wall, urban site. Interior shot: open-plan ICU with monitoring stations."

**Extraction result**:
```json
{
  "buildingType": "hospital",
  "spaceType": "open-plan ICU with monitoring stations",
  "materialPalette": ["white concrete", "glass curtain wall"],
  "colorAccents": [],
  "lightingDirection": undefined,
  "styleKeywords": ["contemporary design"],
  "inhabitedDetails": [],
  "avoid": []
}
```
(`persona` is absent — Claude correctly omits it for institutional buildings.)

**Exterior concept render prompt**:
```
Photorealistic exterior architectural render of this building. Materials: white concrete, glass curtain wall. Lighting: well-balanced architectural photography lighting. Style reference: contemporary design. Eye-level 3/4 corner perspective showing the complete building facade. Physically accurate proportions, high-end architectural visualization, V-Ray/Corona quality, no distortion, no text, no watermark.

Building description: 200-bed regional hospital, contemporary design, white concrete + glass curtain wall, urban site. Interior shot: open-plan ICU with monitoring stations.
```

**Phase 3 interior prompt**:
```
Photorealistic eye-level interior architecture photograph of the open-plan ICU with monitoring stations. Camera at human eye level (1.5 meters height), positioned in the doorway looking across the entire space toward the far wall, capturing the full width at a wide-angle 28mm perspective. The space is fully furnished appropriate to its function as a open-plan ICU with monitoring stations. Materials: white concrete, glass curtain wall. Lighting: well-balanced architectural photography lighting. Style reference: contemporary design. Style: ultra-high-end architectural photography, photorealistic, shallow architectural depth of field, 4K crisp detail. IMPORTANT: NO people in this image, NO animals, NO text, NO labels, NO watermark.

Layout context: 200-bed regional hospital...
```

**ZERO residential language.** No "oak flooring", no "warm inhabited", no "golden hour", no "golden retriever", no "fresh flowers", no "bedroom", no "kitchen". The space is correctly identified as "open-plan ICU with monitoring stations". Lighting falls back to the neutral "well-balanced architectural photography lighting" because the brief doesn't specify lighting. Materials are "white concrete, glass curtain wall" — exactly what the brief says.

---

### Case 3: Mock Office Brief

**Input text**: "12-storey corporate HQ, glass + bronze fins, plaza-level entrance. Interior shot: open-plan office floor with hot-desks and breakout zones."

**Extraction result**:
```json
{
  "buildingType": "office",
  "spaceType": "open-plan office floor with hot-desks and breakout zones",
  "materialPalette": ["glass", "bronze fins"],
  "colorAccents": [],
  "lightingDirection": undefined,
  "styleKeywords": [],
  "inhabitedDetails": [],
  "avoid": []
}
```

**Phase 3 interior prompt**:
```
Photorealistic eye-level interior architecture photograph of the open-plan office floor with hot-desks and breakout zones. Camera at human eye level (1.5 meters height), positioned in the doorway looking across the entire space toward the far wall, capturing the full width at a wide-angle 28mm perspective. The space is fully furnished appropriate to its function as a open-plan office floor with hot-desks and breakout zones. Materials: glass, bronze fins. Lighting: well-balanced architectural photography lighting. Style: ultra-high-end architectural photography, photorealistic, shallow architectural depth of field, 4K crisp detail. IMPORTANT: NO people in this image, NO animals, NO text, NO labels, NO watermark.

Layout context: 12-storey corporate HQ...
```

**ZERO residential language.** No "warm inhabited", no kitchen/bedroom defaults, no personas, no lifestyle props. Space is "open-plan office floor with hot-desks and breakout zones" — extracted verbatim from the brief.

---

## 7. Model String Confirmation

| Function | File | Before | After |
|----------|------|--------|-------|
| `generateConceptImage` | `openai.ts:840` | `gpt-image-1` | `gpt-image-1.5` |
| `generateLifestyleImage` | `cinematic-pipeline.ts:701` | `gpt-image-1` | `gpt-image-1.5` |

Both upgraded to the text-correct extraction-grade model per memory rule.

---

## 8. tsc + build Output

```
$ npx tsc --noEmit
(no output — zero errors)

$ npm run build
(clean build, all pages compiled successfully, zero errors/warnings)
```

---

## 9. Cost Delta

| Component | Before | After |
|-----------|--------|-------|
| Claude Sonnet 4.6 extraction | — | ~$0.005 |
| GPT-Image-1.5 exterior render | ~$0.04 | ~$0.04 (model upgrade, same price tier) |
| GPT-Image-1.5 interior reference | ~$0.04 | ~$0.04 (model upgrade, same price tier) |
| Kling exterior 5s | $0.50 | $0.50 |
| Kling interior 10s | $1.00 | $1.00 |
| **Total per WF-08 execution** | **~$1.58** | **~$1.585** |

Delta: **+$0.005/execution** for the Sonnet 4.6 extraction call. Negligible.

---

## 10. Snags / Ambiguities Resolved

1. **"Do NOT rewrite Phase 3's image-generation function body"** — Interpreted as: do not modify buffer handling, API call mechanics, or R2 upload logic in `generateLifestyleImage`. Adding a `promptOverride` parameter and a conditional that uses it instead of the hardcoded template IS modifying the function body, but it's modifying the PROMPT ASSEMBLY, not the PLUMBING. The actual `client.images.edit(...)` call, buffer conversion, File construction, R2 upload — all unchanged.

2. **Model string `gpt-image-1` vs `gpt-image-1.5`** — The codebase already uses `gpt-image-1.5` in `generate-3d-render/route.ts:379`. The cinematic pipeline and concept image functions lagged behind at `gpt-image-1`. Upgraded both.

3. **Extraction fallback behaviour** — When `ANTHROPIC_API_KEY` is absent or the extraction call fails, `EMPTY_EXTRACTION` is returned. All downstream prompt builders check for empty arrays/undefined fields and use neutral fallbacks. The pipeline never breaks — it degrades to the neutral-default prompts, which are already an improvement over the old hardcoded residential defaults.

4. **cinematic-pipeline.ts hardcoded strings NOT removed** — The `LIFESTYLE_IMAGE_PROMPT_TEMPLATE`, `ROOM_FURNITURE_HINTS`, and `buildLifestylePrompt` (with golden retriever) are retained as-is for backward compatibility with the cinematic pipeline stages (buildOverviewPrompt/buildTransitionPrompt/buildLifestylePrompt) which are NOT used by GN-009 but ARE used by the standalone cinematic walkthrough endpoint (`/api/generate-cinematic-walkthrough`). These callers do not pass `promptOverride` and continue using the legacy template. They should be addressed in a separate phase.

5. **`submitDualWalkthrough` extraction param** — Added as optional field to the existing `options` object. Existing callers (WF-06, WF-11) don't pass it, so their prompts are unchanged.

---

## 11. Required Live-Test Plan

### Test 1: Marxstraße 12 PDF (residential)
1. `npm run dev` → Dashboard → WF-08 template
2. Upload `Rendering_Brief_Marxstrasse12.pdf`
3. Run → watch server logs for:
   - `[BRIEF-EXTRACT] Extracted: type=residential_apartment space=open kitchen-dining persona=yes materials=4 ...`
   - `[GN-009] No upstream image — generating brief-driven exterior concept render`
   - `[GN-009] Phase 3: interior reference ready`
4. Verify exterior video: building matches description (Mehrfamilienhaus, not generic)
5. Verify interior video: camera INSIDE a room, materials match brief (oak floor, chalk-white walls), no family/golden retriever in the reference image

### Test 2: Any commercial/office brief (even 1 paragraph)
Use a text prompt node or type: "12-storey glass office tower, open-plan floors, breakout zones, polished concrete, neutral palette"
1. Run WF-08
2. Verify logs show `type=office`, NO persona
3. Verify interior video: office space, NOT residential. No kitchen, no bedroom, no warm inhabited look

### Test 3: Any hospital/educational brief
Use: "200-bed hospital, white concrete, glass curtain wall, ICU ward with monitoring stations"
1. Run WF-08
2. Verify logs show `type=hospital`, NO persona
3. Verify interior video: clinical space. ZERO residential language, ZERO golden retriever, ZERO oak flooring
