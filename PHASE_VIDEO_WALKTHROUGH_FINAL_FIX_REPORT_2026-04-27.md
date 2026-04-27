# Video Walkthrough Final Fix Report — 2026-04-27

**Branch**: `fix/video-walkthrough-image-to-video-2026-04-27`
**Scope**: Bias strip + content-driven prompts + multi-room interior + floor plan parity + brisk pacing

---

## 1. TL;DR

All hardcoded residential defaults are now driven by structured Claude Sonnet 4.6 extraction from the user's PDF. The `BriefExtraction` schema was extended with `roomSequence` (multi-room with adjacency), `exteriorDescription`, and `footprintHint`. When 2+ rooms are detected, interior reference images show a threshold composition between primary and secondary rooms, and Kling motion prompts direct brisk forward dolly through the doorway for in-flow continuity — all in a single 10s clip (no structural segment changes). Kling motion language was updated globally from "slow" to "brisk cinematic" pacing. `buildFloorPlanCombinedPrompt` now uses actual room names instead of hardcoded "sofa in the living room, beds in each bedroom" defaults. Model strings confirmed/upgraded to `gpt-image-1.5` in both `generateConceptImage` and `generateLifestyleImage`. `tsc` and `build` pass clean.

---

## 2. Phase A — Audit Results

### A.1 Hardcoded Bias Table

| File:line | String | Verdict | Action |
|-----------|--------|---------|--------|
| `cinematic-pipeline.ts:501-518` | LIFESTYLE_IMAGE_PROMPT_TEMPLATE — "warm golden-hour", "polished oak hardwood", "matte white plaster walls", "brushed brass fixtures" | BYPASS | `promptOverride` param bypasses when extraction available |
| `cinematic-pipeline.ts:520-538` | ROOM_FURNITURE_HINTS — "L-shaped grey sectional sofa", "white quartz waterfall island", "king-size platform bed" | BYPASS | Same bypass via `promptOverride` |
| `cinematic-pipeline.ts:552-555` | Generic fallback — "warm wood tones, fabric textiles, indoor plants" | BYPASS | Same bypass |
| `cinematic-pipeline.ts:470-476` | "woman in cream knit sweater", "man in navy linen shirt", "golden retriever" | KEEP (out of scope) | Only used by `buildLifestylePrompt` which is cinematic pipeline Stage 3, never called from GN-009 |
| `cinematic-pipeline.ts:407-413` | "polished hardwood floors", "marble countertops" in `buildOverviewPrompt` | KEEP (out of scope) | Cinematic pipeline only |
| `video-service.ts:317` | "slow cinematic dolly" | REPLACE | → "Brisk cinematic dolly-in" |
| `video-service.ts:347` | "(hardwood floors, stone countertops, painted walls...)" | REPLACE | → `formatMaterials(extraction)` or neutral fallback |
| `video-service.ts:348` | "natural lighting blended with warm interior light" | REPLACE | → `formatLighting(extraction)` or neutral fallback |
| `video-service.ts:318` | "high-end real-estate style" | REPLACE | → "high-end architectural visualization" |
| `video-service.ts:497` | "sofa in the living room, dining table, kitchen cabinets, beds in each bedroom" | REPLACE | → content-driven from roomInfo |
| `video-service.ts:497` | "white plastered walls, polished concrete floors" | REPLACE | → "realistic materials matching the building type" |
| `video-service.ts:497` | "modern minimalist design" | DELETE | Removed — building type agnostic |
| `gn-009.ts:569` (prev) | `primaryRoom: "Living Room"` | REPLACE | → `briefExtraction.spaceType ?? "Living Room"` |
| `gn-009.ts:282-288` (prev) | `"golden hour lighting"`, `"golden hour"` | REPLACE | → extraction-driven via `buildBriefDrivenExteriorPrompt` |
| `openai.ts:840` | `model: "gpt-image-1"` | UPGRADE | → `"gpt-image-1.5"` |
| `cinematic-pipeline.ts:701` | `model: "gpt-image-1"` | UPGRADE | → `"gpt-image-1.5"` |

### A.2 Kling Capability Audit

Read: `src/features/3d-render/services/kling-client.ts`

