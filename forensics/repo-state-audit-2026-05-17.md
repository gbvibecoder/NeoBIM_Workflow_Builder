# Repo State Audit — 2026-05-17

22 uncommitted files in working tree at start of v2-retirement phase.
Read-only categorization into delete/commit/gitignore buckets.

## Working tree at start

```
?? LOCAL_SMOKE_TEST_RESULTS.md     (repo root)
?? MIGRATION_SAFETY_REVIEW.md      (repo root)
?? PROD_DEPLOY_RUNBOOK.md          (repo root)
?? prod-eval-outputs/              (19 files inside)
```

Expanded: 3 + 19 = 22.

## Per-file verdict

| File / dir | Verdict | Reason |
|---|---|---|
| `prod-eval-outputs/SUMMARY.md` | **DELETE** | False-green run summary (`prod SHA 38245069`); declared 5/5 PASS but every IFC inside is mm-scale. Corrected version: `prod-eval-outputs-v2/SUMMARY.md` (committed in `0e85f7fc`). |
| `prod-eval-outputs/SUMMARY-rest.md` | **DELETE** | Auxiliary table from the same broken run. |
| `prod-eval-outputs/residential-bedroom.ifc` | **DELETE** | `IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)` — the mm bug. Corrected version: `prod-eval-outputs-v2/residential-bedroom.ifc`. |
| `prod-eval-outputs/residential-bedroom-status.json` | **DELETE** | Status of broken run. |
| `prod-eval-outputs/residential-bedroom-logs.json` | **DELETE** | Logs of broken run. |
| `prod-eval-outputs/restaurant-counter.ifc` | **DELETE** | Same — mm-scale, replaced. |
| `prod-eval-outputs/restaurant-counter-status.json` | **DELETE** | Same. |
| `prod-eval-outputs/restaurant-counter-logs.json` | **DELETE** | Same. |
| `prod-eval-outputs/retail-pop-up.ifc` | **DELETE** | Same. |
| `prod-eval-outputs/retail-pop-up-status.json` | **DELETE** | Same. |
| `prod-eval-outputs/retail-pop-up-logs.json` | **DELETE** | Same. |
| `prod-eval-outputs/small-office.ifc` | **DELETE** | Same. |
| `prod-eval-outputs/small-office-status.json` | **DELETE** | Same. |
| `prod-eval-outputs/small-office-logs.json` | **DELETE** | Same. |
| `prod-eval-outputs/sol-properties-booth.ifc` | **DELETE** | Same. |
| `prod-eval-outputs/sol-properties-booth-status.json` | **DELETE** | Same. |
| `prod-eval-outputs/sol-properties-booth-logs.json` | **DELETE** | Same. |
| `prod-eval-outputs/test-status.json` | **DELETE** | Scratch from a one-off probe. |
| `prod-eval-outputs/test-logs.json` | **DELETE** | Same. |
| `LOCAL_SMOKE_TEST_RESULTS.md` | **GITIGNORE** | Local-only smoke-test result from the v3 deploy + smoke phase. Pre-existed before all v3 work; the author intentionally never committed it. |
| `MIGRATION_SAFETY_REVIEW.md` | **GITIGNORE** | Local-only safety review for the `20260516000000_v3_observability` migration. Pre-existed; intentionally not committed. |
| `PROD_DEPLOY_RUNBOOK.md` | **GITIGNORE** | Local-only operator runbook for Rutik's terminal. Pre-existed; intentionally not committed. |

## Aggregate

- **19 files DELETE** (entire `prod-eval-outputs/` directory)
- **3 files GITIGNORE** (the local-only deploy MDs)
- **0 files COMMIT** (the post-fix outputs already committed)

## Safety net

Before `rm -rf prod-eval-outputs/`, mirror to `/tmp/bf-false-green-backup/`
so the files are recoverable for 24 hours if Rutik suddenly needs them.

## Why these are not in `.gitignore` already

The 3 MDs were written by earlier Claude sessions that were meant to
hand them to Rutik in-conversation, then leave the working tree alone.
That worked at the time but accumulated noise across sessions. Adding
to `.gitignore` now is the right cleanup; the file contents themselves
were never lost (they're still on disk, just no longer tracked).

`prod-eval-outputs/` was created by the same earlier session's eval
harness in advance of knowing whether the outputs were valid. Once
forensics showed they were the false-green run, the author renamed
their post-fix successor to `prod-eval-outputs-v2/` rather than
overwrite the broken set. The broken set has served its purpose
(diagnostic baseline + side-by-side comparison) and now goes.
