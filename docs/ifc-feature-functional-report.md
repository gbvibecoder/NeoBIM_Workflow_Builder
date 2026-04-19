# IFC Generation & Creation — Functional Report

**Audience:** Product, design, QS / AEC domain experts, business stakeholders.
**Status as of:** 2026-04-18 (Phase 1 Track A complete; Phase 1 Tracks B/C/D pending).
**Purpose:** Plain-English companion to the technical report. Describes what the IFC feature does for users today, what changed in Phase 1, what's still lean vs rich, and what "ultra-realistic IFC" would look like end-to-end.

---

## 1. What the feature does, in one paragraph

NeoBIM lets an architect or quantity surveyor drop a `.ifc` file (or start from a text brief) onto a visual canvas and, with a few connected "nodes", get back professional deliverables: a bill of quantities spreadsheet in INR with live market pricing, a cost estimate, a clash-detection report, a downloadable multi-discipline IFC package (Architectural / Structural / MEP / Combined), and an interactive 3D viewer — all without leaving the browser. The IFC write path is powered by a dedicated Python microservice (`ifcopenshell`-based) running on Railway; a TypeScript fallback path exists for resilience.

---

## 2. User Journeys

### Path A — "I have an IFC, give me a BOQ"

1. On the dashboard canvas, open the prebuilt **IFC Model → BOQ Cost Estimate** workflow (or wire it from the palette: IN-004 → TR-007 → TR-008 → EX-002, plus IN-006 → TR-015 for market prices).
2. Drag a `.ifc` onto the **IFC Upload** tile. Browser reads the file locally; a green check appears and a toast announces `IFC parsed: 4,312 elements, 5 storeys`.
3. Enter a location (e.g. Pune, Maharashtra, India) in the Location tile. **Market Intelligence** fetches live steel/cement/sand prices.
4. Press **Run**. Nodes turn green sequentially: Quantity Extractor → BOQ Cost Mapper → XLSX Exporter.
5. **Result panel shows:** an IFC Quality Assessment card (0–100 score with EXCELLENT/GOOD/FAIR/LIMITED label), a table of 50–200 BOQ line items grouped by CSI division, a total cost in ₹ Cr/L, and a download button for the XLSX.

### Path B — "I have a brief or idea, give me an IFC"

1. Drop a PDF brief, or type a prompt: "5-storey mixed-use, 1,800 m² GFA/floor, Pune, RCC frame".
2. The **Brief Parser** / **Design Brief Analyzer** tiles extract structured requirements (floors, programme, constraints).
3. **Massing Generator** generates procedural 3D geometry + an IFC file + a GLB viewer in parallel and uploads to cloud storage.
4. **IFC Exporter** assembles the 4 IFC discipline files (Architectural, Structural, MEP, Combined).
5. **Each file now carries a Rich/Lean badge** (Phase 1 Track A). Green "Rich" if generated via the Python service (full geometry, proper openings, material layer sets). Amber "Lean" if the Python service was unavailable and the TypeScript fallback kicked in.
6. Click "Download Combined.ifc" → open in Revit / BlenderBIM / Navisworks for verification.

### Path C — "Check this model for clashes"

1. Drop an IFC on **IFC Upload**, wire to **Clash Detector**, press Run.
2. For federation: expand "Additional IFC files" on the upload tile, attach Structural + MEP `.ifc` siblings.
3. Server-side axis-aligned-bounding-box analysis (2.5 cm tolerance, 5 000 clash cap).
4. **Output:** table of clash pairs (Severity / Element A / Element B / Storey / Overlap m³) with hard/soft/clearance classification and cross-model summary in federated mode.

### Path D — "Just let me look at the model"

1. Visit `/dashboard/ifc-viewer` directly (or click the "Open in Viewer" banner on IN-004).
2. Drag-drop an IFC — or the viewer auto-attaches your most recent file via IndexedDB.
3. Three.js + web-ifc renders the model with Toolbar (view modes, section planes, measurements, screenshots), Model Tree, Properties Panel, ViewCube.
4. Opening the viewer after a canvas upload in another tab auto-attaches that file to any waiting IFC Upload tile (cross-tab IndexedDB handoff).

---

## 3. What's NEW in Phase 1 Track A (just shipped on `feature/rich-ifc-phase-1`)

### 3.1 Users can now see which engine generated their IFC

