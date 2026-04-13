# IfcOpenShell Microservice Architecture

**Status:** Design Document (not yet implemented)
**Author:** BuildFlow Engineering
**Date:** April 2026
**Relates to:** Phase 5 of IFC-to-BOQ Accuracy Improvement Roadmap

---

## 1. Problem Statement

Our web-ifc WASM parser (`src/features/ifc/services/ifc-parser.ts`) handles ~80% of IFC files well but fails on three critical scenarios:

| Scenario | Root Cause | Impact on BOQ |
|---|---|---|
| **Complex geometry** (IfcBooleanResult, IfcFacetedBrep, IfcAdvancedBrep) | web-ifc only processes IfcExtrudedAreaSolid; skips boolean/brep geometry | Volume/area = 0 for affected elements, underestimating costs by 10-30% |
| **Large files** (>30MB) | Vercel serverless has 1GB memory limit; WASM memory model amplifies usage ~4x | Parse crashes, entire BOQ fails |
| **Non-standard authoring tools** (SketchUp, Rhino, Grasshopper exports) | These tools use IfcFacetedBrep/IfcTriangulatedFaceSet instead of extrusions | Most elements get count-only (no area/volume), provisional sums dominate |

IfcOpenShell (Python, C++ geometry kernel underneath) handles all of these correctly. It is the gold standard for server-side IFC processing, used by Solibri, BlenderBIM, and most open BIM tools.

---

## 2. Service Architecture

### Recommendation: **FastAPI** (not Flask)

| Criteria | Flask | FastAPI | Decision |
|---|---|---|---|
| Async support | Requires Gunicorn + gevent | Native async/await | FastAPI |
| Request validation | Manual | Pydantic auto-validation | FastAPI |
| File upload handling | Manual multipart | Built-in `UploadFile` | FastAPI |
| OpenAPI docs | Flask-RESTX addon | Auto-generated | FastAPI |
| Performance | ~2x slower on benchmarks | Starlette-based, production-grade | FastAPI |
| IfcOpenShell compatibility | Works | Works | Tie |
| Typing | Optional | First-class Pydantic models | FastAPI |

**FastAPI wins** on every criterion that matters for a file-processing microservice.

### High-Level Architecture

```
                         BuildFlow (Next.js on Vercel)
                                    |
                         TR-007 Quantity Extractor
                           /        |         \
                     web-ifc    IfcOpenShell    text-regex
                     (WASM)    (microservice)   (fallback)
                       |            |               |
                     [fast,       [slower,        [fastest,
                      simple]      accurate]       least accurate]
                                    |
                              ┌─────┴──────┐
                              │  FastAPI    │
                              │  Python 3.11│
                              │  IfcOpenShell│
                              │  Docker     │
                              └─────┬──────┘
                                    |
                              GPU/CPU server
                              (Railway / Render / VPS)
```

### Decision Flow: When to Call Microservice

TR-007 should call the IfcOpenShell microservice when:

```
1. web-ifc WASM parsing SUCCEEDED but:
   a) >10% of elements have zero volume despite having representations
      (indicates complex geometry web-ifc couldn't handle)
   b) >5 IfcBooleanResult or IfcFacetedBrep entities detected in the file
      (web-ifc will silently return 0 for these)

2. web-ifc WASM parsing FAILED:
   a) Out-of-memory error (file too large for WASM)
   b) WASM crash/timeout (corrupted geometry, unsupported schema)

3. File size > 25MB:
   a) Skip web-ifc entirely, go directly to IfcOpenShell
   b) web-ifc WASM on Vercel will likely OOM on files this size
```

The text-regex parser remains the final fallback when BOTH web-ifc and IfcOpenShell fail (network error, microservice down, etc.).

---

## 3. API Endpoint Design

### `POST /parse`

Primary endpoint. Accepts an IFC file, returns the full parse result matching our `IFCParseResult` TypeScript interface.

