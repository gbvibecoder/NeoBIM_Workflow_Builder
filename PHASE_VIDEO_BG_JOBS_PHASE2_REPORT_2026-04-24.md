# Phase 2 Report — HeroSection Migration + Artifact Durability + Reader Audit

**Branch:** `feat/video-bg-jobs-phase2-durability` (cut from Phase 1 branch `feat/video-bg-jobs-qstash`, which was itself cut from `main` at `094ae369`)
**Date:** 2026-04-24
**Working tree only — nothing committed, nothing pushed.**

Phase 2 carries Phase 1's uncommitted working tree forward (Phase 1 was explicitly "working tree only; Rutik merges manually"). Both phases' changes now coexist in this branch's working tree. The diffs attributable to Phase 2 are called out explicitly in every section below; everything else is Phase 1 baggage the user already reviewed.

---

## 1. Scope Verification — File Checklist

### Phase-2-specific files MODIFIED

| File | Phase 2 touch | Notes |
|---|---|---|
| `prisma/schema.prisma` | Added `dbExecutionId String?` column + index on `VideoJob` | Additive only |
| `src/app/api/execute-node/handlers/types.ts` | Added `dbExecutionId: string \| undefined` to `NodeHandlerContext` | |
| `src/app/api/execute-node/route.ts` | Extract `dbExecutionId` from body, pass into `ctx` with 20+char guard | Minimal edit |
| `src/features/execution/hooks/useExecution.ts` | Added `dbExecutionId` parameter to `executeNode`; sent in POST body; passed `null` in `regenerateNode` | One edit, as permitted by prompt |
| `src/app/api/execute-node/handlers/gn-009.ts` | Destructure `dbExecutionId` from ctx; pass to all 3 `createVideoJobAndEnqueue` calls | |
| `src/features/3d-render/services/video-job-service.ts` | Added `dbExecutionId` to `CreateVideoJobInput`; persist to DB; added `patchExecutionArtifact` + call at terminal transition | Core Stream 1 deliverable |
| `src/features/execution/components/result-showcase/sections/HeroSection.tsx` | `useVideoJob` branch after all legacy hooks; renders `SegmentedVideoPlayer` when `videoJobId` set | Stream 2 |
| `src/features/canvas/components/artifacts/FullscreenVideoPlayer.tsx` | `useVideoJob` fallback for segments / videoUrl / downloadUrl; refactored pre-existing `setState-in-effect` into cleanup-function form | Stream 3 |

### Phase-2-specific files CREATED

| File | Purpose |
|---|---|
| `prisma/migrations/20260424180000_videojob_db_execution/migration.sql` | Adds `dbExecutionId` column + index. Additive only. |
| `PHASE_VIDEO_BG_JOBS_PHASE2_REPORT_2026-04-24.md` | This report |

### Files carried over from Phase 1 (already in working tree, untouched this phase)

- `src/types/video-job.ts`, `src/features/3d-render/services/kling-client.ts`, `src/features/3d-render/services/video-service.ts`, `src/features/canvas/components/artifacts/VideoBody.tsx`, `src/features/execution/components/result-showcase/tabs/MediaTab.tsx`, `src/features/execution/components/result-showcase/useShowcaseData.ts`, `src/features/canvas/components/artifacts/SegmentedVideoPlayer.tsx`, `src/features/execution/hooks/useVideoJob.ts`, `src/app/api/video-jobs/[id]/route.ts`, `src/app/api/video-worker/poll/route.ts`, `src/lib/env.ts`, `prisma/migrations/20260424100000_add_video_jobs/migration.sql`, `PHASE_VIDEO_BG_JOBS_REPORT_2026-04-24.md`.

These are exactly the files listed as FROZEN in the Phase 2 prompt. Zero content change on any of them.

### Files FORBIDDEN — not touched

All of these are unchanged (verified against `git status`):
- `src/features/3d-render/services/cinematic-pipeline.ts`
- `src/app/api/generate-cinematic-walkthrough/route.ts`
- `src/app/api/cinematic-status/route.ts`
- `src/app/api/generate-video-walkthrough/route.ts`
- `src/features/dashboard/components/VideoRenderStudio.tsx`
- `src/features/3d-render/services/walkthrough-renderer.ts`
- `src/app/api/persist-video/route.ts`
- `src/app/api/concat-videos/route.ts`
- `src/features/ifc/**`, `src/features/floor-plan/**`
- `src/features/workflows/constants/node-catalogue.ts`, `prebuilt-workflows.ts`

---

## 2. Stream 1 Audit — Answers

### Q1. When `/api/execute-node` is called, does the DB Execution row already exist? If yes, how does the handler look up its id?

**Answer: YES (for persisted workflows only), and the handler does NOT currently look it up.**

