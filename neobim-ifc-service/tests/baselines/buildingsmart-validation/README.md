# buildingSMART Validation Service — baseline reports

Per-fixture JSON reports live here as
`<fixture>_<YYYY-MM-DD>.json`, plus an aggregate `SUMMARY.md` produced
by the runner script.

**Phase 0 status:** deferred. The directory exists so CI can land changes
without a "no such directory" failure, but the baseline JSONs are not
yet committed because submission to `validate.buildingsmart.org`
requires either:

- the runner script (`scripts/submit_buildingsmart_baseline.py`) to be
  executed in an environment with network egress and the
  `BSDD_VALIDATION_SERVICE_TOKEN` secret, or
- the offline stub (`BSDD_VALIDATION_OFFLINE=1`) for shape-only commits.

`tests/test_buildingsmart_baseline.py` skips its parametrized cases
when no baseline is committed; once the JSONs land here, the drift
gate becomes active automatically.

## How to seed this directory

```bash
cd neobim-ifc-service
BSDD_VALIDATION_SERVICE_TOKEN=… \
  python scripts/submit_buildingsmart_baseline.py \
    --fixtures simple_box,multistorey_residential,non_rectangular \
    --rich-mode full
```