**Request:**
```
POST /parse
Content-Type: multipart/form-data

file: <binary .ifc file>
options: {
  "extract_geometry": true,         // compute volumes/areas from geometry kernel
  "extract_materials": true,         // resolve material associations
  "extract_properties": true,        // read Pset properties (IsExternal, etc.)
  "extract_openings": true,          // compute net areas via IfcRelVoidsElement
  "compute_model_quality": true,     // run pre-extraction validation
  "max_elements": 50000,             // safety limit
  "timeout_seconds": 120             // per-file timeout
}
```

**Response (200 OK):**
```json
{
  "meta": {
    "version": "1.0",
    "timestamp": "2026-04-13T12:00:00Z",
    "processingTimeMs": 4500,
    "ifcSchema": "IFC4",
    "projectName": "Wellness Center Sama",
    "projectGuid": "2WBz$1...",
    "units": { "length": "m", "area": "m2", "volume": "m3" },
    "warnings": [],
    "errors": [],
    "parser": "ifcopenshell-0.8.0"
  },
  "summary": {
    "totalElements": 450,
    "processedElements": 448,
    "failedElements": 2,
    "divisionsFound": ["03", "04", "05", "08", "09"],
    "buildingStoreys": 4,
    "grossFloorArea": 2284.5,
    "totalConcrete": 185.3,
    "totalMasonry": 1250.0
  },
  "divisions": [
    {
      "code": "03",
      "name": "Concrete",
      "totalVolume": 185.3,
      "volumeWithWaste": 194.6,
      "totalArea": 1500.0,
      "totalNetArea": 1380.0,
      "totalOpeningArea": 120.0,
      "areaWithWaste": 1575.0,
      "wasteFactor": 5.0,
      "elementCount": 85,
      "categories": [
        {
          "code": "03 30 00",
          "name": "Cast-in-Place Concrete",
          "elements": [
            {
              "id": "2WBz$1abc...",
              "type": "IfcWall",
              "name": "Basic Wall:Generic - 200mm:12345",
              "storey": "Ground Floor",
              "material": "M25 Concrete / 230mm Brick",
              "materialLayers": [
                { "name": "Plaster", "thickness": 0.025 },
                { "name": "Brick", "thickness": 0.230 }
              ],
              "quantities": {
                "count": 1,
                "area": { "gross": 25.5, "net": 22.0, "unit": "m2" },
                "volume": { "base": 6.375, "withWaste": 6.69, "unit": "m3" },
                "weight": { "gross": 15843.75, "unit": "kg" },
                "length": 8.5,
                "width": 0.3,
                "height": 3.0,
                "thickness": 0.3,
                "openingArea": 3.5,
                "crossSectionArea": 0.9,
                "outerSurfaceArea": 25.5,
                "footprintArea": 2.55,
                "quantitySource": "qto_standard"
              },
              "properties": {
                "IsExternal": true,
                "concreteGrade": "M25",
                "PredefinedType": "STANDARD"
              }
            }
          ]
        }
      ]
    }
  ],
  "buildingStoreys": [
    { "name": "Ground Floor", "elevation": 0.0, "height": 4.0, "elementCount": 120 }
  ],
  "modelQuality": {
    "zeroVolumeElements": { "count": 2, "types": ["IfcBuildingElementProxy"] },
    "noMaterialElements": { "count": 5, "types": ["IfcMember", "IfcPlate"] },
    "unassignedStoreyElements": { "count": 0, "types": [] },
    "suspiciousDimensions": [],
    "duplicateElements": { "count": 0, "estimatedImpact": "none" },
    "unitConversion": {
      "detectedUnit": "METRE",
      "conversionApplied": false,
      "conversionFactor": 1.0
    },
    "score": 92,
    "label": "EXCELLENT"
  }
}
```

### `GET /health`

Health check for load balancer / uptime monitoring.

```json
{
  "status": "healthy",
  "ifcopenshell_version": "0.8.0",
  "python_version": "3.11.9",
  "uptime_seconds": 86400,
  "files_processed": 1234,
  "avg_processing_ms": 4500
}
```

### `POST /geometry-only`

Lightweight endpoint for when we just need volumes/areas for specific elements (not a full parse). Used when web-ifc succeeded but couldn't compute geometry for specific elements.

**Request:**
```json
{
  "file_url": "https://r2.buildflow.dev/uploads/abc123.ifc",
  "element_ids": [12345, 67890, 11111],
  "compute": ["volume", "area", "weight"]
}
```