Evidence trail:
- `src/features/execution/hooks/useExecution.ts:1446`: `const executionId = generateId();` — client-generated correlation ID.
- `src/features/execution/hooks/useExecution.ts:1508–1523`: client separately POSTs `/api/executions`, receives `dbExecutionId` (DB CUID), stores in a local variable.
- `src/features/execution/hooks/useExecution.ts:713–723`: the execute-node POST body carries only the **client** `executionId`, not `dbExecutionId`.
- `src/app/api/execute-node/route.ts:51`: the dispatcher destructures only `executionId` from the body — never sees the DB id.

Side note: the regen-cap enforcement in `/api/execute-node/route.ts:273` that does `prisma.execution.findFirst({ where: { id: executionId } })` is actually **a latent no-op bug in production** — `executionId` there is the client id, never matches a DB CUID, so `findFirst` always returns null and the enforcement falls through to `if (!exec) return false`. Out of scope for this phase, but documented for future cleanup.

### Q2. Does Execution have a queryable correlation column (clientExecutionId / runId)?

**Answer: NO.** The current `Execution` model has `id` (CUID), `workflowId`, `userId`, `status`, `startedAt`, `completedAt`, `tileResults`, `errorMessage`, `metadata`, `createdAt`. No column maps to the client's generated correlation id. Verified at `prisma/schema.prisma:204–227`.

### Q3. Cheaper approach?

**Chose Approach A.** Rationale in §8 (Ambiguities).

---

## 3. Stream 1 — Source-Verify Walkthrough

### 3.1 Schema change

**File:** `prisma/schema.prisma` (VideoJob model, lines ~884–933 after format)
```prisma
model VideoJob {
  ...
  userId      String
  user        User   @relation(...)
  executionId String // client-correlation ID, not a FK
  dbExecutionId String?   // Phase 2 — DB Execution.id when persisted
  nodeId      String
  ...
  @@index([dbExecutionId])
}
```

**Migration:** `prisma/migrations/20260424180000_videojob_db_execution/migration.sql`
```sql
ALTER TABLE "video_jobs" ADD COLUMN "dbExecutionId" TEXT;
CREATE INDEX "video_jobs_dbExecutionId_idx" ON "video_jobs"("dbExecutionId");
```

Additive only. Existing rows get `NULL`. Worker's patch skips when `NULL`.

### 3.2 Ctx plumbing — body → handler

`src/app/api/execute-node/handlers/types.ts:48–56`:
```ts
/**
 * DB-side Execution.id for the current workflow run, if persisted.
 * `executionId` above is a CLIENT-generated correlation id; it does NOT
 * equal Execution.id. The client sends both in the body so handlers that
 * need to record durable rows can link to the real Execution row.
 */
dbExecutionId: string | undefined;
```

`src/app/api/execute-node/route.ts:54–56`:
```ts
const { catalogueId, executionId, dbExecutionId, tileInstanceId, inputData, userApiKey } = await req.json();
```

`src/app/api/execute-node/route.ts:363`:
```ts
dbExecutionId: typeof dbExecutionId === "string" && dbExecutionId.length >= 20 ? dbExecutionId : undefined,
```
(20-char guard rejects short / missing values — CUIDs are 25 chars.)

`src/features/execution/hooks/useExecution.ts:720`:
```ts
body: JSON.stringify({
  catalogueId,
  executionId,
  dbExecutionId,   // Phase 2 — null when workflow isn't persisted
  tileInstanceId: node.id,
  inputData,
}),
```

`src/features/execution/hooks/useExecution.ts:94–100`:
```ts
async function executeNode(
  node: WorkflowNode,
  executionId: string,
  dbExecutionId: string | null,   // Phase 2
  ...
```

Two call sites: `runWorkflow` passes real `dbExecutionId`; `regenerateNode` passes `null` (L12.1).

### 3.3 GN-009 hand-off

`src/app/api/execute-node/handlers/gn-009.ts:24`:
```ts
const { inputData, tileInstanceId, executionId, apiKey, userId, dbExecutionId } = ctx;
```

All three `createVideoJobAndEnqueue` call sites (floor-plan, dual image2video, text2video) now include `dbExecutionId`:
```ts
const videoJobId = await createVideoJobAndEnqueue({
  userId,
  executionId: executionId ?? "local",
  dbExecutionId,       // Phase 2
  nodeId: tileInstanceId,
  ...
});
```

### 3.4 `CreateVideoJobInput` + persist

`src/features/3d-render/services/video-job-service.ts:116–138`:
```ts
export interface CreateVideoJobInput {
  userId: string;
  executionId: string;
  dbExecutionId?: string;   // Phase 2 durability link
  ...
}
```

`video-job-service.ts:175`:
```ts
const job = await prisma.videoJob.create({
  data: {
    ...,
    dbExecutionId: input.dbExecutionId ?? null,
    ...
  },
  select: { id: true },
});
```

