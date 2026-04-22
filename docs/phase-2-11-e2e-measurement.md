# Phase 2.11 — End-to-End Quality Measurement

**Date:** 2026-04-22T16:55:25.360Z
**Branch:** `feat/phase-2-11-accuracy-patches` (after all 4 steps committed)
**Prompt:** "3BHK 40x40 north facing vastu pooja room"

## 1. Executive summary

🚀 **Score: 84 / 100** — above target.
**Recommendation:** pass
**Baseline band:** 52–65 (pre-Phase-2.10). **Target band:** 70–78.
**Delta vs baseline midpoint (58):** +26

## 2. Phase 2.11 change-specific observations

- **Label block injection (2.10.3):** ❌ NOT present
- **Dedup renames (2.10.3):** 0 applied
- **Drift metrics (2.10.2):** not computed
- **Drift penalty applied on dimensionPlausibility:** 0
- **Phantom drops (2.10.4):** 0 — threshold now 16 sqft

## 3. Quality verdict breakdown

| Dimension | Score (1–10) |
|---|---:|
| roomCountMatch | 10 |
| noDuplicateNames | 10 |
| dimensionPlausibility | 7 |
| vastuCompliance | 6 |
| orientationCorrect | 9 |
| adjacencyCompliance | 8 |
| connectivity | 8 |
| exteriorWindows | 7 |
| bedroomPrivacy | 7 |
| entranceDoor | 10 |

**weakAreas** (score < 6): none

**Reasoning:** All 8 required rooms from the brief are present with fully unique names, earning perfect scores on count and naming. Vastu compliance is mixed: Pooja Room (NE) and Master Bedroom (SW) are ideally placed, but the Kitchen is tagged NE — a notable vastu violation as the ideal is SE (or N/E as alternatives), and both bathrooms are placed in SW and NW respectively, with SW being a hard vastu violation for bathrooms. Dimension plausibility is mostly acceptable, though the Kitchen at 8.1×5.8ft (4.4m²) and Pooja Room at 6.1×6.1ft (3.5m²) are on the tight side for a 40×40ft plot, and the Master Bedroom's reported area (16.1m²) appears slightly understated for its stated 12.2×14.2ft dimensions. The Living Room is correctly oriented north on a north-facing plot, and habitable rooms carry windows, though both bathrooms have zero windows which is a minor ventilation concern. | bedroomPrivacy: Bedroom 2 opens to a common area | entranceDoor: Main entrance on N as declared

## 4. Extraction detail

- Extracted rooms: **8** / brief expected: **8**
- Missing (not in extraction): [none]
- Unexpected (in extraction, not in brief): [none]
- Stage 4 issues: 0

## 5. Synthesis (Stage 5) detail

- Path: **fidelity**
- Rooms / walls / doors / windows: 8 / 34 / 6 / 20
- Stage 5 issues: 1
  - fidelity: rooms "Bedroom 3" and "Common Bathroom" overlap by 0.8 sqft (preserved as-is)

## 6. Timing + cost breakdown

- Total wall-clock: 66255 ms
- Total cost: $0.0943

| Stage | Duration (ms) | Cost (USD) |
|---|---:|---:|
| parse | 8511 | — |
| stage1 | 21066 | $0.0368 |
| stage2 | 24444 | $0.0340 |
| stage4 | 4447 | $0.0114 |
| stage5 | 14 | $0.0000 |
| stage6 | 7770 | $0.0122 |

## 7. Artefacts

- `experiments/outputs/phase-2-11-e2e/stage2-image.png` — generated floor plan (1024×1024 PNG)
- `experiments/outputs/phase-2-11-e2e/stage4-extraction.json` — ExtractedRooms payload
- `experiments/outputs/phase-2-11-e2e/stage5-project.json` — FloorPlanProject payload
- `experiments/outputs/phase-2-11-e2e/stage6-verdict.json` — QualityVerdict payload
- `experiments/outputs/phase-2-11-e2e/run.json` — aggregated metrics

## 8. Interpretation

Score **84** exceeds the Phase 2.11 target band (70–78). Phase 2.11 has delivered more than the projected ceiling on this prompt.

**Note:** this is a single-prompt measurement. Phase 2.11's accuracy claim should be validated across 10+ prompts before declaring a production-ready ceiling shift.
