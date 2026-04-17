# Phase 1 Sub-Plan — Rich IFC Initiative

**Status:** Sub-plan for review. No code changes yet. Awaiting VibeCoders approval before the first commit.
**Date:** 2026-04-18
**Branch target:** `feature/rich-ifc-phase-1` — branched from `upstream/main` (not `better-3d-model`, and **not** `origin/main` which is 1097 commits behind upstream).
**Starting point:** `git fetch upstream && git checkout -b feature/rich-ifc-phase-1 upstream/main` — produces a clean branch off the current production line, avoiding the BetaBanner work still in PR #245 on `better-3d-model`.

---

## Ground-Truth Reconciliation (from live probes, not user statements)

| Claim (user) | Reality (verified) | Source |
|---|---|---|
| "Railway service is live" | ✅ HTTP 200 at `/`, uptime 27 min, git SHA `f00bc4871b0f` | `curl .../` |
| "Service returns `{service, status, version}`" | ✅ Matches exactly | `neobim-ifc-service/app/main.py:232-241` |
| "/api/v1/health endpoint is reachable and authenticated" | ⚠️ Incorrect path. `GET /api/v1/health` → **401** (auth middleware rejects before 404 can fire). Correct endpoint: `GET /health` (public, no auth), `GET /ready` (public, no auth, exercises ifcopenshell). | `curl` + `neobim-ifc-service/app/main.py:228`, `auth.py:9` PUBLIC_PATHS |
| "ifcopenshell_version" | ✅ `0.8.5`, Python 3.11.15, Linux 6.18.5 | `curl /health` |
| "API key configured on both sides" | ✅ Railway `/health` reports `api_key_configured: true`; request with auth header succeeds at `/api/v1/export-ifc` | `curl /health` |

**Consequence for Track A:** probe path is `GET {IFC_SERVICE_URL}/ready` (no `/api/v1` prefix), no Authorization header needed. Keeps the probe cheap and independent of auth correctness.

---

## Artifact Render Site Discovery

Phase 0 audit placeholder ("likely in `src/features/canvas/components/artifacts/`") — **wrong**. Actual render chain:

1. `src/app/api/execute-node/handlers/ex-001.ts:237-262` emits the artifact with `metadata: { engine, ifcServiceUsed, ... }`.
2. `src/features/execution/components/result-showcase/useShowcaseData.ts:416-426` flattens file artifacts into `FileDownload[]` — **and strips `artifact.metadata`**. Only `{name, type, size, downloadUrl, _rawContent}` survives.
3. `src/features/execution/components/result-showcase/tabs/ExportTab.tsx:210-251` maps `fileDownloads` into download cards rendered under "Download Center".
4. Canvas `src/features/canvas/components/nodes/BaseNode.tsx` — shows node-level status but does not render per-file chips for EX-001.

Track A3 must therefore touch **two** files (not one): `useShowcaseData.ts` to propagate the metadata through, and `ExportTab.tsx` to render the badge. Adjusted plan reflects this.

---

## Track A — Observability

### A1. Health probe in `ifc-service-client.ts`

**File modified:** `src/features/ifc/services/ifc-service-client.ts`

**New exports:**

```ts
export interface ServiceReadinessResult {
  ready: boolean;
  reason: "ok" | "not-configured" | "timeout" | "http-error" | "parse-error" | "network-error";
  statusCode?: number;
  latencyMs: number;
  checkedAt: number; // Date.now()
  error?: string;    // short message, not stack
}

export async function isServiceReady(timeoutMs?: number): Promise<ServiceReadinessResult>;
```

**Internal (not exported):**

```ts
const READY_CACHE_TTL_MS = 60_000;
const READINESS_CACHE = new Map<string, ServiceReadinessResult>(); // keyed by IFC_SERVICE_URL
```

**Behavior:**
- If `IFC_SERVICE_URL` unset → return `{ready:false, reason:"not-configured", latencyMs:0, checkedAt:Date.now()}` without any network I/O.
- Check `READINESS_CACHE` keyed by URL. If fresh (`<60s`), return cached.
- Otherwise `fetch(\`${IFC_SERVICE_URL}/ready\`, { signal: AbortSignal.timeout(timeoutMs ?? 5000) })`. **No Authorization header** (endpoint is public per `auth.py:9`).
- Success = HTTP 200 AND parsed body has `ready === true`.
- Cache the result (success or failure) for 60 s.
- Never throws — all error paths return a `ServiceReadinessResult`.

**Deviation from prompt:** prompt said "exported function `isServiceReady`" returning `Promise<boolean>`. I'm returning `Promise<ServiceReadinessResult>` because downstream (A2 metadata, A5 getServiceHealthStatus) needs `latencyMs` and `reason` without a second probe. Boolean convenience: callers can do `(await isServiceReady()).ready`. **Flag for approval** — small change, bigger observability payoff.

### A2. Gate the Python attempt in `ex-001.ts`

**File modified:** `src/app/api/execute-node/handlers/ex-001.ts`