Every IFC download card in the Export tab now shows a small pill:

- **🟢 Rich (green, Sparkles icon)** — generated via the Python `ifcopenshell` service. Full geometry, proper openings that cut host walls, material layer sets, Qto_* base quantities.
- **🟠 Lean (amber, AlertTriangle icon)** — generated via the built-in TypeScript exporter because the Python service was unavailable. The file is still a valid IFC4, just lighter on rebar / curtain walls / MEP detail. Hover the pill for the exact reason ("not-configured", "timeout", "http-error", "parse-error", "network-error") and a hint to check `IFC_SERVICE_URL`.

### 3.2 Faster fail-over when the Python service is down

Before Phase 1, EX-001 would wait the full 30-second timeout every time Railway was cold or unreachable, producing silent TS-fallback output. Now a 5-second pre-flight `/ready` probe runs first; on failure the TS fallback kicks in immediately, saving ~25 seconds and surfacing the state to the user via the Lean pill.

### 3.3 Documented env vars

`.env.example` now documents:
- `IFC_SERVICE_URL` — Python service URL (prod Railway default).
- `IFC_SERVICE_API_KEY` — Bearer token for service calls.
- `IFC_RICH_MODE` — richness dial (coming in Phase 1 Track B): `off` / `arch-only` / `mep` / `structural` / `full`.

### 3.4 Plumbing reserved for future admin dashboard

A `getServiceHealthStatus()` helper is now exported. No UI yet — but a future Ops dashboard can poll Python-service health without requiring any refactor.

---

## 4. What works reliably vs what's preview

### Reliably supported today

- **IFC parsing (read path)** — works on exports from Revit, ArchiCAD, Tekla, Allplan up to ~100 MB. IFC2X3 + IFC4.
- **Quantity takeoff (TR-007)** — gross/net/opening area, volume, per-storey breakdown, CSI MasterFormat grouping, per-material-layer detail, QS-style table.
- **Self-awareness layer** — IFC Quality Assessment card with smart warnings (e.g. "This file has no Qto_* base quantities — BOQ accuracy is limited. Re-export from Revit with 'Export Base Quantities' enabled").
- **Unit awareness** — metric vs imperial detected and converted.
- **Waste factors + CSI mapping** — codified per division (concrete 5 %, masonry 8 %, finishes 15 %, etc.), material-aware overrides (steel columns → Division 05; timber beams → Division 06).
- **BOQ cost mapping (TR-008)** — IS 1200 / CPWD unit rates, live market price fallback chain (TR-015 → Redis → Postgres learning DB → static).
- **Clash detection (TR-016)** — single-model and multi-model federated, severity classification, storey grouping.
- **IFC export (EX-001)** — always returns valid ISO-10303-21 STEP. 4 discipline variants per run. Includes CSI/NBC classifications, Pset_*Common sets, deterministic GUIDs on TS path when project ID supplied.
- **Standalone viewer** — Three.js + web-ifc, IndexedDB cache.
- **R2 storage** — auto-upload for IFCs and generated assets with base64 fallback when misconfigured.

### Preview / partial today

- **Python IfcOpenShell microservice** — deployed, live, and primary. Produces *core* geometry correctly (walls, slabs, columns, beams, windows, doors, stairs, spaces, basic MEP segments) but currently missing:
  - rebar (no body, no metadata)
  - proper curtain wall decomposition
  - MEP fittings (bends, tees, valves)
  - MEP port topology (IfcDistributionPort, IfcRelConnectsPorts)
  - railings
  - roofs as distinct entities (currently emits IfcSlab with PredefinedType=ROOF)
  - foundations as distinct entities (uses IfcBuildingElementProxy)
  - furniture
  - classification references
  - zones
  - structural analysis model
- **BIM Query Engine (TR-009), Delta Comparator (TR-010), Material/Carbon (TR-011), Zoning Compliance (TR-006), IFC-to-Web Converter (GN-006), Speckle Publisher (EX-004)** — defined in the catalogue, shown in the palette, but **not wired to any handler**. Dragging them into a workflow has no effect. Either ship or remove from palette.
- **TypeScript fallback exporter richness** — the fallback path has code written for IfcStructuralAnalysisModel, IfcDistributionPort, IfcRelConnectsPorts, IfcReinforcingBar, IfcCurtainWall decomposition, IfcFurniture, IfcFooting, IfcClassificationReference, 4D tasks, 5D costs, Indian permit/RERA data, international classifications — but all these emissions sit behind four "gate flags" that default to off. Phase 1 Track B will ship an `IFC_RICH_MODE` env var that flips them on. Until then the TS fallback output is intentionally lean to avoid "flying debris" artefacts on non-rectangular buildings.
- **No user-facing "richness" choice** yet. Phase 1 Track B will add a per-run override so a workflow can say "give me rich" or "give me lean" without setting global env.

