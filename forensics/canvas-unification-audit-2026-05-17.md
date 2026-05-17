# Canvas Unification — Architectural Audit

**Date:** 2026-05-17 · **Phase:** CANVAS-FIRST UNIFICATION · **Status:** D1 (read-only)

> Pre-flight audit of every file that the v3 form / `GN-013` mega-node
> touches, classified as DELETE / EDIT / KEEP, with surfaced ambiguities
> that need a call from Rutik before destructive work begins.

---

## 1 · Categorization

### 1.1 DELETE entirely (after grep verification)

| Path | What it is | Why DELETE |
|---|---|---|
| `src/app/dashboard/brief-to-ifc/v3/new/page.tsx` | Server page that mounts SubmitForm | The form surface is being retired. |
| `src/features/brief-to-ifc/v3/components/submit-form.tsx` | Client form: text/PDF/JSON tabs, cost cap, submit | Replaced by 4 canvas nodes. |
| `src/features/brief-to-ifc/v3/components/sample-briefs.tsx` | Sample briefs disclosure within form | Form-only. No other consumers. |
| `src/features/brief-to-ifc/v3/components/cost-estimate.tsx` | Cost-estimate panel within form | Form-only. |
| `src/features/brief-to-ifc/v3/components/dashboard-card.tsx` | `AiIfcDashboardCard` — the amber dashboard quick-start tile pointing at `/v3/new` | Same surface — must die with the form. |
| `src/app/api/execute-node/handlers/gn-013-ai-ifc.ts` | GN-013 handler (calls `/v3/generate` synchronously, emits `file` artifact) | Mega-node retired in favour of 4 transparent nodes. |
| `src/app/api/execute-node/handlers/__tests__/gn-013-ai-ifc.test.ts` | Vitest for the above | Test for deleted code. |
| `src/app/api/execute-node/handlers/__tests__/dispatcher-gn-013.test.ts` | Dispatcher test for GN-013 | Replaced by new dispatcher tests for TR-025/26/27/EX-007. |

**Net:** 8 files. Plus the empty `src/app/dashboard/brief-to-ifc/v3/new/` directory after files are removed.

### 1.2 EDIT (remove specific references)

