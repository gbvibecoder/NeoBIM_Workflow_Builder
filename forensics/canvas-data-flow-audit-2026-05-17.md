# Canvas Pipeline — Data-Flow Audit
**Date:** 2026-05-17
**Branch / commits in scope:** `main` @ `1038d4d2 → dda4cd2c → 3a3a0b33`
**Audit driver:** GOD-mode comprehensive bug hunt (post-ship)
**Outcome:** 5 critical/high bugs found across 3 files. All fixed surgically.
**Surface area scope:** IN-009 → TR-025 → TR-026 → TR-027 → EX-007 (canvas-visible v3 pipeline)

---

## §1 — Executive verdict

**Before this audit:** the canvas template "AI-Powered IFC Generation" shipped in
`1038d4d2` was *cosmetically* visible but **functionally non-operational
end-to-end**. The earlier 3a3a0b33 fix made the IN-009 textarea + horizontal layout
render correctly, but the execution layer never actually invoked the real backend
for the 4 new handler nodes — and even if it had, the TR-026 → `/runs` call would
have 400'd before the agent ever started.

The user's only e2e evidence to date was a rendering screenshot. Nothing had ever
actually completed end-to-end on production.

**After this audit (commit pending):** all 5 nodes are wired into the live
execution paths, the request bodies match the strict backend schemas, and the
image artifact uses the canonical `data.url` field so the canvas card actually
shows the rendered PNG. Static gates are green:

- `npx tsc --noEmit` — clean
- `npm run build` — green
- `npx vitest run src/{app/api/execute-node,features/canvas,features/workflows,features/brief-to-ifc,features/execution}` — 91/91 pass
- `npx vitest run` (full) — 3720 pass · 7 fail · 1 skip
  - The 7 failures are **pre-existing**, in unrelated features
    (`brief-renders/banners`, `LightPricing`, `IFCEnhancerPanel`,
    `useBriefRenderUpload` idempotency). None introduced by this audit. Not in scope.
- `pytest neobim-ifc-service/tests/` — 75 collection errors (pre-existing
  `app/services/design_agent` import failures), 26 tests pass for
  `test_buildflow_ifc.py`. Not in scope.

---

## §2 — Per-node data-flow trace

### IN-009 · Brief input

```
INPUTS:
  (none — entry point of the pipeline)
NODE COMPONENT:
  src/features/canvas/components/nodes/InputNode.tsx → BriefInput (lines 79-265)
HANDLER:
  Pure client-side. No /api/execute-node call. The execution orchestrator
  (useExecution.ts) takes node.data.inputValue and emits an input artifact
  via the INPUT_NODE_IDS branch (lines 100-289).
OUTPUTS:
  {
    type: "text",
    data: {
      content: <briefText>,     // ← what TR-025 reads (alias)
      prompt:  <briefText>,
      label:   "User Input",
    }
  }
PASS-THROUGH TO TR-025:  ✅ briefText reaches downstream via data.content alias.
```

### TR-025 · Brief Enricher

```
INPUTS (from upstream artifact's `data` field, with alias chain):
  - briefText | brief | content | inputValue : string ≥ 40 chars
HANDLER:
  src/app/api/execute-node/handlers/tr-025.ts (handleTR025)
API CALL:
  POST /api/brief-to-ifc/v3/enrich
  REQUEST:   { brief: <string> }
  RESPONSE:  { brief: BriefSpec, costUsd, durationMs, inputTokens, outputTokens }
OUTPUTS:
  {
    type: "json",
    data: {
      briefSpec, project, spaceCount, elementCount, materialCount,
      enrichmentCostUsd, enrichmentMs, inputTokens, outputTokens, summary
    }
  }
SHAPE MATCH WITH /enrich:  ✅ — body { brief } matches schema; result.brief used.
SHAPE MATCH WITH TR-026:   ✅ — data.briefSpec is what TR-026 reads.
```

### TR-026 · IFC Agent Builder