---

## 5. Controllable richness (coming Phase 1 Track B)

The TS exporter has four gate flags that control which entities emit with real body geometry vs metadata-only:

| Flag | Controls |
|---|---|
| `emitRebarGeometry` | `IfcReinforcingBar` bodies. Off = Pset metadata only (BBS tools still work). |
| `autoEmitDemoContent` | Sample bolts, welds, plant-room equipment, MEP port topology, lifts, ramps, furniture demos. |
| `emitCurtainWallGeometry` | Individual mullion / spandrel body geometry. Off = metadata under IfcCurtainWall container. |
| `emitMEPGeometry` | Duct / pipe / tray body geometry. Off = entities with no body (metadata-only). |

Phase 1 Track B exposes these through a single `IFC_RICH_MODE` env var with preset bundles:

| `IFC_RICH_MODE` value | What flips on |
|---|---|
| `off` (default, = today) | Nothing — current production behaviour, minimum-visual, all metadata intact |
| `arch-only` | Curtain walls |
| `mep` | MEP bodies + demo content (fittings, valves, terminals) |
| `structural` | Rebar bodies |
| `full` | Everything — richest output, highest risk of debris on exotic geometry |

A per-run override is also planned: adding `richMode: "full"` to an EX-001 node's input data will trump the env var.

**Default stays `off` in production.** No behaviour change until someone explicitly sets the var or per-run flag.

---

## 6. Inputs required and outputs produced

### Inputs (authoring side)

- **Primary:** a `.ifc` file, IFC2X3 or IFC4, ≤ 100 MB. Must start with `ISO-10303-21;`.
- **Optional supplementary:** additional Structural and MEP `.ifc` files for clash federation.
- **Location:** country/state/city text or structured JSON (enables INR pricing, seismic/wind zones, regional factors).
- **Design brief:** PDF or free text (only needed for the massing-first path).
- **Parameters:** floors, footprint, building type (IN-005 node for explicit numerics).

### Outputs

- **Quantities table** — headers: Category, Element, Gross Area, Opening Area, Net Area, Volume, Qty, Unit. 50-200 rows typical. Per-storey, external/internal wall split, covering-type detail.
- **IFC Quality card** — 0-100 score + per-issue counts (zero-volume elements, missing materials, unassigned storeys, suspicious thicknesses). Smart warnings with actionable fixes (e.g. "In Revit, enable 'Export Base Quantities'").
- **BOQ table** — rows with unit price in local currency, total per line, M/L/E (material/labour/equipment) breakdown, waste factor applied, escalation, AACE class.
- **BOQ spreadsheet** — `.xlsx` and `.csv` download URLs.
- **IFC export** — up to 4 files per run: `{slug}_architectural_{date}.ifc`, `_structural`, `_mep`, `_combined` with R2 download URLs (or base64 data URI fallback). **Each now carries a Rich/Lean provenance pill.**
- **Clash report** — table of element pairs with severity, overlap volume, storey, source-model labels in federated mode.
- **Interactive viewer** — `/dashboard/ifc-viewer`; canvas artifact cards also embed mini viewers.

### Example run (WF-09 on a Pune 5-storey residential IFC)

- Quantities table: ~120 rows (walls external/internal per floor, slabs per floor, columns, beams, doors, windows, finishes, roof, MEP segments).
- IFC Quality: 78/100, "GOOD", 3 warnings (missing Qto_Common on 12 members, 2 walls with implausible thickness).
- Total BOQ: `₹ 4.82 Cr` with labour/material/equipment split and sourced unit rates.
- Download: `wellness_center_sama_2026-04-17.xlsx` (~40 KB) + 4 IFC files (~1-5 MB each).
- Badge shown: 🟢 **Rich** (Python service responded in 1.2 s).

---

## 7. Business value