**Insertion point:** immediately before the existing `try { ... }` at L170.

**New logic (pseudocode — actual implementation in Commit A2):**

```ts
const probeStart = Date.now();
const readiness = await isServiceReady(5_000);
const probeMs = Date.now() - probeStart;

if (!readiness.ready) {
  logger.debug("[EX-001] skipping python path", { reason: readiness.reason });
  // skip try-block entirely → go straight to TS fallback at L200
  // ifcServiceUsed stays false
  // stamp metadata.ifcServiceSkipped = true, metadata.ifcServiceSkipReason = readiness.reason
  // stamp metadata.ifcServiceProbeMs = probeMs
} else {
  // existing flow L170-194 runs
  // also stamp metadata.ifcServiceProbeMs = probeMs
}
```

**New fields added to `artifact.metadata` (L254-260):**
- `ifcServiceProbeMs: number` — always present
- `ifcServiceSkipped: boolean` — true if probe failed (skip path taken)
- `ifcServiceSkipReason: ServiceReadinessResult["reason"] | undefined` — only when skipped
- `ifcServicePath: "python" | "ts-fallback"` — explicit, derived from `ifcServiceUsed`

**Back-compat:** existing `metadata.engine` and `metadata.ifcServiceUsed` unchanged.

### A3. Rich/Lean badge in UI — **two-file change**

**File 1 modified:** `src/features/execution/components/result-showcase/useShowcaseData.ts`

At L416-426, extend `FileDownload` to carry IFC metadata:

```ts
// Extend the existing FileDownload interface (L37-45):
export interface FileDownload {
  name: string;
  type: string;
  size: number;
  downloadUrl?: string;
  _rawContent?: string;
  // Phase 1 additions — populated only for EX-001 IFC artifacts, undefined otherwise
  ifcEngine?: "ifcopenshell" | "ifc-exporter";
  ifcServiceUsed?: boolean;
  ifcServiceSkipReason?: string;
}
```

At L417-426, read `a.metadata` alongside `a.data` and forward the IFC fields. Group files by their parent `artifactId` so all 4 discipline files carry the same metadata from one EX-001 run.

**File 2 modified:** `src/features/execution/components/result-showcase/tabs/ExportTab.tsx`

Around L210-251, inside the `data.fileDownloads.forEach` loop, detect IFC artifacts and append a badge component to the download card. Badge is a small pill shown adjacent to the file icon:

```ts
// New component — render inside the download card when file.ifcEngine is present
function IfcEngineBadge({ engine, skipReason }: { engine?: string; skipReason?: string }) {
  if (!engine) return null;
  const isRich = engine === "ifcopenshell";
  // colors from existing COLORS (result-showcase/constants.ts)
  // icon: Sparkles (rich) or AlertTriangle (lean), from lucide-react
  // tooltip: "Python service unavailable. Rebar, curtain walls, full MEP may be reduced. Ask admin to check IFC_SERVICE_URL." when !isRich
}
```

**Colors (must use existing tokens):**
- Rich chip: `COLORS.EMERALD` + `${COLORS.EMERALD}20` bg — same token used for "Execution complete" at ExportTab.tsx:283-289.
- Lean chip: `COLORS.AMBER` or equivalent from `result-showcase/constants.ts` (verify token exists at implementation time).

**Deviation from prompt:** prompt said "find the EX-001 artifact card renderer ... likely in src/features/canvas/components/artifacts/". Actual render site is `execution/result-showcase/tabs/ExportTab.tsx`. Canvas `artifacts/` holds *viewers*, not download chips. Reason documented above under "Render Site Discovery".

### A4. Document env vars in `.env.example`

**File modified:** `.env.example`

**Insertion point:** new block after line 65 (`ML_SERVICE_URL`), before the `FAL_KEY` block.

```bash
# ============================================================
# NeoBIM IFC Service (Python, FastAPI, ifcopenshell)
# Source: neobim-ifc-service/ — see README.md for deploy notes.
# When set, EX-001 generates IFC4 files via this service (richer geometry,
# proper openings, material layer sets). When unset or unreachable, EX-001
# silently falls back to the built-in TypeScript exporter.
# ============================================================
IFC_SERVICE_URL="https://buildflow-python-server.up.railway.app"
IFC_SERVICE_API_KEY="your-shared-secret-matching-railway-side"
```

### A5. Tiny monitoring helper

**New file:** `src/features/ifc/services/ifc-service-health.ts` (~40 LOC)

```ts
import { isServiceReady, type ServiceReadinessResult } from "./ifc-service-client";

export interface ServiceHealthStatus {
  ready: boolean;
  latencyMs: number;
  lastChecked: number;
  lastError?: string;
  reason: ServiceReadinessResult["reason"];
}

export async function getServiceHealthStatus(
  timeoutMs?: number,
): Promise<ServiceHealthStatus>;
```

Thin wrapper over `isServiceReady` that transforms the result into the shape a future admin dashboard would consume. No UI wiring in Phase 1.

---

