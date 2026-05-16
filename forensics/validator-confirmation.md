# Validator Confirmation — yesterday's 5 broken IFCs

Each row asserts the new geometric validators flag the file as broken.
If `world_bbox.verdict == "OK"` here, the validators are bugged.

| Brief | world_bbox | space_polygons | element_coverage | origin_collapse |
|---|---|---|---|---|
| residential-bedroom | **COLLAPSED_AT_ORIGIN** (ratio 0.0015, 0.0015, 0.0010) | OK | MISSING_ELEMENTS (missing 3) | OK (5%) |
| restaurant-counter | **SCALED_TOO_SMALL** (ratio 0.0015, 0.0015, 0.0010) | OK | MISSING_ELEMENTS (missing 3) | OK (3%) |
| retail-pop-up | **COLLAPSED_AT_ORIGIN** (ratio 0.0015, 0.0015, 0.0009) | OK | MISSING_ELEMENTS (missing 4) | OK (14%) |
| small-office | **COLLAPSED_AT_ORIGIN** (ratio 0.0015, 0.0015, 0.0010) | OK | MISSING_ELEMENTS (missing 4) | OK (20%) |
| sol-properties-booth | **SCALED_TOO_SMALL** (ratio 0.0015, 0.0015, 0.0010) | NO_EXPECTED_POLYGON,OK | MISSING_ELEMENTS (missing 12) | OK (1%) |

🚨 At least one IFC passed validation — fix validators before proceeding.
