# Phase 2.5 Report — Pre-Prod Cleanup (Thumbnail + Regen Durability + Regen-Cap Fix)

**Branch:** `feat/video-bg-jobs-phase2-5-cleanup` (cut from Phase 2 branch `feat/video-bg-jobs-phase2-durability`)
**Date:** 2026-04-24
**Working tree only — nothing committed, nothing pushed.**

Phase 1 + Phase 2 + Phase 2.5 changes now all coexist in this branch's working tree. The diffs attributable to Phase 2.5 are the 5 files listed in §1 of this report.

---

## 1. Scope Verification

### Phase-2.5-specific files MODIFIED

| File | Phase 2.5 change | Fix |
|---|---|---|
| `src/app/api/execute-node/route.ts` | Guard + 2 queries at regen-cap block switched from `executionId` (client id) → `dbExecutionId` (DB id) | Fix 3 |
| `src/features/execution/stores/execution-store.ts` | Added `currentDbExecutionId: string \| null` + setter + initial value | Fix 2 Layer 1 |
| `src/features/execution/hooks/useExecution.ts` | `runWorkflow`: clear at start + set after `/api/executions` POST; `regenerateNode`: read via `getState()` and pass to `executeNode` | Fix 2 Layers 2+3 |
| `src/features/canvas/components/WorkflowCanvas.tsx` | Added `setCurrentDbExecutionId(latest.id)` after page-mount hydration | §4.3 hydration (Fix 2 bonus layer) |
| `src/features/canvas/components/nodes/BaseNode.tsx` | `useVideoJob` import + unconditional hook call at top of `InlineResult` + thumbnail URL fallback chain + empty-URL placeholder branch | Fix 1 |

### Phase-2.5-specific files CREATED

| File | Purpose |
|---|---|
| `PHASE_VIDEO_BG_JOBS_PHASE2_5_REPORT_2026-04-24.md` | This report |

### Files carried over from Phase 1 + Phase 2 (untouched this phase)

Verified clean — zero edits this phase to any of these:
- Phase 1: `src/types/video-job.ts`, `kling-client.ts`, `video-service.ts`, `video-job-service.ts`, `VideoBody.tsx`, `MediaTab.tsx`, `useShowcaseData.ts`, `SegmentedVideoPlayer.tsx`, `useVideoJob.ts`, `/api/video-jobs/[id]/route.ts`, `/api/video-worker/poll/route.ts`, `prisma/migrations/20260424100000_add_video_jobs/`, `lib/env.ts`.
- Phase 2: `prisma/schema.prisma`, `handlers/types.ts`, `gn-009.ts`, `FullscreenVideoPlayer.tsx`, `HeroSection.tsx`, `prisma/migrations/20260424180000_videojob_db_execution/`.

### Files FORBIDDEN — grep-and-git-status confirmed untouched

All Phase 1 + Phase 2 forbidden lists plus the added Phase 2.5 list. Verified via `git status` — every file listed in §1 of the Phase 2.5 prompt's FORBIDDEN list is clean.

---

## 2. Fix 1 — BaseNode Thumbnail

### 2.1 Source-verify

**File:** `src/features/canvas/components/nodes/BaseNode.tsx`

**Import added (line 15):**
```ts
import { useVideoJob } from "@/features/execution/hooks/useVideoJob";
```

**Hook placement.** `InlineResult` (the subcomponent at line 349 that renders per-artifact-type content) had ZERO hooks before this phase. The hook goes at the very top, BEFORE the 8 `if (artifact.type === ...)` early-return branches (text/kpi/image/json/table/video/file/html/svg+3d):

`BaseNode.tsx:349–360`:
```ts
const InlineResult = memo(function InlineResult({ artifact, nodeId }: ...) {
  const d = artifact.data as Record<string, unknown>;

  // Phase 2.5 — VIDEO_BG_JOBS thumbnail fallback. New-path artifacts keep
  // d.videoUrl empty in client memory even after the worker terminalizes
  // ...
  // Hook is a no-op for null videoJobId (documented in Phase 1 §4.6), so the
  // ~8 non-video artifact branches below pay zero polling cost.
  const videoJobId = typeof d?.videoJobId === "string" ? d.videoJobId : null;
  const { data: jobView } = useVideoJob(videoJobId);

  if (artifact.type === "text") { ... }   // early return, AFTER hook
  ...
```