**Response:**
```json
{
  "results": {
    "12345": { "volume": 6.375, "area_gross": 25.5, "area_net": 22.0, "weight": 15843.75 },
    "67890": { "volume": 0.85, "area_gross": 12.0, "area_net": 12.0, "weight": 6682.5 }
  },
  "failed": [11111],
  "processing_ms": 1200
}
```

---

## 4. File Transfer Mechanism

IFC files need to get from the user's browser (via Vercel) to the Python microservice. Three options:

### Option A: Direct Upload (Recommended)

```
Browser → Vercel (parse-ifc route) → R2 upload → R2 presigned URL → IfcOpenShell service
```

1. User uploads IFC to Vercel's `/api/parse-ifc`
2. Vercel stores file in Cloudflare R2 (already implemented for large files)
3. Vercel sends the R2 URL to the IfcOpenShell service
4. IfcOpenShell downloads from R2, parses, returns result
5. Vercel returns result to browser

**Pros:** No large file transfer through Vercel's 4.5MB body limit. R2 handles file storage. Service can download at datacenter speeds.
**Cons:** Extra R2 round-trip adds ~500ms latency.

### Option B: Streaming Upload

```
Browser → Vercel → stream body → IfcOpenShell service
```

**Pros:** No intermediate storage.
**Cons:** Vercel serverless has 4.5MB request body limit. Won't work for large files.

### Option C: Direct Browser → Service

```
Browser → IfcOpenShell service (direct CORS)
```

**Pros:** Lowest latency, no Vercel in the path.
**Cons:** Exposes service URL, requires CORS, complicates auth. Breaks our current architecture.

**Decision: Option A.** We already upload large IFC files to R2. The IfcOpenShell service receives only a URL, downloads the file server-to-server, and returns the parsed result. Clean, scalable, secure.

---

## 5. Error Handling & Timeout Strategy

### Timeout Hierarchy

| Stage | Timeout | Reason |
|---|---|---|
| Vercel → Service HTTP call | 150s | Below Vercel's 180s maxDuration |
| Service → IFC parsing | 120s | Leave 30s for HTTP overhead |
| Service → Per-element geometry | 5s | Kill hung elements, log + skip |
| Service → File download from R2 | 30s | Large files, slow network |

### Error Response Format

```json
{
  "error": {
    "code": "PARSE_TIMEOUT",
    "message": "IFC parsing exceeded 120s timeout. File may be too complex.",
    "partial_result": { ... },
    "elements_processed": 320,
    "elements_remaining": 130
  }
}
```

### Partial Results

Unlike web-ifc which crashes entirely on OOM, IfcOpenShell can return partial results:
- If parsing times out at 120s, return whatever elements were processed
- Flag `meta.warnings` with "Partial parse: 320/450 elements processed before timeout"
- This is better than the current behavior (total failure → text-regex fallback)

### Retry Strategy

TR-007 should NOT retry automatically. If the service is down:
1. Log the error
2. Fall back to text-regex parser
3. Add warning: "IfcOpenShell service unavailable, quantities may be less accurate"

---

## 6. Hosting Options & Cost Analysis

### Option 1: Railway (Recommended for MVP)

| Spec | Value | Cost |
|---|---|---|
| Plan | Pro | $5/mo base |
| CPU | 8 vCPU (burstable) | $0.000463/min |
| Memory | 8GB | $0.000231/min per GB |
| Estimated usage | ~50 files/day, avg 30s each | ~$20-40/mo |
| Deploy | Dockerfile, auto-deploy from Git | Included |
| Region | US-East (near Neon DB + Vercel) | - |

**Pros:** Simple, auto-scaling, Docker-native, good free tier for testing.
**Cons:** Cold start ~15s if service scales to zero.

### Option 2: Render

| Spec | Value | Cost |
|---|---|---|
| Plan | Standard | $7/mo base |
| Instance | 1 CPU, 2GB RAM | $7/mo |
| Auto-scale | 1-3 instances | $7-21/mo |

**Pros:** Predictable pricing, good uptime.
**Cons:** Lower specs than Railway for the price.