## Track B — Plumb rich flags through EX-001

### B1. richMode env + override in `ex-001.ts`

**File modified:** `src/app/api/execute-node/handlers/ex-001.ts`

**New helper (private to this file, inserted above `handleEX001`):**

```ts
type RichMode = "off" | "arch-only" | "mep" | "structural" | "full";

interface RichFlags {
  emitRebarGeometry: boolean;
  autoEmitDemoContent: boolean;
  emitCurtainWallGeometry: boolean;
  emitMEPGeometry: boolean;
}

function resolveRichMode(inputData: unknown): { mode: RichMode; flags: RichFlags; source: "override" | "env" | "default" };

function richModeToFlags(mode: RichMode): RichFlags;
```

**Resolution order:**
1. `inputData.richMode` (if a valid RichMode string) → `source = "override"`
2. `process.env.IFC_RICH_MODE` (if a valid RichMode string) → `source = "env"`
3. `"off"` → `source = "default"`

**Mode → flag mapping (exact, matching prompt):**

| mode | emitRebar | autoEmitDemo | emitCurtainWall | emitMEP |
|---|---|---|---|---|
| `off` | false | false | false | false |
| `arch-only` | false | false | **true** | false |
| `mep` | false | **true** | false | **true** |
| `structural` | **true** | false | false | false |
| `full` | **true** | **true** | **true** | **true** |

**Applied at L202-204** (the `genMulti(...)` call): extend the options object with the four flags.

**Default `"off"` preserves current production behaviour byte-for-byte.**

### B2. Forward richMode to Python service

**File modified:** `src/features/ifc/services/ifc-service-client.ts`

**`generateIFCViaService` signature change (additive):**

```ts
export async function generateIFCViaService(
  geometry: MassingGeometry,
  options: {
    projectName: string;
    buildingName: string;
    author?: string;
    richMode?: RichMode; // NEW — optional
  },
  filePrefix: string,
): Promise<IFCServiceResponse | null>;
```

`richMode` is forwarded in the request body under `options.rich_mode` (snake_case). The Python `ExportOptions` at `neobim-ifc-service/app/models/request.py:136-146` **does not declare this field**, and Pydantic by default IGNORES extra fields (verified: `ExportOptions` has no `model_config = {"extra": "forbid"}`). So the Python service will silently accept and drop it. **This is intentional** — Phase 1 is TS-side only; Phase 2+ adds Python consumption.

**No Python code change in Track B.** Only a docs note in Python request.py acknowledging `rich_mode` is expected from Phase 2+.

### B3. Integration test

**New file:** `tests/integration/ifc-rich-mode.test.ts`

**Test matrix:** 5 cases × assertion per mode.

```ts
describe("EX-001 richMode plumbing", () => {
  // mocks generateMultipleIFCFiles to a spy; asserts the received options
  // carries the expected four flags for each richMode value.
  test.each([
    ["off",        { rebar: false, demo: false, cw: false, mep: false }],
    ["arch-only",  { rebar: false, demo: false, cw: true,  mep: false }],
    ["mep",        { rebar: false, demo: true,  cw: false, mep: true  }],
    ["structural", { rebar: true,  demo: false, cw: false, mep: false }],
    ["full",       { rebar: true,  demo: true,  cw: true,  mep: true  }],
  ])("mode %s produces expected flags", async (mode, expected) => { ... });
});
```

Uses Vitest + `vi.mock` on `@/features/ifc/services/ifc-exporter` to intercept `generateMultipleIFCFiles` without actually running the 6,328-LOC STEP writer.

### B4. Structured EX-001 log line

**Location:** `ex-001.ts`, end of handler, before `return artifact`.

```ts
const totalMs = Date.now() - ex001Start; // new local at handler top
logger.info("[ex-001] completed", {
  richMode: richMode.mode,
  richModeSource: richMode.source,
  path: ifcServiceUsed ? "python" : "ts-fallback",
  probeMs,
  totalMs,
  filesGenerated: files.length,
  totalBytes: files.reduce((s, f) => s + f.size, 0),
  skipped: readiness.ready ? false : true,
  skipReason: readiness.ready ? undefined : readiness.reason,
});
```

Single line, JSON-structured via existing `logger`. Vercel logs parse it easily.

---

## Track C — Input surface extension

### C1a–c. Extend `src/types/geometry.ts` ElementProperties

**File modified:** `src/types/geometry.ts` (currently 128 LOC).

All new fields **OPTIONAL**, appended inside `GeometryElement.properties` (L30-75). Each gets a JSDoc comment naming the consumer.

**Architectural block** (C1a):