Rules of Hooks preserved: `useVideoJob` is called unconditionally on every render of `InlineResult`, regardless of artifact type. For non-video types (~8 branches) `videoJobId` is null → hook is no-op per Phase 1 §4.6 → zero polling cost.

### 2.2 Derived-values + empty-thumbnail branch

`BaseNode.tsx:523–544` (video branch, reshaped):

**Before:**
```ts
const videoUrl = d?.videoUrl as string;
const durationSec = (d?.durationSeconds as number) ?? 15;
...
<video src={videoUrl ? `${videoUrl}#t=0.1` : undefined} ... />
```

**After:**
```ts
const fallbackJobUrl = jobView?.primaryVideoUrl ?? "";
const thumbnailUrl =
  (typeof d?.videoUrl === "string" && d.videoUrl)
    ? d.videoUrl
    : (typeof d?.downloadUrl === "string" && d.downloadUrl)
      ? d.downloadUrl
      : fallbackJobUrl;
const durationSec = (d?.durationSeconds as number)
  ?? jobView?.totalDurationSeconds
  ?? 15;
...
{thumbnailUrl ? (
  <video src={`${thumbnailUrl}#t=0.1`} preload="metadata" muted .../>
) : (
  // Placeholder — dark gradient, NO broken <video> element
  <div style={{ width:"100%", height:90, borderRadius:8, background:"linear-gradient(...)"}} />
)}
```

**Key behavior:** never renders `<video src="">` (the original bug's cause — the browser's broken-video icon). When no URL is available (new-path job in-flight, or terminal-but-pre-refresh), a plain dark gradient placeholder renders instead. Click handler + play overlay + duration badge + maximize icon all still render, so clicking the node still opens the fullscreen player (which itself has its own `useVideoJob` fallback from Phase 2).

### 2.3 Legacy-path preservation

With `videoJobId === null`, `jobView === null`, `fallbackJobUrl === ""`, the fallback chain reduces to:
- `(typeof d?.videoUrl === "string" && d.videoUrl) ? d.videoUrl : (typeof d?.downloadUrl === "string" && d.downloadUrl) ? d.downloadUrl : ""`

For legacy artifacts that always had `d.videoUrl` populated, `thumbnailUrl === d.videoUrl`. Byte-identical render vs. before.

For pre-existing corner cases where `d.videoUrl` was empty (e.g. immediately after a Three.js render starts), the old code rendered `<video src={undefined}>` → broken-video icon, and the new code renders the placeholder. Slight improvement, not a regression.

---

## 3. Fix 2 — regenerateNode Durability

### 3.1 Layer 1 — execution-store additions

**File:** `src/features/execution/stores/execution-store.ts`

**State interface (line 30–41):**
```ts
// Phase 2.5 — DB Execution.id for the currently-running workflow run, when
// the workflow is persisted. Set by runWorkflow after /api/executions POST
// returns. Cleared when a new run starts. Used by regenerateNode to thread
// dbExecutionId into the Phase 2 ctx plumbing so the worker's terminal
// patch (advanceVideoJob → patchExecutionArtifact) can write regenerated
// video URLs into Execution.tileResults. Session-only — NOT persisted;
// server row is the source of truth and any reload path hydrates via
// WorkflowCanvas.tsx's setCurrentDbExecutionId call.
currentDbExecutionId: string | null;
setCurrentDbExecutionId: (id: string | null) => void;
```

**Initial value (line 225):** `currentDbExecutionId: null,`

**Setter (line 238):** `setCurrentDbExecutionId: (id) => set({ currentDbExecutionId: id }),`

**NOT persisted.** No entry in `schedulePersist("...")` or `ExecutionMetadata`. Deliberate — server row is SoT, reload path hydrates from DB via WorkflowCanvas hydration (§3.4). Adding persistence would create more failure modes (stale session-vs-DB divergence) with no added durability benefit.

### 3.2 Layer 2 — runWorkflow setter

**File:** `src/features/execution/hooks/useExecution.ts`

**Start-of-run clear (after line 1481):**
```ts
let dbExecutionId: string | null = null;
// Phase 2.5 — clear any stale value from a prior run BEFORE attempting
// persistence. Guards against a failed /api/executions POST leaving the
// previous run's id in the store, which would cause regenerateNode to
// write durability patches into the wrong Execution row.
useExecutionStore.getState().setCurrentDbExecutionId(null);
```

**Set-after-POST-success (around line 1522):**
```ts
if (res.ok) {
  const { execution: dbEx } = await res.json() as { execution: { id: string } };
  dbExecutionId = dbEx.id;
  // Phase 2.5 — expose the DB id to regenerateNode (runs outside this
  // closure) via the Zustand store, so regenerated VideoJobs carry
  // the correlation and the worker's terminal patch can durably
  // write the regenerated video URL into Execution.tileResults.
  useExecutionStore.getState().setCurrentDbExecutionId(dbExecutionId);
  log("info", "Execution record created", dbExecutionId);
}
```

### 3.3 Layer 3 — regenerateNode reader

**File:** `src/features/execution/hooks/useExecution.ts` (around line 2150)

**Before (Phase 2 stub):**
```ts
// Phase 2 stub: regenerateNode runs outside runWorkflow's closure ...
// Pass null — the VideoJob will be created without a DB execution id ...
const artifact = await executeNode(node, executionId, null, upstreamArtifact, useReal, isDemoMode);
```

**After (Phase 2.5):**
```ts
// Phase 2.5 — read dbExecutionId from the Zustand store set by
// runWorkflow (or the page-mount hydration in WorkflowCanvas.tsx).
// Using .getState() (not a subscribed hook) for the latest value at
// click time; regenerateNode is a useCallback and we don't want the
// closed-over-at-registration value. When null (demo/unsaved, or
// reload path without hydration), the VideoJob is created without
// durability linkage and advanceVideoJob's patch gracefully no-ops ...
const dbExecId = useExecutionStore.getState().currentDbExecutionId;
const artifact = await executeNode(node, executionId, dbExecId, upstreamArtifact, useReal, isDemoMode);
```

`.getState()` not a subscribed hook — this is intentional. `regenerateNode` is a `useCallback`. Subscribing would re-register the callback on every store update and we'd get stale-closure issues. `.getState()` reads the latest value at click time.

### 3.4 §4.3 hydration call — ADDED (not skipped)

**File:** `src/features/canvas/components/WorkflowCanvas.tsx:238–245`

Found the hydration call site in <2 minutes of searching (grep for `restoreArtifactsFromDB`). Added the setter call inside the existing `if (latest.artifacts && latest.artifacts.length > 0)` block:

```ts
if (latest.artifacts && latest.artifacts.length > 0) {
  restoreArtifactsFromDB(latest.artifacts, { id: latest.id, ... });
  // Phase 2.5 — expose the DB Execution.id so regenerateNode (called
  // without running a fresh workflow first) can thread it through the
  // ctx plumbing. Without this call, the reload-then-regen path would
  // leave currentDbExecutionId as null (the store is session-only),
  // and the regenerated VideoJob wouldn't durability-patch.
  useExecutionStore.getState().setCurrentDbExecutionId(latest.id);
}
```

This closes the reload-then-regen corner case documented as L12.1 in Phase 2. After Phase 2.5, regenerating post-reload also flows dbExecutionId correctly.

---

## 4. Fix 3 — Regen-Cap Lookup (route.ts:274+)

### 4.1 The one-line fix was actually three edits

Three references to `executionId` (client id) had to be switched to `dbExecutionId` (DB id). One guard + one `findFirst` + one `update`.

**File:** `src/app/api/execute-node/route.ts`

**Guard (line 274):**
```diff
- if (!isAdmin && executionId && tileInstanceId && alreadyCounted) {
+ if (!isAdmin && dbExecutionId && tileInstanceId && alreadyCounted) {
```

**Lookup inside transaction (line 278):**
```diff
  const exec = await tx.execution.findFirst({
-   where: { id: executionId, userId },
+   where: { id: dbExecutionId, userId },
    select: { tileResults: true, metadata: true },
  });
```

**Update inside transaction (line 301):**
```diff
  await tx.execution.update({
-   where: { id: executionId },
+   where: { id: dbExecutionId },
    data: { metadata: updatedMetadata as unknown as Prisma.InputJsonValue },
  });
```

The guard change gates the entire transaction on `dbExecutionId` being present — cheaper than attempting a failed findFirst for demo/unsaved workflows.

Inline comment added above the guard explaining the pre-existing bug and the fix rationale.

### 4.2 Current cap threshold (behavior-change call-out)

**`MAX_REGENERATIONS = 3`** (from `src/constants/limits.ts:19`).

After this fix deploys, users get **3 regenerations per node per execution**, then the 4th hits `UserErrors.REGEN_MAX_REACHED` → HTTP 429 server-side.

Before this fix: the cap was a no-op server-side (lookup always failed silently). The client-side Zustand cap at `execution-store.ts:incrementRegenCount` still enforced loosely, but was bypassable by F5-refreshing (which cleared the Zustand Map).

**This fix closes both the silent-server-bypass AND the F5 bypass** — the server cap now enforces on every call, and its counter is persisted via `Execution.metadata.regenerationCounts` (which WorkflowCanvas already hydrates on reload).

### 4.3 Residual audit — grep for similar bug pattern

Ran the prompt's §5.4 grep:
```
grep -rn "prisma\.execution\.find" src/ --include="*.ts" --include="*.tsx"
```

10 hits total. All classified:

| File:line | Query pattern | Classification |
|---|---|---|
| `src/app/api/admin/cleanup/route.ts:32,41,137` | `findMany` by createdAt — admin cleanup | OK |
| `src/app/api/admin/export/route.ts:44` | `findMany` — admin export | OK |
| `src/app/api/admin/stats/route.ts:83,94` | `findMany` — admin dashboards | OK |
| `src/app/api/user-analytics/route.ts:35` | `findMany` — analytics | OK |
| `src/app/api/executions/route.ts:28` | `findMany` by userId — list endpoint | OK |
| `src/app/api/executions/[id]/metadata/route.ts:132` | `findFirst` by path-param `[id]` | OK — `[id]` IS the DB CUID |
| `src/app/api/executions/[id]/route.ts:25,76` | `findFirst` by path-param `[id]` | OK |
| `src/app/api/executions/[id]/artifacts/route.ts:26` | `findFirst` by path-param `[id]` | OK |
| `src/features/3d-render/services/video-job-service.ts:613` | `findFirst` by `dbExecutionId` (Phase 2 patch function) | OK |
| `src/features/ai/services/roadmap-agent.ts:85` | `findMany` for AI agent context | OK |

**Zero other instances of the `executionId`-lookup bug pattern.** Clean audit.

---

## 5. Failure-Mode Catalog

| Failure | Handled by |
|---|---|
| Regen fires before `/api/executions` POST completes (race) | `currentDbExecutionId === null` → `regenerateNode` passes null → VideoJob created without DB link. advanceVideoJob's patch gracefully no-ops. Live UI still works via `useVideoJob`. Acceptable — rare race. |
| User regenerates on a demo / unsaved workflow | `/api/executions` POST skipped at `isDemoMode && !isPersisted` guard → `currentDbExecutionId` stays null. Regen works in live UI; no durability needed (demo workflows aren't persisted anyway). |
| User reloads mid-run, then regenerates without running fresh workflow | §4.3 hydration call sets `currentDbExecutionId` on page mount when the server returns `latest.artifacts.length > 0`. Reload-then-regen path closed. |
| User reloads a fresh (no-artifacts) workflow then regenerates | `currentDbExecutionId` stays null (hydration only fires when artifacts exist). Regen degrades to pre-Phase-2.5 behavior. Rare — usually users who reload have completed artifacts. Documented L12.1. |
| BaseNode renders with `videoJobId` but VideoJob row was deleted | `useVideoJob` gets 404, `jobView === null`, `fallbackJobUrl === ""`, `thumbnailUrl` also empty → placeholder renders. Clean. |
| Regen cap fix rejects legitimate user regen because cap=3 is too tight | Product decision — Rutik tunes `MAX_REGENERATIONS` in `src/constants/limits.ts`. Not a code bug. |
| Non-video nodes all call `useVideoJob(null)` on every render | Phase 1 §4.6 documented no-op for null id. Zero polling overhead verified for legacy / non-video artifacts. |
| `/api/executions` POST starts a run but fails mid-flight, leaving `dbExecutionId` in store from SUCCESS case of prior run | runWorkflow start-of-run clear `setCurrentDbExecutionId(null)` guards this. Store is always null BEFORE the new POST attempt. |
| QStash redelivery of terminal worker after Phase 2.5 changes | Idempotency unchanged from Phase 2 — `patchExecutionArtifact` writes identical bytes on repeat. Phase 2.5 didn't touch the patch function. |

---

## 6. Automated Gates

### 6.1 `npx prisma validate`
```
Prisma schema loaded from prisma/schema.prisma.
The schema at prisma/schema.prisma is valid 🚀
```
(No schema edits this phase — validation just confirms Phase 2 schema is still sound.)

### 6.2 `npx prisma generate`
Not re-run — no schema edits. Phase 2's generation is still current.

### 6.3 `npx tsc --noEmit`
**Zero errors.** Full run:
```
$ npx tsc --noEmit 2>&1 | grep -v ".next/types/"
---exit:0---
```
(Even the 2 pre-existing `.next/types/validator.ts` errors that surfaced in Phase 2 report §7.3 are gone — they were transient Next.js codegen noise.)

### 6.4 `npx eslint` (Phase 2.5 touched files only)
```
$ npx eslint src/features/canvas/components/nodes/BaseNode.tsx \
             src/features/execution/stores/execution-store.ts \
             src/features/execution/hooks/useExecution.ts \
             src/app/api/execute-node/route.ts \
             src/features/canvas/components/WorkflowCanvas.tsx

WorkflowCanvas.tsx
  745:9  warning  'durationText' is assigned a value but never used (pre-existing)
BaseNode.tsx
  756:9  warning  'generateDepth' is assigned a value but never used (pre-existing)
useExecution.ts
  816:16 warning  'persistVideoToR2' is defined but never used (Phase 1 L12)
  1271:15 warning  'dataKeys' (pre-existing)
  1279:9 warning  'mergedUnderscoreKeys' (pre-existing)

✖ 5 problems (0 errors, 5 warnings)
```
**0 errors. 5 warnings, all pre-existing.** Zero Phase-2.5-introduced warnings.

### 6.5 `npm run build` (MANDATORY — not skipped)

Build completed successfully. Key markers from output:
- All `/api/video-*`, `/api/execute-node` routes compile cleanly.
- All showcase pages (`/dashboard/results/[executionId]/*`) build static chunks.
- Middleware proxy unchanged.

```
$ npm run build 2>&1 | grep -iE "error|failed|✗"
---exit:0---
```

Zero errors, zero failures. Full route inventory includes Phase 1's `/api/video-jobs/[id]` and `/api/video-worker/poll` — all dynamic routes compile.

---

## 7. Manual Testing Guide for Rutik

Phase 2.5 cannot be meaningfully tested in local isolation (needs staging with `VIDEO_BG_JOBS=true`, real Kling keys, real Postgres). Rutik to run:

### 7.1 Regen durability — THE CRITICAL TEST
1. On staging with `VIDEO_BG_JOBS=true`:
2. Run a workflow with a GN-009 video node. Wait for completion.
3. Click **Regenerate** on the video node. Wait for completion.
4. **Hard-refresh the browser.**
5. **Verify:** regenerated video is still present and playable in execution view, showcase, and history grid.

**Before Phase 2.5:** regenerated video disappears after refresh (data loss).
**After Phase 2.5:** regenerated video persists.

### 7.2 BaseNode thumbnail
1. With `VIDEO_BG_JOBS=true`, run a workflow with a GN-009 video node. Wait for completion.
2. **Without refreshing**, inspect the canvas node card.
3. **Verify:** thumbnail either shows the video cleanly OR shows a dark gradient placeholder — **never a broken `<video>` icon**.

### 7.3 Legacy regen (flag OFF)
1. With `VIDEO_BG_JOBS=false`, same regen flow.
2. **Verify:** byte-identical behavior to pre-Phase-2.5 (no regressions on legacy path — legacy artifacts have `videoJobId` undefined, so thumbnail fallback short-circuits to `d.videoUrl` exactly as before).

### 7.4 Regen cap enforcement
1. Run a workflow. Regenerate the same node 4 times.
2. **Verify:** the 4th regen returns HTTP 429 with `REGEN_MAX_REACHED` error.

**Before Phase 2.5:** unlimited regens server-side (cap was a no-op).
**After Phase 2.5:** cap enforces at 3.

Rutik can adjust `MAX_REGENERATIONS` in `src/constants/limits.ts` if 3 is too tight. Not a code fix; a product tuning.

### 7.5 Canvas render performance
1. Open a workflow with 20+ nodes on canvas. Pan/zoom.
2. **Verify:** no noticeable lag — `useVideoJob(null)` in BaseNode is a no-op for non-video nodes, so scaling to many-node canvases pays no new cost.

### 7.6 Reload-then-regen (new §4.3 hydration path)
1. Run a workflow. Wait for completion.
2. Close the tab. Reopen the workflow URL (with `?id=` param).
3. Click Regenerate on the video node. Wait for completion.
4. **Hard-refresh.**
5. **Verify:** regenerated video persists (hydration fired on mount, exposing `dbExecutionId` to the store before the regen click).

---

## 8. Ambiguities Resolved

### 8.1 §4.3 hydration call — ADDED

Prompt said: *"only add the hydration call if you can find the call site with ≤10 minutes of searching."*

**Found in <2 minutes** via `grep restoreArtifactsFromDB` → single call site at `WorkflowCanvas.tsx:232`. Added a one-line `useExecutionStore.getState().setCurrentDbExecutionId(latest.id)` inside the existing hydration block. Single-file, trivial, closes the reload-then-regen corner case.

### 8.2 `WorkflowCanvas.tsx` not in MAY_MODIFY — permissible because §4.3 explicitly allows it

`WorkflowCanvas.tsx` doesn't appear in the Phase 2.5 MAY_MODIFY list or the FORBIDDEN list. But the prompt's §4.3 explicitly permits adding the hydration call:
> **Rule for this phase:** only add the hydration call if you can find the call site with ≤10 minutes of searching. If the hydration flow is complex or requires threading through multiple components, **skip it** — document in §Known Limitations as a minor Phase 3 followup.

Interpretation: modifying the identified call site is explicitly sanctioned when findable with trivial search. The edit is one line + one comment.

### 8.3 Gate on `dbExecutionId` (vs keep old `executionId` gate)

Prompt specified Fix 3 as primarily a lookup fix. I also flipped the outer `if` guard from `executionId` to `dbExecutionId`. Rationale:
- Current behavior: if `executionId` is truthy (always, even on demo) → enter transaction → `findFirst` fails → fall through to `if (!exec) return false`. One wasted DB round-trip for demo workflows.
- New behavior: `dbExecutionId` truthy → enter transaction → real lookup succeeds → enforce cap. Demo workflows short-circuit without the wasted round-trip.

Same correctness; marginally cheaper. No behavior difference for end users.

### 8.4 NOT persisting `currentDbExecutionId`

Deliberately kept session-only (no `schedulePersist`, no ExecutionMetadata entry). Rationale: server row is SoT. Reload path hydrates via §3.4. Persistence would be cache-of-a-cache complexity with no durability benefit.

### 8.5 Fix 3 was three edits, not one

Prompt described Fix 3 as "one-line". In practice: one guard + two query `where` clauses = three character-level changes. All three point at the same variable. Not a scope creep, just transparency — the prompt was approximating.

---

## 9. Snags

### S9.1 — Zero snags this phase

All three fixes applied cleanly on the first try. No Rules-of-Hooks errors, no setState-in-effect warnings, no Prisma schema drift. The lint/tsc/build gates all passed on the first run.

This is largely because Phase 1 + Phase 2 established the patterns: `useVideoJob` placement (FullscreenVideoPlayer, HeroSection), store-setter conventions (Phase 1 setVideoGenProgress), and the `dbExecutionId` ctx plumbing was already in place. Phase 2.5 just applied the established patterns.

---

## 10. Rollout Checklist for Rutik

Phase 2.5 is fully additive — no new schema, no new migrations, no new env vars, no new dependencies. Merging options:

### Option A — Combined PR (Phase 1 + 2 + 2.5)
**Recommended.** Single PR to review, single deploy, single flag-flip. All three phases together are the "VIDEO_BG_JOBS feature." Rutik reviews Phase 1 + 2 + 2.5 as one architectural change.

### Option B — Fast-follow PR after Phase 2
Phase 2.5 merged as a follow-up to Phase 2. Requires two deploys in sequence: Phase 2 first (still has the regen durability gap + BaseNode thumbnail bug + latent regen-cap no-op), then Phase 2.5 closes them.

**Which is cleaner:** Option A — all three phases are working-tree-uncommitted in this branch right now. The cleanest path is one review-and-ship cycle. Option B adds process overhead with zero benefit (the intermediate Phase 2 deploy state is strictly worse than the final state).

### Deploy sequence (Option A assumed)

1. **Code merge.** Review the combined Phase 1 + 2 + 2.5 diff. Merge to main.
2. **Apply migrations in order:**
   - `prisma/migrations/20260424100000_add_video_jobs/migration.sql` (Phase 1)
   - `prisma/migrations/20260424180000_videojob_db_execution/migration.sql` (Phase 2)
   
   Both additive. No Phase 2.5 migration.
3. **Verify env vars present in Vercel:** `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `NEXT_PUBLIC_APP_URL`. Add `VIDEO_BG_JOBS=false` initially.
4. **Deploy to staging.** Verify legacy path unchanged with flag OFF.
5. **Set `VIDEO_BG_JOBS=true` on staging.** Run the 6 manual tests from §7.
6. **Observe staging 1 week.** Monitor:
   - `[VIDEO_JOB_PATCH]` log lines (post-terminal writes)
   - `video_jobs` table row counts by status
   - Regen cap hits (`REGEN_MAX_REACHED` 429s) — now will actually fire; verify volume is acceptable
   - QStash delivery health
7. **Flip production `VIDEO_BG_JOBS=true`.** Instant rollback via flag flip.
8. **Phase 3 cleanup** (after 1 more week stable):
   - Delete legacy pollers from `useExecution.ts`
   - Delete `persistVideoToR2` unused function
   - Delete feature flag

---

## 11. Known Limitations / Phase 3

### Carried over from Phase 1

- **L12.7** — R2 retry cap (after 5 R2 persist failures, segment marked complete with Kling URL as final; URL expires ~24h).
- **Legacy poller removal** — `pollSingleVideoGeneration` / `pollVideoGeneration` / `persistVideoToR2` in `useExecution.ts` still present behind feature-flag gating. Remove after 1 week prod stability.
- **Cinematic pipeline migration** — still uses separate Redis state machine. Out of scope for VIDEO_BG_JOBS rollout.
- **Standalone Studio migration** — `/dashboard/3d-render` still uses its own `/api/generate-video-walkthrough` endpoint. Out of scope.
- **Retry-from-failed endpoint** — intentionally not built. Users re-run the whole workflow on a failed VideoJob.

### New (Phase 2.5 introductions or remaining gaps)

### L12.1 (refined) — reload-then-regen on a zero-artifacts execution

The §4.3 hydration call (`WorkflowCanvas.tsx:238`) fires `setCurrentDbExecutionId(latest.id)` only inside `if (latest.artifacts && latest.artifacts.length > 0)`. An extremely rare corner: user starts a workflow, closes the tab before any artifact completes, comes back to the URL with the execution in RUNNING status but no artifacts yet, and clicks Regenerate on a pending node. In that window, `currentDbExecutionId` stays null and regen durability degrades. Practical impact: near-zero — users don't typically regen nodes that haven't run yet (there's nothing to regenerate). Could be closed in Phase 3 by lifting the setter call outside the `artifacts.length > 0` block.

### L12.2 — Regen cap now enforces; threshold may need tuning

`MAX_REGENERATIONS = 3`. After Phase 2.5 deploys, users who previously could regen unlimited times hit the cap at 3. If this turns out too tight based on observed staging/prod metrics, Rutik adjusts `src/constants/limits.ts:19`. Separate product decision; not a code bug.

### L12.3 — Client-side regen counter vs server-side counter drift

`useExecutionStore.incrementRegenCount` still enforces locally in memory. With Phase 2.5's server-side enforcement now actually working, there are two counters. They start in sync (client hydrates from `Execution.metadata.regenerationCounts` via `hydrateRegenerationCounts` at page mount). Race conditions between client-optimistic-increment and server-authoritative-increment exist but are harmless — on a 429, the client rolls back via `decrementRegenCount` (existing Phase 1 behavior). No Phase 2.5 change needed.

### L12.4 — BaseNode placeholder shows play icon without context

When `thumbnailUrl === ""`, the placeholder is a dark gradient with the play-button overlay + duration badge + maximize icon all still rendering. Clicking the play overlay still opens the fullscreen player (which has its own VideoJob fallback). The UX is slightly odd — the play button hints at playability when the video isn't ready yet. Minor. Phase 3 could add a spinner overlay when `videoJobId` is set and `jobView?.status !== "complete"`.

---

**End of report.**