```
INPUTS:
  - briefSpec        : object (required) ← from TR-025.data.briefSpec
  - cost_cap_usd?    : number
  - max_turns?       : number
  - workflow_id?     : string
HANDLER:
  src/app/api/execute-node/handlers/tr-026.ts (handleTR026)
API CALLS:
  1. POST /api/brief-to-ifc/v3/runs
     REQUEST (after fix):
       { briefSpec, [cost_cap_usd], [max_turns], [workflow_id] }
     RESPONSE: { runId, status, statusUrl, ... }
  2. POLL GET /api/brief-to-ifc/v3/runs/{runId}/status
     until status ∈ {COMPLETED, FAILED, CANCELLED}
     Initial delay 3s, interval 5s with +500ms backoff, max 8s, timeout 500s.
OUTPUTS:
  {
    type: "file",
    dataUri: <ifcUrl>,
    data: {
      ifcUrl, runId, entityCount, turns, generatorCostUsd, generatorMs,
      runUrl, summary
    }
  }
SHAPE MATCH WITH /runs:    ✅ AFTER FIX (was 🚨 broken — see Bug #A1).
SHAPE MATCH WITH TR-027:   ✅ — data.ifcUrl is what TR-027 reads.
POLLING ROBUSTNESS:        ✅ — 5xx retries with backoff, 4xx hard-throw.
TIMING:                    ✅ — 500s timeout vs Vercel maxDuration 600s on dispatcher.
```

### TR-027 · Geometric Validator

```
INPUTS:
  - ifcUrl : string (required, >8 chars) ← from TR-026.data.ifcUrl
HANDLER:
  src/app/api/execute-node/handlers/tr-027.ts (handleTR027)
API CALL:
  POST /api/brief-to-ifc/v3/validate
  REQUEST:  { ifcUrl }
  RESPONSE: { runId, ifcUrl, validator: ValidatorView }
    where ValidatorView = {
      verdict: "OK" | "FAILED",
      worldBbox: [w,d,h] | null,
      worldBboxVerdict, polygonOk, originOk, elementCoverageOk,
      lengthUnit, failures[], entityCount, schemaName
    }
OUTPUTS:
  {
    type: "json",
    data: {
      ifcUrl (passthrough), runId, verdict, worldBbox, worldBboxVerdict,
      polygonOk, originOk, elementCoverageOk, lengthUnit, failures[],
      entityCount, schemaName, bboxLabel, summary
    }
  }
SHAPE MATCH WITH /validate: ✅
SHAPE MATCH WITH EX-007:    ✅ — ifcUrl is passed through, runId is set.
```

### EX-007 · IFC Export + Preview

```
INPUTS:
  - ifcUrl : string (required, >8 chars) ← from TR-027.data.ifcUrl
  - runId? : string                       ← from TR-027.data.runId
HANDLER:
  src/app/api/execute-node/handlers/ex-007.ts (handleEX007)
API CALL:
  POST /api/brief-to-ifc/v3/render-previews
  REQUEST:  { ifcUrl }
  RESPONSE: { runId, ifcUrl, topPngUrl, isoPngUrl, meshCount, durationMs }
OUTPUTS (after fix — see Bug #A4):
  {
    type: "image",
    dataUri: topPngUrl,
    data: {
      url:       topPngUrl,   // ← added; what InlineResult reads
      ifcUrl, runId, topPngUrl, isoPngUrl, ifcViewerUrl, runUrl,
      meshCount, durationMs, summary, images: [{label, url}, {label, url}]
    }
  }
SHAPE MATCH WITH /render-previews: ✅
SHAPE MATCH WITH InlineResult:     ✅ AFTER FIX (was showing "No preview").
```

---

## §3 — Bugs found + status

### 🚨 BUG #A1 [CRITICAL] · TR-026 → /runs strict-schema rejection

**File:** `src/app/api/execute-node/handlers/tr-026.ts` line 81 (pre-fix)

**Symptom:** Every canvas-driven TR-026 call would 400 with
`"Unrecognized key in object: 'source'"` before reaching the agent loop.

