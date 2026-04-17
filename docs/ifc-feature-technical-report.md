# IFC Feature — Technical Forensics Report

**Author:** Senior-engineer forensics pass (read-only audit)
**Date:** 2026-04-17
**Branch:** `better-3d-model`
**Scope:** Complete IFC creation + generation pipeline — upload, parse, quantity extract, BOQ mapping, massing → IFC, IFC export, clash detection, viewer.
**Read-only:** no changes, no PRs, no commits. Every claim cites file:line.

---

## 1. Architecture Overview

### 1.1 Component map

```
┌────────────────────────────────────────────────────────────────────────┐
│                       CLIENT  (browser, Next.js)                       │
│                                                                        │
│  ┌───────────────┐  ┌───────────────────┐  ┌───────────────────────┐  │
│  │ IN-004 input  │  │ /dashboard/       │  │ Canvas artifact       │  │
│  │ (InputNode)   │  │  ifc-viewer       │  │ IFCBIMViewer          │  │
│  │               │  │  (IFCViewerPage)  │  │                       │  │
│  └──────┬────────┘  └────────┬──────────┘  └──────────┬────────────┘  │
│         │                    │ IndexedDB (ifc-cache)  │               │
│         │                    ▼                        │               │
│         │         ┌──────────────────┐                │               │
│         │         │ Web Worker:      │                │               │
│         │         │ ifc-worker.ts    │                │               │
│         │         │  web-ifc WASM    │◄───────────────┘               │
│         │         └──────────────────┘                                │
│         │                                                             │
│         │  client-side parseIFCText()  ──► ifcParsed stored on node   │
│         │                                                             │
│         │  TR-007 fast-path (useExecution.ts): if large file,         │
│         │  upload via FormData to /api/parse-ifc, then construct      │
│         │  artifact directly without hitting /api/execute-node.       │
│         ▼                                                             │
└─────────┼─────────────────────────────────────────────────────────────┘
          │
          │   POST /api/upload-ifc    (multipart, max 100 MB)
          │   POST /api/parse-ifc     (JSON {ifcUrl} OR multipart)
          │   POST /api/execute-node  (catalogueId + inputData)
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  SERVER  (Next.js API routes, Vercel)                   │
│                                                                         │
│  /api/upload-ifc  ─► uploadIFCToR2()  ──►  Cloudflare R2 (ifc/ prefix)  │
│                                                                         │
│  /api/parse-ifc   ─► parseIFCBuffer (WASM, web-ifc)                     │
│                     └── on WASM failure ─► parseIFCText (regex)         │
│                                                                         │
│  /api/execute-node                                                      │
│     ├─ TR-007  handlers/tr-007.ts    ─► reuses parseIFCBuffer           │
│     ├─ TR-008  handlers/tr-008.ts    ─► pure TS cost mapper             │
│     ├─ TR-016  handlers/tr-016.ts    ─► clash-detector.ts (web-ifc AABB)│
│     ├─ GN-001  handlers/gn-001.ts    ─► generateIFCFile (TS) + GLB      │
│     ├─ GN-012  handlers/gn-012.ts    ─► floor-plan → MassingGeometry    │
│     └─ EX-001  handlers/ex-001.ts    ─► generateIFCViaService (HTTP)    │
│                                        └── fallback: generateMultiple-  │
│                                            IFCFiles (TS)                │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │  POST {IFC_SERVICE_URL}/api/v1/export-ifc
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│           PYTHON MICROSERVICE  (neobim-ifc-service/, FastAPI)           │
│                                                                         │
│  routers/export.py  ─► ifc_builder.build_multi_discipline()             │
│                        ├─ wall_builder.create_wall                      │
│                        ├─ slab_builder.create_slab                      │
│                        ├─ column_builder / beam_builder / stair_builder │
│                        ├─ opening_builder.create_window / create_door   │
│                        ├─ mep_builder.create_duct / pipe / tray         │
│                        ├─ space_builder.create_space                    │
│                        ├─ material_library (IfcMaterialLayerSet)        │
│                        └─ property_sets (Pset_*Common)                  │
│                                                                         │
│  Produces IFC4 bytes per discipline (architectural / structural / mep / │
│  combined), uploads via r2_uploader, returns {download_url, ...}.       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Where each piece runs

| Concern | Where | Evidence |
|---|---|---|
| IFC file chosen by user | Browser | `src/features/canvas/components/nodes/InputNode.tsx:83-209` (IN-004 `FileUploadInput`) |
| Raw `File` held in memory | Browser (module-level `Map`) | `InputNode.tsx:17-18` `inputFileStore`, `inputMultiFileStore`; `:510` `supplementaryIFCStore` |
| Text-regex parse on upload | Browser main thread | `InputNode.tsx:136-192` calls `parseIFCText` |
| WASM parse (interactive viewer) | Browser Web Worker | `src/features/ifc/components/ifc-worker.ts` + `Viewport.tsx:1-60` loads web-ifc WASM client-side |
| WASM parse (server side for BOQ) | Node.js on Vercel | `src/features/ifc/services/ifc-parser.ts:1927-1934` — `new IfcAPI(); SetWasmPath(.../node_modules/web-ifc/); await Init()` |
| STEP text fallback parse | Server or browser | `src/features/ifc/services/ifc-text-parser.ts` |
| IFC generation (TypeScript, always on) | Node.js / Vercel | `src/features/ifc/services/ifc-exporter.ts:1400-1854` writes STEP text by hand |
| IFC generation (Python, when `IFC_SERVICE_URL` set) | Separate service (Docker, Railway) | `neobim-ifc-service/app/services/ifc_builder.py:83-288` via `IfcOpenShell` |
| R2 upload (IFC) | Node.js | `src/lib/r2.ts:273-313` `uploadIFCToR2`; `:328-383` `uploadBuildingAssets` |
| R2 upload (Python path) | Python service | `neobim-ifc-service/app/services/r2_uploader.py:27-57` |
| IFC cache for page refresh | Browser IndexedDB | `src/features/ifc/lib/ifc-cache.ts:21-151` |

---

## 2. File-by-File Breakdown

### 2.1 API routes

#### `src/app/api/parse-ifc/route.ts` (189 LOC)

- **Purpose:** Accept an IFC file (multipart or JSON `{ifcUrl}`), return `{result, meta}` with parsed divisions + diagnostics.
- **Exports:** `POST`, `maxDuration = 180` (L7).
- **Auth / rate limit:** `auth()` + `checkEndpointRateLimit(userId, "parse-ifc", 10, "1 m")` (L76-84).
- **SSRF guard:** `isAllowedIfcUrl` (L20-42) restricts `ifcUrl` to same-origin relative paths, `R2_PUBLIC_URL` prefix, the `<account>.r2.cloudflarestorage.com` host, or `*.r2.dev`.
- **Validation:** header must start with `ISO-10303-21;` (L70-73), max 100 MB (L9), empty buffer rejected (L118-120).
- **Parse pipeline:** `parseBuffer` (L51-68) first calls `parseIFCBuffer` (WASM). On any throw, falls back to `parseIFCText` and marks `parserUsed: "text-regex"`. Both paths return the same structured result.
- **Side effects:** fetches from R2 with `AbortSignal.timeout(60_000)` (L110). Emits `console.info`/`console.warn` with breadcrumb `[parse-ifc]`. No DB writes.

#### `src/app/api/upload-ifc/route.ts` (77 LOC)

- **Purpose:** Multipart upload endpoint that proxies a `.ifc` file to R2 under the `ifc/` prefix.
- **Max duration:** 60s (L7), 100 MB cap (L38-43).
- **Auth + rate limit:** same shape as parse-ifc with limit `"upload-ifc", 10, "1 m"`.
- **Side effects:** `uploadIFCToR2(buffer, file.name)` writes to R2 (L57).
- **Return:** `{ifcUrl, fileName, fileSize}` (L65-69).
- **Used by:** `useExecution.ts:571-582` for TR-016 clash detection when only the raw File is available client-side.

#### `src/app/api/execute-node/route.ts` (414 LOC)

- **Purpose:** Dispatcher. After auth, rate-limit, and regen-cap checks, looks up the handler in `nodeHandlers` and calls it.
- **Real node allow-list:** `REAL_NODE_IDS` (L19) — includes TR-007, TR-008, TR-016, GN-001, GN-012, EX-001 among the IFC-adjacent ones.
- **IFC-relevant timeouts:** `maxDuration = 600` (L28).
- **Error contract:** wraps `APIError` via `formatErrorResponse` (L391-394) and returns 500 with `SYS_001` for generic throws (L402-412).
- **Regen cap:** enforced via `Execution.metadata.regenerationCounts` (L270-318). Fail-open on Prisma errors (L314-317).

#### `src/app/api/execute-node/handlers/tr-007.ts` (585 LOC) — Quantity Extractor

- **Export:** `handleTR007: NodeHandler` (L19).
- **Three input modes:** pre-parsed (`inputData.ifcParsed`), R2 URL (`inputData.ifcUrl`), inline base64 (`inputData.fileData`).
- **Mode 1 (L79-234):** reuses `preParsed.divisions`, folds in parser diagnostics (`geometryTypes`, `materialTypes`, `elementWarnings`, `fileMetadata`, `elementSamples`, `smartWarnings`, `smartFixes`). Aggregates by `elementType + storey + external/internal wall suffix + IfcCovering PredefinedType`.
- **Mode 2 (L237-246):** `fetch(ifcUrl)` then feed the buffer into Mode 3.
- **Mode 3 (L249-401):** imports `parseIFCBuffer` dynamically and calls it with a fresh `ParserDiagnosticCounters`.
- **Supplementary merge (L419-473):** walks `structuralIFCParsed` and `mepIFCParsed` (from `supplementaryIFCStore`) to add foundation / MEP rows.
- **QS corrections (L478-511):** looks up `prisma.quantityCorrection` by `elementType`, takes the last 20, trims min/max, applies average ratio if ≥ 3 corrections and |Δ| > 5%.
- **Error contract:** if no rows are produced, returns `NextResponse.json(formatErrorResponse({code:"NODE_001", …}), {status:422})` (L408-415).
- **Side effects:** Prisma read (`quantityCorrection.findMany`), diagnostic object assembled in memory, returns `type: "table"` artifact with `_parserDiagnostics`, `_ifcContext`, `_modelQuality`.

#### `src/app/api/execute-node/handlers/tr-008.ts` (1720 LOC) — BOQ Cost Mapper

- **Export:** `handleTR008: NodeHandler` (L41).
- **Input:** expects `_elements` from TR-007, plus optional `_marketData` (from TR-015), `_parserDiagnostics`, `_marketDiagnostics`, location JSON.
- **Fallback chain for prices (L112-152):** TR-015 live → Redis cache → Postgres `MaterialPriceCache` via `resolvePriceFallback` → static IS 1200 / CPWD rates.
- **IS 1200 steel rate formula (L103-105):** `marketSteelMaterialPerKg + 20 labour = marketTMTPerKg`; structural steel = material × 1.55 + ₹40 fabrication labour.
- **Diagnostics merged (L46-54):** `mergeParserDiagnostics`, `mergeMarketDiagnostics`.
- **Output (inferred from size and inputs):** table + summary of BOQ lines; persists `BoQAnalytics` fire-and-forget (per file comment L31-39).

#### `src/app/api/execute-node/handlers/tr-016.ts` (193 LOC) — Clash Detector

- **Export:** `handleTR016` (L10).
- **Two modes:**
  - Multi-model (L16-88): `ifcModels[]` array, fetches all in parallel, calls `detectClashesFromMultipleBuffers` with `{tolerance:0.025, maxClashes:5000}` (`src/features/3d-render/services/clash-detector.ts:579`).
  - Single-model (L90-192): accepts `fileData` base64, `ifcUrl`, `ifcData.buffer`, or `ifcParsed.ifcUrl`. Calls `detectClashesFromBuffer` (`clash-detector.ts:544`).
- **Engine (`clash-detector.ts:382-538`):** `IfcAPI().OpenModel()`, enumerates element types, calls `StreamAllMeshes` to compute AABBs, then `detectClashes` with spatial grid (`:268`) and `aabbOverlap` (`:138`) with severity `classifySeverity` (`:162`).
- **Error contract:** throws `APIError(CLASH_DETECTION_FAILED, 500)` (L86, 191) or `APIError(NO_GEOMETRY_FOR_CLASHES, 400)` (L137).

#### `src/app/api/execute-node/handlers/ex-001.ts` (265 LOC) — IFC Exporter

- **Export:** `handleEX001` (L19).
- **Four paths:**
  - Path 0 (L30-49): reuse `inputData.ifcUrl` if upstream GN-001 already wrote to R2. **Note the verbatim comment L14-18:** "the original Path 0 sets an artifact then falls through and the later branches always overwrite it." Behaviour is preserved but observable.
  - Path A (L57-62): real geometry (`_geometry.storeys` + `_geometry.footprint`) from GN-001.
  - Path B/C (L63-156): extracts floors/footprint/height/GFA via regex + `ParsedBrief.programme` summation + `extractBuildingTypeFromText`, then calls `generateMassingGeometry` (from `deps`).
- **Generation (L170-233):** tries `generateIFCViaService` first (Python). If `IFC_SERVICE_URL` unset or service returns non-OK, falls back to `generateMultipleIFCFiles` from `ifc-exporter.ts` which produces 4 discipline strings (architectural / structural / mep / combined). TS fallback uploads each via `uploadBase64ToR2` with `application/x-step`.
- **Output artifact (L237-262):** `type: "file"` with `files: [{name, type:"IFC 4", size, downloadUrl, discipline, _ifcContent}]`, top-level backward-compat fields, `metadata.ifcServiceUsed` flag.
- **Data-URI fallback (L222):** if R2 is not configured, `downloadUrl` becomes `data:application/x-step;base64,…`.

#### `src/app/api/execute-node/handlers/gn-001.ts` (469 LOC) — Massing Generator (writes IFC)

- **Path 3 — unified BIM pipeline (L362-466):** calls `generateIFCFile(geometry, {...})` (from `ifc-exporter.ts`) in parallel with `generateGLB`, then uploads both + metadata JSON via `uploadBuildingAssets` (`src/lib/r2.ts:328-383`).
- **Result:** artifact type `3d` with `{glbUrl, ifcUrl, metadataUrl}` — downstream EX-001 can pass through this `ifcUrl` via Path 0.

#### `src/app/api/execute-node/handlers/gn-012.ts` (231 LOC) — Floor Plan Editor

- **Stages:** (1) AI room programmer → (2) AI spatial layout (GPT-4o with retry) or multi-floor BSP layout → (3) architectural detailing.
- **IFC-adjacent output:** `convertFloorPlanToMassing(project)` (L149) produces `massingGeometry` which is the same `MassingGeometry` shape consumed by EX-001 Path A. Emitted under `_outputs["geo-out"]` (L212). Downstream EX-001 therefore builds IFC from GN-012 output too.
- **No direct IFC write here** — it only produces `MassingGeometry` + `FloorPlanProject`.

### 2.2 Services

#### `src/features/ifc/services/ifc-parser.ts` (2680 LOC)

- **Exports:** `QuantityData`, `MaterialLayer`, `IFCElementData`, `CSICategory`, `CSIDivision`, `BuildingStorey`, `ModelQualityReport`, `IFCParseResult`, `ParserFileMetadata`, `ElementDiagnostic`, `ParserTimings`, `ParserDiagnosticCounters`, `createParserDiagnosticCounters`, `parseIFCBuffer` (L1896).
- **Schema consumed:** IFC2X3 / IFC4 via `web-ifc`'s `GetModelSchema`.
- **WASM bootstrap (L1927-1934):** `new IfcAPI(); SetWasmPath(path.resolve(process.cwd(), "node_modules/web-ifc") + "/", true); await Init(); OpenModel(buffer, {COORDINATE_TO_ORIGIN:true})`. Depends on serverless bundler placing `node_modules/web-ifc` alongside the handler.
- **Diagnostics:** populates geometry type counts (`IfcExtrudedAreaSolid`, `IfcBooleanResult`, `IfcFacetedBrep`, `IfcMappedItem`, `IfcBoundingBox`), material association types, file metadata (`authoringApplication`, `qtoBaseSetCount`, `customQuantitySetCount`, etc.), per-element samples with fallback chains, phase timings.
- **Smart warnings (L321-414):** authoring-tool-aware messages (Revit, ArchiCAD, BIMcollab, Solibri) with suggested fixes including referencing `docs/ifcopenshell-microservice-architecture.md`.
- **CSI mapping (L446-L~650):** `DEFAULT_WASTE_FACTORS` per CSI division, `IfcWall`/`IfcColumn`/`IfcBeam` material-based overrides, MEP mappings (div 22/23), `IfcBuildingElementProxy` inference by material name.
- **Unit handling (L2022+):** reads `IfcUnitAssignment` from project; detects `FOOT`, `INCH`, `METRE`; applies `lengthConversionFactor`.

#### `src/features/ifc/services/ifc-text-parser.ts` (1133 LOC)

- Regex over raw STEP text. Emits `TextParseResult` with the same `divisions → categories → elements` shape as the WASM parser, plus its own `ParserDiagnosticCounters`. Called both from `parse-ifc` route (on WASM error) and directly from the browser via `InputNode.tsx` to avoid a server round-trip.

#### `src/features/ifc/services/ifc-exporter.ts` (6328 LOC)

- **Top-level exports:** `generateIFCFile` (L1400), `emitMEPFixturesForStorey` (L4818), `emitMissingBuildingElements` (L5068), `generateMultipleIFCFiles` (L6318).
- **Strategy:** pure string builder — no library. Writes `ISO-10303-21` STEP text by hand. Header at L1428-1437, ends with `END-ISO-10303-21;` at L1854.
- **Schema switch:** `IFC4` default, `IFC2X3` legacy. Wall entity `IFCWALL` for IFC4 vs `IFCWALLSTANDARDCASE` for IFC2X3 (L2304, L2497).
- **Features (per header comment L1-20):** `IfcRelAssociatesMaterial`, `IfcOpeningElement` + `IfcRelVoidsElement` + `IfcRelFillsElement`, type objects (`IfcWallType` etc.), UUID v4 + v5 GUIDs compressed to 22-char base-64 (`BUILDFLOW_NAMESPACE` L177, `compressGuid` L185-199), dual CSI+NBC classification, `IfcDistributionSystem` for MEP, IS-808 steel profiles, `Pset_SpaceCommon`, Body/Axis/FootPrint subcontexts.
- **Options (L65-168):** `schema`, `filter` (architectural|structural|mep|all), `region` (india|eu|us), `geoReference`, `rera`, `currency`, `projectPhase`, `enableMappedItems`, `permit`, `federatedFiles`, plus three guard flags `emitRebarGeometry`, `autoEmitDemoContent`, `emitCurtainWallGeometry`, `emitMEPGeometry` — **all default `false`** because the comments document a past incident of "flying debris" on non-rectangular buildings when these were on (L123-168).
- **International classifications (L6121-6207):** hard-coded Uniclass 2015, OmniClass 2013, Uniformat II 2009, DIN 276-1:2018, NATSPEC 2023.
- **Indian EPDs, IS 1893 seismic, IS 875 wind, IS 456 load combos (L6101-6244):** all hard-coded sample catalogues.
- **COBie manufacturer catalogue (L6261-6312):** Indian brand placeholders (Kirloskar, Voltas, Blue Star, Havells, Schneider, Legrand, ABB, Waaree, Otis, Tyco).

#### `src/features/ifc/services/ifc-service-client.ts` (114 LOC)

- **Export:** `generateIFCViaService(geometry, options, filePrefix)` (L47).
- **Behaviour:** returns `null` when `IFC_SERVICE_URL` is unset (L56-58) — triggers the TS fallback. Timeout 30 s (L39). Forwards geometry shape verbatim to Python `POST /api/v1/export-ifc`.
- **Auth:** `Bearer ${IFC_SERVICE_API_KEY}` when configured.
- **Result:** `{status, files[], metadata}` where each file already has an R2 `download_url` (or base64 data URI fallback).

#### `src/features/ifc/lib/ifc-cache.ts` (151 LOC)

- **Exports:** `saveLastIFCFile`, `loadLastIFCFile`, `clearLastIFCFile`, `CachedIFCFile`.
- **Why IndexedDB:** IFC files routinely exceed 5 MB localStorage limit (L15-19). Stores a `Blob` synchronously before any `await` so it survives when the same buffer is transferred into a Web Worker (L66-98).
- **Cross-tab usage:** the viewer tab caches; the canvas IN-004 auto-attach reads via `loadLastIFCFile` (`InputNode.tsx:241-256`).

### 2.3 Client components

- `IFCViewerPage.tsx` (735) — standalone page at `/dashboard/ifc-viewer`. Dynamic-imported with `ssr:false` (`src/app/dashboard/ifc-viewer/page.tsx:6-26`).
- `Viewport.tsx` (1651) — Three.js + web-ifc. Imports web-ifc type IDs inline (L27-60) to avoid `import 'web-ifc'` at module top (SSR safety).
- `ifc-worker.ts` (583) — Web Worker duplicating the same type constants (L9-41). Runs parsing off the main thread.
- `UploadZone`, `Toolbar`, `ModelTree`, `PropertiesPanel`, `ViewCube`, `ContextMenu`, `IntegrationBanner` — viewer chrome.
- `src/features/canvas/components/artifacts/IFCBIMViewer.tsx` — inline viewer on artifact cards; fetches `ifcUrl` or uses raw text `content`.

### 2.4 Python microservice (`neobim-ifc-service/`)

| File | LOC | Purpose |
|---|---|---|
| `app/main.py` | 61 | FastAPI app, CORS allowing trybuildflow.in + localhost:3000/3001, `ApiKeyMiddleware`, mounts `health` + `export` routers under `/api/v1`. |
| `app/auth.py` | 29 | Bearer-token middleware; `/health`, `/ready`, `/docs`, `/openapi.json` are public. No API key configured ⇒ dev mode (open). |
| `app/config.py` | 38 | Pydantic settings for API key, R2 creds, port, log level. |
| `app/routers/export.py` | 98 | `POST /api/v1/export-ifc`. Validates ≥ 1 storey and ≤ 100 storeys (L32-41). Calls `build_multi_discipline`. Uploads each discipline to R2; data-URI fallback via `ifc_to_base64_data_uri`. |
| `app/routers/health.py` | 34 | `/health` (liveness + `ifcopenshell.version`), `/ready` (creates an IFC in-memory as a smoke test). |
| `app/models/request.py` | 156 | Mirrors `MassingGeometry`/`GeometryElement` TS types. `ElementType` literal includes `wall, slab, column, roof, space, window, door, beam, stair, balcony, canopy, parapet, duct, pipe, cable-tray, equipment`. |
| `app/models/response.py` | 47 | `ExportedFile`, `EntityCounts` (12 named entity fields), `ExportMetadata`, `ExportIFCResponse`. |
| `app/services/ifc_builder.py` | 321 | Orchestrator. Creates IfcProject/Site/Building/Storey; two-pass element creation (walls first so openings can reference them). Groups MEP into systems (L272-275). |
| `app/services/wall_builder.py` | 197 | `create_wall` uses vertex pair to derive length + direction (L30-40); extrudes `IfcRectangleProfileDef` along Z by `height`. `create_opening_in_wall` + `fill_opening` implement the IfcRelVoidsElement/IfcRelFillsElement pair. |
| `app/services/slab_builder.py` | 104 | `create_slab` accepts optional `footprint` for `IfcArbitraryClosedProfileDef`, extruded by `thickness`. `is_roof` inferred from `elem.type` or name. |
| `app/services/column_builder.py` | 75 | IfcColumn via rectangular profile + extrusion. |
| `app/services/beam_builder.py` | 93 | IfcBeam. |
| `app/services/opening_builder.py` | 192 | IfcWindow + IfcDoor tied to parent wall via the opening helper. |
| `app/services/space_builder.py` | 98 | IfcSpace with footprint polyline. |
| `app/services/stair_builder.py` | 97 | IfcStairFlight (rise/tread from props if supplied). |
| `app/services/mep_builder.py` | 291 | Duct, pipe, cable-tray, equipment + `create_mep_system` which builds `IfcDistributionSystem` + `IfcRelAssignsToGroup`. |
| `app/services/material_library.py` | 224 | `WALL_PRESETS`, slab, roof presets by building type → IfcMaterialLayerSet via `api.run('material.add_material', …)`. |
| `app/services/property_sets.py` | 239 | Pset_WallCommon, Pset_SlabCommon, Pset_WindowCommon, Pset_DoorCommon, Pset_SpaceCommon, Pset_BeamCommon, Pset_ColumnCommon. |
| `app/services/r2_uploader.py` | 63 | boto3 S3 client to `{account}.r2.cloudflarestorage.com`, key `ifc/{yyyy}/{mm}/{dd}/{filename}`, fallback `ifc_to_base64_data_uri`. |
| `app/utils/guid.py` | 25 | `new_guid()` returning IfcOpenShell's compressed GUID. |
| `app/utils/geometry.py` | 67 | Vertex helpers. |
| `app/utils/ifc_helpers.py` | 51 | `assign_to_storey` wraps `IfcRelContainedInSpatialStructure`. |

### 2.5 Tests present

- `tests/unit/ifc-exporter.test.ts` — covers generator.
- `tests/unit/ifc-multi-export.test.ts` — covers `generateMultipleIFCFiles`.
- `tests/unit/ifc-cost-pipeline.test.ts` — covers TR-007 → TR-008 mapping.
- `neobim-ifc-service/tests/` directory exists but only `fixtures/` is populated; no `.py` test files are listed — **UNKNOWN coverage for the Python service.**

---

## 3. Data Contracts

### 3.1 Parser → consumers

```ts
// src/features/ifc/services/ifc-parser.ts:178-210
interface IFCParseResult {
  meta: { version; timestamp; processingTimeMs; ifcSchema;
          projectName; projectGuid;
          units: {length; area; volume}; warnings: string[]; errors: string[] };
  summary: { totalElements; processedElements; failedElements;
             divisionsFound: string[]; buildingStoreys; grossFloorArea;
             totalConcrete?; totalMasonry? };
  divisions: CSIDivision[];              // code → categories → elements[]
  buildingStoreys: BuildingStorey[];
  modelQuality?: ModelQualityReport;     // L149-176
  parserDiagnostics?: ParserDiagnosticCounters;  // L264-295
}