- **Time saved.** Manually extracting a BOQ from a medium-building IFC (~5 000 elements) takes a QS 4-8 hours. This workflow reduces mechanical extraction to seconds and sanity-checking to minutes.
- **Accuracy.** Exact when the IFC has `Qto_*BaseQuantities`. Honest warnings when it doesn't. Cross-user correction learning nudges statistical accuracy after ≥ 3 corrections for the same element type.
- **Consistency.** CSI MasterFormat + NBC India Part 4 dual classification baked in.
- **Round-trip fidelity.** IFC export targets Revit 2024, ArchiCAD 27, Tekla, Navisworks, Solibri, BlenderBIM. Deterministic GUIDs (TS path when project ID supplied) mean re-exports don't churn identities.
- **Indian market fit.** Default region is India: IS 456 concrete grades, IS 800 steel, IS 875 wind zones, IS 1893 seismic zones, RERA registration, NBC 2016 classification, INR Cr/L formatting, Indian EPDs + COBie catalogue (ACC, UltraTech, Tata Steel, JSW, SAIL, Kirloskar, Voltas, Blue Star, Havells, Schneider, Legrand, ABB, Waaree, Otis). Non-Indian users still get sensible defaults via `region: "eu" | "us"` with Uniclass / OmniClass / Uniformat / DIN / NATSPEC.
- **Where it fits in the AEC workflow.** Between "design complete" and "tender". Architect hands off IFC; QS produces first-pass BOQ within a day instead of a week; iterates with architect on model quality; exports federated IFC package for consultants. Clash detection is a sanity check before contractor sharing.
- **Operational visibility** (new Phase 1). Users can now see engine provenance; Ops can eventually see service health; Engineering can debug silent fallbacks via the new metadata stamps.

---

## 8. Current Limitations (user-visible)

- **No BIM Query Engine, Delta Comparator, Material/Carbon Inference, Zoning Compliance, IFC-to-Web Converter, Speckle Publisher** — all in the palette but non-functional. A user wiring them in gets no output.
- **TypeScript fallback visually omits rebar, mullions, MEP pipes/ducts/trays as body geometry** by default. Opens as a building with perimeter shell + floors, but MEP and rebar look "empty" in viewers. They are present as properly tagged entities for QS tools. Python path also misses these today (no rebar at all, no mullion decomposition).
- **No progress bar for long runs.** A 5-storey 80 MB IFC can take 30-90 s to parse server-side; the UI shows node status but no percentage.
- **Supplementary IFC limited to 1 Structural + 1 MEP sibling.** Real projects often have 2-5 MEP sub-discipline IFCs (plumbing, HVAC, fire, electrical).
- **Large-file handling is split.** For files > ~1 MB, TR-007 takes a different code path that occasionally loses some diagnostic fields. Quantities are consistent; the "Behind the Scenes" panel may show less detail.
- **Silent fallback in prod (now improved in Phase 1).** Before: no visibility when Python service was down. After: Lean pill with tooltip + reason.
- **Viewer is single-model.** `/dashboard/ifc-viewer` opens one IFC at a time; no federated view.
- **No versioning.** Previous IFC uploads are auto-cleaned after ~3 days. Cached viewer copy per user in IndexedDB, clears on "Remove file".
- **API rate limits** — Free: 3 lifetime. MINI/STARTER/PRO: monthly limits.
- **Main-thread parsing on canvas IFC Upload.** Standalone viewer uses a Web Worker; canvas tile does not — very large files can briefly freeze the canvas.
- **The Rich/Lean badge shows only on the "combined" file.** The 4 discipline files are shown as one card currently (backward-compat flattening). Phase 1 Track B can fan this out.

---

## 9. What "Ultra-Realistic IFC" would look like

This is the target state for visual fidelity when a user opens a NeoBIM-generated IFC in BlenderBIM / Revit. Each line is one concrete improvement that makes the output feel closer to "I modelled this in Revit myself".

### 9.1 In the main building shell

