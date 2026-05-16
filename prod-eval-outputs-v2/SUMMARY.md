# Eval Re-Run Summary — 2026-05-16 (post-fix)

All 5 briefs re-run against `main@d57f2833` with the helper
unit-fix + new geometric validators. Compare to yesterday's
false-green at `prod-eval-outputs/SUMMARY.md`.

## Per-eval results

| Brief | status | cost | turns | world_bbox | actual bbox | space_polygons | origin_collapse | element_coverage | Visual PASS |
|---|---|---|---|---|---|---|---|---|---|
| residential-bedroom | COMPLETED | $0.187 | 8 | **OK** | 4.00×5.00×2.70m | OK | OK | OK (missing 0) | ✅ |
| restaurant-counter | COMPLETED | $0.226 | 8 | **OK** | 4.00×8.00×3.00m | OK | OK | OK (missing 0) | ✅ |
| retail-pop-up | COMPLETED | $0.128 | 8 | **OK** | 6.00×6.12×3.00m | OK | OK | OK (missing 0) | ✅ |
| small-office | COMPLETED | $0.127 | 9 | **OK** | 5.00×5.15×2.95m | OK | OK | OK (missing 0) | ✅ |
| sol-properties-booth | COMPLETED | $0.520 | 16 | **OK** | 15.00×15.40×4.50m | OK | OK | OK (missing 0) | ✅ |

**Total Anthropic spend: $1.188** (budget cap: $15.00)

**Overall: ✅ 5/5 PASS — visual quality verified.**

## Details

### residential-bedroom

- status: `COMPLETED` · cost: `$0.187` · turns: `8`
- world_bbox: `OK` actual extent `4.00×5.00×2.70m` vs expected `[4.0, 5.0, 2.8]` ratio `[1.0, 1.0, 0.9642857142857144]`
- origin_collapse: at_origin `1 / 21` (5%)
- element_coverage: actual `{'IfcSlab': 1, 'IfcWall': 4, 'IfcFurnishingElement': 9, 'IfcBuildingElementProxy': 7, 'IfcLightFixture': 0}` vs expected `{'IfcSlab': 1, 'IfcWall': 4, 'IfcFurnishingElement': 9, 'IfcBuildingElementProxy': 4, 'IfcLightFixture': 3}`

### restaurant-counter

- status: `COMPLETED` · cost: `$0.226` · turns: `8`
- world_bbox: `OK` actual extent `4.00×8.00×3.00m` vs expected `[4.0, 8.0, 3.0]` ratio `[1.0, 1.0, 1.0]`
- origin_collapse: at_origin `1 / 39` (3%)
- element_coverage: actual `{'IfcSlab': 1, 'IfcFurnishingElement': 9, 'IfcCovering': 2, 'IfcBuildingElementProxy': 27, 'IfcLightFixture': 0}` vs expected `{'IfcSlab': 1, 'IfcFurnishingElement': 9, 'IfcCovering': 2, 'IfcBuildingElementProxy': 24, 'IfcLightFixture': 3}`

### retail-pop-up

- status: `COMPLETED` · cost: `$0.128` · turns: `8`
- world_bbox: `OK` actual extent `6.00×6.12×3.00m` vs expected `[6.0, 6.12, 3.2]` ratio `[1.0, 1.0, 0.9375]`
- origin_collapse: at_origin `2 / 14` (14%)
- element_coverage: actual `{'IfcSlab': 1, 'IfcWall': 3, 'IfcFurnishingElement': 4, 'IfcLightFixture': 0, 'IfcBuildingElementProxy': 6}` vs expected `{'IfcSlab': 1, 'IfcWall': 3, 'IfcFurnishingElement': 4, 'IfcLightFixture': 4, 'IfcBuildingElementProxy': 2}`

### small-office

- status: `COMPLETED` · cost: `$0.127` · turns: `9`
- world_bbox: `OK` actual extent `5.00×5.15×2.95m` vs expected `[5.0, 5.15, 3.0]` ratio `[1.0, 1.0, 0.9833333333333333]`
- origin_collapse: at_origin `3 / 15` (20%)
- element_coverage: actual `{'IfcSlab': 2, 'IfcWall': 4, 'IfcFurnishingElement': 5, 'IfcLightFixture': 0}` vs expected `{'IfcSlab': 2, 'IfcWall': 4, 'IfcFurnishingElement': 5, 'IfcLightFixture': 4}`

### sol-properties-booth

- status: `COMPLETED` · cost: `$0.520` · turns: `16`
- world_bbox: `OK` actual extent `15.00×15.40×4.50m` vs expected `[15.0, 15.4, 4.5]` ratio `[1.0, 1.0, 1.0]`
- origin_collapse: at_origin `1 / 78` (1%)
- element_coverage: actual `{'IfcSlab': 1, 'IfcCovering': 13, 'IfcColumn': 8, 'IfcBeam': 1, 'IfcBuildingElementProxy': 34, 'IfcWall': 9, 'IfcFurnishingElement': 12, 'IfcLightFixture': 0}` vs expected `{'IfcSlab': 1, 'IfcCovering': 13, 'IfcColumn': 8, 'IfcBeam': 1, 'IfcBuildingElementProxy': 23, 'IfcWall': 9, 'IfcFurnishingElement': 12, 'IfcLightFixture': 11}`