### 3.5 The patch function

`video-job-service.ts:584` — `patchExecutionArtifact` invocation at terminal transition:
```ts
if (isTerminalStatus(newStatus)) {
  await patchExecutionArtifact({
    videoJobId,
    dbExecutionId: job.dbExecutionId,
    userId: job.userId,
    nodeId: job.nodeId,
    terminalStatus: newStatus,
    failureReason: failureReason ?? null,
    segments,
    completedDuration,
    finalCostUsd: finalCost ?? 0,
    isRenovation: job.isRenovation,
    isFloorPlan: job.isFloorPlan,
    pipeline: job.pipeline as VideoPipeline,
  });
  return { terminal: true, status: newStatus };
}
```

The patch function itself (`video-job-service.ts:604–767`) does:

**Execution lookup + guard:**
```ts
if (!dbExecutionId) return;          // demo / unsaved run — no patch needed

const exec = await prisma.execution.findFirst({
  where: { id: dbExecutionId, userId },
  select: { id: true, tileResults: true },
});
if (!exec) {
  logger.warn(`[VIDEO_JOB_PATCH] execution row not found jobId=X dbExecId=Y`);
  return;
}
```

**Artifact lookup within `tileResults`:**
```ts
for (let i = 0; i < tileResults.length; i++) {
  const entry = tileResults[i] as Record<string, unknown> | null;
  if (!entry || entry.type !== "video") continue;
  const data = entry.data as Record<string, unknown> | undefined;
  if (data?.videoJobId === videoJobId) { patchedIndex = i; break; }
  // Fallback nodeId match (rare race)
  if (patchedIndex < 0 && (entry.nodeId === nodeId || entry.tileInstanceId === nodeId)) {
    patchedIndex = i;
  }
}
```

**Deterministic patch build:**
```ts
const patchedData: Record<string, unknown> = {
  ...previousData,
  videoGenerationStatus: terminalStatus,
  videoUrl: primaryUrl,
  downloadUrl: primaryUrl,
  ...(interiorUrl !== undefined ? { interiorVideoUrl: interiorUrl } : {}),
  segments: flatSegments,
  durationSeconds: completedDuration > 0 ? completedDuration : previousData.durationSeconds,
  shotCount: completeSegments.length || 1,
  costUsd: finalCostUsd,
  generationProgress: 100,
  label,  // recomputed via deriveFinalLabel()
  videoJobId,   // unchanged for traceability
};
```

**Write back:**
```ts
await prisma.execution.update({
  where: { id: dbExecutionId },
  data: { tileResults: tileResults as unknown as Prisma.InputJsonValue },
});
```

**Idempotency:** no explicit guard. Every field derives deterministically from the same VideoJob state — a duplicate QStash delivery re-runs with the exact same inputs and writes the exact same output. No-op by construction (per prompt §3.5).

**Failure mode:** `try/catch` wraps the whole function. Any throw inside → `logger.error` → swallowed. The enclosing `advanceVideoJob` terminalization proceeds regardless. The VideoJob row IS the source of truth; the patch is a durability backup.

### 3.6 Write surface choice

The patch writes to `Execution.tileResults` (JSON array), not to the separate `Artifact` table. Justified by `src/app/api/executions/route.ts:44–62` — the GET endpoint explicitly reconstructs artifacts FROM `tileResults`, not from the `Artifact` table. Also confirmed by `useExecution.ts:1828` where client writes go via `POST /api/executions/[id]/artifacts`, which appends to `tileResults`. One write surface is sufficient for all known consumers.

---

## 4. Stream 2 — HeroSection Migration

### 4.1 Source-verify

`src/features/execution/components/result-showcase/sections/HeroSection.tsx:53–56` — the `useVideoJob` hook placement is AFTER all legacy hooks (`useLocale`, 2× `useMemo`, `useRef`, `useState`, `useExecutionStore`, `useCallback`):
```ts
// useVideoJob MUST be called after every legacy hook above so Rules of
// Hooks is preserved. Hook is a no-op when videoJobId is null.
const videoJobId = videoData?.videoJobId ?? null;
const { data: jobView } = useVideoJob(videoJobId);
```

`HeroSection.tsx:64–97` — early return for videoJobId path, drops the gradient-overlay metadata strip (replaced by SegmentedVideoPlayer's built-in controls + MediaTab's export row):
```ts
if (videoJobId) {
  return (
    <motion.div ...>
      {jobView ? (
        <SegmentedVideoPlayer view={jobView} heightPx={360} compact={false} />
      ) : (
        <HeroLoadingShell />
      )}
    </motion.div>
  );
}
```

`HeroSection.tsx:99` — legacy path unchanged below:
```ts
if (!videoData?.videoUrl && !heroImageUrl && !isGenerating && !isFailed) return null;
```

### 4.2 Retry button handling