interface IFCElementData {                // L108
  id: string; type: string; name: string; storey: string;
  material: string; materialLayers?: MaterialLayer[];
  quantities: QuantityData;               // L72 — area {gross,net}, volume {base,withWaste}, …
  properties?: Record<string, unknown>;
}
```

### 3.2 TR-007 artifact (client fast-path AND server handler produce the same shape)

```ts
// tr-007.ts:546-584, useExecution.ts:535-550
{ type: "table",
  data: {
    label: "Extracted Quantities (IFC)",
    headers: ["Category","Element","Gross Area (m²)","Opening Area (m²)",
              "Net Area (m²)","Volume (m³)","Qty","Unit"],
    rows: string[][],
    _elements: [{description, category, quantity, unit,
                 grossArea?, netArea?, openingArea?, totalVolume?,
                 storey, elementCount, materialLayers?, ifcType, …}],
    _hasStructuralFoundation: boolean,
    _hasMEPData: boolean,
    _parserDiagnostics: PipelineDiagnostics,
    _ifcContext: {totalFloors, totalGFA, estimatedHeight,
                  dominantStructure, openingRatio, slabToWallRatio},
    content: parseSummary,                // string
    _modelQuality?: ModelQualityReport,
  },
  metadata: { model: "ifc-parser-v2", real: true,
              hasStructuralIFC, hasMEPIFC } }