**Cause:**
```ts
const body: Record<string, unknown> = { briefSpec, source: "canvas" };
```
The `/api/brief-to-ifc/v3/runs` endpoint defines its body schema with
`z.object({...}).strict()`. zod's `.strict()` rejects unknown keys. The
`source: "canvas"` analytics tag was never part of the accepted vocabulary,
so the entire request was rejected.

**Why the tests passed:** the existing TR-026 unit test mocks `fetch` and
never exercises the actual zod schema. The body assertion only checked the
`briefSpec` and `cost_cap_usd` fields — it didn't reject extra keys.

**Fix:** removed `source: "canvas"` from the request body. Also tightened
the unit test to assert against an `ALLOWED_KEYS` allow-list so any future
"let's tag every request" patch will fail loudly in CI instead of in prod.

**Verification:** `tr-026.test.ts` still passes (3 tests); new allow-list
assertion enforced.

---

### 🚨 BUG #A4 [HIGH] · EX-007 image artifact missing `data.url`

**File:** `src/app/api/execute-node/handlers/ex-007.ts` `data: {...}` object (pre-fix)

**Symptom:** Even after a successful render-previews call, the canvas
EX-007 node card would show the "No preview" placeholder instead of the top PNG.

**Cause:** The canvas `InlineResult` renderer (BaseNode.tsx line 435) reads
`d?.url` for `type: "image"` artifacts. EX-007 set `dataUri: topPngUrl` but
not `data.url`. The convention used by every other image-producing
handler (GN-003 etc.) is to set `data.url` to the primary image URL.

**Fix:** added `url: result.topPngUrl` to EX-007's `data` object. Documented
the convention in a comment so future image handlers don't repeat the mistake.

---

### 🚨 BUG #B1 [CRITICAL] · useExecution.ts INPUT_NODE_IDS missing IN-009

**File:** `src/features/execution/hooks/useExecution.ts` line 105 (pre-fix)

**Symptom:** When the canvas executes IN-009, the brief text typed by the
user **does not become an input artifact**. The node falls through past the
INPUT_NODE_IDS branch, past the demo-mode branch, past the real-API branch
(because IN-009 was not in REAL/LIVE either), and lands in the mock executor —
which returns generic placeholder text. TR-025 then fails with
`"needs a brief of at least 40 characters"` because the real brief never made
it downstream.

**Cause:** Direct parallel to the BaseNode.tsx bug fixed in `3a3a0b33`:
```ts
const INPUT_NODE_IDS = new Set(["IN-001", ..., "IN-008"]);   // missing IN-009
```

**Fix:** added `"IN-009"` to the set.

---

### 🚨 BUG #B2 [CRITICAL] · useExecution.ts REAL_NODE_IDS missing all 4 canvas nodes

**File:** `src/features/execution/hooks/useExecution.ts` line 66 (pre-fix)

**Symptom:** When mock execution is disabled, TR-025/TR-026/TR-027/EX-007
never reach `/api/execute-node`. They fall through the
`shouldUseRealAPI = isLive || (useRealExecution && REAL_NODE_IDS.has(id))`
gate at line 317 → mock executor → no real backend work.

**Cause:** the client-side REAL_NODE_IDS allow-list was last updated for v2
(TR-022/TR-024/EX-006). The Canvas Unification phase added 4 new node IDs
to the server-side REAL_NODE_IDS in `route.ts:26` but the client-side mirror
was not updated.

**Fix:** added `TR-025, TR-026, TR-027, EX-007` to the client-side
REAL_NODE_IDS.

---

### 🚨 BUG #B3 [CRITICAL] · useExecution.ts LIVE_NODE_IDS missing all 4 canvas nodes

**File:** `src/features/execution/hooks/useExecution.ts` lines 70-87 (pre-fix)

**Symptom:** Even if a user turns on real-execution mode, the new canvas
nodes are still skip-able to mock. The 4 v3-only handlers genuinely have
no useful mock — there's no way to fake an agent-built IFC2X3 file. They
need to be in LIVE_NODE_IDS so they're real for **everyone, every time**.

**Cause:** same root cause as #B2 — the LIVE_NODE_IDS set was last touched
for v2 and never updated for canvas-unification.

