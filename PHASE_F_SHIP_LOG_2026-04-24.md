# Results V2 — Phase F Ship Log

## STATUS: **SHIPPED ✅**

Five phases of engineering landed on `main` in five logical commits behind a single env var. Code is live on the branch and in the repo; the experience is dark until Rutik flips `NEXT_PUBLIC_RESULTS_V2=true` in Vercel. Users see zero change in the meantime.

---

## 1. Gauntlet Summary (F.A)

Full transcript at `PHASE_F_PREFLIGHT_LOG.txt` (committed in Commit 1). Headline exit codes:

| Gate | Command | Exit |
|---|---|---|
| Branch sanity | `git branch --show-current` → `feat/results-v2-cinematic` | 0 |
| Remote sanity | `git remote -v` → `origin = rutikerole/NeoBIM_Workflow_Builder.git` | 0 |
| Fetch origin main | `git fetch origin main` | 0 |
| No prior commits on branch | `git log main..HEAD --oneline` → empty | 0 |
| Local main matches origin | `git log origin/main..main --oneline` → empty | 0 |
| Working tree shape | 19 entries (expanded: 72 V2 untracked + 1 modified) | 0 |
| `npx tsc --noEmit` | | 0 |
| `npx eslint` (V2 scope) | 0 errors, 1 pre-existing warning (`WorkflowCanvas.tsx:787 durationText` — predates all V2 phases) | 0 |
| `npx vitest run tests/unit/results-v2/` | 67 / 67 passing | 0 |
| `npm run build` | Only pre-existing Cache-Control warning | 0 |
| Forbidden-pattern grep | Zero render-visible `$N` literals, zero `cost/price/usd/dollar` DOM strings, zero `any`/`@ts-ignore`/`as any` | — |

**Notable out-of-scope findings** (documented, not acted on — Phase F forbids refactors):

- `src/app/dashboard/results/[executionId]/boq/page.tsx:61` has a pre-existing `react-hooks/set-state-in-effect` ESLint error. It lives in tracked production code that predates Phase C. The prompt's broad lint scope (`src/app/dashboard/results/`) pulls it in; the narrower V2-specific scope (matching Phase E) is clean. Surfacing this to Rutik so it can be fixed in a follow-up.
- `experiments/` (20 files, ML training scratch from April 23) remains untracked throughout. Not V2-related, never committed to any branch, explicitly excluded from the F.C commit plan. Intentional.

---

## 2. Rollback Tag (F.B)

```
tag          pre-results-v2-activation
points to    ecf3c2dbd7039f1a6d3ec0340f2db8f0b0eaaef1
which is     "fix(auth): auto-link Google sign-in to existing same-email accounts"
             (the last commit on main before this merge)
message      "Rollback anchor: last known-good main before Results V2 merge"
pushed       origin (confirmed via `git ls-remote --tags origin`)
```

The parachute exists before the jump.

---

## 3. Commits on Feature Branch (F.C — 5 commits, logical grouping)

Captured before the merge changed the graph — these are visible on both the feature branch (`origin/feat/results-v2-cinematic`) and as the second-parent chain of the merge commit (`f3c024d^2..f3c024d^2@{0}`).

```
7ac4ab4  test(results-v2): phase-E merge-readiness — 67 tests, runtime scan, screenshot tooling
25af7a8  feat(canvas): flag-gate completion → V2 redirect (legacy overlay preserved when flag off)
d435d8c  feat(results-v2): flag-gated route + dev preview + legacy deep-link fallback
8291cf6  feat(results-v2): cinematic result experience — 6 heroes, 5 panels, pure selectors
1cbf7a4  docs(results-v2): audit + doctrine + phase reports + screenshots
```

Each commit is independently revertible. Commit 4 (canvas rewire, 22+/4-) is the smallest — if something in production blows up, reverting *just that commit* flips the behavior back without undoing the rest of the work.

**Commit 1 minor note:** `PHASE_F_PREFLIGHT_LOG.txt` was force-added (`git add -f`) because `.gitignore` line 63 (`*.txt`) excludes it by default. Amended into the initial commit so the log ships as committed evidence. This is the only `-f` used anywhere in Phase F.

---

## 4. Merge on Main (F.E)

```
merge commit    f3c024d15110ffdca4e449b86d6a0caa597d21eb
merge style     --no-ff (topology preserved — the 5 commits are visible as
                a side branch feeding the merge in `git log --graph`)
on branch       main
now at origin   ecf3c2d..f3c024d  main -> main   (F.F push confirmed)
```

Inside `git log --graph --oneline`:

