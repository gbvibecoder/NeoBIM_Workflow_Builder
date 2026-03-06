# NeoBIM Workflow Builder — Deep Simulation Test Report
**Date:** 2026-03-06 | **Auditor:** CTO | **Method:** Code-path tracing (every user action simulated)

---

## EXECUTIVE SUMMARY

| Metric | Value |
|--------|-------|
| Total nodes tested | 31 |
| Nodes with explicit mock/real handlers | 26 |
| Nodes with NO handler (generic fallback) | 5 |
| Prebuilt workflows tested | 7 |
| Workflows with data-flow bugs | 4 |
| Critical bugs found | 5 |
| Non-critical bugs found | 8 |
| Download/export paths broken | 4 of 6 mock file exports |

**Verdict:** The happy path works for simple linear workflows in mock mode. Branching workflows, real-mode execution of wf-09, and all mock file downloads are broken.

---

## SECTION 1: CRITICAL ISSUES (Must Fix for Hackathon)

### CRIT-1: IN-004 REAL_NODE_IDS Mismatch — wf-09 Fails in Real Mode

**Severity:** P0 — Workflow crashes
**File:** `src/hooks/useExecution.ts:14` vs `src/app/api/execute-node/route.ts:16`

**What happens:**
- Client-side `REAL_NODE_IDS` includes `IN-004` (IFC Upload)
- Server-side `REAL_NODE_IDS` does NOT include `IN-004`
- When `NEXT_PUBLIC_ENABLE_MOCK_EXECUTION !== "true"` (real mode), the client sends IN-004 to `/api/execute-node`
- Server responds with **400 error** (`NODE_NOT_IMPLEMENTED`)
- Execution halts at the very first node of wf-09

**Impact:** The entire IFC → BOQ → Export workflow (wf-09) is broken in real mode.

**Evidence:**
```
Client (useExecution.ts:14): new Set(["TR-003", "GN-003", "IN-004", "TR-007", "TR-008", "EX-002"])
Server (route.ts:16):        new Set(["TR-003", "GN-003", "TR-007", "TR-008", "EX-002"])
                                                            ^^^^^^ MISSING
```

---

### CRIT-2: Linear Execution Engine Ignores Graph Topology

**Severity:** P0 — Branching workflows produce wrong results
**File:** `src/hooks/useExecution.ts:191-204`

**What happens:**
- The engine sorts all nodes by x-position: `orderedNodes = [...nodes].sort((a, b) => a.position.x - b.position.x)`
- Each node receives only `previousArtifact` — the output of the **immediately prior node in x-sorted order**
- Edge connections are **completely ignored** for data routing

**Impact on wf-10 (Hero Workflow):**
```
Graph topology:  n1 → n2 → n3 → n4 ─┬→ n5 (Image Generator)
                                      └→ n6 (IFC Exporter)

Execution order (x-sorted): n1, n2, n3, n4, n5, n6

Actual data flow:
  n5 receives n4's output ✅ (correct by coincidence — n4 is prev in x-order)
  n6 receives n5's output ❌ (should receive n4's output per edges e4-6a and e4-6b)
```

n6 (IFC Exporter) gets an image artifact from n5 instead of the massing data from n4. The IFC export receives completely wrong input.

---

### CRIT-3: Data Loss at GN-001 → GN-003 Boundary in wf-01

**Severity:** P1 — User's prompt context is lost
**File:** `src/services/mock-executor.ts:242-261` (GN-001 output) vs `src/app/api/execute-node/route.ts:107-108` (GN-003 input)

**What happens in wf-01 (Text Prompt → Concept Building):**
1. IN-001 (Text Prompt) → outputs `{ content: "user's text", prompt: "user's text" }` ✅
2. TR-003 (Building Description) → reads `inputData.content` → outputs `{ content: "BUILDING DESCRIPTION...", _raw: {object} }` ✅
3. GN-001 (Massing Generator) → reads `inputData.content` → outputs **KPI artifact** with `{ metrics: [...] }` ⚠️
4. GN-003 (Image Generator) → reads `inputData._raw` or `inputData.content` or `inputData.prompt`