```ts
/** Fire rating in minutes. Consumer: TS exporter Pset_WallCommon.FireRating (ifc-exporter.ts ~L2400) — overrides default "REI 120" exterior / "EI 60" interior. */
fireRatingMinutes?: number;
/** Acoustic rating in dB. Consumer: TS exporter Pset_WallCommon.AcousticRating (not yet emitted — Phase 2 add). */
acousticRatingDb?: number;
/** Thermal transmittance (U-value) in W/m²K. Consumer: Pset_WallCommon.ThermalTransmittance (currently hard-coded 0.25 at property_sets.py:75). */
thermalUValue?: number;
/** External classification code. Consumer: TS exporter IfcClassificationReference emitters (ifc-exporter.ts:2049, 5405). */
classificationCode?: string;
/** Classification system selector. Consumer: same emitters; must match one of the mapping tables at ifc-exporter.ts:6121-6196. */
classificationSystem?: "CSI" | "Uniclass" | "OmniClass" | "NBC" | "Uniformat";
/** Logical zone this element belongs to. Consumer: reserved for Phase 4 IfcZone emission; TS exporter currently ignores. */
zoneName?: string;
/** Explicit load-bearing flag. Consumer: Pset_WallCommon.LoadBearing (currently derived from isPartition at property_sets.py:68). */
isLoadBearing?: boolean;
```

**Structural block** (C1b):

```ts
/** Material grade string. Consumer: TS exporter emitMaterialPhysicsPsets (ifc-exporter.ts:1806) — "M30" → concrete Pset_ConcreteElementGeneral; "Fe500" → Pset_SteelElementGeneral. */
materialGrade?: string;
/** Profile reference. Consumer: TS exporter Indian IS-808 section selector (ifc-exporter.ts:2304 area, Fix 11). "ISMB 450", "rectangular-300x450". */
profileType?: string;
/** Uniformly distributed design load, kN/m. Consumer: Phase 3 Python IfcStructuralLinearAction (not yet emitted). TS exporter ignores. */
designLoadKnPerM?: number;
/** Point or axial design load, kN. Consumer: Phase 3 Python IfcStructuralPointAction. TS exporter ignores. */
designLoadKn?: number;
/** Span behaviour. Consumer: Phase 3 Python structural model. TS exporter ignores. */
spanType?: "simple" | "continuous" | "cantilever";
/** Support type at element ends. Consumer: Phase 3 Python IfcBoundaryCondition. TS exporter ignores. */
supportType?: "fixed" | "pinned" | "roller";
/** Reinforcement ratio as a fraction of cross-section area (e.g. 0.015 = 1.5 %). Consumer: TS exporter rebar bar specs generator (ifc-exporter.ts:864, 4196). */
rebarRatio?: number;
/** Explicit rebar layout. Consumer: TS exporter IfcReinforcingBar emitter (ifc-exporter.ts:4241) when emitRebarGeometry flag is true. */
rebarSpec?: {
  mainBars?: { diameterMm: number; count: number };
  stirrups?: { diameterMm: number; spacingMm: number };
};
```

**MEP block** (C1c):

```ts
/** Human-readable system name. Consumer: TS exporter emitMEPSystemAssignments (ifc-exporter.ts:1801); groups elements into IfcDistributionSystem. */
systemName?: string;
/** IFC4 IfcDistributionSystemEnum literal value. */
systemPredefinedType?: string;
/** Port flow direction. Consumer: TS exporter emitMEPPortConnectivity (ifc-exporter.ts:5730) — currently synthesises SOURCE/SINK chains; this field lets upstream override. */
flowDirection?: "source" | "sink" | "bidirectional";
/** Upstream element ID for port connectivity topology. Phase 4 consumer. */
upstreamElementId?: string;
/** Downstream element IDs. Phase 4 consumer. */
downstreamElementIds?: string[];
/** Diameter in millimetres — QS-tool friendly. When present, takes precedence over the existing `diameter` field (meters). Consumer: TS exporter MEP profile generator (ifc-exporter.ts:3664). */
diameterMm?: number;
/** Duct/tray cross-section width in mm. */
widthMm?: number;
/** Duct/tray cross-section height in mm. */
heightMm?: number;
/** Insulation thickness in mm. Consumer: Phase 4 Pset_DuctSegmentInsulation. */
insulationThicknessMm?: number;
/** Design flow rate. Units deliberately unspecified; carrier, depends on system type. */
designFlowRate?: number;
/** Design pressure. Units as above. */
designPressure?: number;
```

### C2. New `GeometryElement.type` literals

**File modified:** `src/types/geometry.ts` — extend the union at L20-22.

Adds **13 new literals**:

```ts
type: "wall" | "slab" | "column" | "roof" | "space" | "window" | "door" | "beam" | "stair"
    | "balcony" | "canopy" | "parapet" | "duct" | "pipe" | "cable-tray" | "equipment"
    | "mullion" | "spandrel"
    // ── Phase 1 additions ──
    | "roof-element"          // dedicated IfcRoof emission vs existing "roof" → IfcSlab(ROOF)
    | "railing"
    | "curtain-wall"
    | "furniture"
    | "foundation"
    | "shear-wall"
    | "bracing"
    | "rebar-group"
    | "duct-fitting"
    | "pipe-fitting"
    | "valve"
    | "flow-terminal"
    | "equipment-hvac"
    | "equipment-plumbing"
    | "equipment-electrical"
    | "air-terminal"
    | "sanitary-terminal"
    | "electrical-fixture"
    | "lighting-fixture"
    | "junction-box"
```

