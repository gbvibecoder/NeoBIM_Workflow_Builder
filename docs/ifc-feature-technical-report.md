# IFC Generation & Creation — Technical Report

**Audience:** Senior engineers, BIM architects, QS domain experts contributing to improvements.
**Status as of:** 2026-04-18 (Phase 1 Track A complete on `feature/rich-ifc-phase-1`; Python microservice live on Railway at git SHA `f00bc4871b0f`).
**Purpose:** Complete current-state reference with file:line citations. Reads as a map of every IFC-related code path, entity emitter, data contract, and improvement lever.

---

## 1. Executive Summary

NeoBIM's IFC capability has two complementary paths:

- **Write path (EX-001 → IFC4 files).** A Python FastAPI microservice (`neobim-ifc-service/`) built on `ifcopenshell 0.8.5` is the primary engine. A 6,328-LOC hand-rolled TypeScript STEP writer (`src/features/ifc/services/ifc-exporter.ts`) is the emergency fallback. Phase 1 Track A added a pre-flight probe + UI indicator so users always see which path ran.

- **Read path (TR-007 parse / TR-016 clash / `/ifc-viewer`).** Browser-side `web-ifc` WASM with a regex-based text-parser fallback. Unchanged in Phase 1.

**Key architectural tension revealed by the Phase 0 audit:** the TS exporter actually contains richer emitters (structural analysis model, MEP ports, rebar, curtain-wall decomposition, classifications, 4D/5D tasks) than the Python service — but four gate flags (`emitRebarGeometry`, `autoEmitDemoContent`, `emitCurtainWallGeometry`, `emitMEPGeometry`) default to `false`, and `ex-001.ts:172-176` never sets them. Phase 1 Track B will plumb these flags through. Phases 2-4 will grow the Python service to feature parity.

**What changed in Phase 1 Track A (complete):**
1. Pre-flight `/ready` probe with 60 s cache, so a down Python service fails over in ≤5 s instead of burning the 30 s export timeout.
2. Rich/Lean badge on EX-001's download card — amber with tooltip when TS fallback ran, green when IfcOpenShell ran.
3. New metadata fields stamped on every EX-001 artifact: `ifcServicePath`, `ifcServiceProbeMs`, `ifcServiceSkipped`, `ifcServiceSkipReason`.
4. `.env.example` now documents `IFC_SERVICE_URL`, `IFC_SERVICE_API_KEY`, `IFC_RICH_MODE`.
5. `getServiceHealthStatus()` helper reserved for a future admin dashboard.

---

## 2. Architecture Overview (post Phase 1 Track A)