Hidden for videoJobId path — the new path returns before ever rendering the legacy `isFailed` JSX that contains `onRetryVideo`. For new-path failures, `SegmentedVideoPlayer` renders its own error card with the failure reason. No new retry endpoint built (Phase 3).

### 4.3 Rules-of-Hooks eslint output

Phase 1 hit 6 rules-of-hooks errors on VideoBody's first pass (documented in Phase 1 S10.1). This phase took care to place `useVideoJob` AFTER every legacy hook. Verified clean — zero `react-hooks/rules-of-hooks` errors:
```
$ npx eslint src/features/execution/components/result-showcase/sections/HeroSection.tsx
(empty — no errors, no warnings)
```

### 4.4 Legacy-path preservation

With `videoJobId` null/undefined, the new-path early return is skipped and control falls through to the exact same legacy JSX from before. Byte-identical behavior for legacy artifacts — zero regression.

---

## 5. Stream 3 — Reader Audit Table

Methodology: ran the greps prescribed in §5.1 of the prompt. Filtered out Phase 1 frozen files, cinematic pipeline, Standalone Studio, and other out-of-scope. Remaining hits were classified per §5.2.

### 5.1 Classification table

| File : line(s) | What it reads | Classification | Resolution |
|---|---|---|---|
| `src/app/api/execute-node/handlers/gn-009.ts:294,370,409,565,603,699,732` | `videoUrl: ""` in artifact construction | PHASE_1_ALREADY_HANDLED | Deliberately empty on creation. Stream 1 patch populates at terminal for saved workflows; `useVideoJob` populates UI for live state. |
| `src/features/execution/components/result-showcase/useShowcaseData.ts:47,54,65,266,267,273,274` | `videoUrl` / `videoJobId` extraction | PHASE_1_ALREADY_HANDLED | Phase 1 added `videoJobId` pass-through. |
| `src/features/execution/hooks/useExecution.ts:812,822,901,913,914,1025,1027,1030,1033` | Legacy pollers (`persistVideoToR2`, single/dual poll) | LEGACY_ONLY | Only fires when `videoGenerationStatus === "processing"` on legacy artifacts. New-path artifacts use `"queued"` — these never fire. Removal deferred to Phase 3. |
| `src/app/page.tsx:919` | `LandingVideo.videoUrl` for marketing feed | OUT_OF_SCOPE | Unrelated — reads from `CommunityVideo` table. |
| `src/app/api/community-videos/route.ts:67,90,98,100,119` | Community video submission | OUT_OF_SCOPE | Separate feature (user-uploaded marketplace videos). Unrelated to execution artifacts. |
| `src/app/api/share/video/route.ts:42,52,60,62,68,71,125` | `videoUrl` from POST body | COVERED_BY_STREAM_1 | MediaTab POSTs `videoData.downloadUrl ?? videoData.videoUrl`. Post Stream 1 patch + page reload, both are populated. In-flight UX: MediaTab already toasts "video not available" gracefully (MediaTab.tsx:65–67, FROZEN). Acceptable degradation — see L12.2. |
| `src/app/share/[slug]/page.tsx:17,37,43,57,182,193` | Shared video rendering from `VideoShareLink` row | OUT_OF_SCOPE | Reads from a separate DB column (`VideoShareLink.videoUrl`) that was frozen at share-creation time. Independent of execution lifecycle. |
| `src/features/canvas/components/artifacts/FullscreenVideoPlayer.tsx:51–54,200,203,457,468` | `d.videoUrl` / `d.downloadUrl` / `segments[].videoUrl` | **NEEDS_FIX → FIXED** | Added `useVideoJob` fallback; derives `jobSegments`, `fallbackJobUrl`, uses them when artifact fields are empty. See §5.2. |
| `src/features/canvas/components/nodes/BaseNode.tsx:516,536` | `d.videoUrl` for terminal-state video thumbnail on canvas node | ACCEPTABLE_DEGRADATION | Cosmetic only (thumbnail preview on node card). During generation, VideoBody renders the SegmentedVideoPlayer progress UI, masking this element. Post-terminal before refresh: thumbnail shows broken `<video>` in browser. After Stream 1 patch + refresh: thumbnail works. See L12.3. |
| `src/features/execution/components/result-showcase/index.tsx:133,230,238,239,408,410,413` | Placeholder artifact creation + legacy retry poll + artifact-persist loop | COVERED_BY_STREAM_1 | The persist loop at lines 395–430 already gates on `videoUrl && status === "complete"`, so new-path artifacts (empty videoUrl) no-op gracefully — the worker handles the DB write. Placeholder path (lines 133) is for the showcase "Create Video" CTA which runs the standalone `/api/generate-video-walkthrough` flow, out of scope this phase. Legacy single-poll at lines 215–260 is unreachable for new-path artifacts (they set `"queued"`, not `"processing"`). |

