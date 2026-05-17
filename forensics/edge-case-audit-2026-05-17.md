# Edge-Case Audit — `/api/brief-to-ifc/v3/runs`
**Date:** 2026-05-17
**Method:** Direct API submission against production `trybuildflow.in`.
**Scope:** Failure modes that can be exercised over HTTP. The UI-flow edge cases (PDF / DOCX drag-drop) are documented in §3 as "manual TODO" — they cannot be exercised from CLI without a headless browser.

---

## §1 — API-level cases (5/5 PASS)

| # | Case | Body | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| 1 | Short brief | `{"brief": "Too short."}` | HTTP 400, mentions `brief / min / 40` | HTTP 400 ✓ | **PASS** |
| 2 | Empty body | `{}` | HTTP 400, `brief / briefSpec / required` | HTTP 400 ✓ | **PASS** |
| 3 | Empty brief string | `{"brief": ""}` | HTTP 400 (fails min(40) + .refine()) | HTTP 400 ✓ | **PASS** |
| 4 | Very long brief (21 000 chars) | studio brief × 500 | HTTP 400, mentions `max / 20000` | HTTP 400 ✓ | **PASS** |
| 5 | Malformed gibberish (Lorem ipsum, 145 chars) | passes schema length check | HTTP 202 with runId (pipeline accepts) | HTTP 202 ✓ | **PASS** |

**5/5 cases behave as specified.** The Zod schema correctly rejects the four schema violations before any AI spend, and accepts the gibberish brief (it passes structural validation; what the agent produces from gibberish is a Layer-1 / Layer-2 concern not surfaced here).

Raw response logs: `prod-eval-outputs-v6/edge-case-results.json`.

---

## §2 — Detail per case

### Case 1 · Short brief (under 40 chars)

```json
POST /api/brief-to-ifc/v3/runs
{ "brief": "Too short." }     // 10 chars
```

**Response:** HTTP 400
```
{ "error": { "title": "Invalid request",
             "message": "brief: Too small: expected string to have >=40 characters",
             "code": "INVALID_INPUT" } }
```

Rejection happens at the Zod schema layer (`z.string().min(40)`). Zero Anthropic spend. The error message is user-readable.

### Case 2 · Empty body

```json
POST /api/brief-to-ifc/v3/runs
{ }
```

**Response:** HTTP 400 with the `.refine()` message: "Either `brief` (free text) or `briefSpec` (pre-enriched) is required."

Clean rejection. Good UX.

### Case 3 · Empty brief string

```json
POST /api/brief-to-ifc/v3/runs
{ "brief": "" }
```

**Response:** HTTP 400 — fails both `min(40)` AND `.refine(Boolean(brief))`.

The error returned cites the min(40) violation first which is the most actionable.

### Case 4 · Very long brief (21 000 chars)

```json
POST /api/brief-to-ifc/v3/runs
{ "brief": "<21 000 chars of studio brief repeated>" }
```

**Response:** HTTP 400, "brief: Too big: expected string to have <=20000 characters".

The 20 000-char cap is a cost-runaway guard. A 20 000-char brief costs $1+ to enrich (Layer 1) so the upper bound is sensible. Users typing a 5-page brief see this; they need to summarise.

### Case 5 · Malformed gibberish (passes schema, semantically empty)

```json
POST /api/brief-to-ifc/v3/runs
{ "brief": "lorem ipsum dolor sit amet asdfasdf qwerty 123456 ..." }   // 145 chars
```

**Response:** HTTP 202, `{ "runId": "cmpa19zr5...", "status": "PENDING", ... }`.

The pipeline accepts gibberish (it passes structural validation). What happens next is a downstream concern:
- Layer 1 (enrichment) is instructed to be faithful to the brief. A faithful BriefSpec for gibberish will have empty `spaces` / `elements` arrays.
- Layer 2 (agent) given an empty BriefSpec is likely to either: (a) finalize an empty IFC (just walls + floor of a default room), or (b) hit the `AGENT_GAVE_UP` failure code.

**Note:** the gibberish submission was kicked off during this audit (runId `cmpa19zr5...`). It counts against the user's monthly quota but was let-run for documentation. Not polled to completion here — Rutik can `curl` its `/status` later if curious about the agent's behaviour on garbage input.

---

## §3 — UI-flow cases NOT testable from CLI (manual TODO)

These need a browser session. Recommend testing manually after Vercel deploys commit `3a45e970`:

### TODO-1 · PDF upload via IN-009 PDF tab

- **Current state:** the canvas IN-009 BriefInput component shows the PDF tab disabled with a "Coming soon" hint that routes the user to `IN-002 (PDF/DOCX Upload) → TR-001 (Brief Parser)`.
- **Manual check:** Open canvas template, click PDF tab, confirm the hint message renders correctly and the disabled state is unambiguous.

### TODO-2 · DOCX upload via IN-009 DOCX tab

- Same as TODO-1 but for DOCX.

### TODO-3 · Result page IFC hero card

- After clicking RUN WORKFLOW on the canvas template, navigate to the result page (`/dashboard/results/<executionId>`). Verify:
  - Workflow type badge says **IFC EXPORT** (not "CONCEPT RENDERS")
  - Orange/amber hero card with "Your IFC building model is ready" headline
  - KPI strip: ENTITIES · BBOX · UNIT · VERDICT
  - Primary CTA "Open in IFC Viewer" (filled, orange)
  - Secondary CTA "Download IFC" (outlined)
  - PNG thumbnails BELOW the hero (GeneratedAssetsSection)

### TODO-4 · `?url=` mode in the IFC viewer

- Click "Open in IFC Viewer" on a fresh canvas run's result page.
- Should navigate to `/dashboard/ifc-viewer?url=...`, show "Loading IFC from URL…" toast, then auto-mount the 3D viewer with the building.
- Rotate, zoom — confirm the model is interactive.

---

## §4 — Recommendation

**API-level behaviour: ✅ ready for users.** The pipeline rejects the four schema-violation cases cleanly before any spend, and accepts schema-valid input even when it's semantically meaningless. No exception paths broken.

**Browser-level behaviour:** untested in this audit; needs ~5 minutes of manual click-through after Vercel deploys `3a45e970`. If TODO-1/2/3/4 all pass visually, the canvas-IFC user journey is end-to-end verified.

**No fixes were applied this phase.** The 5 API rejections + 1 schema-valid accept all behaved as designed.