**The problem:** GN-001 outputs a `kpi` artifact type. Its data object has `metrics` array but **no `content`, no `prompt`, no `_raw` field**. When GN-003 receives this:
- `inputData._raw` → `null` (KPI has no `_raw`)
- `inputData.content` → `undefined` (KPI has no `content`)
- `inputData.prompt` → `undefined` (KPI has no `prompt`)

**Result (real mode):** GN-003 falls back to the generic fallback object with `programSummary: "Modern mixed-use building, Nordic minimal style"` — losing all user context.

**Result (mock mode):** The mock GN-003 reads `inputData.content ?? inputData.prompt` → both undefined → falls back to `"architectural concept"`, generating a generic seed image.

---

### CRIT-4: Data Loss at TR-002 → GN-001 Boundary in wf-02 and wf-10

**Severity:** P1 — Requirements JSON not readable by downstream
**File:** `src/services/mock-executor.ts:98-121` (TR-002 output) vs `src/services/mock-executor.ts:242-261` (GN-001 input)

**What happens:**
- TR-002 outputs a `json` artifact: `{ json: { building_type: "mixed-use", floors: 5, ... } }`
- GN-001 reads `inputData.content ?? inputData.prompt` for floor count extraction

**The problem:** TR-002's data has a `json` field, not `content` or `prompt`. GN-001 does regex matching on the string representation, but `String(inputData.content)` → `"undefined"` → floor match fails → defaults to 5 floors regardless of what the PDF said.

**Impact:** wf-02 (PDF → Massing) and wf-10 (Hero Pipeline) always generate 5-floor buildings no matter what the brief says.

---

### CRIT-5: Artifact Persistence Uses Wrong API Path

**Severity:** P1 — History page shows empty artifacts
**File:** `src/hooks/useExecution.ts:229-240` (write path) vs `src/app/api/executions/[id]/route.ts:20` (read path)

**What happens:**
- **Write path:** `POST /api/executions/[id]/artifacts` appends to `tileResults` JSON field on the Execution model
- **Read path:** `GET /api/executions/[id]` queries `include: { artifacts: { orderBy: ... } }` — reading from the **Artifact Prisma model**

**The mismatch:**
- `tileResults` is a JSON column on the `Execution` table — the write path appends there
- `artifacts` is a separate Prisma relation (`model Artifact`) with its own table — the read path queries there
- The write path never creates rows in the `Artifact` table
- The read path never reads from `tileResults` JSON

**Schema evidence:**
```prisma
model Execution {
  tileResults  Json            @default("[]")   // ← write path stores here
  artifacts    Artifact[]                         // ← read path queries here
}

model Artifact {
  executionId    String       // FK to Execution
  tileInstanceId String       // FK to TileInstance — requires a valid TileInstance ID!
  ...
}
```

**Additional problem:** The `Artifact` model requires `tileInstanceId` as FK to `TileInstance`. But useExecution uses `node.id` (React Flow node ID like `n1-abc123`), not a database TileInstance ID. Even if someone tried to create Artifact rows, the FK constraint would fail.

**Impact:** History page shows executions but with 0 artifacts. Users cannot see past results.

---

## SECTION 2: NON-CRITICAL ISSUES

### NC-1: Five Nodes Have No Mock Handler

**File:** `src/services/mock-executor.ts:333-337`

These node IDs fall through to the generic default case:

| Node ID | Node Name | Output |
|---------|-----------|--------|
| IN-007 | API Connector | `{ json: { status: "completed", nodeId: "IN-007" } }` |
| TR-011 | Energy Analyzer | `{ json: { status: "completed", nodeId: "TR-011" } }` |
| GN-005 | Facade Generator | `{ json: { status: "completed", nodeId: "GN-005" } }` |
| GN-006 | Landscape Generator | `{ json: { status: "completed", nodeId: "GN-006" } }` |
| EX-005 | DXF Exporter | `{ json: { status: "completed", nodeId: "EX-005" } }` |

**Impact:** These nodes appear to "complete" but show a meaningless JSON artifact card. Not in any prebuilt workflow, so only affects custom user-built flows.

---

### NC-2: DALL-E Image URLs Expire (~1 hour)

**File:** `src/app/api/execute-node/route.ts:127-137`

GN-003 in real mode returns `{ url: "https://oaidalleapiprodscus.blob.core.windows.net/..." }`. These Azure Blob Storage URLs have a ~1 hour expiration. The URL is:
- Displayed directly in ArtifactCard's `<img src={data.url}>`
- Persisted to tileResults JSON (if DB write succeeds)
- Never cached or re-hosted