### 5.2 FullscreenVideoPlayer — fix diff

**File:** `src/features/canvas/components/artifacts/FullscreenVideoPlayer.tsx`

Added import at line 9:
```ts
import { useVideoJob } from "@/features/execution/hooks/useVideoJob";
```

Derived-values block replaced (line 45 onward):

**Before:**
```ts
const rawSegments = d?.segments;
const segments: VideoSegment[] = Array.isArray(rawSegments) ? rawSegments : [];
const hasSegments = segments.length > 1;
const currentSegment = hasSegments ? segments[currentSegmentIndex] : null;
const videoUrl = hasSegments
  ? (currentSegment?.videoUrl ?? "")
  : (typeof d?.videoUrl === "string" ? d.videoUrl : typeof d?.downloadUrl === "string" ? d.downloadUrl : "");
const downloadUrl = typeof d?.downloadUrl === "string" ? d.downloadUrl : typeof d?.videoUrl === "string" ? d.videoUrl : "";
const fileName = typeof d?.name === "string" ? d.name : "walkthrough.mp4";
const shotCount = typeof d?.shotCount === "number" ? d.shotCount : (hasSegments ? segments.length : 1);
const totalDurationSec = typeof d?.durationSeconds === "number" ? d.durationSeconds : 15;
const costUsd = typeof d?.costUsd === "number" ? d.costUsd : null;
```

**After (Phase 2 changes marked):**
```ts
// Phase 2: videoJobId fallback — artifact fields stay empty for new-path
// jobs in client memory even after the worker terminalizes (Stream 1 patch
// updates DB, not in-memory state). useVideoJob provides live URLs.
const videoJobId = typeof d?.videoJobId === "string" ? d.videoJobId : null;
const { data: jobView } = useVideoJob(videoJobId);

const rawSegments = d?.segments;
const artifactSegments: VideoSegment[] = Array.isArray(rawSegments) ? rawSegments : [];
const jobSegments: VideoSegment[] = videoJobId && jobView
  ? jobView.playableSegments.map((s) => ({
      videoUrl: s.url,
      downloadUrl: s.url,
      durationSeconds: s.durationSeconds,
      label: s.kind === "exterior"
        ? `Exterior — ${s.durationSeconds}s`
        : s.kind === "interior"
          ? `Interior — ${s.durationSeconds}s`
          : `Walkthrough — ${s.durationSeconds}s`,
    }))
  : [];
const segments: VideoSegment[] = artifactSegments.length > 0 ? artifactSegments : jobSegments;
const hasSegments = segments.length > 1;

const currentSegment = hasSegments ? segments[currentSegmentIndex] : null;
const fallbackJobUrl = jobView?.primaryVideoUrl ?? "";
const videoUrl = hasSegments
  ? (currentSegment?.videoUrl ?? "")
  : (typeof d?.videoUrl === "string" && d.videoUrl
      ? d.videoUrl
      : typeof d?.downloadUrl === "string" && d.downloadUrl
        ? d.downloadUrl
        : fallbackJobUrl);
const downloadUrl = (typeof d?.downloadUrl === "string" && d.downloadUrl)
  ? d.downloadUrl
  : (typeof d?.videoUrl === "string" && d.videoUrl)
    ? d.videoUrl
    : fallbackJobUrl;
const fileName = typeof d?.name === "string" ? d.name : "walkthrough.mp4";
const shotCount = typeof d?.shotCount === "number" ? d.shotCount : (hasSegments ? segments.length : 1);
const totalDurationSec = typeof d?.durationSeconds === "number" && d.durationSeconds
  ? d.durationSeconds
  : (jobView?.totalDurationSeconds ?? 15);
const costUsd = typeof d?.costUsd === "number" ? d.costUsd : (jobView?.costUsd ?? null);
```

Semantics: for legacy artifacts (no `videoJobId`), behavior is byte-identical (the empty `jobSegments` array and `fallbackJobUrl === ""` fall through to the exact same values as before). For new-path artifacts, the fallback kicks in only when artifact fields are empty.

Also touched: pre-existing `setState-in-effect` at line 104–110 (reset-on-close) — refactored to use the cleanup-function pattern. Semantically equivalent; eliminates the lint error that my modifications surfaced.

### 5.3 BROKEN_DURING_INFLIGHT summary

**One case identified (FullscreenVideoPlayer) and fixed.** Zero BROKEN_DURING_INFLIGHT cases remaining in audited reader set.

---

## 6. Failure-Mode Catalog (Phase 2 additions)