### Option 3: AWS Lambda with Container Image

| Spec | Value | Cost |
|---|---|---|
| Memory | 4GB | ~$0.000067/req |
| Timeout | 900s max | - |
| Container size | Up to 10GB | IfcOpenShell Docker image ~2GB |
| Estimated cost | 50 files/day, 30s avg | ~$15/mo |

**Pros:** True scale-to-zero, pay-per-use.
**Cons:** Cold start 30-60s (Docker container), 15-min max timeout, complex deployment.

### Option 4: Dedicated VPS (Hetzner/DigitalOcean)

| Spec | Value | Cost |
|---|---|---|
| CPX31 (Hetzner) | 4 vCPU, 8GB RAM, 160GB SSD | EUR 14.40/mo |
| Always-on | No cold starts | - |
| Manual ops | Docker Compose, manual updates | Time cost |

**Pros:** Cheapest for sustained load, no cold starts, full control.
**Cons:** No auto-scaling, manual ops, single point of failure.

### Recommendation

**Start with Railway** for MVP (Week 3-4), **migrate to Hetzner VPS** when volume exceeds 200 files/day (Month 2+). Railway's auto-scaling handles variable load during early adoption; Hetzner is 3x cheaper for sustained throughput.

---

## 7. IfcOpenShell Capabilities We'd Use

### Core Functions

```python
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.unit
import ifcopenshell.util.placement

# Open file
model = ifcopenshell.open("project.ifc")

# Get all elements of a type
walls = model.by_type("IfcWall")

# Geometry settings for volume/area computation
settings = ifcopenshell.geom.settings()
settings.set("use-world-coords", True)
settings.set("weld-vertices", True)

# Compute geometry for an element (handles ALL representation types)
shape = ifcopenshell.geom.create_shape(settings, wall)
# shape.geometry contains vertices and faces
# We compute volume/area from the mesh

# Get quantities from Qto sets
qtos = ifcopenshell.util.element.get_psets(wall, qtos_only=True)
# Returns: {"Qto_WallBaseQuantities": {"GrossArea": 125.5, "NetVolume": 28.8, ...}}

# Get property sets
psets = ifcopenshell.util.element.get_psets(wall, psets_only=True)
# Returns: {"Pset_WallCommon": {"IsExternal": True, "LoadBearing": True, ...}}

# Get material
material = ifcopenshell.util.element.get_material(wall)
# For layered: material.MaterialLayers → [IfcMaterialLayer, ...]

# Get storey assignment
container = ifcopenshell.util.element.get_container(wall)
# Returns IfcBuildingStorey

# Get openings (voids)
openings = ifcopenshell.util.element.get_decomposition(wall)
# Filter for IfcOpeningElement
```

### Volume/Area Computation from Mesh

```python
import numpy as np

def compute_volume_from_shape(shape) -> float:
    """Compute volume using divergence theorem on triangle mesh."""
    verts = shape.geometry.verts
    faces = shape.geometry.faces

    vertices = np.array(verts).reshape(-1, 3)
    triangles = np.array(faces).reshape(-1, 3)

    volume = 0.0
    for tri in triangles:
        v0, v1, v2 = vertices[tri[0]], vertices[tri[1]], vertices[tri[2]]
        # Signed volume of tetrahedron with origin
        volume += np.dot(v0, np.cross(v1, v2)) / 6.0

    return abs(volume)

def compute_area_from_shape(shape) -> float:
    """Compute surface area from triangle mesh."""
    verts = shape.geometry.verts
    faces = shape.geometry.faces

    vertices = np.array(verts).reshape(-1, 3)
    triangles = np.array(faces).reshape(-1, 3)

    area = 0.0
    for tri in triangles:
        v0, v1, v2 = vertices[tri[0]], vertices[tri[1]], vertices[tri[2]]
        area += np.linalg.norm(np.cross(v1 - v0, v2 - v0)) / 2.0

    return area
```

This handles **every** IFC geometry type because IfcOpenShell's C++ kernel tessellates all representations into triangle meshes before returning them.

---

## 8. Security Considerations

### File Validation

