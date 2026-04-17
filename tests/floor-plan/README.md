# Floor Plan Regression Harness

10-prompt regression suite for the floor plan generator. Used by Pipeline B work to track per-commit deltas in generation accuracy.

## Run baseline

```bash
SNAPSHOT_NAME=baseline-pre-fixes npm test -- tests/floor-plan/run-regression.test.ts
```

The harness mocks `auth`, `prisma`, and `rate-limit`, then calls the route handler in-process. Output: `tests/floor-plan/snapshots/<SNAPSHOT_NAME>.json` plus a Markdown table on stdout.

## Real OpenAI vs mocked OpenAI

`tests/setup.ts` overrides `OPENAI_API_KEY` to a fake value. With the fake key, `programRooms()` falls back to `programRoomsFallback()` (regex). Scores reflect the regex pipeline.

To run against the real AI pipeline, override the env BEFORE vitest loads:

```bash
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env.local | cut -d= -f2-) \
  SNAPSHOT_NAME=baseline-pre-fixes-ai \
  npm test -- tests/floor-plan/run-regression.test.ts
```

Even with the override, `tests/setup.ts:beforeAll` still re-overrides. To bypass setup, run with a separate vitest config or run the harness directly under tsx (not currently installed).

For Day 1 the regex baseline is the working assumption.

## Diff snapshots

```bash
npx vitest run tests/floor-plan/diff-snapshots.ts -- baseline-pre-fixes post-vastu-severity-fixes
```

## Per-commit naming convention

| Commit                          | Snapshot name                  |
|--------------------------------|--------------------------------|
| 1 (maxDuration)                | `baseline-pre-fixes`           |
| 3 (Vastu severity fixes)       | `post-vastu-severity-fixes`    |
| 4 (Hallucination strip)        | `post-hallucination-strip`     |
| 5 (Renderer cap-skip fix)      | `post-renderer-fix`            |