- **Visible reinforcement.** Every RCC column/beam has real IfcReinforcingBar bodies you can section-cut in BlenderBIM and see the main bars + stirrups. Today: no rebar at all on Python; metadata-only on TS.
- **Proper curtain walls.** Each mullion is a real IfcMember with I-profile; each glazing panel is an IfcPlate with transparent material. Today: metadata-only aggregation on TS; absent on Python.
- **Railings on every stair and balcony.** Visible handrails + balusters. Today: absent on Python; present on TS path (`IfcRailing` at `ifc-exporter.ts:3467`).
- **Dedicated roof entities with pitch.** Flat vs gable vs hip vs shed. Today: all roofs emit as IfcSlab(ROOF) — no pitch semantics.
- **Foundations visible below grade.** Pad footings at each column, strip footings under walls, pile caps when applicable. Today: absent on Python (uses proxy); present on TS (gated).

### 9.2 MEP you can actually trace

- **Ducts that turn corners with fittings.** Real `IfcDuctFitting` entities at each elbow/tee. Today: none emitted by Python; TS has it gated behind `autoEmitDemoContent`.
- **Pipes with valves.** Real `IfcValve` entities where isolation/check valves would go. Today: none emitted.
- **Ports + connectivity topology.** `IfcDistributionPort` at each segment end, `IfcRelConnectsPorts` linking them — makes MEP systems traceable in Solibri and Navisworks. Today: none emitted by Python; TS synthesises when `autoEmitDemoContent` is on.
- **Distribution systems with proper enum.** `IfcDistributionSystem.PredefinedType = AIRCONDITIONING` vs `DOMESTICCOLDWATER` etc. Today: generic `IfcSystem` with hardcoded name strings.

### 9.3 Structural model that engineers can actually analyse

- **IfcStructuralAnalysisModel** root with analytical line elements for beams/columns and surface elements for walls/slabs. Enables round-trip to ETABS, Tekla Structural Designer, SAP2000.
- **Load cases + combinations** per IS 456 (dead, live, wind, seismic).
- **Boundary conditions** at footings — fixed / pinned / roller. Today: none.
- **Applied actions** — UDL on beams, point loads on columns. Today: none.

### 9.4 Indian regulatory compliance baked in

- **`IfcPermit`** carrying the RERA registration, municipal approval, permit number, valid-until, fire NOC, environmental clearance. Today: present on TS path, absent on Python.
- **`IfcApproval`** stamps for design review milestones.
- **`IfcClassification`** + `IfcClassificationReference` with NBC India Part 4 Occupancy classifications (A-G) and CSI MasterFormat codes per element. Today: TS emits; Python doesn't.
- **Seismic/wind zones** on building Pset. Today: TS emits; Python doesn't.

### 9.5 Visual quality you'd see on first open

- **Per-element colors via `IfcStyledItem` + `IfcSurfaceStyle`.** Concrete columns grey, steel beams light blue, brick walls red-brown, glazing transparent. Today: BlenderBIM uses defaults because there's no style emission.
- **Textures via `IfcSurfaceStyleWithTextures`.** Brick texture on masonry walls, wood grain on floors, aluminium mill finish on mullions. Requires texture files hosted on R2. Today: absent.
- **Presentation layers per discipline** so Navisworks can toggle Architecture / Structure / MEP independently in one 3D view. Today: absent.
- **Lighting fixtures** in rooms — `IfcLightFixture` + `IfcLightSource` for BlenderBIM lighting simulation. Today: absent.
- **Vegetation + site context** — trees as `IfcGeographicElement`, site boundary polygon, terrain. Today: absent.

### 9.6 Furniture sets per space type

- **Bedroom** = bed + wardrobe + nightstand + desk + ceiling fan + curtains.
- **Office** = desk + task chair + filing cabinet + floor lamp + laptop-spot marker.
- **Living room** = sofa + coffee table + TV unit + side tables + floor lamp + area rug.
- **Kitchen** = base + wall cabinets, sink, stove, fridge, pantry.
- **Bathroom** = WC, washbasin, shower, mirror, towel rail.

Each as an `IfcFurniture` set keyed to the space's `Pset_SpaceCommon.Category`. Today: absent.

### 9.7 2D annotations embedded

- **Dimensions** on plans (wall lengths, door widths, room areas).
- **Room tags** with name + area.
- **North arrow + scale bar.**
- **Section cut symbols.**

All as `IfcAnnotation` with `IfcDraughtingPreDefinedColour`. Today: absent.

### 9.8 Topological correctness (Phase 5 / topologicpy territory)