```python
# 1. Check file extension
if not filename.endswith(".ifc"):
    return 400, "Only .ifc files accepted"

# 2. Check STEP header
first_line = file.read(64)
if not first_line.startswith(b"ISO-10303-21;"):
    return 400, "Invalid IFC file format"

# 3. Size limit
MAX_SIZE = 200 * 1024 * 1024  # 200MB
if file_size > MAX_SIZE:
    return 413, "File exceeds 200MB limit"

# 4. Parse in sandboxed process (prevent malicious STEP files)
# Use multiprocessing with timeout
```

### Service-to-Service Authentication

```
Header: Authorization: Bearer <IFCSERVICE_API_KEY>
```

- `IFCSERVICE_API_KEY` is a shared secret stored in both Vercel env vars and the service's env
- Rotate every 90 days
- Rate limit: 100 requests/minute per API key

### Network Security

- Service runs behind a reverse proxy (Caddy/nginx) with TLS
- No public access — only whitelisted Vercel IPs (or use private networking on Railway)
- CORS disabled entirely (service is API-only, no browser access)

---

## 9. Performance Estimates

Benchmarks from IfcOpenShell community and our CubiCasa5K ML service experience:

| File Size | Elements | Qto Extraction | Full Geometry | Total (Est.) |
|---|---|---|---|---|
| 1MB | ~50 | <0.5s | 1-2s | **2-3s** |
| 5MB | ~200 | 1s | 3-5s | **4-6s** |
| 10MB | ~500 | 2s | 5-10s | **7-12s** |
| 30MB | ~1500 | 5s | 15-30s | **20-35s** |
| 50MB | ~3000 | 8s | 30-60s | **38-68s** |
| 100MB | ~6000 | 15s | 60-120s | **75-135s** |
| 200MB | ~12000 | 30s | 120-240s | **150-270s** (4.5min) |

**Key insight:** Geometry computation (tessellation) is the bottleneck, not file I/O or property reading. For files where web-ifc already extracted Qto properties, we only need IfcOpenShell for the geometry of FAILED elements — not the entire file. This means the `/geometry-only` endpoint is critical: parsing 10 failed elements from a 50MB file takes ~5s, not 60s.

### Memory Usage

| File Size | Peak Memory |
|---|---|
| 10MB | ~200MB |
| 50MB | ~800MB |
| 100MB | ~1.5GB |
| 200MB | ~3GB |

**Recommendation:** 4GB minimum, 8GB for production safety. This rules out Lambda (max 10GB but costly at high memory) and favors Railway/VPS.

---

## 10. Deployment Strategy

### Dockerfile

```dockerfile
FROM python:3.11-slim

# IfcOpenShell requires system dependencies
RUN apt-get update && apt-get install -y \
    libxml2 libxslt1.1 liboce-foundation-dev liboce-modeling-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app/ /app/
WORKDIR /app

# Health check
HEALTHCHECK --interval=30s --timeout=10s CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### requirements.txt

```
fastapi==0.111.0
uvicorn[standard]==0.30.0
ifcopenshell==0.8.0
numpy==1.26.4
python-multipart==0.0.9
httpx==0.27.0
pydantic==2.7.0
```

### Environment Variables

```
IFCSERVICE_API_KEY=<shared-secret>
MAX_FILE_SIZE_MB=200
PARSE_TIMEOUT_SECONDS=120
ELEMENT_TIMEOUT_SECONDS=5
LOG_LEVEL=INFO
```

---

## 11. Integration Plan

### Phase 5a: Deploy Standalone Service (Week 3, Days 1-3)

1. Build Docker image with IfcOpenShell + FastAPI
2. Deploy to Railway (Pro plan)
3. Test with 10 sample IFC files of varying complexity
4. Verify output matches `IFCParseResult` TypeScript interface exactly
5. Add `IFCSERVICE_URL` and `IFCSERVICE_API_KEY` to Vercel env vars

### Phase 5b: Integrate into TR-007 (Week 3, Days 4-5)

Modify `src/app/api/parse-ifc/route.ts`:

```typescript
// Current flow:
// 1. Try web-ifc WASM
// 2. If fails → try text-regex
// 3. If fails → return error