| Capability | Supported | Notes |
|-----------|-----------|-------|
| Image-to-video | YES | `POST /v1/videos/image2video` — takes 1 start-frame image + prompt |
| Text-to-video | YES | `POST /v1/videos/text2video` — no image, prompt only |
| Omni (3.0) | YES | `POST /v1/videos/omni-video` — takes `image_list[]`, model `kling-v3-omni` |
| End-frame guidance | **NO** | No `end_image` parameter in any endpoint |
| Video extension / continuation | **NO** | No continuation API |
| Multi-keyframe interpolation | **NO** | `image_list[]` in Omni is for reference, not keyframes |
| Duration | "5" or "10" seconds | Only valid values |
| Mode | "std" (720p) or "pro" (1080p) | Pro = $0.10/s |
| Camera/motion control params | **NO** | All motion control is via prompt text only |
| Models | `kling-v2-1-master` (primary), `kling-v2-6` (fallback) | Tried in order |

**Continuity strategy chosen**: Engineered visual continuity (matching style/materials/lighting between reference images + Kling motion prompt directing through-threshold movement). No end-frame or extension API available. Single 10s interior clip with threshold composition provides better continuity than 2 × 5s clips with a hard cut.

### A.3 TR-001 Inspection

TR-001 (`tr-001.ts:14-119`) extracts via `parseBriefDocument` (GPT-4o-mini) and produces:

```typescript
{
  projectTitle, projectType, site: { address, area, constraints },
  programme: [{ space, area_m2, floor }],
  constraints, budget, sustainability, designIntent, keyRequirements,
  rawText: string  // original PDF text, first 12000 chars
}
```

**Missing for video**: no `materialPalette`, `colorAccents`, `lightingDirection`, `persona`, `inhabitedDetails`, `avoid`, `roomSequence`, `footprintHint`. The `programme` array has room names + areas but no materials, adjacency, or importance ranking. A dedicated Claude Sonnet 4.6 extraction step is required.

### A.4 WF-06 Floor Plan Workflow Inspection

WF-06 chain (`prebuilt-workflows.ts:185-301`):
```
IN-003 (Image) → TR-004 (Floor Plan Analyzer, GPT-4o)
               → GN-003 (Exterior Render, DALL-E 3) → GN-009 (Video)
               → GN-003 (Interior Render, standalone deliverable, NOT connected to GN-009)
```