- **2nd-level space boundaries** where wall and slab faces align with space face. Enables energy analysis export to EnergyPlus / IES VE. Today: only 1st-level.
- **Space-to-space adjacency graph** — corridors connect rooms, stairs connect storeys. Enables wayfinding + egress analysis.
- **Apertures preserved through booleans.** Doors/windows that remain connected to host walls even after complex cuts.

---

## 10. Open Questions for the Team

1. **When do we finish wiring the IfcOpenShell microservice into TR-007?** The architecture doc (`docs/ifcopenshell-microservice-architecture.md`) lays out a decision flow. Right now only EX-001 uses the service. Biggest remaining accuracy win available.

2. **Should we ship the catalogued-but-unimplemented nodes (TR-009 / TR-010 / TR-011 / EX-004) or hide them?** They appear in the palette, suggesting they work, and failing silently when dragged erodes trust.

3. **Unified quality + confidence dashboard?** Today the IFC Quality card, parser diagnostics, clash report, BOQ disclaimer, and the new Rich/Lean badge all surface quality signals separately. A combined view would help a QS decide whether to trust the output for tender.

4. **Multiple MEP sub-discipline IFCs per federation?** Large projects ship 2-5 (plumbing, HVAC, fire, electrical, low-voltage). Current UI accepts one per discipline.

5. **Should the Python service become the default quality bar, not the fallback?** Phase 2+ will make it so. Requires completing the 12.2-12.5 roadmap from the technical report.

6. **R2 retention policy advertisement.** 3 days for IFC, 25 days for other files per comments. UNKNOWN whether the cleanup cron is actually running in production.

7. **Comparison / diff UI between runs.** Delta Comparator (TR-010) was designed for this but isn't implemented. Would let users see "how did my BOQ move when I iterated the model?".

8. **Offload TR-007 canvas parse to Web Worker** (as the standalone viewer already does) to avoid main-thread freezes on large files.

9. **Should Rich/Lean pill distinguish "not configured" from "service down" visually?** Today both show amber "Lean" with different tooltip text. Enterprise deployments might want a blocking "Rich REQUIRED" mode where the export fails rather than silently degrading.

10. **What's our position on ultra-realism at scale?** Phase 4-5 work (textures, lighting, furniture, 2nd-level boundaries) has real infra cost (Python service memory, R2 bandwidth for textures, topologicpy image size). Worth defining the target user and scope before committing.

11. **When the Indian market maturity is achieved, do we extend NBC/IS logic to other regions** (Singapore's BCA codes, UAE's NFPA fire codes, US's IBC) for multi-market compliance? Each region requires its own Psets, classifications, EPD catalogues.

12. **Texture library** — if we do 9.5 (visual textures), we need a library of brick / wood / concrete / glass / aluminium images hosted on R2 with proper IfcImageTexture metadata. Who maintains this? Is it per-project (user uploads) or shared (NeoBIM library)?

---

## 11. Current State Snapshot

**Deployed right now:**
- Next.js app on Vercel (production: `rutikerole/main`).
- Python service on Railway (`https://buildflow-python-server.up.railway.app`, git SHA `f00bc4871b0f`, ifcopenshell 0.8.5).
- R2 buckets: `buildflow-files` (TS side) + `buildflow-models` (Python side).
- Probe layer operational in `feature/rich-ifc-phase-1` branch, awaiting merge.

**PRs in flight:**
- `#245` (BetaBanner refactor — unrelated to IFC) → `rutikerole/main`.
- Phase 1 Track A (6 commits on `feature/rich-ifc-phase-1`) — not yet pushed, pending localhost verification.

**Not in any PR / branch:**
- Phase 1 Tracks B (richMode plumbing), C (input surface extension), D (baseline fixtures). These are scoped in `docs/ifc-phase-1-subplan.md` but not implemented.

**Key numbers:**
- TS exporter: 6,328 LOC (1 file).
- Python service: 2,756 LOC across 20 files.
- Entire Next.js IFC subsystem: ~15,000 LOC.
- Test suite: 1,958 tests, 9.21 s wall time.

---

## 12. What to read next

- **Engineering roadmap:** `docs/ifc-feature-technical-report.md` § 12 "Roadmap to Ultra-Realistic IFC".
- **Phase 1 detailed plan:** `docs/ifc-phase-1-subplan.md`.
- **Multi-phase strategy:** `docs/RICH_IFC_IMPLEMENTATION_PLAN.md`.
- **Historical audit:** `docs/ifc-phase-0-audit.md`.

---
