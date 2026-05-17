# v2 RETIRED — One Pipeline, One Path

**Date:** 2026-05-17 · **Ship commit:** `1759b9c6` · **Decision: 🟢 SHIPPED**

---

## 1 · TL;DR

v2 IFC pipeline retired. v3 (`GN-013` AI IFC Generator) is the only
path to an IFC. Repo clean, Vercel simplified, one feature flag total
(default-on). Users see one working path; no more legacy traps.

---

## 2 · What changed

1. **Repo cleanup.** 22 uncommitted files → 0. False-green `prod-eval-outputs/` deleted (corrected versions live in `prod-eval-outputs-v2/`). `LOCAL_SMOKE_TEST_RESULTS.md` / `MIGRATION_SAFETY_REVIEW.md` / `PROD_DEPLOY_RUNBOOK.md` now in `.gitignore`. As a bonus, fixed a `PHASE_*.md` gitignore catch-all that had silently dropped yesterday's `PHASE_V3_SHIPPED_2026-05-17.md` — it's now on origin too.
2. **v2 catalogue deprecation.** `TR-024 / TR-022 / EX-006` marked `deprecated + hiddenFromPicker + replacedBy: "GN-013"`. Old DB workflows still load (entries preserved); new users can't drag them.
3. **Canvas picker filters.** New `VISIBLE_NODE_CATALOGUE` derived export; all 3 pickers (`SlimLibraryDrawer`, `NodeLibrarySidebar`, `QuickSearch`) use it.
4. **Deprecation banner.** Loads on any workflow with a v2 node. Three actions: **Upgrade workflow** (one-click swap of the chain for a single GN-013, preserving upstream brief source); **Open form instead** (→ `/dashboard/brief-to-ifc/v3/new`); **Dismiss** (per-workflow, localStorage).
5. **v2 backend → HTTP 410 Gone.** `POST /api/brief-to-ifc-job`, `POST /api/brief-to-ifc-job/worker`, and the canvas handlers for `TR-024 / TR-022 / EX-006` all return `PIPELINE_RETIRED`. `GET /api/brief-to-ifc-job` stays online so users can still inspect historical job rows (canary check removed for reads).
6. **Feature-flag simplification.** `briefToIfcV2QueueEnabled` removed from `FeatureFlags` type + the `/api/config/feature-flags` response + `useExecution`'s wf-13 dispatch branch. `shouldUseBriefToIfcV3` is now default-TRUE (only `BRIEF_TO_IFC_V3_ENABLED=false` disables it).
7. **Sidebar + dashboard polish.** "AI IFC (Beta)" sidebar entry → "AI IFC". Dashboard card drops the "(beta)" subtitle and the client-side flag gate. The card now reads: "Upload a PDF or paste text. AI builds a BIM model in ~1 minute for around $0.20."

---

## 3 · What users see now

- **Canvas picker:** only `GN-013 AI IFC Generator` visible for IFC generation. v2 nodes are gone from search + library.
- **Submit form:** [`/dashboard/brief-to-ifc/v3/new`](https://trybuildflow.in/dashboard/brief-to-ifc/v3/new) — 3 tabs (text / PDF / JSON), sample-briefs disclosure, cost-estimate panel, monthly quota counter.
- **Old workflows:** load with a "This workflow uses an old IFC pipeline" banner + "Upgrade workflow" button (one-click swap to GN-013, autosaves).
- **Sidebar:** "AI IFC" entry (Sparkles icon, no beta badge).
- **Dashboard:** prominent amber Quick-Start card linking to the submit form.

---

## 4 · What changed in Vercel

Two env vars deleted (no longer read by code):
- `BRIEF_TO_IFC_V2_QUEUE_ENABLED`
- `NEXT_PUBLIC_BRIEF_TO_IFC_V2_QUEUE_ENABLED`

The third (`BRIEF_TO_IFC_V3_ENABLED`) was also deleted — code now defaults to enabled. Verified live: `GET /api/config/feature-flags` returns `{ briefToIfcV3Enabled: true, ... }`.

---

## 5 · Cumulative v3 journey cost

| Phase | Spend |
|---|---|
| Eval cycle 2 (false-green) | $1.27 |
| Beast-mode forensics + fix | $1.19 |
| SOL real-brief test | $0.196 |
| Shippability phase (D1–D7) | $0 |
| **v2 retirement (this phase)** | **$0** |
| **Total Anthropic** | **≈ $2.66** |

---

## 6 · Final test state

- vitest: **207 files passed**, 21 new tests added this phase (5 catalogue invariants + 9 upgrade-utility + 4 banner + 3 v2-retirement). 7 pre-existing failures unchanged (none in v3 or canvas).
- pytest: **44/44** on the v3 helper + sandbox tests.
- TypeScript: clean.
- `npm run build`: green (176 routes, 9.5 s compile).

---

## 7 · Closing message

✅ v2 RETIRED. v3 IS THE ONLY PIPELINE.

Repo: clean. Vercel: simplified. Users: see one working path. You're done. Tweet when ready.