Existing "roof" literal is **preserved verbatim**. New "roof-element" is for the future case where GN-001 emits a dedicated IfcRoof entity (vs current IfcSlab+PredefinedType=ROOF at slab_builder.py:27-32).

### C3. Mirror all new fields in `request.py`

**File modified:** `neobim-ifc-service/app/models/request.py`

**ElementProperties (L31-62) additions** — all `Optional[...]` with `Field(alias="camelCase", default=None)`:

```python
# Architectural
fire_rating_minutes: Optional[int] = Field(alias="fireRatingMinutes", default=None)
acoustic_rating_db: Optional[int] = Field(alias="acousticRatingDb", default=None)
thermal_u_value: Optional[float] = Field(alias="thermalUValue", default=None)
classification_code: Optional[str] = Field(alias="classificationCode", default=None)
classification_system: Optional[Literal["CSI", "Uniclass", "OmniClass", "NBC", "Uniformat"]] = Field(alias="classificationSystem", default=None)
zone_name: Optional[str] = Field(alias="zoneName", default=None)
is_load_bearing: Optional[bool] = Field(alias="isLoadBearing", default=None)

# Structural
material_grade: Optional[str] = Field(alias="materialGrade", default=None)
profile_type: Optional[str] = Field(alias="profileType", default=None)
design_load_kn_per_m: Optional[float] = Field(alias="designLoadKnPerM", default=None)
design_load_kn: Optional[float] = Field(alias="designLoadKn", default=None)
span_type: Optional[Literal["simple", "continuous", "cantilever"]] = Field(alias="spanType", default=None)
support_type: Optional[Literal["fixed", "pinned", "roller"]] = Field(alias="supportType", default=None)
rebar_ratio: Optional[float] = Field(alias="rebarRatio", default=None)

# rebarSpec as a nested model
class RebarBarSpec(BaseModel):
    diameter_mm: float = Field(alias="diameterMm")
    count: int
    model_config = {"populate_by_name": True}

class RebarStirrupSpec(BaseModel):
    diameter_mm: float = Field(alias="diameterMm")
    spacing_mm: float = Field(alias="spacingMm")
    model_config = {"populate_by_name": True}

class RebarSpec(BaseModel):
    main_bars: Optional[RebarBarSpec] = Field(alias="mainBars", default=None)
    stirrups: Optional[RebarStirrupSpec] = Field(alias="stirrups", default=None)
    model_config = {"populate_by_name": True}

rebar_spec: Optional[RebarSpec] = Field(alias="rebarSpec", default=None)

# MEP
system_name: Optional[str] = Field(alias="systemName", default=None)
system_predefined_type: Optional[str] = Field(alias="systemPredefinedType", default=None)
flow_direction: Optional[Literal["source", "sink", "bidirectional"]] = Field(alias="flowDirection", default=None)
upstream_element_id: Optional[str] = Field(alias="upstreamElementId", default=None)
downstream_element_ids: Optional[list[str]] = Field(alias="downstreamElementIds", default=None)
diameter_mm: Optional[float] = Field(alias="diameterMm", default=None)
width_mm: Optional[float] = Field(alias="widthMm", default=None)
height_mm: Optional[float] = Field(alias="heightMm", default=None)
insulation_thickness_mm: Optional[float] = Field(alias="insulationThicknessMm", default=None)
design_flow_rate: Optional[float] = Field(alias="designFlowRate", default=None)
design_pressure: Optional[float] = Field(alias="designPressure", default=None)
```

**`ElementType` Literal (L67-71) additions** — extend with:

```
"roof-element", "railing", "curtain-wall", "furniture",
"foundation", "shear-wall", "bracing", "rebar-group",
"duct-fitting", "pipe-fitting", "valve", "flow-terminal",
"equipment-hvac", "equipment-plumbing", "equipment-electrical",
"air-terminal", "sanitary-terminal", "electrical-fixture",
"lighting-fixture", "junction-box",
"mullion", "spandrel"  # ← Phase 0 audit's latent bug fix
```

**Note:** the new `IfcTypeStr` values that these types *would* map to (IfcRoof, IfcRailing, IfcCurtainWall, IfcFurniture, IfcFooting, IfcDuctFitting, IfcPipeFitting, IfcValve, IfcFlowController, IfcReinforcingBar, IfcReinforcingMesh, IfcMaterialProfileSet) are **NOT** added to `IfcTypeStr` in C3 — that's Phase 2 territory (new Python builders will consume these). Phase 1 only accepts the new `type` literal; actual entity creation happens in Phase 2+ when builders are added. Until then, Python `ifc_builder.py` will hit the final `except Exception as e: log.warning("element_creation_failed"...)` branch and skip them — **additive, no regression**.

### C4. Forward new fields in `ifc-service-client.ts`

No code change needed — the client already posts `geometry` verbatim (`ifc-service-client.ts:61-80`). Only add an assertion test:

**New file:** `tests/integration/ifc-service-client-forwards-new-fields.test.ts`

Mocks `fetch`, sends a `GeometryElement` with `materialGrade: "M30"` and `systemName: "Supply Air 1"`, asserts the outbound body includes those keys (in camelCase since the TS client sends TS-shaped JSON and Python `populate_by_name: true` accepts both).

### C5. Backward-compat verification

Run in CI for every commit in Track C:
- `npx tsc --noEmit` — zero new errors.
- `npm test` — all existing tests pass.
- Python local:
  ```bash
  cd neobim-ifc-service && uvicorn app.main:app --port 8000
  curl -X POST http://localhost:8000/api/v1/export-ifc \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer $IFC_SERVICE_API_KEY" \
       -d @tests/fixtures/sample_geometry.json
  ```
  Expect: 200 with 4 discipline files. Sample geometry has zero new fields, so Pydantic acceptance with additions must not regress.

---

## Track D — Baseline fixtures

### D1. Python-path baseline

**Procedure:**
1. Start local Python service: `cd neobim-ifc-service && uvicorn app.main:app --port 8000`.
2. POST `tests/fixtures/sample_geometry.json` (the existing 3-storey office fixture).
3. Save response `files[].download_url` contents — but since R2 upload will happen, save the **raw bytes before R2 upload** by writing a small local-only helper script (see D4).
4. Target: `neobim-ifc-service/tests/fixtures/baseline/phase0/{architectural,structural,mep,combined}.ifc`

### D2. TS-fallback baseline

**Procedure — one-off script, not checked in as a test:**
- `scripts/generate-ts-baseline.mjs` (new). Imports `generateMultipleIFCFiles` directly from `src/features/ifc/services/ifc-exporter.ts` via `tsx`. Runs with each `richMode`:
  ```
  ts_off_{arch,struct,mep,combined}.ifc
  ts_full_{arch,struct,mep,combined}.ifc
  ```
- Target: `neobim-ifc-service/tests/fixtures/baseline/phase0/`

**Why both richMode values at baseline:** the whole point of Phase 1 is to make `IFC_RICH_MODE=full` do something observable. Committing `ts_off_*` and `ts_full_*` establishes the before/after contrast for every subsequent phase.

### D3. Entity-count report

**New file:** `neobim-ifc-service/tests/fixtures/baseline/phase0/entity_counts.md`

Table rendered from the output of D4 run on each of the 12 fixture files:

```markdown
| File | IfcWall | IfcSlab | IfcColumn | IfcBeam | ... | IfcStructuralAnalysisModel | IfcDistributionPort | IfcRelConnectsPorts | IfcDuctFitting | IfcPipeFitting | IfcValve | IfcReinforcingBar | IfcCurtainWall | IfcClassificationReference | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| python/architectural.ifc | ... |
| python/structural.ifc | ... |
...
| ts_off_architectural.ifc | ... |
| ts_full_architectural.ifc | ... |
```

This IS the baseline. Phase 2+ acceptance gate = "counts don't regress AND new capability columns fill in".

### D4. `scripts/count-ifc-entities.py`

**New file.** ~60 LOC. Uses `ifcopenshell`:

```python
#!/usr/bin/env python3
"""Emit a JSON summary of IFC entity counts for baseline/diff checks."""
import json, sys, ifcopenshell
# ... argparse for input path + optional --pretty flag
# for each of ~25 target entity classes: model.by_type(class) → count
# emit JSON {file, schema, total_entities, by_type: {...}}
```

Importable too — future phases call `from scripts.count_ifc_entities import count_entities`.

### D5. Regeneration recipe

**New file:** `docs/ifc-baseline-regeneration.md`

1-page how-to for regenerating the 12 baseline fixtures when input changes. References D1, D2, D4.

---

## Proposed Commit Sequence

The prompt lists 20 commits. Observed issues + my proposed adjustments:

| # | Prompt's commit | Status | Note |
|---|---|---|---|
| 1 | `docs: commit RICH_IFC_IMPLEMENTATION_PLAN.md (after .gitignore exception)` | **BLOCKED by your "no .md commits" directive** | See Deviation #1 |
| 2 | `docs: commit phase 0 audit` | **BLOCKED by your "no .md commits" directive** | See Deviation #1 |
| 3 | `chore(env): document IFC_SERVICE_URL + IFC_SERVICE_API_KEY in .env.example` (A4) | OK | First commit that ships — env doc |
| 4 | `feat(ifc-service): add isServiceReady health probe` (A1) | OK | — |
| 5 | `feat(ex-001): gate Python call behind pre-flight probe` (A2) | OK | depends on #4 |
| 6 | `feat(ui): surface ifcServiceUsed as badge on EX-001 artifact` (A3) | OK | touches 2 files per discovery above |
| 7 | `feat(obs): expose getServiceHealthStatus helper` (A5) | OK | tiny |
| 8 | `feat(ifc): plumb richMode flags through ex-001 → generateMultipleIFCFiles` (B1) | OK | — |
| 9 | `feat(ifc): forward richMode to Python service` (B2) | OK | — |
| 10 | `test: ifc-rich-mode integration test` (B3) | OK | — |
| 11 | `feat(obs): structured EX-001 execution log line` (B4) | OK | — |
| 12 | `feat(types): extend ElementProperties with architectural fields` (C1a) | OK | — |
| 13 | `feat(types): extend ElementProperties with structural fields` (C1b) | OK | — |
| 14 | `feat(types): extend ElementProperties with MEP fields` (C1c) | OK | — |
| 15 | `feat(types): add new GeometryElement.type literals` (C2) | OK | **MUST land AFTER #16** so TS+Python move together — will propose swap |
| 16 | `feat(python): mirror new input fields in request.py` (C3) | OK | — |
| 17 | `test: assert new fields survive TS→Python boundary` (C4) | OK | — |
| 18 | `chore(fixtures): add baseline IFC fixtures + entity count report` (D1–D3) | OK | requires Python service running locally |
| 19 | `chore(scripts): add count-ifc-entities.py` (D4) | OK | should land BEFORE #18 so #18 can run it |
| 20 | `docs: baseline regeneration recipe` (D5) | **BLOCKED by "no .md commits"** | See Deviation #1 |

**Suggested reordering:**
- Swap #15 ↔ #16 (Python type literal lands first; TS type literal lands second — keeps Python-side strict while TS is loose).
- Move #19 before #18 (script before fixtures that use it).

**Final proposed order:**
3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, **16, 15**, 17, **19, 18**, and conditionally 1, 2, 20 depending on Deviation #1 resolution.

---

## Deviations from the Prompt (require VibeCoders approval)

### Deviation #1 — `.md` commit conflict

**Context:** prompt commit #1 is "docs: commit RICH_IFC_IMPLEMENTATION_PLAN.md (after .gitignore exception)"; commit #2 is "docs: commit phase 0 audit"; commit #20 is "docs: baseline regeneration recipe". Three turns ago you said **"do not commit and push .md files on main production"**. Six hours ago you undid my audit commit for that reason.

**The conflict cannot be silently resolved.** Options:
- **(a)** You've reversed position AGAIN and want the .md files committed — please confirm explicitly. If yes, the `.gitignore` `*_PLAN.md` re-enable needs to land first (one-line commit).
- **(b)** The .md files stay uncommitted — prompts #1, #2, #20 are dropped. Phase 1 still ships: A/B/C/D tracks don't depend on any doc commit. Reports and plans live on disk only.
- **(c)** Commit .md files to a **separate** branch that **does not** PR to main — e.g. `docs/ifc-phase-1-planning` with no PR. Never merges, never deploys, just preserves history.

My recommendation: **(b)**. Phase 1 is a large code change; don't pollute its PR with docs your production policy excludes. If you want the docs preserved, use (c).

### Deviation #2 — `isServiceReady` return type

Prompt said `Promise<boolean>`. Sub-plan returns `Promise<ServiceReadinessResult>`. Justification under A1 above — saves a second probe for A5 / metadata stamping, callers can trivially do `(await isServiceReady()).ready` for the boolean case.

### Deviation #3 — A3 touches two files, not one

Prompt assumed artifact card lives in `src/features/canvas/components/artifacts/`. Actual chain is `ex-001.ts` → `useShowcaseData.ts` → `ExportTab.tsx`. The strip between artifact metadata and the rendered `FileDownload` must be widened. Two files modified instead of one. Still one commit.

### Deviation #4 — Commit reordering

Swaps #15↔#16 and #18↔#19 as justified in the commit sequence table above. Net: 20 commits, same content, safer landing order.

### Deviation #5 — `richMode` sent to Python but not consumed in Phase 1

Prompt says "The Python service does not consume these flags today and will ignore them safely (Pydantic extra='ignore' by default, but verify in request.py)."

**Verified:** `neobim-ifc-service/app/models/request.py:145-146` declares `model_config = {"populate_by_name": True}` but does **not** set `extra`. Pydantic v2 default is `extra='ignore'` — extras are silently dropped. So forwarding `rich_mode` is safe today. **However**, if anyone tightens `extra='forbid'` in Phase 2+ without adding `rich_mode` to `ExportOptions`, every EX-001 call breaks. Phase 1 will leave a code comment in `request.py` reserving the field.

### Deviation #6 — Branch parent

Prompt says "Branch off main: feature/rich-ifc-phase-1". Local `main` is 1097 commits behind upstream/main. I'll branch from **`upstream/main` directly**, not local `main` or `origin/main`. Command: `git fetch upstream && git checkout -b feature/rich-ifc-phase-1 upstream/main`.

### Deviation #7 — Endpoint path clarification

Prompt said "Calls GET {IFC_SERVICE_URL}/api/v1/ready" with the caveat "if the path is /ready not /api/v1/ready, use whichever the service actually serves". Confirmed: correct path is **`/ready`** (no prefix, no auth). Sub-plan uses that.