**Impact:** If a user runs a workflow and comes back later, the concept render image will be a broken `<img>`.

---

### NC-3: All Mock File Downloads Are Broken

**File:** `src/services/mock-executor.ts` lines 293-331

All file-type mock artifacts use `downloadUrl: "#"`:

| Node | Mock File | downloadUrl |
|------|-----------|-------------|
| EX-001 (IFC Exporter) | oslo_mixeduse_v1.ifc | `"#"` |
| EX-002 (BOQ Exporter) | oslo_mixeduse_boq.xlsx | `"#"` |
| EX-003 (PDF Report) | compliance_report.pdf | `"#"` |
| EX-006 (Image Exporter) | concept_renders_4K.zip | `"#"` |

The ArtifactCard FileBody component renders a `<a href="#" download="filename">Download</a>` link. Clicking it navigates to `#` (page top scroll), no file downloads.

**Note:** EX-002 in **real mode** correctly generates a base64 data URI that works as a real download. This issue is mock-mode only.

---

### NC-4: IFC Parser Returns Zero Quantities

**File:** `src/services/ifc-parser.ts:304-372`

The `extractQuantities()` function initializes area/volume/length to 0 but **never populates actual values**:
```typescript
quantities.area = { gross: 0, net: 0, unit: "m²" };      // Always 0
quantities.volume = { base: 0, withWaste: 0, unit: "m³" }; // Always 0
```

Line 613 confirms: `const grossFloorArea = buildingStoreys.reduce((sum, storey) => sum + 0, 0);` — literally `sum + 0`.

**Impact:** Even with a real IFC file uploaded, TR-007 extracts element counts correctly but all area/volume values are zero. The fallback data kicks in, which actually has realistic numbers. Net effect: real IFC files produce the same results as no IFC file.

---

### NC-5: Missing Template IDs in AI Prompt Generator

**File:** `src/components/ai/PromptInput.tsx:68-70`

`matchTemplate()` references three IDs that don't exist in `PREBUILT_WORKFLOWS`:

| Prompt keyword | Template ID | Exists? | Fallback |
|---------------|-------------|---------|----------|
| "variant" / "options" | wf-07 | NO | Falls back to wf-01 (Text → Concept) |
| "image" + "concept" | wf-08 | NO | Falls back to wf-01 |
| "compliance" / "zoning" | wf-06 | NO | Falls back to wf-01 |

**How it works:** `PREBUILT_WORKFLOWS.find(w => w.id === "wf-07")` returns `undefined`, then `?? PREBUILT_WORKFLOWS[0]` catches it, which is wf-01.

**Impact:** Three of the six AI prompt chips silently generate the wrong workflow. User types "Generate 3 massing variants" → gets wf-01 (Text → Concept) instead of a variant workflow.

---

### NC-6: Mock TR-007 Schema Differs from Real TR-007

**File:** `src/services/mock-executor.ts:174-188` vs `src/app/api/execute-node/route.ts:225-242`

| Field | Mock TR-007 | Real TR-007 |
|-------|-------------|-------------|
| headers | `["Element", "Count", "Area (m²)", "Volume (m³)", "Source"]` | `["Category", "Element", "Quantity", "Unit"]` |
| row format | `["IfcWall (External)", 48, 1240, 148.8, "Qto_WallBaseQuantities"]` | `["Walls", "External Walls", "1240.00", "m²"]` |
| `_elements` field | Not present | Present (required by TR-008 real handler) |

**Impact:** If TR-008 runs in real mode after mock TR-007, it can't find `_elements` and falls back to processing raw `rows`. The column order is different, causing garbled cost calculations.

---

### NC-7: Rate Limiter Requires Upstash Redis (Fails Gracefully)

**File:** `src/app/api/execute-node/route.ts:33-67`

Rate limiting calls `checkRateLimit()` which uses Upstash Redis. If `UPSTASH_REDIS_REST_URL` is not configured:
- The rate limit check throws
- The catch block on line 64 logs the error and allows the request to proceed (fail-open)

**Impact:** Without Redis configured, there's no rate limiting. This is by design (fail-open), but means the 3 runs/day limit for free users is not enforced.