```
*   f3c024d Merge: Results V2 cinematic surface (flag-gated, default OFF)
|\
| * 7ac4ab4 test(results-v2): phase-E merge-readiness — 67 tests, runtime scan, screenshot tooling
| * 25af7a8 feat(canvas): flag-gate completion → V2 redirect (legacy overlay preserved when flag off)
| * d435d8c feat(results-v2): flag-gated route + dev preview + legacy deep-link fallback
| * 8291cf6 feat(results-v2): cinematic result experience — 6 heroes, 5 panels, pure selectors
| * 1cbf7a4 docs(results-v2): audit + doctrine + phase reports + screenshots
|/
* ecf3c2d fix(auth): auto-link Google sign-in to existing same-email accounts   ← pre-results-v2-activation
```

---

## 5. Post-Ship Repo State

- `main` → `f3c024d` (merge commit) on both local and `origin`
- `feat/results-v2-cinematic` → `7ac4ab4`, pushed to origin, **NOT deleted** (preserved for forensics / cherry-pick / post-merge inspection)
- Tag `pre-results-v2-activation` → `ecf3c2d`, pushed to origin
- Working tree: single leftover `?? experiments/` (pre-existing, intentional)
- `NEXT_PUBLIC_RESULTS_V2` **not touched** — code is live, flag is OFF, users see no change
- `NEXT_PUBLIC_RESULTS_V2_PREVIEW` also not touched — preview routes 404 in production

Vercel will kick off a build for the merge commit on main. That deployment will include V2 code but, with the flag unset, the Canvas FAB still opens the legacy `ResultShowcase` overlay and the V2 route's flag-OFF branch is still the current active path.

---

## 6. Flag-Flip Handoff — Rutik's Next Steps

### To activate V2 in production

1. **Vercel → BuildFlow → Settings → Environment Variables.**
2. **Add** a new env var:
   ```
   Name:   NEXT_PUBLIC_RESULTS_V2
   Value:  true
   Scope:  Production  (optionally also Preview — recommended so Vercel preview deploys show V2)
   ```
3. **Trigger a redeploy** (Deployments → latest main deployment → ⋯ → Redeploy) *or* just wait for the next push to main; either rebuild activates the flag.
4. **Smoke test on `trybuildflow.in`:**
   - Log in, run any existing workflow end-to-end.
   - After completion, you should be redirected to `/dashboard/results/<executionId>`.
   - Verify: V2 hero renders, ribbon scrolls, panels stagger in, video plays (or skeleton shows while it renders).
   - DevTools console: no new errors. The analytics CSP-block noise from the Phase E scan is pre-existing and expected.
   - If you took a floor-plan workflow: confirm warm amber/rose tones on HeroFloorPlan.
5. **Monitor for 24–48h** (Sentry + Vercel logs):
   - Any `pageerror` on `/dashboard/results/[executionId]` → investigate.
   - Any spike in 500s on `/api/executions/[id]` → the V2 normalizer runs one GET per deep-link load; traffic shape should match workflows-completed-today.

### To instantly deactivate V2

- In Vercel, **delete** the `NEXT_PUBLIC_RESULTS_V2` env var (or set it to anything other than `"true"`).
- Redeploy the latest main. Canvas returns to the legacy overlay within seconds of the deploy going live.
- No code change needed.

### To fully revert the code

```bash
git checkout main
git pull
git revert -m 1 f3c024d15110ffdca4e449b86d6a0caa597d21eb
git push origin main
```

- The feature branch `feat/results-v2-cinematic` and the tag `pre-results-v2-activation` both survive — use them to inspect or cherry-pick later.
- The rollback tag points at the exact pre-merge state if you ever need to reset-hard (though `git revert` is the safer operation).

---

## 7. What Shipped (for the changelog)

Counts pulled from the 5 commits:

- **35 files** in Commit 1 (9 docs/reports + 26 screenshots).
- **27 files** in Commit 2 (V2 core: 6 heroes, 5 panels, 4 primitives, 1 controls, 5 libs, 2 hooks, 1 fixture set, 1 constants, 1 types, 1 composer).
- **5 files** in Commit 3 (V2 route, legacy fallback, 2 preview routes).
- **1 file** in Commit 4 (canvas rewire — 22+/4-).
- **6 files** in Commit 5 (4 test files, 2 scripts).

Total: **74 files changed, ~8,900 lines added, 4 removed**. Zero files in forbidden zones (IFC, VIP pipeline, auth, Prisma, `/api/**`, execution engine).

---

## 8. Anomalies Surfaced for Rutik

Two non-blocking items caught during Phase F that Rutik may want to triage later (both out of scope for this ship):

1. **`boq/page.tsx:61` pre-existing ESLint error** (documented in §1). Independent of V2; fix in a dedicated commit when you're next in the area.
2. **`WorkflowCanvas.tsx:787 durationText` unused-var warning** — also pre-existing, same scope rule.

These are on `main` today and were on `main` before V2. Not introduced by this merge.

---

**Ceremony complete.** 🚢

Branch `feat/results-v2-cinematic` on origin. Merge commit `f3c024d` on origin/main. Tag `pre-results-v2-activation` on origin. Flag `NEXT_PUBLIC_RESULTS_V2` still yours to flip.

Five phases of paranoia now live in `git log`. Go flip it when you're ready.