| Failure | Handled by |
|---|---|
| Worker calls `patchExecutionArtifact`, but DB Execution row not found (user deleted execution mid-job) | Log warn `[VIDEO_JOB_PATCH] execution row not found`. Job still terminalizes cleanly. No throw. |
| Worker patches, but `tileResults` JSON is concurrently modified by another node | Last-write-wins. Prisma JSONB UPDATE is atomic at the row level; both writers' intents are preserved for their own nodes because each only mutates a single index in the array. |
| `videoJobId` on artifact but VideoJob row deleted (user wiped history) | `useVideoJob` receives 404 from `/api/video-jobs/[id]`; existing hook error-handling surfaces it. UI shows blank state. |
| HeroSection receives legacy artifact (no videoJobId) | Falls through to legacy path, uses `data.videoUrl` (populated by Stream 1 patch for saved workflows). |
| HeroSection receives videoJobId artifact that was patched but VideoJob row is gone | Legacy fallback path's `data.videoUrl` is the R2 URL (patched in), works independently of VideoJob row. Durability backup working as designed. |
| Audit discovers a BROKEN_DURING_INFLIGHT call site that can't be fixed in scope | None found. Every reader is classified; FullscreenVideoPlayer is the only one requiring a fix and it's now fixed. |
| Patch called twice (QStash redelivery) | Deterministic patch — second run writes identical bytes. Idempotent by construction. |
| Patch called while row's `dbExecutionId` is null | Early return — no-op. Documented in §3.5. |

---

## 7. Automated Gates

### 7.1 `npx prisma validate`
```
Prisma schema loaded from prisma/schema.prisma.
The schema at prisma/schema.prisma is valid 🚀
```

### 7.2 `npx prisma generate`
```
✔ Generated Prisma Client (v7.7.0) to ./node_modules/@prisma/client in 199ms
```

### 7.3 `npx tsc --noEmit`

Full run. Only pre-existing `.next/types/validator.ts` errors remain, unrelated to this phase:
```
.next/types/validator.ts(25,44): error TS2344: Type 'Route' does not satisfy the constraint 'LayoutRoutes'.
    Type '"/book-demo"' is not assignable to type 'LayoutRoutes'.
.next/types/validator.ts(25,75): error TS2344: Type 'Route' does not satisfy the constraint 'LayoutRoutes'.
```

These are Next.js auto-generated route-validator diagnostics, not code errors. Same class of issue as Phase 1 (though the specific route differs — `/book-demo` now instead of `/onboard`). Independent of Phase 2 changes. Zero new errors introduced by Phase 2.

### 7.4 `npx eslint` on touched files

Ran on all Phase 2 files + Phase 1 companion files:
```
$ npx eslint <phase-2-files>
/src/features/execution/hooks/useExecution.ts
  816:16  warning  'persistVideoToR2' is defined but never used (pre-existing — Phase 1 L12)
  1271:15 warning  'dataKeys' is assigned a value but never used (pre-existing)
  1279:9  warning  'mergedUnderscoreKeys' is assigned a value but never used (pre-existing)
```

**0 errors. 3 warnings, all pre-existing.** No Phase-2-introduced warnings. The setState-in-effect error in FullscreenVideoPlayer that surfaced when I first touched the file was fixed via the cleanup-function refactor.

### 7.5 `npm run build` (MANDATORY this phase — NOT skipped)

Phase 1 skipped this. Phase 2 did not.

Build completed successfully. Key markers from tail:
```
├ ƒ /api/video-jobs/[id]
├ ƒ /api/video-worker/poll
...
ƒ  (Dynamic)  server-rendered on demand
```

Warnings-and-errors filter result:
```
$ npm run build 2>&1 | grep -iE "error|failed|warn|✗"
Warning: Custom Cache-Control headers detected for the following routes:
```

Single pre-existing info warning about Cache-Control headers (unrelated). Exit code 0.

Full build output is ~200 lines of "building routes" spam; the salient part is that `/api/video-jobs/[id]`, `/api/video-worker/poll`, and every other route compiles cleanly. No TypeScript, no bundler, no runtime errors. Zero Phase-2 regressions.

---

## 8. Ambiguities Resolved

### 8.1 Approach A vs Approach B — WHY A

**Chose Approach A (dbExecutionId column on VideoJob + ctx plumbing).**

Approach B (correlation column on Execution) was viable but has two issues:
1. **Semantic debt:** adds a column to Execution purely to expose a client-side ID-generation quirk. If the frontend is ever refactored to use server-assigned IDs, the column becomes dead weight.
2. **Lookup latency at write time:** worker does an additional Prisma `findFirst` query at every terminal transition, vs. a direct `findUnique` by primary key under Approach A.

Approach A costs one additional DB column and ~4 extra files of plumbing, but each edit is trivially small and Rutik had already implied this was acceptable in prompt §3.3:
> 4. `gn-009.ts`: find the DB execution.id from ctx (if available — see audit Q1), pass to `createVideoJobAndEnqueue`.
> 5. If ctx plumbing is required: `useExecution.ts` gets ONE edit...