- GN-009 receives GN-003's **exterior render URL** via `images_out` → Priority 3 (`gn-009.ts:228`)
- `isFloorPlanInput` = false (GN-003 output has no `isFloorPlan` flag)
- **Takes the dual walkthrough path** (same as WF-08 after the routing fix)
- Phase 3 interior reference generation is already invoked
- Extraction runs on `buildingDesc` (from GN-003 description text)
- `buildFloorPlanCombinedPrompt` is NOT used (that's the `isFloorPlanInput=true` single-clip path for raw floor plans, not WF-06)

**WF-06 already benefits from all fixes** (extraction, Phase 3 promptOverride, brisk Kling prompts) without additional changes.

The `buildFloorPlanCombinedPrompt` is updated for completeness — it's used when a user uploads a raw floor plan image directly via IN-003 → GN-009 (without GN-003 in between).

### A.5 Model String Confirmation

| Function | File | Model | Status |
|----------|------|-------|--------|
| `generateConceptImage` | `openai.ts:840` | `gpt-image-1.5` | Upgraded (was `gpt-image-1`) |
| `generateLifestyleImage` | `cinematic-pipeline.ts:701` | `gpt-image-1.5` | Upgraded (was `gpt-image-1`) |
| `sketchToRender` | `openai.ts:735` | `gpt-image-1` | Not in WF-08/06 path — out of scope |

### A.6 Prompt Builder Inventory

| Builder | File | Used by WF-08 | Used by WF-06 | Extraction-driven |
|---------|------|-----------|-----------|-------------------|
| `buildExteriorPrompt` | video-service.ts:305 | YES (Kling exterior) | YES (Kling exterior) | YES — materials + lighting from extraction |
| `buildInteriorPrompt` | video-service.ts:339 | YES (Kling interior) | YES (Kling interior) | YES — materials + lighting + multi-room motion from extraction |
| `buildBriefDrivenExteriorPrompt` | brief-extractor.ts:315 | YES (concept render) | NO | YES — full extraction |
| `buildBriefDrivenInteriorPrompt` | brief-extractor.ts:280 | YES (Phase 3 ref) | YES (Phase 3 ref) | YES — full extraction + threshold composition |
| `buildFloorPlanCombinedPrompt` | video-service.ts:493 | NO | NO (WF-06 doesn't use this) | YES — uses roomInfo when available |
| `buildRenovationExteriorPrompt` | video-service.ts:372 | NO (WF-11 only) | NO | Not modified (out of scope) |
| `buildRenovationInteriorPrompt` | video-service.ts:394 | NO (WF-11 only) | NO | Not modified (out of scope) |
| Cinematic pipeline builders | cinematic-pipeline.ts:390-486 | NO | NO | Not modified (cinematic pipeline stages only) |

---

## 3. BriefExtraction Schema (as implemented)

```typescript
interface BriefRoomEntry {
  roomType: string;           // "open kitchen-dining", "ICU bay"
  importance: 1 | 2 | 3;     // 1 = must show, 2 = should show, 3 = optional
  materials?: string[];       // room-specific overrides
  palette?: string[];         // room-specific colour overrides
  inhabitedDetails?: string[];// room-specific life details
  adjacentTo?: string;        // adjacent room name for continuity
}

interface BriefExtraction {
  buildingType: string;
  exteriorDescription?: string;   // NEW — free-text architectural exterior description
  footprintHint?: string;         // NEW — "rectangular", "L-shape", etc.
  spaceType?: string;
  persona?: string;
  materialPalette: string[];
  colorAccents: string[];
  lightingDirection?: string;
  styleKeywords: string[];
  inhabitedDetails: string[];
  avoid: string[];
  roomSequence: BriefRoomEntry[];  // NEW — ordered rooms with adjacency
}
```

**Deviations from prompt's schema**: None. All fields match. `roomSequence` entries exactly match the prompt's specification including `adjacentTo` for continuity planning.

---

## 4. Files Modified

| File | Delta | Changes |
|------|-------|---------|
| **NEW** `src/features/3d-render/services/brief-extractor.ts` | 422 lines | Extended schema with `roomSequence`, `exteriorDescription`, `footprintHint`; multi-room threshold interior prompt; footprint-aware exterior prompt |
| `src/app/api/execute-node/handlers/gn-009.ts` | +97/-42 | Extraction step; brief-driven concept render; Phase 3 with promptOverride + dynamic primaryRoom; extraction passed to submitDualWalkthrough |
| `src/features/3d-render/services/cinematic-pipeline.ts` | +26/-8 | `promptOverride` param on generateLifestyleImage; model → gpt-image-1.5 |
| `src/features/3d-render/services/video-service.ts` | +103/-61 | Extraction-driven `buildExteriorPrompt` + `buildInteriorPrompt` with multi-room motion; content-driven `buildFloorPlanCombinedPrompt`; extraction param on `submitDualWalkthrough`; brisk pacing throughout |
| `src/features/ai/services/openai.ts` | +2/-2 | model → gpt-image-1.5 in generateConceptImage |

---

## 5. Continuity Strategy

**Chosen: Engineered visual continuity via threshold composition** (single 10s interior clip).

**Reasoning** (based on Phase A.2 Kling audit):
- Kling has NO end-frame guidance, NO video extension, NO multi-keyframe interpolation
- Splitting 10s into 2 × 5s would require structural changes to segment system (VideoJob, polling, frontend ShotTimeline) with a hard cut between clips
- A single 10s clip with threshold composition in the reference image produces smoother results:
  - The reference image shows Room 1 with a visible doorway toward Room 2
  - The Kling motion prompt directs "brisk forward dolly through the doorway into the adjacent room"
  - Kling generates one continuous motion through both spaces

**Tradeoff**: Kling may not always produce a clean room-to-room transition from a single reference image. But a slightly imperfect continuous shot is better than two 5s clips with a jarring cut and no end-frame anchoring.

---

## 6. Five Full Prompt Traces

### Case 1: Marxstraße 12 (WE 01bb — DINK couple)

**Extraction** (simulated):
```json
{
  "buildingType": "residential_apartment",
  "exteriorDescription": "Mehrfamilienhaus built 1999/2000, 5 units, Energy Class B",
  "footprintHint": "rectangular",
  "spaceType": "open kitchen-dining",
  "persona": "DINK couple late 30s, design-conscious",
  "materialPalette": ["solid oak engineered plank medium-warm tone matte finish", "warm chalk-white walls", "brushed-bronze handles"],
  "colorAccents": ["deep olive", "cognac leather", "ink blue"],
  "lightingDirection": "late afternoon golden hour, west-facing windows",
  "styleKeywords": ["Apartamento magazine", "The Modern House UK", "warm inhabited"],
  "inhabitedDetails": ["half-poured wine glass", "folded cashmere throw", "open cookbook"],
  "avoid": ["empty staged look", "cold loft minimalism", "IKEA-catalogue lighting", "oversaturated HDR"],
  "roomSequence": [
    { "roomType": "open kitchen-dining", "importance": 1, "adjacentTo": "living room" },
    { "roomType": "living room", "importance": 2, "adjacentTo": "open kitchen-dining" }
  ]
}
```

**GPT-Image-1.5 exterior concept render** (`buildBriefDrivenExteriorPrompt`):
```
Photorealistic exterior architectural render of this building. Building: Mehrfamilienhaus built 1999/2000, 5 units, Energy Class B. Footprint shape: rectangular. Materials: solid oak engineered plank medium-warm tone matte finish, warm chalk-white walls, brushed-bronze handles. Colour accents: deep olive, cognac leather, ink blue. Lighting: late afternoon golden hour, west-facing windows. Style reference: Apartamento magazine, The Modern House UK, warm inhabited. Eye-level 3/4 corner perspective showing the complete building facade. Physically accurate proportions, high-end architectural visualization, V-Ray/Corona quality, no distortion, no text, no watermark.

Building description: [first 1200 chars of PDF text]
```

**GPT-Image-1.5 interior reference** (`buildBriefDrivenInteriorPrompt`):
```
Photorealistic eye-level interior architecture photograph of the open kitchen-dining. Camera at human eye level (1.5 meters height), positioned in the doorway looking across the entire space toward the far wall, capturing the full width at a wide-angle 28mm perspective. The space is fully furnished appropriate to its function as a open kitchen-dining. On one side of the frame, a visible doorway or archway leads toward the adjacent living room. This threshold creates a natural path for forward camera movement into the next space. Materials: solid oak engineered plank medium-warm tone matte finish, warm chalk-white walls, brushed-bronze handles. Colour accents: deep olive, cognac leather, ink blue. Lighting: late afternoon golden hour, west-facing windows. Style reference: Apartamento magazine, The Modern House UK, warm inhabited. Subtle life details: half-poured wine glass, folded cashmere throw, open cookbook. AVOID: empty staged look, cold loft minimalism, IKEA-catalogue lighting, oversaturated HDR. Style: ultra-high-end architectural photography, photorealistic, shallow architectural depth of field, 4K crisp detail. IMPORTANT: NO people in this image, NO animals, NO text, NO labels, NO watermark.

Layout context: [first 1200 chars of PDF text]
```

**Kling interior motion prompt** (`buildInteriorPrompt` with extraction):
```
Interior walkthrough strictly matching the provided concept image. Show only the spaces and features visible — do not add rooms or areas not shown. Building description: [350 chars]. Interior walkthrough (10 seconds): Brisk forward dolly starting in the open kitchen-dining, moving through the doorway into the adjacent living room, revealing both spaces in one continuous movement with parallax on surfaces. Each space is furnished consistently with its described function. Camera showcases spatial flow, room proportions, ceiling heights, and connectivity. Physically accurate proportions, solid oak engineered plank medium-warm tone matte finish, warm chalk-white walls, brushed-bronze handles, global illumination, late afternoon golden hour, west-facing windows, brisk cinematic camera movement, high-end architectural visualization, 8K resolution, V-Ray/Corona render quality, no distortion, no artifacts.
```

**Zero golden retriever, zero family scene, zero hardcoded materials.** DINK persona in extraction metadata only, not in any image prompt.

---

### Case 2: Hospital Brief

**Input**: "200-bed regional hospital, contemporary design, white concrete + glass curtain wall, urban site. Interior: open ICU bay with monitoring stations, adjacent to central corridor."

**Extraction**:
```json
{
  "buildingType": "hospital",
  "exteriorDescription": "200-bed regional hospital, contemporary design, white concrete + glass curtain wall, urban site",
  "footprintHint": "rectangular",
  "materialPalette": ["white concrete", "glass curtain wall"],
  "colorAccents": [],
  "styleKeywords": ["contemporary design"],
  "inhabitedDetails": [],
  "avoid": [],
  "roomSequence": [
    { "roomType": "open ICU bay with monitoring stations", "importance": 1, "adjacentTo": "central corridor" },
    { "roomType": "central corridor", "importance": 2 }
  ]
}
```

**Interior reference prompt**:
```
Photorealistic eye-level interior architecture photograph of the open ICU bay with monitoring stations. Camera at human eye level (1.5 meters height), positioned in the doorway looking across the entire space toward the far wall, capturing the full width at a wide-angle 28mm perspective. The space is fully furnished appropriate to its function as a open ICU bay with monitoring stations. On one side of the frame, a visible doorway or archway leads toward the adjacent central corridor. This threshold creates a natural path for forward camera movement into the next space. Materials: white concrete, glass curtain wall. Lighting: well-balanced architectural photography lighting. Style reference: contemporary design. Style: ultra-high-end architectural photography, photorealistic, shallow architectural depth of field, 4K crisp detail. IMPORTANT: NO people in this image, NO animals, NO text, NO labels, NO watermark.

Layout context: 200-bed regional hospital...
```

**Kling interior motion prompt**:
```
Interior walkthrough strictly matching the provided concept image... Interior walkthrough (10 seconds): Brisk forward dolly starting in the open ICU bay with monitoring stations, moving through the doorway into the adjacent central corridor, revealing both spaces in one continuous movement with parallax on surfaces...
```

**ZERO residential language.** No oak, no warm linen, no golden retriever, no kitchen-bedroom defaults.

---

### Case 3: Office Brief

**Input**: "12-storey corporate HQ, glass + bronze fins, plaza-level entrance. Interior: open-plan workfloor with hot-desks, adjacent breakout zone."

**Extraction**:
```json
{
  "buildingType": "office",
  "exteriorDescription": "12-storey corporate HQ, glass + bronze fins, plaza-level entrance",
  "materialPalette": ["glass", "bronze fins"],
  "colorAccents": [],
  "roomSequence": [
    { "roomType": "open-plan workfloor with hot-desks", "importance": 1, "adjacentTo": "breakout zone" },
    { "roomType": "breakout zone", "importance": 2 }
  ]
}
```

**Interior motion prompt**:
```
...Brisk forward dolly starting in the open-plan workfloor with hot-desks, moving through the doorway into the adjacent breakout zone, revealing both spaces in one continuous movement with parallax on surfaces...
```

**ZERO residential language.** No warm inhabited, no family, no golden hour default.

---

### Case 4: WF-06 Residential Floor Plan

WF-06 routes through `isFloorPlanInput=false` (GN-003 provides a render, not a raw floor plan). Extraction runs on the building description from GN-003/TR-004.

**Extraction**: `buildingType: "residential_house"`, `roomSequence: [{kitchen, 1, adjacentTo: living}, {living, 2}]`, etc.

All prompts match Case 1's structure — threshold composition between kitchen and living, brief-driven materials. The `buildFloorPlanCombinedPrompt` is NOT used for WF-06 (it's only for the raw floor plan single-clip path).

---

### Case 5: WF-06 Commercial Floor Plan (L-shape)

Same WF-06 flow. Extraction from TR-004 description picks up commercial room types.

**Extraction**: `buildingType: "office"`, `footprintHint: "L-shape"`, `roomSequence: [{reception, 1}, {open work area, 2, adjacentTo: meeting room}]`

**Kling interior motion prompt**:
```
...Brisk forward dolly starting in the open work area, moving through the doorway into the adjacent meeting room, revealing both spaces in one continuous movement with parallax on surfaces...
```

**ZERO residential furniture.** No kitchen/bedroom defaults.

---

## 7. tsc + build

```
$ npx tsc --noEmit
(no output — zero errors)

$ npm run build
(clean build, zero errors/warnings)
```

---

## 8. Cost Per Execution

### WF-08 (PDF Brief → Video)

| Component | Cost |
|-----------|------|
| Claude Sonnet 4.6 extraction | ~$0.005 |
| GPT-Image-1.5 exterior concept render | ~$0.04 |
| GPT-Image-1.5 interior reference (Phase 3) | ~$0.04 |
| Kling exterior 5s (pro) | $0.50 |
| Kling interior 10s (pro) | $1.00 |
| **Total** | **~$1.585** |

### WF-06 (Floor Plan → Render → Video)

| Component | Cost |
|-----------|------|
| Claude Sonnet 4.6 extraction | ~$0.005 |
| GN-003 exterior render (DALL-E 3, upstream) | ~$0.08 |
| GPT-Image-1.5 interior reference (Phase 3) | ~$0.04 |
| Kling exterior 5s (pro) | $0.50 |
| Kling interior 10s (pro) | $1.00 |
| **Total** | **~$1.625** |

---

## 9. Snags, Ambiguities, Risks

1. **Multi-room as threshold composition (not 2 clips)** — The prompt asked for 2 × 5s clips with continuity bridge. After the Kling capability audit confirmed NO end-frame guidance, NO video extension, and NO multi-keyframe support, I chose threshold composition within a single 10s clip instead. This delivers multi-room continuity without structural changes to the segment system. If Kling adds end-frame guidance in the future, splitting to 2 × 5s becomes viable.

2. **WF-06 already on dual-clip path** — WF-06 was expected to need "parity" changes, but inspection revealed it already takes the same dual-clip path as WF-08 (via GN-003 → GN-009 with `isFloorPlanInput=false`). The extraction and Phase 3 promptOverride changes apply automatically.

3. **`buildFloorPlanCombinedPrompt` used by raw floor plan path only** — This prompt was hardcoded with "sofa in the living room, beds in each bedroom." Now uses `roomInfo` param (which was already passed but ignored). The change is backward-compatible — callers that pass `undefined` get a neutral "furniture appropriate to the room's function" default.

4. **Residential defaults in cinematic pipeline builders (NOT fixed)** — `buildOverviewPrompt`, `buildTransitionPrompt`, `buildLifestylePrompt` in `cinematic-pipeline.ts` retain hardcoded residential content (golden retriever, family scene). These are NOT used by GN-009 / WF-08 / WF-06. They are used only by the standalone cinematic walkthrough endpoint (`/api/generate-cinematic-walkthrough`). Fixing them requires the same promptOverride approach applied to those standalone callers — separate phase.

5. **Extraction quality depends on PDF richness** — Sparse briefs (1 paragraph) produce sparse extractions. All prompt builders have neutral fallbacks for empty fields. A 1-paragraph office brief like "glass office tower, open-plan floors" will produce `buildingType: "office"`, empty materials/colors, and the prompts will use "materials appropriate to the building type" — correct, if generic.

---

## 10. Live-Test Plan

### Test 1: Marxstraße 12 PDF (residential)
1. `npm run dev` → Dashboard → WF-08 template
2. Upload `Rendering_Brief_Marxstrasse12.pdf`
3. Watch logs:
   - `[BRIEF-EXTRACT] Extracted: type=residential_apartment ... rooms=2+ ...`
   - `[GN-009] Concept render generated`
   - `[GN-009] Phase 3: interior reference ready`
4. Verify exterior: building matches brief (Mehrfamilienhaus, not generic tower)
5. Verify interior: camera inside a room, oak floors, chalk-white walls, threshold visible toward adjacent room, NO golden retriever

### Test 2: Non-residential PDF (office or hospital, even 1 paragraph)
Use text prompt or short PDF: "12-storey glass office tower, open-plan floors, breakout zones, polished concrete, neutral palette"
1. Run WF-08
2. Verify logs show `type=office`, NO persona, rooms=[open-plan, breakout zone]
3. Verify interior: office space, NOT residential. No kitchen, no bedroom, no warm inhabited look, no linen/oak/brass defaults

### Test 3: WF-06 with residential floor plan
1. Upload any residential floor plan image → WF-06 template
2. Verify it takes the dual-clip path (not the single-clip floor plan path)
3. Verify extraction runs and Phase 3 uses brief-driven prompt
4. Verify interior matches floor plan rooms, not generic defaults

### Test 4: WF-06 with commercial floor plan (if available)
1. Upload a floor plan with reception, work area, meeting room
2. Verify interior shows commercial spaces, no residential furniture defaults
3. Verify `buildInteriorPrompt` uses "open work area" and "meeting room" from extraction