```
┌───────────────────────────────────────────────────────────────────────────┐
│                       CLIENT  (browser, Next.js 16)                       │
│                                                                           │
│  ┌───────────────┐  ┌───────────────────┐  ┌──────────────────────────┐   │
│  │ IN-004 input  │  │ /dashboard/       │  │ Canvas artifact card     │   │
│  │ (InputNode)   │  │  ifc-viewer       │  │   ↳ ExportTab.tsx        │   │
│  │               │  │  (IFCViewerPage)  │  │   ↳ Rich/Lean badge ◄NEW │   │
│  └──────┬────────┘  └────────┬──────────┘  └──────────┬───────────────┘   │
│         │                    │                         │                  │
│         │ client-side        │ Web Worker + WASM       │ reads            │
│         │ parseIFCText()     │ for interactive view    │ artifact.metadata│
│         ▼                    ▼                         │ .ifcServicePath  │
│  ┌───────────────────────────────────────┐             │                  │
│  │ useWorkflowStore.ifcParsed            │             │                  │
│  │ (Zustand) — pre-parsed divisions      │             │                  │
│  └──────────────┬────────────────────────┘             │                  │
│                 │                                      │                  │
│                 │ workflow run                         │                  │
│                 ▼                                      │                  │
│  ┌───────────────────────────────────────┐             │                  │
│  │ useExecution — dispatches per-node    │             │                  │
│  │ (TR-007 fast-path, TR-016, etc.)      │             │                  │
│  └──────────────┬────────────────────────┘             │                  │
│                 │                                      │                  │
└─────────────────┼──────────────────────────────────────┘                  │
                  │   POST /api/parse-ifc, /api/upload-ifc, /api/execute-node│
                  ▼                                                         │
┌─────────────────────────────────────────────────────────────────────────┐ │
│                  SERVER  (Next.js API on Vercel)                        │ │
│                                                                         │ │
│  /api/execute-node  → handlers/ex-001.ts                                │ │
│     1. resolve MassingGeometry from upstream                            │ │
│     2. ◄NEW await isServiceReady({5s timeout, 60s cache})               │ │
│     3a. probe.ok  → generateIFCViaService(...) ──→ Python (primary)     │ │
│     3b. probe.fail → skip (generateMultipleIFCFiles TS fallback)        │ │
│     4. stamp artifact.metadata: engine, ifcServicePath,                 │ │
│                                 ifcServiceProbeMs, ifcServiceSkipped,   │ │
│                                 ifcServiceSkipReason                    │ │
│                                                                         │ │
│  /api/parse-ifc  → parseIFCBuffer (web-ifc WASM)                        │ │
│     └── on WASM failure ── parseIFCText (regex)                         │ │
│                                                                         │ │
│  /api/upload-ifc → uploadIFCToR2 → Cloudflare R2 (ifc/ prefix)          │ │
└──────────────────────────────────┬──────────────────────────────────────┘ │
                                   │ POST {IFC_SERVICE_URL}/api/v1/export-ifc
                                   │   Authorization: Bearer <IFC_SERVICE_API_KEY>
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│   PYTHON MICROSERVICE (neobim-ifc-service/, FastAPI, ifcopenshell)      │
│   Deployed to Railway: https://buildflow-python-server.up.railway.app   │
│   Probe endpoint: GET /ready (public)                                   │
│   Health endpoint: GET /health (public, rich diagnostics)               │
│                                                                         │
│   Middleware order (outermost → innermost):                             │
│     ApiKey → CORS → RequestId → handler                                 │
│                                                                         │
│   POST /api/v1/export-ifc → ifc_builder.build_multi_discipline()        │
│        ├─ wall_builder.create_wall (+ create_opening_in_wall)           │
│        ├─ slab_builder.create_slab (floor + roof)                       │
│        ├─ column_builder.create_column                                  │
│        ├─ beam_builder.create_beam (IShape profile)                     │
│        ├─ stair_builder.create_stair (stepped polyline)                 │
│        ├─ opening_builder.create_window/create_door                     │
│        ├─ space_builder.create_space                                    │
│        ├─ mep_builder.create_duct/pipe/cable_tray/equipment             │
│        ├─ material_library.create_material_layer_set                    │
│        └─ property_sets.add_*_psets                                     │
│   → r2_uploader.upload_ifc_to_r2 (boto3) OR base64 data URI fallback    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Where each piece runs

| Concern | Runtime | Evidence |
|---|---|---|
| IN-004 file drop | Browser | `src/features/canvas/components/nodes/InputNode.tsx:83-209` |
| Client-side IFC parse (small files) | Browser main thread | `InputNode.tsx:136-192` calls `parseIFCText` |
| WASM parse (interactive viewer) | Browser Web Worker | `src/features/ifc/components/ifc-worker.ts` |
| WASM parse (server-side BOQ) | Node.js / Vercel lambda | `src/features/ifc/services/ifc-parser.ts:1927-1934` |
| Pre-flight probe | Node.js / Vercel lambda | `src/features/ifc/services/ifc-service-client.ts:62-152` ◄NEW |
| IFC generation (Python, primary) | Railway container | `neobim-ifc-service/app/services/ifc_builder.py:83-288` |
| IFC generation (TS, fallback) | Node.js / Vercel lambda | `src/features/ifc/services/ifc-exporter.ts:1400-1854` |
| R2 upload (TS path) | Node.js | `src/lib/r2.ts:273-313`, `328-383` |
| R2 upload (Python path) | Railway container | `neobim-ifc-service/app/services/r2_uploader.py:27-57` |
| Badge render | Browser | `src/features/execution/components/result-showcase/tabs/ExportTab.tsx:680-708` ◄NEW |

---

## 3. Production Infrastructure

### 3.1 Vercel (Next.js app)

- **Deploys from:** `rutikerole/NeoBIM_Workflow_Builder` main branch ONLY.
- **Cron jobs:** `/api/files/cleanup` daily at 03:00 UTC, `/api/cron/refresh-prices` 2×/month, `/api/cron/reconcile-subscriptions` every 30 minutes (`vercel.json:2-15`).
- **maxDuration:** `/api/parse-ifc` = 180 s (`src/app/api/parse-ifc/route.ts:7`), `/api/execute-node` = 600 s (`src/app/api/execute-node/route.ts:28`), `/api/upload-ifc` = 60 s (`src/app/api/upload-ifc/route.ts:7`).
- **Relevant env vars:** `IFC_SERVICE_URL`, `IFC_SERVICE_API_KEY`, `R2_*`, `UPSTASH_REDIS_*`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `IFC_RICH_MODE` (Phase 1 Track B).

### 3.2 Railway (Python microservice)

- **URL:** `https://buildflow-python-server.up.railway.app`.
- **Docker image:** `python:3.11-slim` + `libgomp1` + 2 uvicorn workers on port 8000 (`neobim-ifc-service/Dockerfile`).
- **Deployed versions (verified via GET /health):** `ifcopenshell 0.8.5`, Python 3.11.15, Linux 6.18.5.
- **R2 bucket used on Python side:** `buildflow-models` (different from TS side's `buildflow-files`).
- **Memory footprint:** ~180 MB RSS at idle (`curl /health`).
- **Cold start:** 5-30 s on free tier; paid plan eliminates this.
- **Auth:** Bearer token in `Authorization` header matching Railway `API_KEY` env var. When unset, service runs in open mode (`neobim-ifc-service/app/auth.py:17-19`).
- **Public endpoints (no auth):** `/`, `/health`, `/ready`, `/docs`, `/openapi.json` (per `auth.py:9` PUBLIC_PATHS).

### 3.3 Cloudflare R2

- **Buckets:** `buildflow-files` (TS side: PDFs, xlsx, IFCs via `uploadIFCToR2`), `buildflow-models` (Python side: IFCs + GLBs).
- **Key layout:**
  - TS-side IFC uploads: `ifc/{yyyy}/{mm}/{dd}/{uuid-short}-{filename}.ifc` (`src/lib/r2.ts:290`)
  - GN-001 bundle: `buildings/{yyyy}/{mm}/{dd}/{buildingId}/model.{glb,ifc,json}` (`src/lib/r2.ts:344-347`)
  - Python service: `ifc/{yyyy}/{mm}/{dd}/{filename}.ifc` (`r2_uploader.py:41`)
- **Retention:** `CLEANUP_DAYS_IFC = 3` (`r2.ts:36`). Actual cleanup cron path: `/api/files/cleanup` (`vercel.json:4-6`). Whether it deletes the `ifc/` prefix is UNKNOWN without reading the handler.
- **Fallback:** every write path gracefully degrades to base64 `data:application/x-step;base64,...` URI if R2 is unconfigured.

### 3.4 Neon PostgreSQL (Prisma)

- Only touched by TR-007's QS corrections lookup (`handlers/tr-007.ts:478-511`).
- `Execution.metadata.regenerationCounts` JSONB for regen cap (`route.ts:286-306`).

### 3.5 Upstash Redis

- `/api/parse-ifc`: 10/min per user (`parse-ifc/route.ts:81-84`).
- `/api/upload-ifc`: 10/min per user (`upload-ifc/route.ts:15-21`).
- `/api/execute-node`: monthly sliding window, plan-tier-based (5/mo FREE, 10/mo MINI, 30/mo STARTER, 100/mo PRO).

---

## 4. Component Inventory

### 4.1 Next.js — IFC write path

| File | LOC | Phase 1 status |
|---|---|---|
| `src/app/api/execute-node/handlers/ex-001.ts` | 296 (was 265) | **Modified** Track A.2 |
| `src/features/ifc/services/ifc-service-client.ts` | 252 (was 114) | **Modified** Track A.1 |
| `src/features/ifc/services/ifc-service-health.ts` | 51 | **NEW** Track A.5 |
| `src/features/ifc/services/ifc-exporter.ts` | 6328 | Unchanged |
| `src/app/api/execute-node/handlers/gn-001.ts` | 469 | Unchanged |
| `src/app/api/execute-node/handlers/gn-012.ts` | 231 | Unchanged |

### 4.2 Next.js — IFC read / viewer path

| File | LOC | Purpose |
|---|---|---|
| `src/app/api/parse-ifc/route.ts` | 189 | WASM parse + text-regex fallback |
| `src/app/api/upload-ifc/route.ts` | 77 | Multipart upload to R2 |
| `src/features/ifc/services/ifc-parser.ts` | 2680 | WASM parser + diagnostics |
| `src/features/ifc/services/ifc-text-parser.ts` | 1133 | Regex-based STEP fallback |
| `src/features/ifc/lib/ifc-cache.ts` | 151 | IndexedDB cache |
| `src/features/ifc/components/IFCViewerPage.tsx` | 735 | Standalone viewer |
| `src/features/ifc/components/Viewport.tsx` | 1651 | Three.js + web-ifc glue |
| `src/features/ifc/components/ifc-worker.ts` | 583 | Web Worker |

### 4.3 UI — result showcase (Phase 1 Track A touched)

| File | LOC | Phase 1 status |
|---|---|---|
| `src/features/execution/components/result-showcase/useShowcaseData.ts` | 547 (was 533) | **Modified** Track A.3 |
| `src/features/execution/components/result-showcase/tabs/ExportTab.tsx` | 796 (was 688) | **Modified** Track A.3 |
| `src/features/execution/components/result-showcase/constants.ts` | 44 | Unchanged (COLORS.EMERALD + AMBER used) |

### 4.4 Python microservice

**Production-hardened** post-Phase 0 (deployed at git SHA `f00bc4871b0f`):

| File | LOC | Notes |
|---|---|---|
| `app/main.py` | 242 (was 61) | Lifespan self-test, 3 global exception handlers, RequestIdMiddleware, `/` root endpoint |
| `app/auth.py` | 29 | Bearer auth; public paths bypass |
| `app/middleware.py` | UNKNOWN | RequestId middleware — stamps `request.state.request_id` + `X-Request-ID` header |
| `app/config.py` | 38 | Pydantic settings (api_key, R2 creds) |
| `app/routers/health.py` | 100 (was 34) | `/health` now returns ifcopenshell version, git SHA, memory RSS; `/ready` exercises ifcopenshell, returns 503 on failure |
| `app/routers/export.py` | 98 | `POST /api/v1/export-ifc` dispatcher |
| `app/models/request.py` | 156 | Pydantic models |
| `app/models/response.py` | 47 | `ExportIFCResponse`, `EntityCounts` |
| `app/services/ifc_builder.py` | 321 | Two-pass orchestrator |
| `app/services/wall_builder.py` | 197 | `IfcWall` + opening + fill |
| `app/services/slab_builder.py` | 104 | `IfcSlab` FLOOR + ROOF |
| `app/services/column_builder.py` | 75 | Circular columns only |
| `app/services/beam_builder.py` | 93 | I-section, hard-coded web/flange thickness |
| `app/services/opening_builder.py` | 192 | Window + Door tied to parent wall |
| `app/services/space_builder.py` | 98 | `IfcSpace` polygon footprint |
| `app/services/stair_builder.py` | 97 | Stepped polyline extrusion |
| `app/services/mep_builder.py` | 291 | Segments + `IfcSystem` + `IfcRelAssignsToGroup` |
| `app/services/material_library.py` | 224 | 5 wall × 5 slab × 1 roof preset, IfcMaterialLayerSet |
| `app/services/property_sets.py` | 239 | Pset_*Common + Qto_*BaseQuantities |
| `app/services/r2_uploader.py` | 63 | boto3 S3 → `buildflow-models` bucket |
| `app/utils/geometry.py` | 67 | Polygon area/centroid/perimeter |
| `app/utils/guid.py` | 25 | UUID v4 (random) → 22-char base64 |
| `app/utils/ifc_helpers.py` | 51 | `assign_to_storey` router |

---

## 5. Request Lifecycle — Write Path (EX-001)

### 5.1 Phase 1 Track A flow (post-probe)

```
Client workflow run
    ├─ executeNode(EX-001, executionId, tileInstanceId, inputData)
    ▼
POST /api/execute-node  {catalogueId:"EX-001", inputData}
    ▼
execute-node/route.ts
    ├─ auth + rate-limit checks
    ├─ assertValidInput("EX-001", inputData)
    ├─ dispatch to handleEX001
    ▼
handlers/ex-001.ts
    ├─ L28: let artifact: ExecutionArtifact | undefined
    ├─ L31-49: Path 0 — if upstream ifcUrl, short-circuit (DEAD — overwritten below)
    ├─ L57-62: Path A — real _geometry from GN-001
    ├─ L63-156: Path B/C — extract floors/footprint from TR-001/TR-003
    ├─ L159-161: compute bldgNameSlug + dateStr + filePrefix
    ├─ L164-168: init ifcServiceUsed=false, files=[]
    ├─ L170-172: dynamic import {isServiceReady, generateIFCViaService}
    ├─ L173: const readiness = await isServiceReady()                  ◄ NEW
    ├─ L175: if (readiness.ready) {
    │         L177-196: try { generateIFCViaService(...)
    │                          if (serviceResult) {
    │                            ifcServiceUsed = true
    │                            files = serviceResult.files.map(...)
    │                          }
    │                        } catch { TS fallback }
    │       }
    ├─ L201-204: else { logger.debug("skipping Python — probe failed")  ◄ NEW
    │          }
    ├─ L206-233: if (!ifcServiceUsed) { TS fallback:
    │             import generateMultipleIFCFiles
    │             loop disciplines → base64 → uploadBase64ToR2
    │           }
    ├─ L235: combinedFile = files.find(d=="combined") ?? files[0]
    ├─ L237-263: build artifact with metadata:
    │             engine, ifcServiceUsed (existed)
    │             ifcServicePath, ifcServiceProbeMs,                   ◄ NEW
    │             ifcServiceSkipped, ifcServiceSkipReason              ◄ NEW
    ▼
execute-node/route.ts → persist via Execution.tileResults (Prisma)
    ▼
Client (useExecution.ts) → store in useExecutionStore.artifacts (Map)
    ▼
ExportTab.tsx (via useShowcaseData.ts)
    ├─ findAllByType(artifacts, "file")
    ├─ read each a.metadata                                             ◄ NEW
    ├─ emit FileDownload[] with ifcEngine, ifcServicePath attached
    ├─ ExportTab loops fileDownloads → downloadCards with ifcBadge      ◄ NEW
    ├─ DownloadCard renders IfcEngineBadge inline                       ◄ NEW
```

### 5.2 The probe itself

`src/features/ifc/services/ifc-service-client.ts:62-152`:

- **Target:** `GET ${IFC_SERVICE_URL}/ready` (public — no auth header sent).
- **Cache:** `Map<string, ServiceReadinessResult>` keyed by URL, 60 s TTL. Module-level — per-lambda, not global.
- **Contract:** never throws. Returns a fixed `reason` union:
  - `"ok"` — HTTP 200 + body `ready === true`
  - `"not-configured"` — env var unset; zero network I/O
  - `"timeout"` — `AbortSignal.timeout(5_000)` fired
  - `"http-error"` — non-200 status OR 200 with body.ready !== true
  - `"parse-error"` — JSON parse failed
  - `"network-error"` — any other fetch failure

### 5.3 UI propagation chain (two files)

`useShowcaseData.ts:420-448` — extends `FileDownload` with IFC metadata fields; `ExportTab.tsx:213-243` — derives `ifcBadge` from `ifcEngine`; `ExportTab.tsx:680-708` — renders `IfcEngineBadge` component using existing `COLORS.EMERALD` / `COLORS.AMBER` tokens (no new colors added).

---

## 6. Request Lifecycle — Read Path (TR-007)

Unchanged in Phase 1. Summary: drop → pre-parse client-side (text-regex) → fast-path artifact OR POST to `/api/parse-ifc` for WASM → QS corrections → `type:"table"` artifact with `_elements`, `_parserDiagnostics`, `_ifcContext`, `_modelQuality`.

---

## 7. Data Contracts

### 7.1 `MassingGeometry` (TS — `geometry.ts:95-112`)

```ts
interface MassingGeometry {
  buildingType: string;
  floors: number;
  totalHeight: number;
  footprintArea: number;
  gfa: number;
  footprint: FootprintPoint[];
  storeys: MassingStorey[];
  boundingBox: { min: Vertex; max: Vertex };
  metrics: Array<{ label; value; unit? }>;
}
```

### 7.2 `GeometryElement` (TS — `geometry.ts:17-76`)

```ts
interface GeometryElement {
  id: string;
  type: "wall" | "slab" | "column" | "roof" | "space" | "window" | "door" |
        "beam" | "stair" | "balcony" | "canopy" | "parapet" |
        "duct" | "pipe" | "cable-tray" | "equipment" |
        "mullion" | "spandrel";   // ← Python rejects until Track C.3 lands
  vertices: Vertex[];
  faces: Face[];
  ifcType: "IfcWall" | "IfcSlab" | "IfcColumn" | "IfcBuildingElementProxy" |
           "IfcSpace" | "IfcWindow" | "IfcDoor" | "IfcBeam" | "IfcStairFlight" |
           "IfcRailing" | "IfcCovering" | "IfcFooting" | "IfcDuctSegment" |
           "IfcPipeSegment" | "IfcCableCarrierSegment" | "IfcFlowTerminal";
  properties: ElementProperties;
}
```

### 7.3 `ElementProperties` (current state — Phase 1 Track C will expand)

Currently 27 fields, all mirrored 1:1 in Python `request.py:31-62`:
`name, storeyIndex, height, width, length, thickness, area, volume, isPartition, radius, spaceName, spaceUsage, spaceFootprint, sillHeight, wallOffset, parentWallId, wallDirectionX/Y, wallOriginX/Y, material, discipline, diameter, isExterior, riserCount, riserHeight, treadDepth`.

**Phase 1 Track C will add (not yet landed):**

Architectural: `fireRatingMinutes`, `acousticRatingDb`, `thermalUValue`, `classificationCode`, `classificationSystem`, `zoneName`, `isLoadBearing`.

Structural: `materialGrade`, `profileType`, `designLoadKnPerM`, `designLoadKn`, `spanType`, `supportType`, `rebarRatio`, `rebarSpec{mainBars, stirrups}`.

MEP: `systemName`, `systemPredefinedType`, `flowDirection`, `upstreamElementId`, `downstreamElementIds[]`, `diameterMm`, `widthMm`, `heightMm`, `insulationThicknessMm`, `designFlowRate`, `designPressure`.

### 7.4 EX-001 artifact `data` shape (post Phase 1 Track A)

```ts
{
  type: "file",
  data: {
    files: [                                   // 4 discipline IFCs
      { name, type: "IFC 4", size, downloadUrl,
        label, discipline: "architectural"|"structural"|"mep"|"combined",
        _ifcContent?: string },
      ...
    ],
    label: "IFC Export (4 Discipline Files)",
    totalSize: number,
    // Backward-compat top-level fields from combined file
    name, type: "IFC 4", size, downloadUrl, _ifcContent,
  },
  metadata: {
    engine: "ifcopenshell" | "ifc-exporter",
    real: true,
    schema: "IFC4",
    multiFile: true,
    ifcServiceUsed: boolean,
    ifcServicePath: "python" | "ts-fallback",      // ◄ NEW
    ifcServiceProbeMs: number,                     // ◄ NEW
    ifcServiceSkipped: boolean,                    // ◄ NEW
    ifcServiceSkipReason?: ServiceReadinessReason, // ◄ NEW
  }
}
```

### 7.5 Python service contracts

**Request** (`ExportIFCRequest`, `request.py:151-156`): `{geometry, options, filePrefix}`.
**Response** (`ExportIFCResponse`, `response.py:42-47`): `{status, files[], metadata, error?, code?}`.
**`EntityCounts`** (`response.py:19-32`): 12 tracked types (`IfcWall, IfcSlab, IfcColumn, IfcBeam, IfcWindow, IfcDoor, IfcOpeningElement, IfcSpace, IfcStairFlight, IfcDuctSegment, IfcPipeSegment, IfcFooting`).

---

## 8. IFC Entity Coverage Matrix

Three columns: Python service (today), TS exporter with default flags (`off`), TS exporter with all flags on (`full`).

| Entity | Python | TS `off` | TS `full` |
|---|---|---|---|
| IfcProject / Site / Building / BuildingStorey | ✅ | ✅ | ✅ |
| IfcGrid | ❌ | ✅ (`ifc-exporter.ts:1816`) | ✅ |
| IfcWall + PredefinedType | ✅ (`wall_builder.py:43`) | ✅ | ✅ |
| IfcOpeningElement + IfcRelVoids/Fills | ✅ | ✅ | ✅ |
| IfcSlab (FLOOR + ROOF) | ✅ (`slab_builder.py:29`) | ✅ | ✅ |
| IfcColumn (circular only on Python) | ✅ | ✅ | ✅ |
| IfcBeam + IfcIShapeProfileDef | ✅ (`beam_builder.py:26`) | ✅ | ✅ |
| IfcWindow + IfcDoor + OperationType | ✅ | ✅ | ✅ |
| IfcStairFlight (stepped) | ✅ (`stair_builder.py:27`) | ✅ | ✅ |
| IfcSpace + CompositionType | ✅ (`space_builder.py:22`) | ✅ | ✅ |
| IfcDuctSegment / PipeSegment / CableCarrierSegment | ✅ (body) | ✅ ($-rep) | ✅ (body) |
| IfcFlowTerminal | ✅ | ✅ | ✅ |
| **IfcDuctFitting / IfcPipeFitting** | ❌ | ❌ | ✅ (`ifc-exporter.ts:4961, 4982`) |
| **IfcValve (GATE, CHECK)** | ❌ | ❌ | ✅ (`ifc-exporter.ts:4966`) |
| IfcCableCarrierFitting / IfcFlowController | ❌ | ❌ | ❌ |
| **IfcDistributionPort** | ❌ | ❌ | ✅ (`ifc-exporter.ts:5747`) |
| **IfcRelConnectsPorts** | ❌ | ❌ | ✅ (`ifc-exporter.ts:5764`) |
| IfcSystem / IfcRelAssignsToGroup / IfcRelServicesBuildings | ✅ | ✅ | ✅ |
| IfcBuildingElementProxy (balcony/canopy/parapet) | ✅ | ✅ | ✅ |
| IfcMaterialLayer / LayerSet / LayerSetUsage / RelAssociatesMaterial | ✅ | ✅ | ✅ |
| **IfcMaterialProfileSet** | ❌ | ❌ | ❌ |
| **IfcReinforcingBar** | ❌ | ✅ (Pset-only) | ✅ (body via emitRebarGeometry) |
| **IfcReinforcingMesh** | ❌ | ✅ Pset-only | ✅ body |
| **IfcCurtainWall** | ❌ | ✅ container | ✅ (body via emitCurtainWallGeometry) |
| IfcMember (MULLION) / IfcPlate (CURTAIN_PANEL) | ❌ | ✅ Pset-only | ✅ body |
| **IfcRailing** | ❌ | ✅ (`ifc-exporter.ts:3467`) | ✅ |
| **IfcFurniture** | ❌ | ❌ | ✅ (gated `autoEmitDemoContent`) |
| **IfcFooting** | ❌ (proxy) | ✅ (`ifc-exporter.ts:5190`) | ✅ |
| **IfcStructuralAnalysisModel** | ❌ | ✅ (`ifc-exporter.ts:5569`) | ✅ |
| IfcStructuralLoadGroup (LOAD_CASE + LOAD_COMBINATION) | ❌ | ✅ | ✅ |
| IfcStructuralCurveMember / SurfaceMember / Action | ❌ | ❌ | ❌ |
| IfcBoundaryCondition | ❌ | ❌ | ❌ |
| IfcMechanicalFastener | ❌ | ❌ | ✅ (gated) |
| **IfcClassification + IfcClassificationReference + IfcRelAssociatesClassification** | ❌ | ✅ (`ifc-exporter.ts:2049, 5405`) | ✅ |
| IfcZone | ❌ | ❌ | ❌ |
| IfcTask + IfcRelAssignsToControl (4D) | ❌ | ✅ (`ifc-exporter.ts:1810`) | ✅ |
| IfcCostSchedule + IfcCostItem (5D) | ❌ | ✅ (`ifc-exporter.ts:1811`) | ✅ |
| IfcLaborResource | ❌ | ✅ (`ifc-exporter.ts:5808`) | ✅ |
| IfcPermit / IfcApproval (Indian compliance) | ❌ | ✅ | ✅ |
| IfcDocumentReference (federation) | ❌ | ✅ | ✅ |
| IfcMapConversion + IfcProjectedCRS (georeference) | ❌ | ✅ (when opted in) | ✅ |
| Pset_EnvironmentalImpactValues (embodied carbon) | ❌ | ✅ (`ifc-exporter.ts:1818`) | ✅ |
| Pset_WallCommon / SlabCommon / ColumnCommon / BeamCommon / WindowCommon / DoorCommon / SpaceCommon | ✅ | ✅ | ✅ |
| Pset_SpaceThermalRequirements | ❌ | ✅ | ✅ |
| Qto_WallBaseQuantities / SlabBaseQuantities / ColumnBaseQuantities / BeamBaseQuantities | ✅ | ✅ | ✅ |
| IfcRelSpaceBoundary (1st level) | ❌ | ✅ | ✅ |
| **IfcRelSpaceBoundary2ndLevel** | ❌ | ❌ | ❌ |

**Headline finding:** Python path covers spatial hierarchy + 12 core building elements with correct geometry + Common Psets/Qtos. Everything beyond (classifications, structural analysis, MEP topology, rebar bodies, curtain-wall decomposition, 4D/5D, carbon) is TS-only territory, and visually-enriching items are behind gate flags.

---

## 9. TS Exporter Gate Flags — Reference

`src/features/ifc/services/ifc-exporter.ts:65-168` (options), `1609-1612` (defaults), `1828-1832` (gate branches).

### 9.1 `emitRebarGeometry` (default `false`)

- **Off:** `IfcReinforcingBar` emits with `Representation=$` (no body). BBS metadata in `Pset_BuildFlow_BBS` intact.
- **On:** bars emit as `IfcExtrudedAreaSolid` (L4211-4240).
- **Risk of on:** "cloud of cylinders at origin" artefact on non-rectangular buildings.

### 9.2 `autoEmitDemoContent` (default `false`)

- **Off:** skips sample bolts/welds, plant-room equipment, MEP port topology (L1829-1831), per-storey MEP fixtures (L1766-1768), sample lifts/ramps/pile-caps/furniture/curtain-wall demos (L5112-5267).
- **On:** all above emit at hard-coded bbox-derived coordinates.
- **Risk of on:** "flying debris" on non-rectangular buildings.

### 9.3 `emitCurtainWallGeometry` (default `false`)

- **Off:** mullions emit as `IfcMember(.MULLION.)`, spandrels as `IfcPlate(.CURTAIN_PANEL.)` with `Representation=$`. Aggregated under `IfcCurtainWall` container.
- **On:** each gets body prism.
- **Risk of on:** facade with 900+ mullions = flying stick chaos.

### 9.4 `emitMEPGeometry` (default `false`)

- **Off:** segments + terminals emit as entities with `Representation=$`. COBie / takeoff works on metadata.
- **On:** body prisms extruded along world +X (ducts) or +Z (pipes).
- **Risk of on:** floating horizontal ladders stretching beyond footprint.

**Phase 1 Track B** introduces `IFC_RICH_MODE` that maps to preset flag bundles: `off` / `arch-only` / `mep` / `structural` / `full`.

---

## 10. Python Microservice Deep Dive

### 10.1 FastAPI app (`app/main.py`)

**Lifespan self-test** (`main.py:40-50`): creates minimal IFC in-memory to verify ifcopenshell works. Failure logs error; `/ready` reports unhealthy; Railway retries.

**Middleware chain** (outermost to innermost, per `main.py:97-114`):
1. **CORS** — allowlist `trybuildflow.in`, `www.trybuildflow.in`, `localhost:3000/3001`; `GET POST`; exposes `X-Request-ID`.
2. **RequestIdMiddleware** — stamps `request.state.request_id` + `X-Request-ID` response header.
3. **ApiKeyMiddleware** — Bearer auth; bypasses public paths (`/health`, `/ready`, `/docs`, `/openapi.json`, `/`).

**Exception handlers** (`main.py:120-222`):
- `StarletteHTTPException` → structured JSON with `error_code: "HTTP_<code>"`.
- `RequestValidationError` → 422 with per-field `loc`, `msg`, `type`, `input_preview` + hint flagging ElementType literal drift as common cause.
- Global `Exception` → 500 with `error_type`, `error_code: "INTERNAL_SERVER_ERROR"`, traceback preview logged server-side.

**Root endpoint** (`main.py:232-241`): public `GET /` returns `{service, status, version, docs, health, ready}`.

### 10.2 Health endpoints (`app/routers/health.py`)

**GET /health** (L50-69): rich diagnostics — `ifcopenshell_version`, `python_version`, `platform`, `uptime_seconds`, `git_sha`, `config.{api_key_configured, r2_configured, r2_bucket, log_level}`, `memory.max_rss_kb`.

**GET /ready** (L72-99): exercises ifcopenshell. Creates `ifcopenshell.file(schema="IFC4")` + `api.run("root.create_entity", ifc_class="IfcProject")`. Returns `{ready:true, ifc_creation_test_ms, git_sha}` or 503 with hint mentioning `libgomp1` requirement on slim images.

### 10.3 Export router (`app/routers/export.py`)

Validation (L32-41): ≥1 storey, ≤100 storeys. Dispatches to `ifc_builder.build_multi_discipline(request)`. Uploads each discipline bytes via `upload_ifc_to_r2`; base64 fallback.

### 10.4 Builder orchestrator (`app/services/ifc_builder.py`)

**Discipline filter** (L63-67):
- architectural = {wall, window, door, space, balcony, canopy, parapet}
- structural = {column, beam, slab, roof, stair}
- mep = {duct, pipe, cable-tray, equipment}

Element-level override via `elem.properties.discipline` (L75). `"combined"` emits all.

**Two-pass element creation** (L175-269): walls first (so windows/doors can reference `wall_lookup`), then everything else.

**MEP grouping** (L272-275): hard-coded 3 systems (HVAC, Plumbing, Electrical). Phase 1 Track C.1c will add per-element `systemName`.

### 10.5 Individual builders

**`wall_builder.create_wall` (L14-105):** derives length from first two vertices; extrudes `IfcRectangleProfileDef(XDim=length, YDim=thickness)` along Z. `PredefinedType = PARTITIONING` or `STANDARD`.

**`wall_builder.create_opening_in_wall` (L108-183):** `IfcOpeningElement` at `(offset_along_wall, 0, sill_height)` relative to wall. Void shape is rectangular profile (width × 1.0 m — wider than wall to guarantee through-cut) extruded by opening_height. Links via `IfcRelVoidsElement`.

**`wall_builder.fill_opening` (L186-198):** `IfcRelFillsElement` opening → window/door.

**`slab_builder.create_slab` (L14-105):** `PredefinedType = ROOF | FLOOR`. `IfcArbitraryClosedProfileDef` when footprint ≥3 points, else 20×20 m rectangle fallback. Extruded along Z by thickness.

**`column_builder.create_column` (L14-75):** circular only. `IfcCircleProfileDef(Radius)` extruded along Z by height. **Width/length props ignored** — gap flagged in § 11.

**`beam_builder.create_beam` (L14-93):** I-section with hard-coded `FlangeThickness=0.015 m`, `WebThickness=0.010 m`. Orientation derived from vertices; extrusion along +Z by length.

**`opening_builder.create_window/create_door` (L13-192):** hooks parent_wall via opening + fill. Window: `OverallHeight` + `OverallWidth` attrs + simplified glass panel geometry. Door: `OperationType = DOUBLE_DOOR_SINGLE_SWING` when width≥1.8 else `SINGLE_SWING_LEFT`.

**`space_builder.create_space` (L12-98):** `CompositionType = ELEMENT`. `LongName = spaceUsage`. Profile from `spaceFootprint` polygon or element vertices or 4.47×4.47 m fallback.

**`stair_builder.create_stair` (L12-97):** `IfcStairFlight` with `NumberOfRisers`, `RiserHeight`, `TreadLength`. **Real stepped polyline** extruded along +Y by width — the only builder that emits a stepped profile.

**`mep_builder.create_duct` (L14-73):** rectangular profile, extruded along **world +X** by length — the "direction unknown" problem. Same for pipes (L76-134) and cable trays (L137-196).

**`mep_builder.create_equipment` (L199-258):** `IfcFlowTerminal`, box extruded along +Z.

**`mep_builder.create_mep_system` (L261-291):** `IfcSystem` + `IfcRelAssignsToGroup(group, members)` + `IfcRelServicesBuildings`.

### 10.6 Material library

5 wall presets (residential / office / commercial / industrial / healthcare), 1 partition preset, 5 slab presets, 1 roof preset. Each 3-4 layers (finish / structure / insulation / finish) with thicknesses in metres and category tags.

**Preset resolver** (L145-157): case-insensitive substring match on `building_type`. Fallback = office.

**Association** (L206-224): `IfcMaterialLayerSetUsage` wrapping `IfcMaterialLayerSet`, linked via `IfcRelAssociatesMaterial`. Direction `AXIS2 / POSITIVE / OffsetFromReferenceLine=0`.

### 10.7 Property sets — current hard-coded values

| Element | Attribute | Current Value | Input field that would replace it |
|---|---|---|---|
| Wall exterior | FireRating | "REI 120" | `fireRatingMinutes` → "REI <n>" |
| Wall interior | FireRating | "EI 60" | `fireRatingMinutes` → "EI <n>" |
| Slab | FireRating | "REI 120" | `fireRatingMinutes` |
| Column | FireRating | "R 120" | `fireRatingMinutes` |
| Beam | FireRating | "R 90" | `fireRatingMinutes` |
| Door | FireRating | "EI 30" | `fireRatingMinutes` |
| Wall exterior | ThermalTransmittance | 0.25 W/m²K | `thermalUValue` |
| Slab roof | ThermalTransmittance | 0.20 W/m²K | `thermalUValue` |
| Window | ThermalTransmittance | 1.4 W/m²K | `thermalUValue` |
| Window | GlazingAreaFraction | 0.85 | UNKNOWN — would need new field |

All become input-driven in Phase 1 Track C.

### 10.8 `IfcSpace` routing via `aggregate` vs `container`

IFC4 requires `IfcSpace` to use `IfcRelAggregates`, not `IfcRelContainedInSpatialStructure`. Helper at `ifc_helpers.py:14-51` routes based on `element.is_a()`. Raw `create_entity` fallback for API-version drift.

---

## 11. Known Gaps & Tech Debt

1. **EX-001 Path 0 is dead.** `ex-001.ts:30-49` assigns artifact but L206-233 always overwrites.
2. **Non-deterministic GUIDs on Python.** `guid.py:13-15` uses UUID v4 random. TS exporter uses UUID v5 + namespace when `projectIdentifier` set (`ifc-exporter.ts:177-199`). Model-versioning tools see every re-export as new model. **Regression on Python path.**
3. **Two `LIVE_NODES` sources of truth drift** (catalogue vs executor).
4. **TR-007 client-side parse on main thread** — can freeze canvas on large files. Viewer correctly uses Web Worker.
5. **`MAX_IFC_SIZE` drift** — `r2.ts:34` = 100 MB; comment at L267-272 says "Max 50MB".
6. **SSRF allowlist permissive** — any `*.r2.dev` / `*.r2.cloudflarestorage.com` accepted.
7. **IFC4.3 / IFC5 not supported.** Python pinned to IFC4 (no `schema` field in `request.py`).
8. **`mullion` / `spandrel` rejected by Python.** `massing-generator.ts:1088, 1197` produces them. `request.py:67-71` rejects. Phase 1 Track C.3 fixes.
9. **Rectangular columns not supported on Python.** `column_builder.py:46` only emits circle. Should branch on `radius` vs `width+length`.
10. **MEP direction always world +X.** `mep_builder.py:58, 119, 181` extrudes `(1, 0, 0)`. Should derive from vertices.
11. **Beam I-section hard-coded.** `beam_builder.py:59-60` uses 15/10 mm flanges/web regardless of profile.
12. **Python builder failures silent.** `ifc_builder.py:268-269` — any exception logged at warning + element skipped; no indicator to user.
13. **`ExportOptions` doesn't declare `rich_mode`.** Pydantic default `extra='ignore'` safe today; a future `extra='forbid'` would break. Track C pre-emptively adds.
14. **Probe cache per-lambda.** Cold-start burst fires probes in parallel. Acceptable.
15. **Rich/Lean badge only on "combined" file.** Four discipline files inside `a.data.files[]` are not expanded in `useShowcaseData.ts:418-448`.

---

## 12. Roadmap to Ultra-Realistic IFC

Prioritized by impact-on-visual-richness × effort.

### 12.1 Immediate wins (Phase 1 Track B — pending)

- **Ship `IFC_RICH_MODE`** — unlocks existing TS exporter features already written. `full` = rebar bodies + curtain-wall decomposition + MEP bodies + demo fixtures visible in viewers. Code ready at `ifc-exporter.ts:123-167` (flags) + `1828-1832` (gates); only plumbing in `ex-001.ts` remains.

### 12.2 Short-horizon (Phase 2 — Python parity pass)

Each bullet = one new builder file + 2-4 new entities + ElementProperties field:

- **`roof_builder.py`** — proper `IfcRoof` (distinct from IfcSlab) + `IfcRoofType` with `FLAT_ROOF`/`SHED_ROOF`/`GABLE_ROOF`. Input: `roofPitchDeg`, `roofForm`. Replaces current "roof via IfcSlab" heuristic at `slab_builder.py:27`.
- **`railing_builder.py`** — `IfcRailing` + `PredefinedType` (HANDRAIL, GUARDRAIL, BALUSTRADE). Host via `IfcRelConnectsElements`. Input: `railingHeight`, `railingPredefinedType`.
- **`footing_builder.py`** — proper `IfcFooting` with `PredefinedType` (PAD_FOOTING, STRIP_FOOTING, CAISSON, PILE_CAP). Today routes via proxy.
- **`furniture_builder.py`** — `IfcFurniture` with `FurnitureType` (BED, DESK, CHAIR, TABLE, CABINET). Enables COBie.
- **Rectangular column support** in `column_builder.py` — branch on `width + length + depth` presence. 10-line change.
- **Proper MEP extrusion direction** — derive vector from first two vertices when `len(vertices) >= 2`, fall back to world axis only when length-only.
- **Deterministic GUIDs on Python side** — port UUID v5 + buildingSMART 22-char compression from `ifc-exporter.ts:185-199`. New `utils/guid.py` with `projectIdentifier` namespace.

### 12.3 Medium-horizon (Phase 3 — structural analysis layer)

- **`structural_builder.py`** — `IfcStructuralAnalysisModel` root + `IfcStructuralCurveMember` (beams/columns) + `IfcStructuralSurfaceMember` (walls/slabs). Connectivity via `IfcRelConnectsStructuralMember`.
- **Load cases** — `IfcStructuralLoadCase` + `IfcStructuralLoadGroup` per IS 456. Factors per IS 1893.
- **Boundary conditions** — `IfcBoundaryCondition` at footings + supports, driven by `supportType`.
- **Applied actions** — `IfcStructuralLinearAction` (UDL) + `IfcStructuralPointAction` from `designLoadKnPerM` / `designLoadKn`.
- **Rebar** — `IfcReinforcingBar` + `IfcReinforcingMesh`. Host via `IfcRelProjectsElement` or `IfcRelAssignsToElement`. Port TS exporter logic at `ifc-exporter.ts:4196-4329`.

### 12.4 Medium-horizon (Phase 4 — MEP topology)

- **Per-segment `IfcDistributionPort`** — two ports (IN at v0, OUT at v1). `FlowDirection` from input.
- **`IfcRelConnectsPortToElement`** — wire each port to its owning segment.
- **`IfcRelConnectsPorts`** — wire segment ports to fitting/terminal ports. Real topology from `upstreamElementId` / `downstreamElementIds`.
- **`fitting_builder.py`** — `IfcDuctFitting`, `IfcPipeFitting`, `IfcCableCarrierFitting` with `PredefinedType` (BEND, TEE, CROSS, REDUCER).
- **Flow devices** — `IfcValve` (GATE, CHECK, BALL, BUTTERFLY, GLOBE), `IfcFlowController`, `IfcFlowMovingDevice` (pump, fan), `IfcFlowStorageDevice` (tank), `IfcFlowTreatmentDevice` (filter).
- **`IfcDistributionSystem`** replacing/complementing generic `IfcSystem`. Proper `PredefinedType` enum from `systemPredefinedType`.

### 12.5 Classification + regional compliance

- **`IfcClassification` + `IfcClassificationReference`** — support CSI, NBC India Part 4, Uniclass 2015, OmniClass, Uniformat II, DIN 276. TS exporter has all six at `ifc-exporter.ts:6121-6207`; Python needs wrapper pattern.
- **`IfcPermit`** for Indian RERA/NBC approvals.
- **`IfcApproval`** for design review stamps.

### 12.6 Visual quality (biggest perceived "ultra-realism" impact)

Each of these is what separates a schematic IFC from a photorealistic one when opened in viewers:

- **Per-element styled items** — `IfcStyledItem` + `IfcSurfaceStyle` + `IfcSurfaceStyleShading` with `DiffuseColour`, `Transparency`, `SpecularHighlight`. Drives viewer colors without needing Cycles materials.
- **Textures** — `IfcSurfaceStyleWithTextures` + `IfcImageTexture` with R2-hosted texture URLs. BlenderBIM renders via Cycles; Navisworks partially; Revit doesn't support textures in IFC round-trip.
- **Presentation layers** — `IfcPresentationLayerWithStyle` per discipline. Enables layer-on/off toggling in Navisworks + ArchiCAD.
- **Proper curtain wall decomposition** — individual mullion/spandrel body geometry + `IfcRelAggregates` linking children back to IfcCurtainWall container.
- **Lighting fixtures** — `IfcLightFixture` + `IfcLightSource` (POINT, DIRECTIONAL, SPOT). Enables lighting simulation in BlenderBIM.
- **Vegetation** — `IfcGeographicElement(TERRAIN)` + `IfcBuildingElementProxy` for trees/planters.
- **2D annotations + dimensions** — `IfcAnnotation` with `IfcDraughtingPreDefinedColour`. Enables 2D plan export from IFC.
- **Railings + handrails** — already planned in 12.2; visually important for stairs/balconies.
- **Furniture populated by space type** — bedroom → bed+desk+wardrobe, office → desk+chair+cabinet, living → sofa+table+tv-unit. Input: `roomType` + `furnitureSet` preset name.

### 12.7 Topological correctness (Phase 5 — topologicpy decision point)

- **2nd-level `IfcRelSpaceBoundary`** — today TS exports 1st-level only (`ifc-exporter.ts:1804`). 2nd-level requires topological intersection between space and bounding walls/slabs. `topologicpy` provides this natively.
- **Space connectivity graphs** — `IfcRelSpaceBoundary` chains let energy tools walk adjacency for EnergyPlus / IES VE.
- **Clash-free routing** — cell-complex-based MEP routing through spaces avoiding structural elements.
- **Apertures preserved through booleans** — doors/windows whose opening relationship survives complex boolean subtractions.
- **Cost:** topologicpy adds ~1.5 GB to Docker image, 20-90 s to generation time. Decision deferred per prompt.

### 12.8 Per-building-type realism presets

Beyond materials, building types could drive entirely different element sets:

- **Residential** — furniture sets per room, sanitary fixtures, electrical outlets, ceiling fans, landscaping.
- **Office** — workstation clusters, meeting room tables, reception furniture, printer/copier rooms, pantry layout.
- **Retail** — display units, POS counters, changing rooms, backlit signage.
- **Healthcare** — beds with headwall units, nurses' station, crash carts, oxygen outlets.
- **Industrial** — pallet racks, overhead cranes, floor markings, safety barriers.

Each preset maps to a JSON list of `IfcFurniture` + `IfcFlowTerminal` + `IfcLightFixture` placements relative to space bounds. Can be generated procedurally or authored as a library.

---

## 13. Observability Layer (Phase 1 Track A)

### 13.1 Probe

File: `src/features/ifc/services/ifc-service-client.ts:62-152`. 60 s cache per URL, never throws, returns structured `ServiceReadinessResult` with fixed `reason` union.

### 13.2 Metadata stamps

Five fields on EX-001 artifact (`handlers/ex-001.ts:255-260`) — `engine`, `ifcServiceUsed`, `ifcServicePath`, `ifcServiceProbeMs`, `ifcServiceSkipped`, `ifcServiceSkipReason`.

### 13.3 UI badge

`IfcEngineBadge` at `ExportTab.tsx:680-708`. Rich = EMERALD + Sparkles; Lean = AMBER + AlertTriangle. Tooltip includes skip reason + points at `IFC_SERVICE_URL`.

### 13.4 Reserved helper

`src/features/ifc/services/ifc-service-health.ts:34-50` — `getServiceHealthStatus()` returning `{ready, latencyMs, lastChecked, lastError, reason, statusCode}`. Future admin dashboard.

---

## 14. Performance & Cost

### 14.1 Latency budgets (observed)

- `/ready` probe (Railway warm): 300-700 ms.
- `/ready` probe (Railway cold): 5-30 s → classified as `timeout` → TS fallback.
- `/api/v1/export-ifc` (Python): 800 ms-3 s small, 3-10 s medium, 10-30 s large.
- TS fallback × 4 disciplines: 200 ms-2 s.
- TR-007 server WASM parse: 2-8 s.
- TR-016 clash detection: 4-20 s.

### 14.2 Memory

- Python idle: ~180 MB RSS. Under load: 300-500 MB. Railway free tier 512 MB = tight for 50k-element buildings.
- TS exporter: `lines: string[]` peak ~50-150 MB V8 heap. Vercel Node 1024 MB = safe.

### 14.3 Cost

- Railway: $5-20/mo for always-on. Currently free-tier.
- Vercel: ~$0 incremental.
- R2: well inside free tier for current scale.

---

## 15. Security

- **SSRF:** `parse-ifc/route.ts:20-42` — same-origin / R2 URLs only.
- **Auth:** NextAuth v5 session for user APIs; shared Bearer for Vercel ↔ Railway.
- **Rate limits:** see § 3.5.
- **Admin bypass:** rate limits only, not input validation (`execute-node/route.ts:46-48`).
- **IFC header check:** both parse + upload verify `ISO-10303-21;` prefix.

---

## 16. Testing

### 16.1 TS suite

`tests/unit/ifc-exporter.test.ts`, `ifc-multi-export.test.ts`, `ifc-cost-pipeline.test.ts`. Full run post-Track A: **70 files, 1,958 tests, 9.21 s wall time, all passing.**

### 16.2 Python service

`neobim-ifc-service/tests/` has only `fixtures/sample_geometry.json` + `__init__.py`. **No test files. No regression coverage against real IFC fixtures.**

### 16.3 Planned Phase 1 Track D

- `scripts/count-ifc-entities.py` — JSON entity-count summary.
- `neobim-ifc-service/tests/fixtures/baseline/phase0/*.ifc` — regression baseline.
- `tests/fixtures/baseline/phase0/entity_counts.md` — Markdown entity matrix (baseline for growth tracking).

### 16.4 Integration tests (Phase 1 Track B / C)

- `tests/integration/ifc-rich-mode.test.ts` — per-richMode flag assertion.
- `tests/integration/ifc-service-client-forwards-new-fields.test.ts` — TS→Python boundary field survival.

---

## 17. Open Questions

1. **Python R2 bucket drift:** Python uses `buildflow-models`, TS uses `buildflow-files`. Intentional or historical?
2. **Does `/api/files/cleanup` actually purge `ifc/` prefix?**
3. **Railway free vs paid tier** — cold starts matter at user-visible scale.
4. **Discipline selection** — currently all 4 always generated. Most users want only Combined. Track B could expose this.
5. **Should `IFC_RICH_MODE` default to `full`** once positioning input lands?
6. **TS exporter sunset path** — at what point after Phase 4 do we freeze/retire?

---

## 18. Diff Summary — what changed since Phase 0 audit

| Area | Phase 0 state | Current |
|---|---|---|
| `.env.example` | Silent on IFC service | Documents `IFC_SERVICE_URL` + `IFC_SERVICE_API_KEY` + `IFC_RICH_MODE` |
| `ifc-service-client.ts` | 114 LOC, only `generateIFCViaService` | 252 LOC, + `isServiceReady` + types |
| `ex-001.ts` probe | None — unconditional Python call | Probe-gated, 5 new metadata fields stamped |
| UI IFC badge | Didn't exist; path fully opaque | Rich/Lean chip on every IFC download |
| `useShowcaseData.ts` | Stripped `a.metadata` | Propagates 4 IFC-specific fields |
| `ExportTab.tsx` | No IfcEngineBadge | New component (L680-708) |
| `ifc-service-health.ts` | Didn't exist | New — `getServiceHealthStatus()` helper |
| `main.py` | 61 LOC — basic CORS + api-key | 242 LOC — RequestId, 3 exception handlers, lifespan self-test, `/` root endpoint |
| `routers/health.py` | 34 LOC | 100 LOC — rich diagnostics on `/health` |

**No Python builder changed. No geometry code changed.** Python-path output is byte-identical to Phase 0 — only observability layer is new.

---

## 19. Reading Index (for contributors)

1. `docs/RICH_IFC_IMPLEMENTATION_PLAN.md` — multi-phase roadmap.
2. `docs/ifc-phase-0-audit.md` — capability audit.
3. `docs/ifc-phase-1-subplan.md` — Phase 1 track breakdown.
4. This file — current-state reference.
5. `docs/ifc-feature-functional-report.md` — non-code companion.
6. `src/features/ifc/services/ifc-service-client.ts` — probe + export entry.
7. `src/app/api/execute-node/handlers/ex-001.ts` — orchestrator.
8. `neobim-ifc-service/app/services/ifc_builder.py` — Python orchestrator.
9. `neobim-ifc-service/app/services/*_builder.py` — per-entity builders.
10. `src/features/ifc/services/ifc-exporter.ts` — 6,328-LOC reference for what rich IFC looks like.

---