```

### 3.3 TR-016 artifact

```ts
// tr-016.ts:62-82, 168-189
{ type: "table",
  data: {
    label: "Clash Detection Report" | "Cross-Model Clash Report (N models)",
    headers: [...],
    rows: [[#, severity, elemA, idA, (modelA)?, elemB, idB, (modelB)?,
            storey, overlapM3], ...],
    _clashes: ClashResult[], _meta: ClashDetectionMeta,
    content: summaryString },
  metadata: { real: true, processingTimeMs, totalElements,
              clashesFound, modelCount?, crossModelClashes? } }
```

### 3.4 MassingGeometry → EX-001 → IFC

```ts
// src/types/geometry.ts (mirrored in neobim-ifc-service/app/models/request.py)
MassingGeometry {
  buildingType, floors, totalHeight, footprintArea, gfa,
  footprint: FootprintPoint[],
  storeys: MassingStorey[{index, name, elevation, height,
    elements: GeometryElement[{id, type, vertices, faces?,
      ifcType: "IfcWall" | "IfcSlab" | "IfcColumn" | … ,
      properties: ElementProperties}] }],
  boundingBox?, metrics? }
```

EX-001 emits `files: [{name, type:"IFC 4", size, downloadUrl, label, discipline: "architectural"|"structural"|"mep"|"combined", _ifcContent?: string}]` (`ex-001.ts:237-262`).

### 3.5 Python service request / response

See `neobim-ifc-service/app/models/request.py:151-156` for `ExportIFCRequest` and `response.py:42-47` for `ExportIFCResponse`. Response `files[i].download_url` is either an R2 URL or a data URI starting with `data:application/x-step;base64,` (`r2_uploader.py:60-63`).

---

## 4. Execution Flow

### 4.1 WF-09 `IFC Model → BOQ Cost Estimate` (`prebuilt-workflows.ts:300-408`)

Topology:
```
IN-004 (IFC Upload)  ──► TR-007 (Quantity Extractor) ──┐
IN-006 (Location)    ──► TR-015 (Market Intelligence)  │
                                     └─► TR-008 (BOQ Cost Mapper) ──► EX-002 (XLSX)
