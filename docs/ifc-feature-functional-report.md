# IFC Feature — Functional Report

**Audience:** Product, design, QS/AEC domain experts, business stakeholders (no code background required).
**Date:** 2026-04-17
**Purpose:** Describe what the IFC feature actually does today, what works, what's still a preview, and what we should decide before the next iteration.

---

## 1. What the feature does, in user terms

NeoBIM lets an architect or quantity surveyor bring a Building Information Model — a `.ifc` file, the industry-standard handoff format from Revit, ArchiCAD, Tekla, BIMcollab and similar tools — onto a visual canvas, run it through a chain of "nodes" (upload, extract quantities, map to cost codes, check clashes, publish as a report, etc.), and get back professional deliverables like a BOQ spreadsheet, a cost estimate in INR, a clash report, a downloadable multi-discipline IFC file, or an interactive 3D viewer — all without leaving the browser.

---

## 2. User journey (click by click)

### Path A — "I already have an IFC. Give me a BOQ."

1. On the dashboard canvas, the user opens the **BOQ Cost Estimate** prebuilt workflow (or builds it from scratch with the node palette).
2. They drag a `.ifc` file onto the **IFC Upload** tile. The browser reads the file locally; within seconds a green check appears and a toast announces `IFC parsed: 4,312 elements, 5 storeys`.
3. They enter a **location** (Pune, Maharashtra, India) in the Location tile. A second tile — **Market Intelligence** — automatically fetches live steel/cement/sand prices via a web-search AI.
4. They press **Run**. The workflow fans out: the Quantity Extractor tile turns green, followed by the BOQ Cost Mapper, then the BOQ Spreadsheet Exporter.
5. The result panel shows: an "IFC Quality Assessment" card (0–100 score with Excellent/Good/Fair/Limited label), a table of 50–200 aggregated BOQ line items grouped by CSI division, a total cost in ₹ Cr/L, and a download button for the XLSX.
6. If they re-run with a different location or a refreshed market feed, the regen counter ticks up (capped per plan tier).

### Path B — "I have a sketch or text brief. Give me an IFC."

1. They drop a **PDF brief** or type a **text prompt** ("5-storey mixed-use, 1,800 m² GFA per floor, Pune, RCC frame").
2. The Brief Parser / Design Brief Analyzer tiles extract structured requirements.
3. The **Massing Generator** tile generates procedural 3D geometry + an IFC file + a GLB for viewing, all in parallel, and uploads them to cloud storage.
4. The **IFC Exporter** tile assembles a 4-file IFC package (Architectural, Structural, MEP, Combined) ready to download. When the optional Python IfcOpenShell service is available, the exporter produces higher-fidelity IFC4 with proper material layer sets, openings, and property sets; otherwise a TypeScript exporter produces a still-valid but visually lighter IFC.
5. The user clicks "Download Architectural.ifc" and opens it in Revit / Navisworks / BlenderBIM for verification.

### Path C — "Check this model for clashes."

1. User drops an IFC on **IFC Upload**, wires it into **Clash Detector**, presses Run.
2. For federation, they expand "Additional IFC files" on the upload tile and add a Structural and MEP `.ifc`.
3. The Clash Detector tile fetches the files server-side and streams meshes through an axis-aligned bounding-box analysis.
4. Output is a table of clash pairs (Severity, Element A, Element B, Storey, Overlap m³) with hard/soft/clearance classification and a cross-model summary when multiple discipline IFCs are supplied.

### Path D — "Just let me look at the model."