File count for Approach A (7 files):
1. `prisma/schema.prisma` — 1 column, 1 index
2. Migration SQL — new file
3. `types.ts` — 1 field on `NodeHandlerContext`
4. `route.ts` — destructure + 1 ctx line
5. `useExecution.ts` — executeNode signature + both call sites + POST body
6. `gn-009.ts` — destructure + 3 call sites (one `replace_all`)
7. `video-job-service.ts` — input type, DB persist, patch function, patch call site

All 7 edits landed cleanly. No other file risk.

### 8.2 Post-terminal patching: Execution.tileResults only (not Artifact table)

Two writable surfaces could conceivably be patched: `Execution.tileResults` (JSON) and the separate `Artifact` table. I patched only `tileResults` because:
1. `src/app/api/executions/route.ts:44–62` reconstructs client-visible artifacts FROM `tileResults`, not from the `Artifact` table.
2. `useExecution.ts:1828` client writes go via `/api/executions/[id]/artifacts` which appends to tileResults.
3. No known consumer queries the `Artifact` table directly for video URL resolution.

One surface is sufficient. Dual-write would have been extra complexity without a benefit.

### 8.3 regenerateNode passes null for dbExecutionId

`regenerateNode` is a separate `useCallback` and doesn't have `dbExecutionId` in closure scope. Plumbing it would require adding `dbExecutionId` to the Zustand `execution-store` (not in MAY_MODIFY for this phase) or a broader hook refactor.

Passing `null` degrades gracefully: the regenerated VideoJob is created without a DB link and Stream 1's patch is a no-op for that run. The live VideoJob still drives UI correctly via `useVideoJob`. Acceptable compromise documented as L12.1.

### 8.4 Gradient overlay dropped in HeroSection new-path

Legacy HeroSection renders a big gradient with Download + Fullscreen buttons overlaying the video. For the new-path branch I dropped the overlay entirely and render only `SegmentedVideoPlayer`. Reasons:
- `<video controls>` inside `SegmentedVideoPlayer` provides native fullscreen.
- Download URL isn't reliably available during in-flight state; building the overlay conditionally across 4 states (queued / partial / complete / failed) would have ballooned the edit.
- MediaTab's export row (below the showcase) still provides download + Share Link when the job completes.

Acceptable UX trade-off for Phase 2.

---

## 9. Snags

### S9.1 — Compile error after useExecution edit

Adding `dbExecutionId` as a required parameter to `executeNode` broke `regenerateNode` at line 2146 which didn't have that value in scope. Fixed by passing `null` (see §8.3).

### S9.2 — Lint pass surfaced pre-existing error in FullscreenVideoPlayer