---

### NC-8: Community Publish Is Frontend-Only

**File:** `src/app/dashboard/community/page.tsx`

The community page shows hardcoded workflow cards. There is no:
- POST API to publish a workflow
- Backend model for published/shared workflows
- Clone-to-my-workflows functionality

The "Clone" button calls `loadTemplate()` from Zustand, which loads from `PREBUILT_WORKFLOWS` constant, not from any database.

**Impact:** Decorative only. Acceptable for hackathon.

---

## SECTION 3: NODE STATUS TABLE (All 31 Nodes)

| # | ID | Name | Has Mock | Has Real | Reads Upstream | Status |
|---|----|------|----------|----------|----------------|--------|
| 1 | IN-001 | Text Prompt | ✅ (bypassed) | N/A (passthrough) | N/A | ✅ PASS |
| 2 | IN-002 | PDF Upload | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 3 | IN-003 | Image Upload | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 4 | IN-004 | IFC Upload | ✅ | ❌ (mismatch) | ❌ | ⚠️ CRIT-1 |
| 5 | IN-005 | Parameter Input | ✅ (bypassed) | N/A (passthrough) | N/A | ✅ PASS |
| 6 | IN-006 | Location Input | ✅ (bypassed) | N/A (passthrough) | N/A | ✅ PASS |
| 7 | IN-007 | API Connector | ❌ (generic) | ❌ | ❌ | ⚠️ NC-1 |
| 8 | TR-001 | Document Parser | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 9 | TR-002 | Requirements Extractor | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 10 | TR-003 | Building Description | ✅ | ✅ (GPT-4o-mini) | ✅ reads `content`/`prompt` | ✅ PASS |
| 11 | TR-004 | Image Understanding | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 12 | TR-005 | Style Prompt Composer | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 13 | TR-006 | Zoning Compliance | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 14 | TR-007 | Quantity Extractor | ✅ | ✅ (web-ifc) | ✅ reads `ifcData` | ⚠️ NC-4, NC-6 |
| 15 | TR-008 | BOQ / Cost Mapper | ✅ | ✅ (cost-db) | ✅ reads `_elements`/`rows` | ✅ PASS |
| 16 | TR-009 | BIM Query | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 17 | TR-010 | Delta Comparator | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 18 | TR-011 | Energy Analyzer | ❌ (generic) | ❌ | ❌ | ⚠️ NC-1 |
| 19 | TR-012 | GIS Context | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 20 | GN-001 | Massing Generator | ✅ | ❌ | ✅ reads `content`/`prompt` | ⚠️ CRIT-4 |
| 21 | GN-002 | Variant Generator | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 22 | GN-003 | Image Generator | ✅ | ✅ (DALL-E 3) | ✅ reads `_raw`/`content`/`prompt` | ⚠️ CRIT-3, NC-2 |
| 23 | GN-004 | Floor Plan Generator | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 24 | GN-005 | Facade Generator | ❌ (generic) | ❌ | ❌ | ⚠️ NC-1 |
| 25 | GN-006 | Landscape Generator | ❌ (generic) | ❌ | ❌ | ⚠️ NC-1 |
| 26 | EX-001 | IFC Exporter | ✅ | ❌ | ❌ | ✅ PASS (mock, download broken NC-3) |
| 27 | EX-002 | BOQ Exporter | ✅ | ✅ (SheetJS) | ✅ reads `rows`/`headers` | ✅ PASS |
| 28 | EX-003 | PDF Report | ✅ | ❌ | ❌ | ✅ PASS (mock, download broken NC-3) |
| 29 | EX-004 | Speckle Publisher | ✅ | ❌ | ❌ | ✅ PASS (mock) |
| 30 | EX-005 | DXF Exporter | ❌ (generic) | ❌ | ❌ | ⚠️ NC-1 |
| 31 | EX-006 | Image Exporter | ✅ | ❌ | ❌ | ✅ PASS (mock, download broken NC-3) |

---

## SECTION 4: WORKFLOW STATUS TABLE (All 7 Prebuilt Workflows)