| Path | Edit |
|---|---|
| `src/features/dashboard/components/Sidebar.tsx` | Lines 105-107: remove the `briefToIfcV3Enabled` conditional that injects the `"AI IFC"` nav entry pointing at `/dashboard/brief-to-ifc/v3/new`. The Templates entry stays (it's the new entry point). |
| `src/app/dashboard/page.tsx` | Line 7 (import `AiIfcDashboardCard`) + line 121 (`<AiIfcDashboardCard />`): remove both. The dashboard no longer has an AI-IFC quick-start card. |
| `src/features/workflows/constants/node-catalogue.ts` | DELETE the `GN-013` catalogue entry (lines ~598-627). ADD 4 new entries: `TR-025`, `TR-026`, `TR-027`, `EX-007`. The deprecated v2 entries (`TR-024`, `TR-022`, `EX-006`) stay as-is (they keep old workflows loadable). |
| `src/app/api/execute-node/route.ts` (**FORBIDDEN — surgical exception**) | Line 23: remove `"GN-013"` from `REAL_NODE_IDS`, add `"TR-025"`, `"TR-026"`, `"TR-027"`, `"EX-007"`. NO OTHER LINES CHANGE. |
| `src/app/api/execute-node/handlers/index.ts` | Add registry entries for the 4 new handlers; remove `GN-013` registration. |
| `src/features/canvas/components/LegacyV2Banner.tsx` | Line 122-128: the "Open form instead" link points at `/dashboard/brief-to-ifc/v3/new` which is being deleted. Replace with a link to `/dashboard/templates` (specifically the new AI-Powered IFC template) OR remove this CTA entirely. **Cleaner: remove it** — the Upgrade button is the primary action. |
| `src/features/canvas/utils/upgrade-v2-to-v3.ts` | Currently swaps the v2 chain for ONE `GN-013` node. Needs rewrite: swap the v2 chain for the 4-node v3 chain (`TR-025 → TR-026 → TR-027 → EX-007`), preserving upstream brief source + re-routing downstream consumers off `EX-007.ifc-out`. |
| `src/features/canvas/utils/__tests__/upgrade-v2-to-v3.test.ts` | Update existing tests to expect the 4-node upgraded chain instead of 1-node GN-013. |
| `src/features/canvas/components/__tests__/legacy-v2-banner.test.tsx` | Update the "Open form" link assertion (since we're removing it) and any GN-013 references. |
| `src/features/workflows/constants/prebuilt-workflows.ts` | `wf-13` template currently uses `IN-002 → TR-024 → TR-022 → EX-006`. Two choices: (a) DELETE wf-13 entirely and add a new template with the 5-node v3 chain; (b) edit wf-13 in place to the new chain. The prompt says "DELETE the old v2 template #09 entirely" + add a NEW template. Following the prompt: delete wf-13, add `wf-ai-ifc-v3`. |

### 1.3 KEEP untouched (the v3 backend + viewer + tooling)

These files DO NOT change:

- `src/features/brief-to-ifc/v3/types.ts` — BriefSpec contract.
- `src/features/brief-to-ifc/v3/brief-enrichment.ts` — Layer 1 logic.
- `src/features/brief-to-ifc/v3/generator/driver.ts` — Layer 2 agent loop.
- `src/features/brief-to-ifc/v3/generator/sandbox-client.ts`
- `src/features/brief-to-ifc/v3/generator/system-prompt.md`
- `src/features/brief-to-ifc/v3/generator/tools.ts`
- `src/features/brief-to-ifc/v3/runtime/background-runner.ts`
- `src/features/brief-to-ifc/v3/runtime/append-log.ts`
- `src/features/brief-to-ifc/v3/lifecycle/*` — heartbeat, transitions, error codes
- `src/features/brief-to-ifc/v3/quota/quota.ts`
- `src/features/brief-to-ifc/v3/canary.ts`
- `src/features/brief-to-ifc/v3/index.ts`
- `src/app/api/brief-to-ifc/v3/enrich/route.ts`
- `src/app/api/brief-to-ifc/v3/generate/route.ts`
- `src/app/api/brief-to-ifc/v3/runs/route.ts`
- `src/app/api/brief-to-ifc/v3/runs/from-pdf/route.ts`
- `src/app/api/brief-to-ifc/v3/runs/[id]/status/route.ts`
- `src/app/api/brief-to-ifc/v3/runs/[id]/logs/route.ts`
- `src/app/api/brief-to-ifc/v3/quota/route.ts`
- `src/app/dashboard/brief-to-ifc/v3/runs/[id]/page.tsx` — results viewer (still useful as deep-link target from TR-026).
- `src/app/dashboard/brief-to-ifc/v3/runs/[id]/run-root.tsx`
- All `prisma/schema.prisma` v3 models + migrations.
- `neobim-ifc-service/app/services/ifc_generator_v3/buildflow_ifc.py` (FORBIDDEN)
- `neobim-ifc-service/app/services/ifc_generator_v3/validate.py`
- `neobim-ifc-service/app/routers/v3_generator.py`

### 1.4 NEW (created in subsequent deliverables)

| Path | Why NEW |
|---|---|
| `src/app/api/brief-to-ifc/v3/validate/route.ts` | D3 — TR-027 calls this. Reads `finalValidation` from run row, no sandbox round-trip. |
| `src/app/api/brief-to-ifc/v3/render-previews/route.ts` | D4 — EX-007 calls this. **Depends on a Python sandbox endpoint** (see §2.2). |
| `src/app/api/execute-node/handlers/tr-025.ts` | D2a — calls `/enrich`. |
| `src/app/api/execute-node/handlers/tr-026.ts` | D2b — calls `/runs` and polls `/runs/[id]/status` until terminal. |
| `src/app/api/execute-node/handlers/tr-027.ts` | D2c — calls `/validate`. |
| `src/app/api/execute-node/handlers/ex-007.ts` | D2d — calls `/render-previews`. |
| `src/app/api/execute-node/handlers/__tests__/tr-025.test.ts` | + tr-026/27, ex-007 tests |
| (possibly) `neobim-ifc-service/app/routers/v3_previews.py` | NEW Python router for matplotlib + ifcopenshell.geom render. See §2.2 ambiguity. |

---

## 2 · Ambiguities surfaced — need a Rutik call before D2+

### 2.1 IN-002 input mismatch (the prompt's "unchanged" claim)

**Prompt says:**
> "IN-002 · Brief Upload (UNCHANGED — already exists) — Interactive element: existing tabbed upload (text / PDF / DOCX). NO CHANGES."

**Reality:** `IN-002` in the catalogue (line 19-32 of `node-catalogue.ts`) is **"PDF Upload"** — it has no text/DOCX tabs, only PDF, and its output port is type `pdf`, not text. The tabbed upload (text/PDF/JSON) lives in the form's `SubmitForm` component, which is being deleted.

**Options:**

| Option | Pros | Cons |
|---|---|---|
| **A. Template uses IN-001 (Text Prompt)** — user pastes brief text into IN-001 → TR-025 | Cleanest. SOL booth is text. No node changes. Works today. | Loses PDF/DOCX upload until a future polish phase. |
| **B. Template uses IN-002 (PDF Upload)** — handler in TR-025 detects PDF input and internally calls `/runs/from-pdf` for extraction | Matches the prompt literally. Preserves PDF support. | Adds branching in TR-025 handler. Doesn't help text/DOCX users. |
| **C. Create a new tabbed input node `IN-009 — Brief`** — text/PDF/DOCX in one node, outputs text | Mirrors the form's UX faithfully. | More work. Five files to add for the new node. The prompt says "no new dependencies" but doesn't forbid new nodes. |
| **D. TR-025 itself owns the tabbed input UI** — no separate input node, TR-025 has the upload tabs inline | Most compact template (4 nodes not 5). | Inverts the canvas pattern where input lives in input nodes. |

**My recommendation: A** (use IN-001 in the template, with `pdf-out → brief-in` loose typing also supported in TR-025). Simplest, fastest, lowest risk. The PDF/DOCX path can re-emerge later as `IN-009 — Brief` if users ask. SOL test proves it works.

### 2.2 Preview rendering — who runs matplotlib?

**Prompt says:**
> "Create `/api/brief-to-ifc/v3/render-previews/route.ts` — POST: `{ ifcUrl: string }` → calls Python sandbox to render top + iso PNGs via matplotlib + ifcopenshell.geom"
> "The existing forensics script `scripts/forensics/ifc-render-preview.py` contains the rendering logic. Wrap it into a sandbox-callable function and expose via this endpoint."

**Reality:** the forensics script is a LOCAL Python script. There is no production Railway sandbox endpoint that renders previews from an IFC URL. To add one means modifying `neobim-ifc-service/` (the Python service in this repo, which Railway deploys when pushed).

**Options:**

| Option | Pros | Cons |
|---|---|---|
| **A. New Python router `v3_previews.py`** with `POST /api/v3/generator/render-previews { ifc_url }` → downloads + renders + returns base64 PNGs. Next.js endpoint uploads to R2. | Matches prompt literally. Clean separation: no touching of `buildflow_ifc.py` or `validate.py` or `v3_generator.py`. | **Deployment dependency**: Railway must redeploy before EX-007 can actually render anything. Adds 5-10 min wait to the SOL e2e. |
| **B. Pre-generate PNGs in the v3 run lifecycle** — add a stage after finalize that renders previews and stores `topPngUrl` / `isoPngUrl` on the run row. EX-007 just reads them by `runId`. | No new Python endpoint. EX-007 is a pure read. | Modifies `runBackground.ts` (v3 backend). Schema migration for 2 new columns. Touches the "v3 backend untouched" rule. |
| **C. Skip PNG generation entirely** — EX-007 surfaces IFC download + viewer deep link only | Zero new infrastructure. Ships fastest. | The "trust-restoring stage" loses its visual proof on canvas. Prompt explicitly wants PNGs as inline artifacts. |

**My recommendation: A** — it matches the prompt and is the cleanest architecture. Railway auto-deploys on push. The deployment dependency adds ~5 min to the SOL e2e, no manual gate.

### 2.3 TR-026 sync vs async on canvas

**Prompt says:**
> "Handler returns `{ status: 'pending', runId }` immediately; canvas component subscribes to Pusher channel `private-bf-v3-{runId}` … On terminal event, update node artifacts and emit completion to downstream nodes."

**Reality:** the canvas execution engine (`useExecution.ts` + execute-node dispatcher) is **synchronous handler-based**. Each handler call awaits the full result and emits a single artifact. There is no precedent for an async handler that returns `pending` and resolves later via a separate channel. The closest pattern is `useVideoJob.ts` for Kling video generation, but that's bespoke.

**Implementing true async** means: refactoring how the canvas execution loop handles per-node lifecycle, adding Pusher subscription on the node component, adding a "pending" state to the execution store, adding completion handling that emits the artifact when the Pusher terminal event lands. This is a substantial frontend refactor (~6-10 files) and adds risk to the SOL booth proof.

**Pragmatic alternative:** TR-026 handler stays SYNCHRONOUS like the current GN-013. It calls `/runs`, then polls `/runs/[id]/status` server-side every 3-5s until terminal, then returns the full result as a single artifact. The agent runs 30-150s; Vercel function `maxDuration: 600` accommodates with margin. No frontend refactor. Live streaming becomes a follow-up polish phase.

| Option | Pros | Cons |
|---|---|---|
| **A. Full async with Pusher live streaming** (prompt literal) | "Wow" factor on canvas. Live turn count, cost ticker. | ~6-10 files of frontend refactor. Adds risk to SOL proof. |
| **B. Sync handler + server-side polling** (like GN-013) | Matches existing canvas pattern. Lowest risk. SOL proves cleanly. | No live streaming. Node sits "running" for 30-150s with just a spinner. |

**My recommendation: B for this phase**, with A scheduled as a follow-up "live streaming polish" phase. The prompt's intent (transparency) is still met by the 4-node decomposition — users see each stage flip from running→success, with per-stage artifacts surfaced. The live ticker is icing, not the cake.

### 2.4 Should `LegacyV2Banner`'s "Open form instead" CTA be deleted?

The banner currently has 3 actions: Upgrade workflow, **Open form instead** → `/v3/new`, Dismiss. The form is being deleted. Two paths:

- **Delete the middle CTA entirely** (cleanest — Upgrade is the primary action anyway).
- **Replace it with "Open template instead"** linking to `/dashboard/templates` and the new wf-ai-ifc-v3 template.

**My recommendation: delete the middle CTA.** Upgrade in place is the right primary action for a workflow that already exists.

### 2.5 The Templates page surface

The prompt assumes a Templates page exists and a `wf-ai-ifc-v3` template can be set as "#1 featured". The current Templates surface is `src/app/dashboard/templates/` (server page) backed by `PREBUILT_WORKFLOWS` in `prebuilt-workflows.ts`. There is no explicit "featured" / "RECOMMENDED" ordering — templates render in array order (with `wf-12` filtered out per Sidebar's count badge logic).

**My recommendation:** put `wf-ai-ifc-v3` at the **top** of `PREBUILT_WORKFLOWS` so it renders first. Add a `featured: true` flag to its definition if the Templates page can be wired to highlight that (read-only for this audit; will check during D6 whether a `featured` rendering hook exists).

---

## 3 · Orphan-grep targets (D5 acceptance gate)

After deletion, these 6 greps MUST return 0 (the prompt's exact list):

```bash
grep -r "GN-013" src/                  # expect 0
grep -r "brief-to-ifc/v3/new" src/     # expect 0
grep -r "gn-013-ai-ifc" src/           # expect 0
grep -r "executeAIIfcNode" src/        # expect 0 — confirmed 0 today
grep -r "sampleBriefs" src/            # expect 0
grep -r "v3 (beta)" src/               # expect 0
```

Plus (additions for completeness):
```bash
grep -r "AiIfcDashboardCard" src/      # expect 0 after dashboard edit
grep -r "SubmitForm" src/features/brief-to-ifc/v3 # expect 0 after delete
grep -r "submit-form" src/             # expect 0
grep -r "cost-estimate" src/features/brief-to-ifc/v3 # expect 0
```

---

## 4 · Pre-existing references confirmed today

Files that DO reference the items being deleted (these are the EDIT or DELETE targets above — verified, not orphan):

- `src/components/dashboard/Sidebar.tsx` ❌ — does not exist; the real sidebar is at `src/features/dashboard/components/Sidebar.tsx`. Prompt's path was slightly off.
- `src/app/(dashboard)/page.tsx` ❌ — does not exist; the dashboard page is at `src/app/dashboard/page.tsx`. Prompt's path was slightly off.
- `src/constants/node-catalogue.ts` ❌ — does not exist; the real catalogue is at `src/features/workflows/constants/node-catalogue.ts`. Prompt's path was slightly off.
- `src/constants/prebuilt-workflows.ts` ❌ — does not exist; real one at `src/features/workflows/constants/prebuilt-workflows.ts`.

These four path-corrections are mechanical and do not change the substance of any deliverable.

---

## 5 · Open questions for Rutik (BLOCKING D2+)

1. **§2.1 IN-002 mismatch** — proceed with **Option A** (use IN-001 in the template)?
2. **§2.2 Preview rendering** — proceed with **Option A** (new Python router on Railway; deployment dependency)?
3. **§2.3 TR-026 async** — proceed with **Option B** (sync handler, defer live streaming)?
4. **§2.4 LegacyV2Banner** — proceed with **delete the "Open form instead" CTA**?
5. **§2.5 Templates featuring** — proceed by reordering `PREBUILT_WORKFLOWS` (top of array) and adding `featured: true` flag if rendering supports it (TBD during D6)?

These five decisions shape D2 / D3 / D4 / D6. Pausing D2+ until Rutik confirms.

---

## 6 · Recommended approach

Given the scope (10 deliverables, deployment dependencies on both Vercel and Railway, frontend refactor risk on TR-026 if we attempt full async), I'd suggest a phased execution rather than one-shot:

- **Slice 1 (this session):** D1 (this audit, done) + Rutik confirms 5 decisions.
- **Slice 2:** D3 + D4 backend endpoints (incl. Python router if §2.2 → A), local tests green.
- **Slice 3:** D2 four canvas nodes (sync handler pattern §2.3 → B), unit tests green.
- **Slice 4:** D6 template + D5 deletion + orphan greps + D7 log integration.
- **Slice 5:** Build + tsc + vitest + pytest all green; commit per D10; user pushes; SOL e2e (D8); Rutik gate (D9); closeout report (D10).

This keeps each slice ~30-60 min and gives natural checkpoints. Alternative: all-in-one-go is feasible if Rutik signs off on the 5 decisions and accepts the risk of a single long autonomous run.

---

## 7 · Files of record

- This audit (`forensics/canvas-unification-audit-2026-05-17.md`)
- `PHASE_V3_SHIPPED_2026-05-17.md` — context
- `PHASE_V2_RETIRED_2026-05-17.md` — yesterday's surgical retirement, which this phase extends
- `PHASE_BEAST_MODE_CLOSEOUT_REPORT_2026-05-16.md` — the unit-fix forensics

End of D1.