1. User visits `/dashboard/ifc-viewer` directly (linked from the canvas IFC Upload tile's "Open in Viewer" banner).
2. Drag-and-drop an IFC (or use the cached one from a recent upload — the viewer remembers the last file via the browser's IndexedDB).
3. The viewer renders the model in Three.js with Toolbar (view modes, section planes, measurements, screenshots), Model Tree, Properties Panel, ViewCube.
4. Opening the viewer after an upload in another tab also auto-attaches that file to any waiting IFC Upload tile on the canvas.

---

## 3. What works reliably today vs. what is still preview

### Reliable today

- **IFC parsing (read path)** — works on Revit, ArchiCAD, Tekla, Allplan exports up to ~100 MB. Handles IFC2X3 and IFC4.
- **Quantity takeoff (TR-007)** — grossly correct for standard elements (walls, slabs, columns, beams, windows, doors, stairs, roofs). Emits a professional QS-style table with gross/net/opening area, volume, per-storey breakdown, CSI MasterFormat grouping, per-material-layer detail. Includes a self-awareness layer ("Model Quality" score, smart warnings like "*This file has no Qto_\* base quantities — BOQ accuracy is limited. Re-export from Revit with 'Export Base Quantities' enabled*").
- **Unit awareness** — detects metric vs imperial files and converts.
- **Waste factors + CSI mapping** — codified per division (concrete 5 %, masonry 8 %, finishes 15 %, etc.), material-aware overrides (steel columns → Division 05; timber beams → Division 06).
- **BOQ cost mapping (TR-008)** — produces Indian (IS 1200 / CPWD) and international unit rates, layered fallback (TR-015 live market → Redis cache → Postgres cross-user learning → static).
- **Clash detection (TR-016)** — axis-aligned bounding-box analysis, single-model and multi-model federated, severity classification, 2.5 cm tolerance default. Caps at 5,000 clashes to keep payloads sane.
- **IFC export (EX-001)** — always returns a valid ISO-10303-21 STEP file that opens in BlenderBIM, ArchiCAD, Navisworks. 4 discipline variants per run. Includes CSI/NBC classifications, Pset_*Common property sets, deterministic GUIDs when a project ID is supplied.
- **Standalone viewer** — Three.js + web-ifc, runs entirely in the browser. Persistent via IndexedDB.
- **R2 storage** — IFC files cached under `ifc/YYYY/MM/DD/`, building assets under `buildings/YYYY/MM/DD/{id}/`.

### Preview or partial

- **Python IfcOpenShell microservice (`neobim-ifc-service/`)** — scaffolded and Dockerised, but only the **export** path is used in production; when the service is unreachable (env var unset, cold start, network timeout), EX-001 silently falls back to the TypeScript exporter with no user-visible retry.
- **BIM Query Engine (TR-009)**, **Delta Comparator (TR-010)**, **Material/Carbon Inference (TR-011)**, **Zoning Compliance (TR-006 – "Coming Soon")**, **IFC-to-Web Converter (GN-006)**, **Speckle Publisher (EX-004)** — present in the catalogue with input/output shapes defined, but **not wired to any handler**. They cannot run from the canvas.
- **TypeScript IFC exporter geometry** — by design, **rebar, curtain-wall mullions, and MEP segments are emitted as metadata only, without body geometry**, because earlier iterations produced "flying debris" in viewers on non-rectangular buildings. Takeoff tools see the entities; viewers see the perimeter shell. The Python service emits proper geometry — so choosing the IfcOpenShell path matters when the user wants a visually rich model.
- **Two "live nodes" lists** — the node catalogue and the client executor define slightly different sets; the difference doesn't break anything but is a source of confusion.
- **Server-side IFC parsing** for files that don't fit the browser path (very large, >~30 MB, or with complex boolean/faceted geometry) — the route exists, the WASM works; the architecture doc anticipates calling the Python service as a better fallback but **that call is not yet wired from TR-007**.

---

## 4. Inputs required and outputs produced

### Inputs (authoring side)

- **Primary:** a `.ifc` file, IFC2X3 or IFC4, ≤ 100 MB. Must start with `ISO-10303-21;`.
- **Optional supplementary:** additional Structural and MEP `.ifc` files for clash federation.
- **Location:** country/state/city text or structured JSON (enables INR pricing, seismic/wind zones, regional factors).
- **Design brief:** PDF or free text (only needed for the massing-first path).

### Outputs

- **Quantities table** — headers: Category, Element, Gross Area, Opening Area, Net Area, Volume, Qty, Unit. 50–200 rows typical. Includes per-storey, external/internal wall split, covering-type detail (flooring/ceiling/cladding).
- **IFC Quality card** — score, per-issue counts (zero-volume elements, missing materials, unassigned storeys, suspicious thicknesses), smart warnings with actionable fixes (e.g. "*In Revit, enable 'Export Base Quantities'*").
- **BOQ table** — rows with unit price in local currency, total per line, M/L/E (material/labour/equipment) breakdown, waste applied, escalation, AACE class.
- **BOQ spreadsheet** — `.xlsx` and `.csv` download URLs.
- **IFC export** — up to 4 files per run: `{slug}_architectural_{date}.ifc`, `_structural`, `_mep`, `_combined` — each with an R2 download URL (or base64 data URI fallback).
- **Clash report** — table of element pairs with severity, overlap volume, storey, source-model labels in federated mode.
- **Interactive viewer** — at `/dashboard/ifc-viewer`; artifact cards in the canvas also embed a mini viewer.

### Example (WF-09 "IFC Model → BOQ Cost Estimate", Pune residential 5-storey IFC)

- Quantities table: ~120 rows (walls external/internal per floor, slabs per floor, columns, beams, doors, windows, finishes, roof, MEP segments).
- IFC Quality: 78/100, "GOOD", 3 warnings (missing Qto_Common on 12 members, 2 walls with implausible thickness).
- Total BOQ: `₹ 4.82 Cr` with labour/material/equipment split and sourced unit rates.
- Download: `wellness_center_sama_2026-04-17.xlsx` (~40 KB).

---

## 5. Business value

- **Time saved.** A quantity surveyor extracting a BOQ from a raw IFC manually typically spends 4–8 hours per medium building (~5,000 elements). This workflow reduces the mechanical extraction to seconds and the sanity-checking to minutes — leaving the QS free to focus on judgment calls.
- **Accuracy.** When the IFC contains `Qto_*BaseQuantities` (the buildingSMART gold standard), measurements are exact. When it doesn't, the tool is honest about it: the IFC Quality card explicitly warns the user and gives an actionable fix (usually "re-export from Revit with Export Base Quantities enabled"). Cross-user correction learning applies statistical nudges when ≥ 3 QS professionals have corrected the same element type.
- **Consistency.** CSI MasterFormat + NBC India Part 4 dual classification is baked in, so the same IFC always maps to the same division/code regardless of the operator's preference.
- **Round-trip fidelity.** IFC export targets Revit 2024, ArchiCAD 27, Tekla, Navisworks, Solibri, BlenderBIM. UUID v5 deterministic GUIDs mean re-exports do not churn element identities — helpful for model-versioning workflows.
- **Indian market fit.** The default region is India: IS 456 concrete grades, IS 800 steel, IS 875 wind zones, IS 1893 seismic zones, RERA registration fields, NBC 2016 classification, INR formatting with Cr/L, sample Indian EPDs (ACC, UltraTech, Tata Steel, JSW, SAIL), and Indian brand COBie catalogue (Kirloskar, Voltas, Blue Star, Havells, Schneider, Legrand, ABB, Waaree, Otis). Non-Indian users still get sensible defaults via `region: "eu" | "us"` with Uniclass/OmniClass/Uniformat/DIN/NATSPEC.
- **Where it fits in the AEC workflow.** Positioned between "design complete" and "tender". An architect hands off IFC; the QS uses NeoBIM to produce a first-pass BOQ for internal pricing within a day instead of a week, iterates with the architect on model quality, and exports a clean federated IFC package for consultants. Clash detection is a sanity check before sharing with contractors.

---

## 6. Current limitations a user would notice

- **No BIM Query** ("how many doors on level 3 with fire rating ≥ 60 min?" — catalogue says it exists, but nothing happens when wired). Similarly for **Delta Comparator**, **Carbon/Material Inference**, **Zoning Compliance**, **IFC-to-Web Converter**, **Speckle Publisher**.
- **The TypeScript exporter visually omits rebar, mullions, and MEP pipes/ducts/trays as body geometry** by default. Opens as a building with a perimeter shell and floors, but MEP and rebar look "empty" in viewers. They are present in the file as properly tagged entities for QS tools. The Python service produces full geometry when deployed.
- **No progress bar for long runs.** A 5-storey 80 MB IFC can take 30–90 s to parse server-side; the UI shows node status (running/success) but no percentage.
- **Supplementary IFC limit** — you can attach one Structural and one MEP sibling file, but not multiple of each.
- **"Large file" handling is split** — for files > ~1 MB, TR-007 takes a different code path that occasionally loses some diagnostic fields depending on which parser ran. Quantities are consistent; the "Behind the Scenes" panel may show fewer details in the fast-path.
- **Silent fallback on IfcOpenShell outage.** If the Python service is scaled to zero (cold start) and the first EX-001 call in a while times out, the user gets the TS-generated IFC with no banner saying "served by fallback". They may notice the difference only when comparing file sizes or opening the file in BlenderBIM.
- **Viewer is single-model.** The standalone viewer opens one IFC at a time; no federated view.
- **No versioning** — previous IFC uploads are auto-cleaned after ~3 days per the R2 constants. Cached viewer copy is kept per user in IndexedDB and clears on "Remove file".
- **API rate limits are plan-tier-based.** Free users: 3 lifetime executions. MINI/STARTER/PRO: monthly limits enforced via Redis. Heavy BOQ users on MINI can hit the ceiling mid-month.
- **IFC Upload parsing runs on the main browser thread** for the canvas tile (the standalone viewer has a Web Worker). Very large files may briefly freeze the canvas.

---

## 7. Open questions the team should answer before the next iteration

1. **When do we finish wiring the IfcOpenShell microservice into TR-007?** The architecture doc (`docs/ifcopenshell-microservice-architecture.md`) lays out a decision flow (use it when file > 25 MB, or when > 10 % elements have zero volume, or when IfcBooleanResult/IfcFacetedBrep is detected). Right now only EX-001 calls the service. This is the single biggest accuracy win available — complex-geometry elements currently contribute 0 to the BOQ.
2. **Should we ship TR-009 / TR-010 / TR-011 / EX-004 or remove them from the catalogue?** They appear in the palette, suggesting they work, and failing silently when dragged erodes trust. Pick a path: implement, delay with an explicit "Coming Soon" label, or remove.
3. **Do we want a unified "quality and confidence" dashboard?** Today the IFC Quality card, the parser diagnostics panel, the clash report, and the BOQ cost disclaimer all surface quality signals separately. A combined view would help a QS decide whether to trust the output for tender.
4. **Should supplementary IFC accept multiple files per discipline?** Large projects often have 2–5 MEP sub-discipline IFCs (plumbing, HVAC, fire, electrical). Current UI accepts one per discipline.
5. **Should the IfcOpenShell path become the default for EX-001?** Right now the TS fallback is first-class for resilience, but its metadata-only rebar/mullions/MEP make the file "lighter" than users expect. Making Python the default (with TS as explicit fallback on failure) would match user intuition — at the cost of requiring the service to be up.
6. **What's the R2 retention policy we want to advertise?** Code comments say 3 days for IFC, 25 days for other files. UNKNOWN whether the cleanup cron is actually running in production — worth confirming.
7. **Do we want a "Compare to last run" diff so users can see how their BOQ moved when the model changed?** The Delta Comparator node was designed for this but isn't implemented.
8. **Should the canvas IFC Upload tile offload parsing to a Web Worker** (as the standalone viewer already does) to avoid main-thread freezes on large files?
9. **Do we unify the two `LIVE_NODES` definitions** in the catalogue and the client executor, or rename them to mean different things (e.g. "real on server" vs "UI indicator")?
10. **What's our story when a user uploads an IFC from SketchUp / Rhino / Grasshopper** (faceted BRep, no base quantities)? Today: IFC Quality flags it, quantities degrade, but the user still sees a BOQ with cost numbers that may be 10–30 % understated. Do we hard-block, soft-warn (current), or route them through the Python path automatically?

---