### wf-01: Text Prompt → Concept Building
| Node | Receives From | Data Field Used | Works? |
|------|--------------|-----------------|--------|
| IN-001 (Text Prompt) | User input | passthrough | ✅ |
| TR-003 (Building Desc) | IN-001 | `content` / `prompt` | ✅ |
| GN-001 (Massing) | TR-003 | `content` / `prompt` | ✅ |
| GN-003 (Image Gen) | GN-001 | `_raw` / `content` / `prompt` | ❌ CRIT-3 |

**Verdict:** ⚠️ PARTIAL — Image generator gets KPI data, loses all text context. Falls back to generic image.

---

### wf-02: PDF Brief → Massing
| Node | Receives From | Data Field Used | Works? |
|------|--------------|-----------------|--------|
| IN-002 (PDF Upload) | Mock data | N/A | ✅ |
| TR-001 (Doc Parser) | IN-002 | Ignores upstream (hardcoded) | ✅ |
| TR-002 (Req Extractor) | TR-001 | Ignores upstream (hardcoded) | ✅ |
| GN-001 (Massing) | TR-002 | `content` / `prompt` → undefined | ❌ CRIT-4 |

**Verdict:** ⚠️ PARTIAL — GN-001 can't read TR-002's `json` field. Defaults to 5 floors.

---

### wf-03: Massing → Concept Images
| Node | Works? | Notes |
|------|--------|-------|
| IN-005 (Parameter Input) | ✅ | Passthrough |
| TR-005 (Style Prompt) | ✅ | Ignores upstream |
| GN-003 (Image Gen) | ⚠️ | Gets image artifact from TR-005, reads `content` → gets `undefined`, uses generic seed |

**Verdict:** ⚠️ PARTIAL — Works visually but image is generic, not informed by parameters.

---

### wf-04: Parameters → 3D Building
| Node | Works? | Notes |
|------|--------|-------|
| IN-005 (Parameter Input) | ✅ | Passthrough |
| GN-001 (Massing) | ⚠️ | Reads `content`/`prompt` from KPI data → undefined → defaults to 5 floors |

**Verdict:** ⚠️ PARTIAL — Always 5 floors regardless of parameter input.

---

### wf-05: Massing → IFC Export
| Node | Works? | Notes |
|------|--------|-------|
| IN-005 (Parameter Input) | ✅ | Passthrough |
| GN-001 (Massing) | ⚠️ | Same as wf-04 |
| EX-001 (IFC Export) | ✅ mock | Download link broken (`#`) |

**Verdict:** ⚠️ PARTIAL — Mock download doesn't work.

---

### wf-09: IFC → Quantity Takeoff → BOQ
| Node | Works? | Notes |
|------|--------|-------|
| IN-004 (IFC Upload) | ❌ real / ✅ mock | CRIT-1: crashes in real mode |
| TR-007 (Quantity Extract) | ⚠️ | IFC parser returns zeros (NC-4), uses fallback |
| TR-008 (Cost Mapper) | ⚠️ | Schema mismatch between mock/real TR-007 (NC-6) |
| EX-002 (BOQ Export) | ✅ real | Real XLSX generation works |

**Verdict:** ❌ FAIL in real mode (CRIT-1), ⚠️ PARTIAL in mock mode (schema mismatch).

---

### wf-10: PDF Brief → Full Pipeline (Hero Workflow)
| Node | Works? | Notes |
|------|--------|-------|
| IN-002 (PDF Upload) | ✅ | Mock data |
| TR-001 (Doc Parser) | ✅ | Hardcoded output |
| TR-002 (Req Extractor) | ✅ | Hardcoded output |
| GN-001 (Massing) | ⚠️ | CRIT-4: can't read TR-002's JSON format |
| GN-003 (Image Gen) | ⚠️ | CRIT-3: gets KPI from GN-001, loses text context |
| EX-001 (IFC Export) | ❌ | CRIT-2: gets n5's image artifact instead of n4's massing |

**Verdict:** ❌ FAIL — Branching execution broken, data loss at multiple boundaries.

---

## SECTION 5: DOWNLOAD & EXPORT STATUS