// New flow:
// 1. If file > 25MB → skip web-ifc, go to step 3
// 2. Try web-ifc WASM
// 3. If web-ifc failed OR >10% elements have zero volume:
//    a. Upload file to R2 (if not already)
//    b. Call IfcOpenShell microservice with R2 URL
//    c. If microservice succeeds → return its result
//    d. If microservice fails → try text-regex
// 4. If text-regex fails → return error
```

Estimated code changes:
- `src/app/api/parse-ifc/route.ts`: +40 lines (add microservice call)
- New: `src/features/ifc/services/ifcopenshell-client.ts`: ~80 lines (HTTP client)
- No changes to TR-007 or TR-008 (they consume `IFCParseResult` regardless of parser)

### Phase 5c: Hybrid Mode — Use Both Parsers (Week 4, Days 1-3)

The smartest approach: use web-ifc for fast property/Qto extraction, IfcOpenShell only for elements that need geometry recomputation.

```typescript
// 1. Parse with web-ifc (fast, handles Qto properties)
const wasmResult = await parseIFCBuffer(buffer, filename);

// 2. Identify elements that need better geometry
const needsGeometry = wasmResult.divisions.flatMap(d =>
  d.categories.flatMap(c =>
    c.elements.filter(e =>
      e.quantities.quantitySource === "geometry_calculated" &&
      (e.quantities.volume?.base === 0 || e.quantities.area?.gross === 0)
    )
  )
);

// 3. If significant number need help, call IfcOpenShell for those elements only
if (needsGeometry.length > 5) {
  const elementIds = needsGeometry.map(e => e.expressID);
  const geometryResult = await ifcOpenShellClient.getGeometryOnly(r2Url, elementIds);

  // 4. Merge IfcOpenShell geometry into web-ifc result
  for (const [id, geom] of Object.entries(geometryResult)) {
    const element = findElementById(wasmResult, id);
    if (element && geom.volume > 0) {
      element.quantities.volume = { base: geom.volume, withWaste: 0, unit: "m3" };
      element.quantities.area = { gross: geom.area_gross, net: geom.area_net, unit: "m2" };
      element.quantities.quantitySource = "geometry_calculated"; // but now accurate
    }
  }
}
```

This hybrid approach gives us:
- **Speed of web-ifc** for the 80% of elements it handles well
- **Accuracy of IfcOpenShell** for the 20% of complex elements
- **No double-parsing** of the entire file

### Phase 5d: Monitoring & Gradual Migration (Week 4, Days 4-5)

1. Add logging: track which parser produced each result, compare accuracy
2. A/B test: for 10% of users, run BOTH parsers and compare outputs
3. If IfcOpenShell consistently produces better results → promote it to primary
4. Keep web-ifc as the fast path for simple files

### Estimated Timeline

| Phase | Duration | Effort |
|---|---|---|
| 5a: Deploy standalone service | 3 days | 1 engineer |
| 5b: Integrate into TR-007 | 2 days | 1 engineer |
| 5c: Hybrid mode | 3 days | 1 engineer |
| 5d: Monitoring + migration | 2 days | 1 engineer |
| **Total** | **10 working days** | **1 engineer** |

---

## 12. Cost Summary

### MVP (Railway, first 3 months)

| Item | Monthly Cost |
|---|---|
| Railway Pro (8 vCPU, 8GB) | $20-40 |
| R2 storage (IFC files) | Already paid |
| Bandwidth | Included in Railway |
| **Total** | **~$30/mo** |

### Production (Hetzner VPS, Month 4+)

| Item | Monthly Cost |
|---|---|
| Hetzner CPX31 (4 vCPU, 8GB) | EUR 14.40 (~$16) |
| Docker + monitoring | Free (self-managed) |
| **Total** | **~$16/mo** |

### At Scale (100+ files/day)

| Item | Monthly Cost |
|---|---|
| Hetzner CPX41 (8 vCPU, 16GB) | EUR 28.80 (~$32) |
| Or: 2x CPX31 with load balancer | EUR 33.80 (~$37) |
| **Total** | **~$35/mo** |

This is negligible compared to the value delivered: each accurate BOQ saves QS professionals hours of manual verification.