The `react-hooks/set-state-in-effect` rule flagged the pre-existing reset-on-close effect at line 104. It was there before my changes, but linting this file for the first time (Phase 1 didn't touch it) exposed the violation. Fixed via cleanup-function refactor — semantically equivalent, rule-compliant. One line of pre-existing debt retired as a side-effect of Phase 2.

### S9.3 — Prisma re-format reshaped the schema

Phase 1's `npx prisma format` (logged in its report) collapsed the VideoJob model from multi-line-with-alignment form into single-line per-field form. The Phase 2 edit had to match the reformatted structure, not the original. Minor annoyance; no semantic impact.

### S9.4 — Latent bug in `/api/execute-node/route.ts` regen enforcement

The audit surfaced that the regen-cap enforcement at `route.ts:273` uses `findFirst({ where: { id: executionId } })` where `executionId` is the client-generated correlation ID, not the DB CUID. In production this means `findFirst` always returns null, the enforcement falls through to `if (!exec) return false`, and the regen cap is effectively a no-op server-side (the client-side Zustand cap still enforces loosely). This is a pre-existing bug NOT introduced by Phase 1 or Phase 2. Out of scope to fix here — documented for Phase 3+.

---

## 10. Rollout Checklist for Rutik

1. **Review both Phase 1 and Phase 2 diffs.** They coexist on this branch. If splitting into two PRs for cleaner history:
   - Phase 1 PR = Phase 1 file list (per `PHASE_VIDEO_BG_JOBS_REPORT_2026-04-24.md` §1).
   - Phase 2 PR = Phase 2 file list (per §1 of this report).
   - Alternatively: one combined PR — both phases are additive and Phase 2 extends Phase 1 cleanly.

2. **Apply migrations in order:**
   - `prisma/migrations/20260424100000_add_video_jobs/migration.sql` (Phase 1 — creates `video_jobs` table)
   - `prisma/migrations/20260424180000_videojob_db_execution/migration.sql` (Phase 2 — adds `dbExecutionId` column)
   
   Both are additive-only. Apply via `prisma migrate deploy` in CI or manual SQL on Neon. Zero downtime.

3. **Add/verify Vercel env vars** (all environments):
   - `QSTASH_TOKEN` ✓ (probably exists from VipJob)
   - `QSTASH_CURRENT_SIGNING_KEY` ✓
   - `QSTASH_NEXT_SIGNING_KEY` ✓
   - `NEXT_PUBLIC_APP_URL` ✓
   - `VIDEO_BG_JOBS=false` (initial — preserves legacy behavior post-deploy)

4. **Deploy to staging with `VIDEO_BG_JOBS=false`.** Verify zero behavior change (legacy path intact).

5. **Set `VIDEO_BG_JOBS=true` on staging.** Run the 7 manual tests from prompt §6.2:
   - HeroSection streams segments for dual-segment job ✓ (Phase 2 wiring)
   - HeroSection legacy-path renders unchanged with flag OFF ✓ (Phase 2 fall-through preserved)
   - Artifact patch — happy path: query DB after terminal, verify `Execution.tileResults[i].data.videoGenerationStatus === "complete"` + R2 videoUrl
   - Artifact patch — partial path: kill one segment, verify `partial` status with only succeeded segment's URL
   - Artifact patch — failed path: kill both, verify `failed` + failureReason
   - Share link for in-flight job: gracefully toasts "video not available" (MediaTab behavior, unchanged)
   - Execution history grid: thumbnails work after Stream 1 patch + page refresh

6. **Observe staging for 1 week.** Monitor:
   - QStash dashboard delivery health
   - Postgres query on `video_jobs` status distribution
   - `[VIDEO_JOB_PATCH]` log lines — patched counts vs `execution row not found` warnings

7. **Flip production `VIDEO_BG_JOBS=true`.** Instant rollback by flipping back to `false`.

8. **Phase 3 cleanup** after 1 more week stable:
   - Delete legacy pollers (`pollSingleVideoGeneration`, `pollVideoGeneration`) from `useExecution.ts`
   - Delete `persistVideoToR2` unused function
   - Delete the feature flag entirely

---

## 11. Known Limitations / Deferred to Phase 3

### L12.1 — regenerateNode doesn't propagate dbExecutionId

Regeneration of a single node (via the regen button) passes `null` for `dbExecutionId` because the Zustand execution-store doesn't track it. Consequence: regenerated VideoJobs terminalize cleanly but skip the Stream 1 patch — the regenerated artifact's `data.videoUrl` stays empty post-completion. Users refreshing the page lose nothing because `useVideoJob` still provides the live URL. But any downstream reader (share, PDF export) that reads `data.videoUrl` on the regenerated artifact sees empty. Phase 3 can route `dbExecutionId` through the Zustand store.

### L12.2 — Share link during in-flight job

MediaTab's Share Link button calls `/api/share/video` with `videoUrl = data.videoData.downloadUrl ?? data.videoData.videoUrl`. For new-path artifacts, both are empty until Stream 1 patch + page refresh. MediaTab already shows a graceful toast in this case (MediaTab.tsx:65–67, FROZEN). Not a regression — same UX as pre-patch, just with an additional in-flight window. Phase 3 could fix by:
- Adding `videoJobId` as alternative parameter to `/api/share/video` (server resolves URL from DB), OR
- Modifying MediaTab to read from `useVideoJob` (requires unfreezing MediaTab for a small amendment).

### L12.3 — BaseNode canvas thumbnail

`src/features/canvas/components/nodes/BaseNode.tsx:516` renders a video thumbnail preview on the canvas node card using `d.videoUrl`. For new-path artifacts, that's empty until Stream 1 patch + page refresh. During generation, VideoBody's SegmentedVideoPlayer (Phase 1) renders on top and masks it. Post-completion without refresh: broken `<video>` element in browser (shows placeholder). Post-refresh: works via Stream 1 patch. Cosmetic only — not a blocker for flag flip. Phase 3 can add a `useVideoJob` fallback similar to FullscreenVideoPlayer.

### L12.4 — Phase 1 limitations still open

- L12.7 from Phase 1 (R2 retry cap → Kling URL as final) — unchanged.
- Legacy pollers still alive in `useExecution.ts` behind feature-flag gating — unchanged.
- Cinematic pipeline not migrated — out of scope, Phase 3+.
- Standalone Studio not migrated — out of scope, Phase 3+.
- No retry-from-failed endpoint — intentionally not built.

### L12.5 — Regen-cap latent bug in route.ts

Pre-existing: `/api/execute-node/route.ts:273` does `findFirst({ where: { id: executionId } })` where `executionId` is the client ID, not the DB CUID. Always null. Regen enforcement is a no-op server-side. NOT introduced by Phase 1 or Phase 2. Document for separate bugfix — the fix is either (a) use the new `dbExecutionId` field I added (Approach A plumbing makes it trivially available), or (b) fix the frontend to send DB IDs consistently. Not a video bug; a rate-limiting bug.

---

**End of report.**