```

Walkthrough:

1. **User drops file in IN-004.** `FileUploadInput.handleFile` (`InputNode.tsx:91-209`) stores the `File` in `inputFileStore`, reads via `FileReader.readAsText`, calls `parseIFCText` **client-side** to produce `ifcParsed` which is written to `node.data.ifcParsed` (L162-173). `ifcUrl`/`fileData` are cleared.
2. **Workflow run triggers `useExecution`** (`useExecution.ts`). For TR-007 it skips the server round-trip when `ifcParsed` exists or the file is "large" (`>1.5 MB base64`, L359). Otherwise, it uploads via multipart to `/api/parse-ifc` (L378-390).
3. **Server parses** — `parse-ifc/route.ts:136` calls `parseBuffer` → `parseIFCBuffer(buffer, fileName, undefined, counters)` (WASM). Regex fallback kicks in on any throw.
4. **TR-007 artifact is synthesised** either on the client fast-path (`useExecution.ts:535-550`) or via `handleTR007` on the server. Both shapes are identical (L3.2).
5. **TR-008 (`handlers/tr-008.ts`)** merges `_elements` from TR-007 with `_marketData` from TR-015 and location JSON from IN-006. Applies fallback chain (L119-152) → computes unit costs → persists `BoQAnalytics`.
6. **EX-002** writes xlsx via `handlers/ex-002.ts` and uploads via `uploadBase64ToR2` (`ex-002.ts:740`).

Storage per step:
| Step | Persistence |
|---|---|
| IN-004 drop | Browser `inputFileStore` Map + `node.data.ifcParsed` in Zustand (`useWorkflowStore`) |
| Optional R2 upload | R2 `ifc/{yyyy}/{mm}/{dd}/{uuid}-{filename}` (`uploadIFCToR2`, 3-day cleanup per constants L35-36 in `r2.ts`) |
| TR-007 result | Stored in `Execution.tileResults[]` row by `useExecution.ts` save path (UNKNOWN exact row — not inspected) |
| TR-008 result | Same mechanism; plus `BoQAnalytics` fire-and-forget |
| EX-002 output | R2 `files/{date}/uuid-filename.xlsx` via `uploadBase64ToR2` |
| Regen counts | `Execution.metadata.regenerationCounts` JSONB (`execute-node/route.ts:286-306`) |

### 4.2 EX-001 path (massing → IFC download)

Topology (wf-08, wf-10, wf-13 all wire GN-001 or TR-001 → EX-001 via `geo-in` / `meta-in`).

1. **EX-001 receives** `inputData` merged from upstream. Path 0 reuses `ifcUrl` if GN-001 already uploaded (ex-001.ts:30-49) — but a later branch overwrites `artifact` unconditionally (comment L14-18).
2. **Geometry resolution**: Path A uses `_geometry`; Path B/C extracts via regex from `content`/`_raw.programme`.
3. **Generation attempt 1**: `generateIFCViaService(resolvedGeometry, options, filePrefix)` (L172). When the Python service is reachable, it returns a `IFCServiceResponse` with R2 download URLs already populated.
4. **Generation attempt 2 (fallback)**: `generateMultipleIFCFiles(resolvedGeometry, {projectName, buildingName})` produces 4 IFC strings. Each is base64-encoded and sent through `uploadBase64ToR2(…, "application/x-step")`. If R2 is not configured, the function returns the data URI unchanged (`r2.ts:246`) and EX-001 uses it as `downloadUrl`.
5. **Side effect**: writes through R2 client. No DB write here — the execution record is created higher up in `useExecution`.

Timeouts / retries:
- `/api/parse-ifc`: `maxDuration = 180` (route L7), fetch timeout 60 s (L110).
- `/api/upload-ifc`: `maxDuration = 60` (L7).
- `/api/execute-node`: `maxDuration = 600` (route L28).
- `ifc-service-client.ts`: `AbortSignal.timeout(30_000)` (L39, L91).
- Regen cap: `MAX_REGENERATIONS` from `@/constants/limits` (execute-node route L13).

### 4.3 WF-12 Clash Detection

```
IN-004 (IFC Upload) ──► TR-016 (Clash Detector)
```

Client path (`useExecution.ts:557-650`):
1. TR-016 requires raw file buffer, not text-parsed divisions. The client checks `inputFileStore` for the source IN-004 file.
2. Uploads primary file via `/api/upload-ifc` (multipart). If `supplementaryIFCStore` holds Structural / MEP siblings, they are uploaded too and bundled as `ifcModels: [{ifcUrl, discipline, fileName}]`.
3. TR-016 handler either (a) fetches all buffers in parallel and runs `detectClashesFromMultipleBuffers`, or (b) fetches single buffer → `detectClashesFromBuffer`.

---

## 5. Real vs Mock Matrix

| catalogueId | Name | Real / Mock | Engine | Evidence (file:line) |
|---|---|---|---|---|
| IN-004 | IFC Upload | Real (client) | `parseIFCText` + `inputFileStore` | `InputNode.tsx:124-192` |
| TR-006 | Zoning Compliance | **Not implemented** | — | Absent from `nodeHandlers` (`handlers/index.ts:40-64`), absent from `REAL_NODE_IDS` (`execute-node/route.ts:19`). Catalogue labels it "Coming Soon" (`node-catalogue.ts:184`). |
| TR-007 | Quantity Extractor | Real, LIVE | `web-ifc` WASM server-side + `parseIFCText` fallback | `handlers/tr-007.ts:252-257`; `useExecution.ts:63` in `LIVE_NODE_IDS` |
| TR-008 | BOQ / Cost Mapper | Real, LIVE | TS cost engine + Anthropic (via TR-015) + OpenAI narrative (deep in handler) | `handlers/tr-008.ts:41-…` |
| TR-009 | BIM Query Engine | **Not implemented** | — | Absent from `handlers/index.ts` and `REAL_NODE_IDS` |
| TR-010 | Delta Comparator | **Not implemented** | — | Absent from registry |
| TR-011 | Material / Carbon | **Not implemented** | — | Absent from registry |
| TR-016 | Clash Detector | Real, LIVE | `web-ifc` AABB | `clash-detector.ts:382-538` |
| GN-001 | Massing Generator (emits IFC) | Real, LIVE | `generateMassingGeometry` + `generateIFCFile` + `generateGLB` | `handlers/gn-001.ts:411-429` |
| GN-006 | IFC-to-Web Converter | **Not implemented** | — | Absent from `handlers/index.ts` and `REAL_NODE_IDS` |
| GN-012 | Floor Plan Editor (→ MassingGeometry) | Real, LIVE | TS + GPT-4o | `handlers/gn-012.ts` |
| EX-001 | IFC Exporter | Real, LIVE | Python `IfcOpenShell` (when `IFC_SERVICE_URL` set) → TS fallback | `handlers/ex-001.ts:170-233` |
| EX-004 | Speckle Publisher | **Not implemented** | — | Absent from registry |

**Catalogue/runtime disagreement flag:** `node-catalogue.ts:681` defines `LIVE_NODES = {TR-003, TR-007, TR-008, TR-015, TR-016, GN-001, GN-003, GN-007, GN-008, GN-009, GN-010, EX-001, EX-002}`. `useExecution.ts:60-74` defines a different `LIVE_NODE_IDS` that **adds** `TR-001`, `GN-012`, removes `GN-007`, `GN-008`, `EX-002`. Two sources of truth — **consider consolidating.**

**Mock executor:** `src/features/execution/services/mock-executor.ts` exists and is invoked from `useExecution.ts:46` when neither `LIVE_NODE_IDS` nor `useReal` (gated by `NEXT_PUBLIC_ENABLE_MOCK_EXECUTION !== "true"`) apply. For IFC-path nodes, the LIVE set ensures real execution always wins.

---

## 6. Known Gaps, Bugs, Tech Debt (visible in the code)

1. **EX-001 Path 0 is dead** — `ex-001.ts:30-49` assigns `artifact` when upstream `ifcUrl` exists, but the later code (L170-233) always overwrites it. The comment at L14-18 explicitly acknowledges this. The net effect: the short-circuit pass-through advertised in the file header doesn't actually happen, so every EX-001 run regenerates IFC from geometry. **Not a bug per se** — behaviour is "preserved verbatim" — but the optimisation intent is lost.

2. **WF-08 graph is incomplete** (`prebuilt-workflows.ts:21-… for wf-08`). The edges shown only connect `n1→n2→n3a/b` but no downstream walkthrough node is wired despite the `expectedOutputs` claiming a video. Review pending — I only read the first 80 lines.

3. **Two `LIVE_NODES` definitions out of sync** — see § 5 above.

4. **Text-parser import cycle risk** — `ifc-text-parser.ts:15` imports `ParserDiagnosticCounters, ElementDiagnostic` from `./ifc-parser`. `ifc-parser.ts` itself imports constants from `web-ifc` unconditionally (L14-37), so any bundle that pulls the text parser also pulls the WASM parser's type surface. Tree-shaking saves runtime but type-level coupling means the fallback is not fully independent of the WASM side.

5. **`IN-004` → TR-007 "large file" threshold is inconsistent.** `useExecution.ts:359` defines "large" as `fileData.length > 1_500_000` (≈ 1 MB binary after base64). But `InputNode.tsx:124-192` already parses *every* IFC client-side and stores `ifcParsed` regardless of size; `fileData` is cleared (L170-171). So the TR-007 large-file branch rarely fires in the happy path — it's a safety net for when `ifcParsed` is missing (loaded from old workflow snapshot, etc.). Worth documenting.

6. **Python service auth is open by default.** `app/auth.py:17-19` — if `settings.api_key` is empty, the middleware allows everything. Fine for local dev, risky in production if operators forget the env var.

7. **`IFC_SERVICE_URL` has no health pre-check.** `ifc-service-client.ts:47-113` just tries the POST and catches. On cold start (Railway / Render scales to zero), the first EX-001 call in a while will incur a >30 s TCP / boot delay and then time out (L39), silently falling back to TS. No `/ready` probe is performed.

8. **Hard-coded `emit*Geometry: false` defaults** (`ifc-exporter.ts:119-167`). The comments describe past "flying debris" incidents on non-rectangular buildings, so the TS exporter *intentionally* emits rebar, mullions, MEP segments as metadata-only (`Representation=$`). Viewers will show entity names but no geometry. **This is by design, not a bug** — it matches Govind's locked IFC visual-quality milestone from project memory — but it means the TS fallback visually differs from the Python path.

9. **Two WASM init sites** — both `ifc-parser.ts:1927-1934` and `clash-detector.ts:383-388` resolve `path.resolve(process.cwd(), "node_modules", "web-ifc")`. Works on Vercel because `web-ifc` is kept in the bundle, but any bundler change that tree-shakes `node_modules/web-ifc` breaks both at once.

10. **CSI mapping + CSI diagnostics duplicate work.** `ifc-parser.ts` owns CSI mapping (L446-650) and `tr-007.ts` re-describes results by building a second division/category structure that the client fast-path also re-aggregates (`useExecution.ts:420-482`). Three similar aggregation passes — kept in sync by hand.

11. **`neobim-ifc-service/tests/` has fixtures but no test files** (see § 2.5). The Python service ships with no automated regression coverage.

12. **`IN-004` client-side parse runs on the main thread** (`InputNode.tsx:136-192` uses `FileReader.readAsText` + synchronous `parseIFCText(text)`). For very large files this can freeze the canvas. The standalone viewer (`/dashboard/ifc-viewer`) correctly uses a Web Worker (`ifc-worker.ts`) — asymmetric design.

13. **`MAX_IFC_SIZE` drift.** `src/lib/r2.ts:34` = 100 MB. `parse-ifc/route.ts:9` = 100 MB. `upload-ifc/route.ts:38` = 100 MB. But the comment above `uploadIFCToR2` in `r2.ts:267-272` says "Max 50MB" — outdated comment.

14. **`isAllowedIfcUrl` hostname allowlist** (`parse-ifc/route.ts:33-36`) accepts any `*.r2.dev` and any `*.r2.cloudflarestorage.com` without pinning bucket or account. Trade-off: flexibility vs tighter SSRF surface.

---

## 7. External Integrations

### 7.1 web-ifc usage

- **Server (`ifc-parser.ts`, `clash-detector.ts`)**: `IfcAPI().Init()` + `OpenModel(buffer, {COORDINATE_TO_ORIGIN:true})` + `GetAllLines`, `GetLineIDsWithType`, `GetLine`, `GetModelSchema`, `StreamAllMeshes`, `GetGeometry`, `GetVertexArray`. WASM binaries served from `node_modules/web-ifc` directly (no CDN).
- **Client Web Worker (`ifc-worker.ts`)**: same API, but runs in worker scope. Transfers the `ArrayBuffer` via `postMessage(..., [buffer])` (detaches it — reason for the `ifc-cache.ts` pre-copy in `saveLastIFCFile`).
- **Pattern duplication**: IFC type IDs are redeclared in three places (`ifc-parser.ts:40-66`, `clash-detector.ts:32-…`, `ifc-worker.ts:9-41`, `Viewport.tsx:27-60`) because `import { IFCWALL } from 'web-ifc'` is only safe in Node (triggers WASM init at import time in browser). Comment at `Viewport.tsx:27` explains.

### 7.2 IfcOpenShell / Python microservice

- **Scaffolding present**: `neobim-ifc-service/` is a complete FastAPI app that can be deployed (Dockerfile ships with Python 3.11-slim + `libgomp1` + 2 uvicorn workers suiting Railway free tier).
- **Integration point**: `ifc-service-client.ts:47-113` in the Next.js app calls `POST {IFC_SERVICE_URL}/api/v1/export-ifc`. Only EX-001 uses it.
- **Not wired to TR-007.** The architecture doc `docs/ifcopenshell-microservice-architecture.md:66-80` outlines when TR-007 should call the service (geometry fallback, large files), but no such call exists in `handlers/tr-007.ts`. The doc is marked "Design Document (not yet implemented)" at L3.
- **No import of `ifcopenshell` from TypeScript code** — the only bridge is HTTP via `ifc-service-client.ts`.

### 7.3 OpenAI / Anthropic calls inside the IFC path

- **TR-008**: uses OpenAI for narrative/reasoning (not verified in full, file is 1720 LOC). Sends market data for cost justification.
- **TR-015**: Anthropic Claude + web search produces `_marketData` feeding TR-008.
- **GN-012**: `programRooms` (OpenAI GPT-4o-mini) → `generateFloorPlan` (GPT-4o) → geometry → `convertFloorPlanToMassing` → IFC shape.
- **TR-007**: **no AI calls** (pure WASM + CSI mapping).
- **TR-016**: **no AI calls** (pure AABB).
- **EX-001**: **no AI calls** — purely geometric + regex extraction.

### 7.4 File storage (R2)

- Keys used:
  - `ifc/{yyyy}/{mm}/{dd}/{uuid}-{filename}` for raw uploads (`r2.ts:290`).
  - `buildings/{yyyy}/{mm}/{dd}/{buildingId}/model.ifc` for GN-001 bundled uploads (`r2.ts:344-347`).
  - `ifc/{yyyy}/{mm}/{dd}/{filename}` from the Python service (`r2_uploader.py:41`).
- Lifetime: `CLEANUP_DAYS_IFC = 3` per constant (`r2.ts:36`), but the **cleanup cron is UNKNOWN — need to confirm**. A search for a cron that deletes `ifc/` prefix keys wasn't part of this pass.
- Fallback: every IFC upload path gracefully degrades to inline base64 data URI if R2 is unconfigured.

---

## 8. Open Items / UNKNOWN

- Whether `IN-004` client-side text parse is used in the *viewer* page or only in the *canvas* IN-004 node — likely only canvas, but `IFCViewerPage.tsx` flow past L120 wasn't traced.
- Exact Prisma persistence of `TR-007`/`TR-008` results into `Execution.tileResults` — only inferred from context.
- Existence of an R2 cleanup job for `ifc/` prefix — **UNKNOWN, need to confirm**.
- Python service tests — directory exists, files not inspected; **UNKNOWN coverage**.

---