| Export Type | Mock Mode | Real Mode | Download Works? |
|------------|-----------|-----------|-----------------|
| IFC file (EX-001) | Returns `downloadUrl: "#"` | Not implemented | ❌ Mock broken |
| XLSX spreadsheet (EX-002) | Returns `downloadUrl: "#"` | Base64 data URI | ✅ Real only |
| PDF report (EX-003) | Returns `downloadUrl: "#"` | Not implemented | ❌ Mock broken |
| Speckle commit (EX-004) | Returns URL string | Not implemented | N/A (text, not file) |
| Image archive (EX-006) | Returns `downloadUrl: "#"` | Not implemented | ❌ Mock broken |
| DALL-E image (GN-003) | picsum.photos URL | Azure Blob URL | ✅ but expires ~1hr |

---

## SECTION 6: AI FEATURES STATUS

| Feature | Implementation | Works? | Notes |
|---------|---------------|--------|-------|
| AI Prompt (workflow gen) | Keyword matching via `matchTemplate()` | ⚠️ | 3 of 6 chips → wrong workflow (NC-5) |
| AI Chat Panel | Regex parsing: add/remove/explain | ✅ | `fuzzyFindNode()` works for name matching |
| GPT-4o-mini (TR-003) | Real OpenAI API | ✅ | Requires `OPENAI_API_KEY` |
| DALL-E 3 (GN-003) | Real OpenAI API | ✅ | URLs expire (NC-2) |

---

## SECTION 7: BILLING & PLAN LIMITS

| Feature | Status | Notes |
|---------|--------|-------|
| Stripe Checkout | ✅ | Fixed in Phase 3 audit (separate PRO/TEAM prices) |
| Webhook handling | ✅ | Signature verification + subscription lifecycle |
| Rate limiting (Free: 3/day) | ⚠️ | Requires Upstash Redis. Fails open without it (NC-7) |
| Rate limiting (Pro: 1000/day) | ⚠️ | Same — requires Redis |
| Plan display in Settings | ✅ | Fixed in Phase 3 audit (reads from session) |
| Billing page | ✅ | Free/Pro/Team tiers render correctly |

---

## SECTION 8: SAVE/LOAD/PERSISTENCE

| Feature | Status | Notes |
|---------|--------|-------|
| Save workflow (Cmd+S) | ✅ | Zustand → POST/PUT /api/workflows |
| Load workflow (canvas?id=) | ✅ | GET /api/workflows/[id] → Zustand |
| Create execution record | ✅ | POST /api/executions on run |
| Save artifacts to DB | ❌ | CRIT-5: writes to `tileResults` JSON, reads from `artifacts` relation |
| History page shows executions | ✅ | List works, but artifact detail is empty |
| "Rerun" from history | ⚠️ | Concept present but runs against current canvas state, not saved graph |

---

## RECOMMENDED FIX PRIORITY

### Hackathon Must-Fix (Before Demo)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | **CRIT-1**: Remove IN-004 from client REAL_NODE_IDS | 1 line | Unblocks wf-09 |
| 2 | **CRIT-2**: Use edge-aware data routing (or acknowledge linear-only) | Medium | Fixes wf-10 |
| 3 | **CRIT-3**: Add `content`/`prompt` to GN-001 output | 2 lines | Fixes image context in wf-01 |
| 4 | **NC-3**: Change mock file `downloadUrl: "#"` to data URIs or blobs | Easy | Makes demo downloads work |
| 5 | **NC-5**: Add wf-06, wf-07, wf-08 templates OR remap to existing | Easy | Fixes 3 AI prompt chips |

### Should Fix (Time Permitting)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 6 | **CRIT-4**: Make GN-001 read `json` field from TR-002 | 3 lines | Fixes wf-02, wf-10 floor counts |
| 7 | **CRIT-5**: Fix artifact persistence (write to Artifact table or read from tileResults) | Medium | Makes history useful |
| 8 | **NC-6**: Align mock/real TR-007 output schema | Easy | Prevents garbled cost data |
| 9 | **NC-1**: Add mock handlers for 5 missing nodes | Easy | Better UX for custom workflows |
| 10 | **NC-2**: Cache DALL-E URLs (download and re-host as data URI) | Medium | Persistent renders |

### Can Skip for Hackathon

| # | Issue | Reason |
|---|-------|--------|
| NC-4 | IFC parser zero quantities | Fallback data works fine |
| NC-7 | Rate limiter needs Redis | Fail-open is acceptable |
| NC-8 | Community is decorative | Known limitation |

---

*Report generated by deep code-path tracing. No fixes applied — report only.*