**Fix:** added `TR-025, TR-026, TR-027, EX-007` to LIVE_NODE_IDS with
inline comments explaining each handler's backend endpoint.

---

## §4 — What is NOT a bug (catalogued for completeness)

| # | Observation | Why it's fine |
|---|---|---|
| 1 | `TR-027 import type { ValidatorView } from .../validate/route.ts` | `import type` is erased at compile time; no runtime boundary leak. |
| 2 | `/runs` BODY_SCHEMA has no default for `cost_cap_usd` | The generator uses `costCapUsd: 3` as backstop. Optional by design. |
| 3 | TR-026 polling uses cookies across 500s window | Sessions last weeks; cookie validity not at risk. |
| 4 | EX-007's `images[]` array is currently unused by any UI | Harmless metadata; the canonical `url` field renders the thumbnail. |
| 5 | `workflow_id` never reaches /runs from canvas | Server stores `workflowId: null`. Reduces observability but doesn't break functionality. **Future-fix candidate**: add `workflowId` to `NodeHandlerContext` so handlers can correlate. |
| 6 | The 4 new canvas nodes have no entries in `assertValidInput` | They fall through to the `default: return { valid: true }` path. No defensive validation, but no false-positive failures either. |
| 7 | `MediaTab` / `ResultShowcase` referenced in CLAUDE.md doesn't exist in the repo | Only `InlineResult` in BaseNode.tsx renders artifacts. CLAUDE.md is stale on this; not in scope to fix here. |

---

## §5 — Test gaps remediated + still open

**Remediated this audit:**
- `tr-026.test.ts` now asserts an allow-list of permitted /runs body keys.
  Catches BUG #A1-class regressions if anyone re-adds a stray key.

**Still open (intentionally out of scope — surgical fix only):**
- No integration tests for `/api/brief-to-ifc/v3/validate` or
  `/api/brief-to-ifc/v3/render-previews`. Both are new endpoints from
  Canvas Unification. Worth adding when there's budget for test infra.
- No template-render test for `wf-ai-ifc-v3`. The
  `visible-node-catalogue.test.ts` covers the catalogue, but not the
  template's node positions or edges.
- No e2e test running a real SOL booth brief through the canvas flow.
  Phase D of the audit calls for this — gated on user-supplied cookie.

---

## §6 — Files changed

```
src/app/api/execute-node/handlers/tr-026.ts                    | removed `source: "canvas"` from /runs body
src/app/api/execute-node/handlers/ex-007.ts                    | added `url` to image artifact data
src/features/execution/hooks/useExecution.ts                   | INPUT_NODE_IDS += IN-009;
                                                                  REAL_NODE_IDS += {TR-025..EX-007};
                                                                  LIVE_NODE_IDS += {TR-025..EX-007}
src/app/api/execute-node/handlers/__tests__/tr-026.test.ts     | body-shape allow-list assertion
forensics/canvas-data-flow-audit-2026-05-17.md                 | this doc
```

**Untouched:** every file in §0 items 11-21 of the audit prompt (the v3
backend), the Python sandbox, the forbidden-file list. No backend changes
were needed — every fix lives on the canvas side of the boundary.

---

## §7 — Recommended next step (out of scope here)

Run a fresh end-to-end SOL booth test on prod after Vercel redeploys the
patch. Suggested flow:

1. `/dashboard/templates` → "AI-Powered IFC Generation"
2. Click → fresh workflow at `/dashboard/canvas?id=…`
3. Paste the SOL Properties brief into IN-009's textarea
4. Click "Run Workflow"
5. Watch the 5 nodes turn `idle → running → success`
6. Verify EX-007 surfaces the top-down PNG inline on the node card
7. Click through to confirm the IFC download + isometric PNG render

Expected: ~44s for TR-026, $0.20 cost, 750+ IFC entities, `verdict: OK`,
bbox ≈ 15×15×4.5m, two PNGs accessible via R2 URL.

**This audit has not run that test yet** — surfacing the cookie request now
so Rutik can decide whether to proceed with the live phase.
