# buildingSMART Validation Service — baseline summary

**Captured:** 2026-05-06
**Endpoint:** `https://validate.buildingsmart.org/api/validate`

## Per-fixture

| fixture | errors | warnings | service status |
|---|---:|---:|---|
| `multistorey_residential` | 0 | 0 | `stub` |
| `non_rectangular` | 0 | 0 | `stub` |
| `simple_box` | 0 | 0 | `stub` |

## Top 5 most common error codes

_No structured error codes captured (either zero errors or the report is a stub)._

## What this baseline gates

`tests/test_buildingsmart_baseline.py` reads these JSON reports and
asserts the per-fixture error count matches what was committed. A
drift in either direction (better or worse) fails the test until
a human re-runs `submit_buildingsmart_baseline.py` and re-pins.

## How to refresh

```bash
cd neobim-ifc-service
BSDD_VALIDATION_SERVICE_TOKEN=… python scripts/submit_buildingsmart_baseline.py
```

Or run it offline (stubbed) for shape-only updates:

```bash
BSDD_VALIDATION_OFFLINE=1 python scripts/submit_buildingsmart_baseline.py
```