---

## Files Created or Modified (full summary)

### Created
- `src/features/ifc/services/ifc-service-health.ts` (A5, ~40 LOC)
- `tests/integration/ifc-rich-mode.test.ts` (B3)
- `tests/integration/ifc-service-client-forwards-new-fields.test.ts` (C4)
- `scripts/generate-ts-baseline.mjs` (D2, local-only utility)
- `scripts/count-ifc-entities.py` (D4)
- `neobim-ifc-service/tests/fixtures/baseline/phase0/architectural.ifc` (D1)
- `neobim-ifc-service/tests/fixtures/baseline/phase0/structural.ifc` (D1)
- `neobim-ifc-service/tests/fixtures/baseline/phase0/mep.ifc` (D1)
- `neobim-ifc-service/tests/fixtures/baseline/phase0/combined.ifc` (D1)
- `neobim-ifc-service/tests/fixtures/baseline/phase0/ts_off_{a,s,m,c}.ifc` (D2)
- `neobim-ifc-service/tests/fixtures/baseline/phase0/ts_full_{a,s,m,c}.ifc` (D2)
- `neobim-ifc-service/tests/fixtures/baseline/phase0/entity_counts.md` (D3)
- `docs/ifc-baseline-regeneration.md` (D5, status depends on Deviation #1)
- `docs/ifc-phase-1-completion.md` (final deliverable, status depends on Deviation #1)

### Modified
- `.env.example` (A4)
- `src/features/ifc/services/ifc-service-client.ts` (A1 + B2)
- `src/app/api/execute-node/handlers/ex-001.ts` (A2 + B1 + B4)
- `src/features/execution/components/result-showcase/useShowcaseData.ts` (A3)
- `src/features/execution/components/result-showcase/tabs/ExportTab.tsx` (A3)
- `src/types/geometry.ts` (C1 + C2)
- `neobim-ifc-service/app/models/request.py` (C3)

### Explicitly untouched (per "out of scope" list)
- All files under `neobim-ifc-service/app/services/*_builder.py`
- `neobim-ifc-service/app/routers/`
- `neobim-ifc-service/app/middleware.py`
- `src/features/ifc/services/ifc-exporter.ts` — options interface changes NOT needed; existing `IFCExportOptions` already has the four flags. Plumbing happens upstream in `ex-001.ts`.

---

## Verification Hooks (where VibeCoders validates)

After each cluster (A, B, C, D), I'll report status and stop. You run:

**A:**
- `npm run dev`, trigger EX-001 end-to-end. Verify green chip.
- Restart without `IFC_SERVICE_URL`, re-run. Verify amber chip + tooltip.
- Curl the deployed Railway `/ready` from local to confirm probe target is identical.

**B:**
- `IFC_RICH_MODE=full npm run dev`, trigger EX-001, open combined.ifc in BlenderBIM. Expect to see more IfcDistributionPort + IfcRelConnectsPorts + IfcCurtainWall + IfcReinforcingBar entities vs default.

**C:**
- `npx tsc --noEmit` — zero new errors.
- `npm test` — all green.
- Local Python service accepts sample_geometry.json unchanged.
- Local Python service accepts a geometry WITH new fields — verifies round-trip.

**D:**
- Fixtures present in `neobim-ifc-service/tests/fixtures/baseline/phase0/`.
- `python scripts/count-ifc-entities.py <any fixture>.ifc` produces a JSON table.
- `entity_counts.md` renders in GitHub preview.

---

## Questions Flagged for VibeCoders

1. **Deviation #1** — are the three `.md` commits (plan, audit, regeneration recipe) in or out of the Phase 1 PR? My default is out; confirm or override.
2. **Deviation #2** — is the richer `ServiceReadinessResult` return type OK, or do you want strict `Promise<boolean>`?
3. **Sub-plan commit** — this document (`docs/ifc-phase-1-subplan.md`) is a new .md file. Per your directive, it stays local only. Confirm.
4. **Feature flag defaults** — `IFC_RICH_MODE` defaults to `off`. Production behavior is therefore unchanged unless VibeCoders explicitly sets the env var after Phase 1 merges. Confirm that's the deployment model.
5. **Python extra='ignore'** — do you want Phase 1 to pre-declare `rich_mode` in `ExportOptions` (as `Optional[str]`, currently unused) rather than rely on silent drop? Adds one line, prevents a Phase 3+ regression. Weak preference: yes, declare it.

---

## Status

**Sub-plan complete. Zero code changes. Zero commits. Awaiting VibeCoders approval on the 5 flagged questions before first commit (which per Deviation #1 will be commit #3 `chore(env): document IFC_SERVICE_URL + IFC_SERVICE_API_KEY in .env.example` unless you flip #1).**

On your go-ahead I will:
1. Create branch `feature/rich-ifc-phase-1` from `upstream/main`.
2. Begin Track A commits in order: 3 → 4 → 5 → 6 → 7.
3. Stop and report after the last Track A commit.
