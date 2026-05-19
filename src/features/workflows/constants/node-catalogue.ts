import type { NodeCatalogueItem } from "@/types/nodes";

export const NODE_CATALOGUE: NodeCatalogueItem[] = [
  // ============================================================
  // INPUT NODES (Blue)
  // ============================================================
  {
    id: "IN-001",
    name: "Text Prompt",
    description: "Free-text input from user (design brief, style description)",
    category: "input",
    icon: "Type",
    inputs: [],
    outputs: [{ id: "text-out", label: "Text", type: "text" }],
    apiEngine: "Native",
    tags: ["text", "prompt", "brief"],
    executionTime: "< 1s",
  },
  {
    id: "IN-002",
    name: "PDF Upload",
    description: "Upload a PDF document (project brief, zoning text, competition doc)",
    category: "input",
    icon: "FileText",
    inputs: [],
    outputs: [
      { id: "pdf-out", label: "PDF", type: "pdf" },
      { id: "meta-out", label: "Metadata", type: "json" },
    ],
    apiEngine: "Native",
    tags: ["pdf", "document", "brief", "upload"],
    executionTime: "< 2s",
  },
  {
    id: "IN-003",
    name: "Image Upload",
    description: "Upload a reference image (sketch, photo, inspiration)",
    category: "input",
    icon: "Image",
    inputs: [],
    outputs: [{ id: "image-out", label: "Image", type: "image" }],
    apiEngine: "Native",
    tags: ["image", "sketch", "photo", "reference"],
    executionTime: "< 2s",
  },
  {
    id: "IN-004",
    name: "IFC Upload",
    description: "Upload an IFC/BIM model file",
    category: "input",
    icon: "Box",
    inputs: [],
    outputs: [{ id: "ifc-out", label: "IFC Model", type: "ifc" }],
    apiEngine: "IFCOpenShell",
    tags: ["ifc", "bim", "model", "revit"],
    executionTime: "< 5s",
  },
  {
    id: "IN-005",
    name: "Parameter Input",
    description: "Numeric parameter entry (floors, height, area, ratios)",
    category: "input",
    icon: "Sliders",
    inputs: [],
    outputs: [{ id: "params-out", label: "Parameters", type: "json" }],
    apiEngine: "Native",
    tags: ["parameters", "sliders", "numeric", "floors", "height"],
    executionTime: "< 1s",
  },
  {
    id: "IN-006",
    name: "Location Input",
    description: "Geographic location entry via address search or map pin",
    category: "input",
    icon: "MapPin",
    inputs: [],
    outputs: [{ id: "geo-out", label: "GeoJSON", type: "geojson" }],
    apiEngine: "Google Maps / OSM",
    tags: ["location", "map", "site", "address", "gis"],
    executionTime: "< 3s",
  },
  {
    id: "IN-007",
    name: "DXF/DWG Upload",
    description: "Upload CAD drawing files",
    category: "input",
    icon: "PenTool",
    inputs: [],
    outputs: [{ id: "cad-out", label: "2D Geometry", type: "geometry" }],
    apiEngine: "CAD Parser",
    tags: ["cad", "dxf", "dwg", "drawing", "autocad"],
    executionTime: "< 5s",
  },
  {
    id: "IN-008",
    name: "Multi-Image Upload",
    description: "Upload one or more building photos for multi-angle analysis and video rendering",
    category: "input",
    icon: "Images",
    inputs: [],
    outputs: [{ id: "images-out", label: "Images", type: "image" }],
    apiEngine: "Native",
    tags: ["images", "multi", "photo", "building", "upload", "batch"],
    executionTime: "< 3s",
  },
  {
    // IN-009 — Brief input.
    //
    // Canvas-native brief entry: tabbed text / PDF / DOCX upload. Outputs
    // raw `briefText` for the downstream Brief Enricher (TR-025). Replaces
    // the deleted /dashboard/brief-to-ifc/v3/new form's tabbed input on
    // canvas (Canvas Unification, 2026-05-17). Today this ships with the
    // Text tab implemented; PDF/DOCX tabs surface "Coming soon" — those
    // formats are still supported via IN-002 (PDF/DOCX Upload) chained
    // through TR-001 (Brief Parser).
    id: "IN-009",
    name: "Brief",
    description:
      "Paste a building brief, or upload a PDF/DOCX project document. Outputs raw text for the Brief Enricher (TR-025).",
    category: "input",
    icon: "FileText",
    inputs: [],
    outputs: [
      { id: "brief-out", label: "Brief Text", type: "text" },
    ],
    apiEngine: "Native",
    tags: ["brief", "text", "pdf", "docx", "ai", "ifc", "v3"],
    executionTime: "< 1s",
  },

  // ============================================================
  // TRANSFORM / AI NODES (Purple)
  // ============================================================
  {
    id: "TR-001",
    name: "Brief Parser",
    description: "Extract requirements, constraints, and program data from uploaded project brief PDFs",
    category: "transform",
    icon: "ScanText",
    inputs: [{ id: "pdf-in", label: "PDF", type: "pdf" }],
    outputs: [{ id: "text-out", label: "Structured Text", type: "text" }],
    apiEngine: "OpenAI GPT-4o-mini + Anthropic Claude (PDF vision fallback)",
    tags: ["pdf", "parse", "ocr", "extract", "text"],
    executionTime: "< 10s",
  },
  {
    id: "TR-002",
    name: "Requirements Extractor",
    description: "Use AI to convert extracted text into structured building requirements",
    category: "transform",
    icon: "Sparkles",
    inputs: [{ id: "text-in", label: "Text", type: "text" }],
    outputs: [{ id: "req-out", label: "Requirements JSON", type: "json" }],
    apiEngine: "OpenAI GPT",
    tags: ["ai", "requirements", "extract", "program", "constraints"],
    executionTime: "< 15s",
  },
  {
    id: "TR-003",
    name: "Design Brief Analyzer",
    description: "AI-powered analysis that converts text briefs into structured building programs with areas, floors, and spatial requirements",
    category: "transform",
    icon: "Building2",
    inputs: [{ id: "json-in", label: "Requirements", type: "json" }],
    outputs: [
      { id: "text-out", label: "Description", type: "text" },
      { id: "prog-out", label: "Program Blocks", type: "json" },
    ],
    apiEngine: "OpenAI GPT",
    tags: ["ai", "description", "program", "building", "narrative"],
    executionTime: "< 10s",
  },
  {
    id: "TR-004",
    name: "Image Understanding",
    description: "Analyze a reference image and extract design intent and style",
    category: "transform",
    icon: "Eye",
    inputs: [{ id: "image-in", label: "Image", type: "image" }],
    outputs: [
      { id: "text-out", label: "Design Interpretation", type: "text" },
      { id: "feat-out", label: "Extracted Features", type: "json" },
    ],
    apiEngine: "OpenAI Vision",
    tags: ["ai", "vision", "image", "style", "analysis"],
    executionTime: "< 15s",
  },
  {
    id: "TR-005",
    name: "Visualization Style Composer",
    description: "Compose architectural visualization parameters — style, materials, lighting, camera angle for DALL-E 3 rendering",
    category: "transform",
    icon: "Wand2",
    inputs: [
      { id: "geo-in", label: "3D Geometry", type: "geometry" },
      { id: "text-in", label: "Style Text", type: "text" },
    ],
    outputs: [
      { id: "prompt-out", label: "Composed Prompt", type: "text" },
      { id: "ctrl-out", label: "Control Image", type: "image" },
    ],
    apiEngine: "OpenAI GPT-4o-mini",
    tags: ["style", "prompt", "composition", "render", "visualization", "live"],
    executionTime: "< 8s",
  },
  {
    id: "TR-006",
    name: "Zoning Compliance Checker (Coming Soon)",
    description: "AI-assisted zoning guidance and code-aware recommendations (Coming Soon - Not for regulatory compliance)",
    category: "transform",
    icon: "ShieldCheck",
    inputs: [
      { id: "ifc-in", label: "IFC Model", type: "ifc" },
      { id: "rules-in", label: "Zoning Rules", type: "text" },
    ],
    outputs: [{ id: "report-out", label: "Compliance Report", type: "json" }],
    apiEngine: "IFCOpenShell + OpenAI GPT",
    tags: ["compliance", "zoning", "regulations", "check", "bim"],
    executionTime: "2-3 min",
  },
  {
    id: "TR-007",
    name: "Quantity Extractor",
    description: "Extract real quantities (gross/net area, volume, openings) from IFC models with automatic CSI MasterFormat mapping and per-storey breakdown",
    category: "transform",
    icon: "Calculator",
    inputs: [{ id: "ifc-in", label: "IFC Model", type: "ifc" }],
    outputs: [{ id: "qty-out", label: "Quantities JSON", type: "json" }],
    apiEngine: "web-ifc (WASM)",
    tags: ["quantities", "qto", "bim", "ifc", "takeoff", "measurement"],
    executionTime: "< 20s",
  },
  {
    id: "TR-008",
    name: "BOQ / Cost Mapper",
    description: "Map quantities to cost codes and unit prices (AI-estimated — verify with a quantity surveyor before tendering)",
    category: "transform",
    icon: "DollarSign",
    inputs: [
      { id: "qty-in", label: "Quantities", type: "json" },
    ],
    outputs: [{ id: "boq-out", label: "BOQ Line Items", type: "json" }],
    apiEngine: "OpenAI GPT + Cost DB",
    tags: ["boq", "cost", "estimation", "quantities", "rates"],
    executionTime: "< 20s",
  },
  {
    id: "TR-009",
    name: "BIM Query Engine",
    description: "Answer natural language questions about a BIM model",
    category: "transform",
    icon: "MessageSquare",
    inputs: [
      { id: "ifc-in", label: "IFC Model", type: "ifc" },
      { id: "query-in", label: "Question", type: "text" },
    ],
    outputs: [
      { id: "answer-out", label: "Answer", type: "text" },
      { id: "elements-out", label: "Queried Elements", type: "json" },
    ],
    apiEngine: "IFCOpenShell + OpenAI GPT",
    tags: ["bim", "query", "nlp", "ai", "ifc"],
    executionTime: "< 25s",
  },
  {
    id: "TR-010",
    name: "Delta Comparator",
    description: "Compare two IFC model versions and compute quantity deltas",
    category: "transform",
    icon: "GitCompare",
    inputs: [
      { id: "ifc-v1", label: "IFC v1", type: "ifc" },
      { id: "ifc-v2", label: "IFC v2", type: "ifc" },
    ],
    outputs: [{ id: "delta-out", label: "Delta Report", type: "json" }],
    apiEngine: "IFCOpenShell",
    tags: ["delta", "compare", "versioning", "changes", "ifc"],
    executionTime: "2-3 min",
  },
  {
    id: "TR-011",
    name: "Material / Carbon Inference",
    description: "Infer materials from IFC classification and compute embodied carbon",
    category: "transform",
    icon: "Leaf",
    inputs: [{ id: "qty-in", label: "Quantities + Materials", type: "json" }],
    outputs: [{ id: "carbon-out", label: "Carbon Report", type: "json" }],
    apiEngine: "Database + Calc Engine",
    tags: ["carbon", "sustainability", "materials", "lca", "embodied"],
    executionTime: "< 15s",
  },
  {
    id: "TR-012",
    name: "GIS Context Loader",
    description: "Load site context data (terrain, nearby buildings, lot boundary)",
    category: "transform",
    icon: "Globe",
    inputs: [{ id: "geo-in", label: "GeoJSON Location", type: "geojson" }],
    outputs: [
      { id: "ctx-geo-out", label: "Context Mesh", type: "geometry" },
      { id: "site-out", label: "Site Data", type: "json" },
    ],
    apiEngine: "Google Maps 3D / OSM / Mapbox",
    tags: ["gis", "context", "site", "terrain", "map"],
    executionTime: "< 20s",
  },

  {
    id: "TR-015",
    name: "Market Intelligence Agent",
    description: "AI agent that researches live construction material prices (steel, cement, sand) via web search — returns sourced, timestamped prices for BOQ accuracy",
    category: "transform",
    icon: "TrendingUp",
    inputs: [
      { id: "location-in", label: "Location", type: "json" },
    ],
    outputs: [{ id: "prices-out", label: "Market Prices JSON", type: "json" }],
    apiEngine: "Anthropic Claude + Web Search",
    tags: ["market", "prices", "steel", "cement", "live", "research", "agent", "intelligence"],
    executionTime: "< 30s",
  },

  {
    id: "TR-016",
    name: "Clash Detector",
    description: "Detects spatial overlaps between building elements (pipes through beams, ducts through columns) using bounding-box collision analysis — generates a clash report with severity classification",
    category: "transform",
    icon: "AlertTriangle",
    inputs: [
      { id: "ifc-in", label: "IFC Model", type: "ifc" },
    ],
    outputs: [{ id: "clashes-out", label: "Clash Report", type: "json" }],
    apiEngine: "web-ifc (WASM)",
    tags: ["clash", "detection", "collision", "coordination", "bim", "ifc", "quality", "mep", "structural"],
    executionTime: "< 60s",
  },

  // ── Brief-to-IFC v3 (Canvas Unification, 2026-05-17) ──
  // The v3 pipeline as 4 transparent canvas stages. Replaces the
  // deleted GN-013 mega-node and the deleted /dashboard/brief-to-ifc/v3/new
  // form. Each node calls a dedicated v3 backend endpoint and surfaces
  // its own artifacts on canvas (BriefSpec, agent KPIs, validator
  // verdict, top/iso PNG previews).
  {
    id: "TR-025",
    name: "Brief Enricher",
    description:
      "Layer 1 — converts raw brief text into a tender-grade BriefSpec via Anthropic forced tool_use. ~15-30s, ~$0.03-0.07.",
    category: "transform",
    icon: "Wand2",
    inputs: [
      { id: "brief-in", label: "Brief Text", type: "text" },
    ],
    outputs: [
      { id: "spec-out", label: "BriefSpec", type: "json" },
    ],
    apiEngine: "Anthropic Claude (forced tool_use)",
    tags: ["ai", "brief", "enrich", "spec", "ifc", "v3", "anthropic"],
    executionTime: "15-30s",
  },
  {
    id: "TR-026",
    name: "IFC Agent Builder",
    description:
      "Layer 2 — agent loop authors an IFC2X3 model from the BriefSpec via tool-using Opus 4.7 + Python sandbox. Geometric validators reject any output that doesn't match the brief.",
    category: "transform",
    icon: "Bot",
    inputs: [
      { id: "spec-in", label: "BriefSpec", type: "json" },
    ],
    outputs: [
      { id: "ifc-out", label: "IFC File", type: "ifc" },
      { id: "kpi-out", label: "Stats (entities, turns, cost)", type: "json" },
    ],
    apiEngine: "Anthropic Opus 4.7 + BuildFlow Sandbox (Railway)",
    tags: ["ai", "ifc", "agent", "opus", "v3", "anthropic", "ifcopenshell"],
    executionTime: "30-150s",
  },
  {
    id: "TR-027",
    name: "Geometric Validator",
    description:
      "Runs the 4 brief-aware visual validators (world bbox, space polygons, origin collapse, element coverage) against the generated IFC. Surfaces verdict + dimensions on canvas.",
    category: "transform",
    icon: "ShieldCheck",
    inputs: [
      { id: "ifc-in", label: "IFC File", type: "ifc" },
    ],
    outputs: [
      { id: "verdict-out", label: "Verdict + Bbox", type: "json" },
      { id: "ifc-out", label: "IFC File (passthrough)", type: "ifc" },
    ],
    apiEngine: "BuildFlow Visual Validators (Python)",
    tags: ["validate", "geometry", "bbox", "ifc", "v3", "qa"],
    executionTime: "< 3s",
  },
  {
    id: "TR-028",
    name: "Item Decomposer (advisory)",
    description:
      "Item Decomposer (advisory) — suggests part breakdown for furniture/equipment items via parallel Opus calls. Each item gets a parts[] array with 6+ sub-components as suggestions for the agent.",
    category: "transform",
    icon: "Wand2",
    inputs: [
      { id: "spec-in", label: "BriefSpec", type: "json" },
      { id: "classification-in", label: "Classification", type: "text" },
    ],
    outputs: [
      { id: "spec-out", label: "BriefSpec (with parts)", type: "json" },
      { id: "metrics-out", label: "Decomposer Metrics", type: "json" },
    ],
    apiEngine: "Anthropic Opus 4.7 (parallel tool_use)",
    tags: ["ai", "decompose", "furniture", "parts", "ifc", "v3", "anthropic"],
    executionTime: "5-20s",
  },

  // ── Phase Beta 2 (2026-05-18): 5 new pipeline nodes ──
  {
    id: "TR-029",
    name: "Architectural Reasoner (advisory)",
    description:
      "Architectural Reasoner (advisory) — suggests rationale and positioning for furniture items via Opus. Photography studios get backdrop-away-from-light, offices get desk-facing-window, etc.",
    category: "transform",
    icon: "Compass",
    inputs: [
      { id: "spec-in", label: "BriefSpec", type: "json" },
    ],
    outputs: [
      { id: "spec-out", label: "BriefSpec (with rationale)", type: "json" },
    ],
    apiEngine: "Anthropic Opus 4.7 (single call)",
    tags: ["ai", "reasoning", "positioning", "domain", "v3", "anthropic"],
    executionTime: "15-30s",
  },
  {
    id: "TR-030",
    name: "Trim Specifier (advisory)",
    description:
      "Trim Specifier (advisory) — suggests trim items including skirting along walls, door hinges/handles/strike plates, window handles. Single Opus call.",
    category: "transform",
    icon: "Wrench",
    inputs: [
      { id: "spec-in", label: "BriefSpec", type: "json" },
    ],
    outputs: [
      { id: "spec-out", label: "BriefSpec (with trim)", type: "json" },
    ],
    apiEngine: "Anthropic Opus 4.7 (single call)",
    tags: ["ai", "trim", "hardware", "skirting", "v3", "anthropic"],
    executionTime: "10-25s",
  },
  {
    id: "TR-031",
    name: "Material Resolver",
    description:
      "Resolves material strings to 50-entry canonical library via fuzzy match — deterministic, sub-50ms. No AI call.",
    category: "transform",
    icon: "Palette",
    inputs: [
      { id: "spec-in", label: "BriefSpec", type: "json" },
    ],
    outputs: [
      { id: "spec-out", label: "BriefSpec (normalized materials)", type: "json" },
    ],
    apiEngine: "Deterministic (no AI call)",
    tags: ["material", "resolver", "deterministic", "v3"],
    executionTime: "< 50ms",
  },
  {
    id: "TR-034",
    name: "Spec Validator",
    description:
      "Deterministic spec validation gate — fails fast on structural errors (missing polygons, NaN coords, broken refs), warns on quality issues.",
    category: "transform",
    icon: "ShieldCheck",
    inputs: [
      { id: "spec-in", label: "BriefSpec", type: "json" },
    ],
    outputs: [
      { id: "spec-out", label: "BriefSpec (validated)", type: "json" },
      { id: "report-out", label: "Validation Report", type: "json" },
    ],
    apiEngine: "Deterministic (no AI call)",
    tags: ["validate", "spec", "deterministic", "gate", "v3"],
    executionTime: "< 10ms",
  },
  {
    id: "TR-032",
    name: "Vision Inspector",
    description:
      "Renders IFC to PNG, feeds to Opus 4.7 vision with briefSpec. Returns quality_score 0-100, issues list, pass/fail. Read-only — does not modify IFC.",
    category: "transform",
    icon: "Eye",
    inputs: [
      { id: "ifc-in", label: "IFC File", type: "ifc" },
    ],
    outputs: [
      { id: "report-out", label: "Vision Report", type: "json" },
      { id: "ifc-out", label: "IFC File (passthrough)", type: "ifc" },
    ],
    apiEngine: "Anthropic Opus 4.7 (vision)",
    tags: ["ai", "vision", "quality", "inspection", "v3", "anthropic"],
    executionTime: "20-45s",
  },
  // Phase Beta 3: Self-correcting pipeline nodes
  {
    id: "TR-033",
    name: "Spec Patcher",
    description:
      "Combines Hard Verifier mismatches + Vision Inspector issues to decide if a rebuild is needed. Generates MUST_BUILD patches for collapsed or missing items. Part of the self-correcting pipeline.",
    category: "transform",
    icon: "Wrench",
    inputs: [
      { id: "ifc-in", label: "IFC File", type: "ifc" },
      { id: "report-in", label: "Reports", type: "json" },
    ],
    outputs: [
      { id: "spec-out", label: "Patched Spec", type: "json" },
      { id: "ifc-out", label: "Best IFC", type: "ifc" },
    ],
    apiEngine: "Anthropic Opus 4.7",
    tags: ["ai", "patch", "self-correct", "retry", "v3", "anthropic"],
    executionTime: "5-15s",
  },
  {
    id: "TR-035",
    name: "Hard Verifier",
    description:
      "Deterministic verification: compares spec.furniture[].parts vs actual IfcRelAggregates in the produced IFC. Reports parts_coverage, trim_coverage, and itemised mismatches.",
    category: "transform",
    icon: "ShieldCheck",
    inputs: [
      { id: "ifc-in", label: "IFC File", type: "ifc" },
      { id: "spec-in", label: "BriefSpec", type: "json" },
    ],
    outputs: [
      { id: "report-out", label: "Verifier Report", type: "json" },
      { id: "ifc-out", label: "IFC File (passthrough)", type: "ifc" },
    ],
    apiEngine: "Python ifcopenshell (Railway)",
    tags: ["verification", "deterministic", "ifc", "parts", "quality", "v3"],
    executionTime: "5-15s",
  },

  // ── Brief-to-IFC v2 (Phase 1) — AI-powered faithful IFC creation ──
  {
    id: "TR-024",
    name: "Brief Enricher",
    description:
      "Reads the user's brief and enriches it into a surgical-grade IFC specification ready for direct translation.",
    category: "transform",
    icon: "Wand2",
    inputs: [{ id: "brief-in", label: "Brief", type: "text" }],
    outputs: [{ id: "enriched-out", label: "Enriched Spec", type: "text" }],
    apiEngine: "Anthropic Claude Sonnet 4.6",
    tags: ["ai", "brief", "enrich", "spec", "ifc", "v2", "claude"],
    executionTime: "30-90s",
    // v2 IFC pipeline — retired 2026-05-17. Layer 1 enrichment is now
    // a dedicated canvas stage (TR-025 Brief Enricher).
    deprecated: true,
    hiddenFromPicker: true,
    replacedBy: "TR-025",
    deprecationNote:
      "Replaced by Brief Enricher (TR-025) in the v3 canvas chain. v2 pipeline retired 2026-05-17.",
  },
  {
    id: "TR-022",
    name: "IFC Architect",
    description:
      "Generates IfcOpenShell Python that authors the IFC from the enriched brief.",
    category: "transform",
    icon: "DraftingCompass",
    inputs: [{ id: "brief-in", label: "Enriched Spec", type: "text" }],
    outputs: [{ id: "script-out", label: "Builder Script", type: "text" }],
    apiEngine: "Anthropic Claude Opus 4.7",
    tags: ["ai", "ifc", "architect", "ifcopenshell", "opus", "v2", "claude"],
    executionTime: "1-4 min",
    // v2 IFC pipeline — retired 2026-05-17. v2 produced broken
    // millimetre-scale IFCs (see PHASE_BEAST_MODE_CLOSEOUT_REPORT_2026-05-16.md).
    // The v3 canvas chain (TR-025 → TR-026 → TR-027 → EX-007) replaces it.
    deprecated: true,
    hiddenFromPicker: true,
    replacedBy: "TR-026",
    deprecationNote:
      "Replaced by IFC Agent Builder (TR-026) in the v3 canvas chain. v2 pipeline retired 2026-05-17.",
  },

  // ── Control Flow / Branching ──
  {
    id: "TR-013",
    name: "Condition Router",
    description: "Route data based on a condition — send output to the 'true' or 'false' path based on a rule you define",
    category: "transform",
    icon: "GitBranch",
    inputs: [
      { id: "data-in", label: "Data", type: "any" },
      { id: "condition-in", label: "Condition", type: "text" },
    ],
    outputs: [
      { id: "true-out", label: "True Path", type: "any" },
      { id: "false-out", label: "False Path", type: "any" },
    ],
    apiEngine: "Native",
    tags: ["condition", "if", "branch", "router", "logic", "filter"],
    executionTime: "< 1s",
  },
  {
    id: "TR-014",
    name: "Data Merge",
    description: "Combine outputs from multiple nodes into a single unified result for downstream processing",
    category: "transform",
    icon: "GitMerge",
    inputs: [
      { id: "input-a", label: "Input A", type: "any" },
      { id: "input-b", label: "Input B", type: "any" },
    ],
    outputs: [
      { id: "merged-out", label: "Merged", type: "json" },
    ],
    apiEngine: "Native",
    tags: ["merge", "combine", "join", "aggregate"],
    executionTime: "< 1s",
  },

  // ============================================================
  // GENERATE / GEOMETRY NODES (Green)
  // ============================================================
  {
    id: "GN-001",
    name: "Massing Generator",
    description: "Generate procedural BIM massing geometry with walls, windows, doors, slabs, columns, and MEP",
    category: "generate",
    icon: "Box",
    inputs: [{ id: "req-in", label: "Requirements", type: "json" }],
    outputs: [
      { id: "geo-out", label: "3D Massing", type: "geometry" },
      { id: "kpi-out", label: "KPIs", type: "json" },
    ],
    apiEngine: "Procedural BIM",
    tags: ["massing", "3d", "geometry", "building", "volume", "bim", "ifc"],
    executionTime: "10-30s",
  },
  {
    id: "GN-002",
    name: "Variant Generator",
    description: "Generate N design variants by systematically varying parameters",
    category: "generate",
    icon: "Layers",
    inputs: [
      { id: "params-in", label: "Parameter Ranges", type: "json" },
      { id: "geo-in", label: "Base Geometry", type: "geometry" },
    ],
    outputs: [
      { id: "variants-out", label: "3D Variants", type: "geometry" },
      { id: "metrics-out", label: "Metrics per Variant", type: "json" },
    ],
    apiEngine: "Rhino.Compute",
    tags: ["variants", "options", "design", "exploration", "parametric"],
    executionTime: "< 60s",
  },
  {
    id: "GN-003",
    name: "Concept Render Generator",
    description: "AI concept renders (not photorealistic) from building descriptions — 4 view types: exterior, floor plan, site plan, interior",
    category: "generate",
    icon: "Palette",
    inputs: [
      { id: "ctrl-in", label: "Control Image", type: "image" },
      { id: "prompt-in", label: "Style Prompt", type: "text" },
    ],
    outputs: [{ id: "images-out", label: "Concept Images", type: "image" }],
    apiEngine: "OpenAI DALL·E 3",
    tags: ["image", "render", "visualization", "concept", "ai", "exterior", "floor plan", "site plan", "interior"],
    executionTime: "2-3 min",
    viewType: "exterior",
  },
  {
    id: "GN-004",
    name: "Floor Plan Generator",
    description: "Generate 2D floor plan layouts from room program and footprint (experimental — for design exploration)",
    category: "generate",
    icon: "LayoutGrid",
    inputs: [{ id: "prog-in", label: "Room Program", type: "json" }],
    outputs: [
      { id: "plan-out", label: "Floor Plan", type: "geometry" },
      { id: "img-out", label: "Annotated Plan Image", type: "image" },
    ],
    apiEngine: "OR-Tools + Rhino.Compute",
    tags: ["floor plan", "layout", "rooms", "2d", "planning"],
    executionTime: "< 45s",
  },
  {
    id: "GN-005",
    name: "Façade Generator",
    description: "Generate parametric façade patterns on massing surfaces",
    category: "generate",
    icon: "Grid",
    inputs: [
      { id: "geo-in", label: "Massing", type: "geometry" },
      { id: "params-in", label: "Style Parameters", type: "json" },
    ],
    outputs: [{ id: "facade-out", label: "Detailed Façade Model", type: "geometry" }],
    apiEngine: "Rhino.Compute (Grasshopper)",
    tags: ["facade", "cladding", "parametric", "detail", "3d"],
    executionTime: "< 60s",
  },
  {
    id: "GN-006",
    name: "IFC-to-Web Converter",
    description: "Convert IFC model to web-viewable format for inline canvas viewing",
    category: "generate",
    icon: "Monitor",
    inputs: [{ id: "ifc-in", label: "IFC Model", type: "ifc" }],
    outputs: [{ id: "web-out", label: "Web 3D Model", type: "geometry" }],
    apiEngine: "xeokit",
    tags: ["ifc", "viewer", "web", "3d", "bim"],
    executionTime: "< 20s",
  },

  {
    id: "GN-007",
    name: "Image to 3D (SAM 3D)",
    description: "Convert a building image into a 3D model (GLB/PLY) using Meta's SAM 3D via fal.ai",
    category: "generate",
    icon: "Box",
    inputs: [{ id: "image-in", label: "Building Image", type: "image" }],
    outputs: [
      { id: "glb-out", label: "3D Model (GLB)", type: "geometry" },
      { id: "ply-out", label: "Gaussian Splat (PLY)", type: "binary" },
    ],
    apiEngine: "fal.ai SAM 3D",
    tags: ["3d", "sam3d", "image-to-3d", "glb", "ply", "meta", "building", "mesh"],
    executionTime: "< 30s",
  },
  {
    id: "GN-008",
    name: "Text to 3D Generator",
    description: "Generate a realistic 3D building model from text — chains DALL-E 3 image generation with SAM 3D conversion in one step",
    category: "generate",
    icon: "Boxes",
    inputs: [
      { id: "text-in", label: "Building Description", type: "text" },
    ],
    outputs: [
      { id: "glb-out", label: "3D Model (GLB)", type: "geometry" },
      { id: "image-out", label: "Generated Image", type: "image" },
    ],
    apiEngine: "OpenAI DALL·E 3 + fal.ai SAM 3D",
    tags: ["text-to-3d", "3d", "ai", "dall-e", "sam3d", "building", "generate", "mesh", "glb"],
    executionTime: "< 60s",
  },

  {
    id: "GN-010",
    name: "Hi-Fi 3D Reconstructor",
    description: "Reconstruct a hyper-detailed, textured 3D mesh (GLB/OBJ) from multi-view rendered images — produces ultra-realistic architectural models with materials, windows, and façade detail",
    category: "generate",
    icon: "Rotate3d",
    inputs: [
      { id: "images-in", label: "Multi-View Renders", type: "image" },
      { id: "desc-in", label: "Building Description", type: "text" },
    ],
    outputs: [
      { id: "glb-out", label: "Detailed 3D Model (GLB)", type: "geometry" },
      { id: "preview-out", label: "360° Preview", type: "image" },
    ],
    apiEngine: "Meshy v4 / Tripo3D / Rodin Gen-2",
    tags: ["3d", "reconstruction", "hi-fi", "mesh", "textured", "glb", "obj", "detailed", "ultra-realistic"],
    executionTime: "2-4 min",
  },

  {
    id: "GN-009",
    name: "Video Walkthrough Generator",
    description: "Generate a cinematic HD video walkthrough (1080p) from concept renders — physics-aware camera motion, golden hour lighting, professional drone cinematography feel. Best-in-class for architecture.",
    category: "generate",
    icon: "Video",
    inputs: [
      { id: "geo-in", label: "3D Model / Renders", type: "geometry" },
      { id: "style-in", label: "Style & Camera", type: "json" },
    ],
    outputs: [{ id: "video-out", label: "HD MP4 Video (1080p)", type: "binary" }],
    apiEngine: "Kling 3.0 Official API",
    tags: ["video", "walkthrough", "flythrough", "animation", "render", "cinematic", "hd", "1080p"],
    executionTime: "3-8 min",
  },

  {
    id: "GN-011",
    name: "Interactive 3D Viewer",
    description:
      "Generates an explorable 3D model directly from floor plan analysis — every wall, door, window, and room in the correct position. Orbit, walk through, and inspect the model in your browser.",
    category: "generate",
    icon: "Box",
    inputs: [
      { id: "json-in", label: "Floor Plan Geometry", type: "json" },
    ],
    outputs: [
      { id: "html-out", label: "3D Viewer (HTML)", type: "binary" },
    ],
    apiEngine: "Three.js r128 (client-side, no AI)",
    tags: ["3d", "viewer", "interactive", "floor-plan", "three-js", "model", "walkthrough"],
    executionTime: "< 5s",
  },

  {
    id: "GN-012",
    name: "Floor Plan Editor",
    description:
      "Interactive 2D CAD editor for floor plans — edit walls, doors, windows, rooms, furniture, dimensions, and annotations. Connects upstream geometry (from TR-004 or GN-004) to downstream BOQ, IFC, and report nodes. Supports Vastu analysis, building code compliance, and real-time cost estimation.",
    category: "generate",
    icon: "PenTool",
    inputs: [
      { id: "json-in", label: "Floor Plan Geometry", type: "json" },
      { id: "brief-in", label: "Design Brief", type: "text" },
    ],
    outputs: [
      { id: "project-out", label: "Floor Plan Project", type: "json" },
      { id: "geo-out", label: "IFC Geometry", type: "geometry" },
      { id: "schedule-out", label: "Room Schedule", type: "json" },
      { id: "boq-out", label: "BOQ Quantities", type: "json" },
      { id: "svg-out", label: "SVG Drawing", type: "image" },
    ],
    apiEngine: "Built-in CAD (client-side, no AI)",
    tags: ["floor-plan", "cad", "editor", "2d", "interactive", "boq", "vastu", "ifc", "walls", "rooms"],
    executionTime: "Interactive",
  },

  // ============================================================
  // EXPORT / OUTPUT NODES (Amber)
  // ============================================================
  {
    id: "EX-001",
    name: "IFC Exporter",
    description: "Export BIM-compatible massing as a downloadable IFC4 file with walls, slabs, and storeys",
    category: "export",
    icon: "Download",
    inputs: [
      { id: "geo-in", label: "3D Geometry", type: "geometry" },
      { id: "meta-in", label: "Metadata", type: "json" },
    ],
    outputs: [{ id: "ifc-out", label: "IFC File", type: "ifc" }],
    apiEngine: "IFCOpenShell",
    tags: ["ifc", "export", "bim", "file", "download"],
    executionTime: "< 15s",
  },
  {
    id: "EX-002",
    name: "BOQ / Spreadsheet Exporter",
    description: "Export bill of quantities or cost estimate as XLSX/CSV",
    category: "export",
    icon: "Table",
    inputs: [{ id: "boq-in", label: "BOQ Data", type: "json" }],
    outputs: [{ id: "xlsx-out", label: "XLSX + CSV", type: "csv" }],
    apiEngine: "SpreadsheetML / openpyxl",
    tags: ["boq", "excel", "spreadsheet", "export", "quantities"],
    executionTime: "< 10s",
  },
  {
    id: "EX-003",
    name: "PDF Report Generator",
    description: "Generate a formatted PDF report (compliance, cost summary, design brief)",
    category: "export",
    icon: "FileOutput",
    inputs: [
      { id: "data-in", label: "Report Data", type: "json" },
      { id: "img-in", label: "Images (optional)", type: "image" },
    ],
    outputs: [{ id: "pdf-out", label: "PDF Report", type: "pdf" }],
    apiEngine: "ReportLab / WeasyPrint",
    tags: ["pdf", "report", "export", "document"],
    executionTime: "< 15s",
  },
  {
    id: "EX-004",
    name: "Speckle Publisher",
    description: "Publish 3D model or data to Speckle for sharing and versioning",
    category: "export",
    icon: "Share2",
    inputs: [{ id: "geo-in", label: "3D Model or IFC", type: "geometry" }],
    outputs: [{ id: "url-out", label: "Speckle Commit URL", type: "text" }],
    apiEngine: "Speckle SDK",
    tags: ["speckle", "share", "collaborate", "versioning", "3d"],
    executionTime: "< 20s",
  },
  {
    id: "EX-005",
    name: "Dashboard Publisher",
    description: "Publish workflow outputs to an analytics dashboard",
    category: "export",
    icon: "BarChart3",
    inputs: [{ id: "metrics-in", label: "Metrics JSON", type: "json" }],
    outputs: [{ id: "dash-out", label: "Dashboard Link", type: "text" }],
    apiEngine: "Power BI / Custom Dashboard",
    tags: ["dashboard", "analytics", "kpi", "reporting"],
    executionTime: "< 10s",
  },
  {
    // Brief-to-IFC v2 (Phase 1). NOTE: this slot previously held a
    // mock-only "Image Exporter" node (no handler, not in REAL_NODE_IDS,
    // not in LIVE_NODES, referenced by zero prebuilt workflows). It is
    // replaced here by the AI IFC Generator — see the Phase 1 report's
    // "Ambiguities Resolved" section.
    id: "EX-006",
    name: "AI IFC Generator (v2 retired)",
    description:
      "RETIRED — v2 pipeline produced mm-scale broken IFCs. Use the 4-node v3 chain (TR-025 → TR-026 → TR-027 → EX-007) via the AI-Powered IFC template instead.",
    category: "export",
    icon: "Boxes",
    inputs: [{ id: "script-in", label: "Builder Script", type: "text" }],
    outputs: [{ id: "ifc-out", label: "IFC File", type: "ifc" }],
    apiEngine: "BuildFlow Python Sandbox (Railway) — retired",
    tags: ["ifc", "sandbox", "python", "generate", "ai", "v2", "ifcopenshell", "retired"],
    executionTime: "30-120s",
    // v2 IFC pipeline — retired 2026-05-17 after the MILLI.METRE bug
    // was caught + fixed in v3 (PHASE_BEAST_MODE_CLOSEOUT_REPORT_2026-05-16.md).
    // Catalogue entry kept so old workflows in the DB still parse on load.
    deprecated: true,
    hiddenFromPicker: true,
    replacedBy: "EX-007",
    deprecationNote:
      "Replaced by IFC Export + Preview (EX-007). v2 pipeline retired 2026-05-17.",
  },
  {
    id: "EX-007",
    name: "IFC Export",
    description:
      "Final stage of the AI IFC pipeline — exposes the IFC R2 URL and deep link to the BIM viewer. Passthrough of the finalized IFC asset.",
    category: "export",
    icon: "FileBox",
    inputs: [
      { id: "ifc-in", label: "Validated IFC", type: "ifc" },
    ],
    outputs: [
      { id: "ifc-out", label: "IFC File", type: "ifc" },
    ],
    apiEngine: "R2 passthrough (no sandbox call)",
    tags: ["ifc", "v3", "export", "download"],
    executionTime: "< 1s",
  },
];

export const NODE_CATALOGUE_MAP = new Map(
  NODE_CATALOGUE.map((node) => [node.id, node])
);

/**
 * The catalogue subset visible in the canvas node-picker.
 *
 * `NODE_CATALOGUE` is the full registry — every node in here can be
 * referenced by an existing workflow saved in the DB, so we MUST NOT
 * remove entries (deletion breaks workflow load). To retire a node
 * from the user-facing surface, set `hiddenFromPicker: true` on its
 * catalogue entry; this derived export filters those out so the picker
 * never offers them again.
 *
 * Use `NODE_CATALOGUE` (or `NODE_CATALOGUE_MAP`) when looking up an
 * existing workflow's node definition. Use `VISIBLE_NODE_CATALOGUE`
 * when rendering the picker.
 */
export const VISIBLE_NODE_CATALOGUE: NodeCatalogueItem[] = NODE_CATALOGUE.filter(
  (n) => !n.hiddenFromPicker,
);

export const NODES_BY_CATEGORY = {
  input: VISIBLE_NODE_CATALOGUE.filter((n) => n.category === "input"),
  transform: VISIBLE_NODE_CATALOGUE.filter((n) => n.category === "transform"),
  generate: VISIBLE_NODE_CATALOGUE.filter((n) => n.category === "generate"),
  export: VISIBLE_NODE_CATALOGUE.filter((n) => n.category === "export"),
};

export const CATEGORY_CONFIG = {
  input: {
    label: "Input",
    color: "#00F5FF",
    bgColor: "rgba(0, 245, 255, 0.06)",
    borderColor: "rgba(0, 245, 255, 0.3)",
    description: "Data sources that feed into your workflow",
  },
  transform: {
    label: "Transform / AI",
    color: "#B87333",
    bgColor: "rgba(184, 115, 51, 0.06)",
    borderColor: "rgba(184, 115, 51, 0.3)",
    description: "AI-powered processing and data transformation",
  },
  generate: {
    label: "Generate / Geometry",
    color: "#FFBF00",
    bgColor: "rgba(255, 191, 0, 0.06)",
    borderColor: "rgba(255, 191, 0, 0.3)",
    description: "3D modeling, image generation, and variant creation",
  },
  export: {
    label: "Export / Output",
    color: "#4FC3F7",
    bgColor: "rgba(79, 195, 247, 0.06)",
    borderColor: "rgba(79, 195, 247, 0.3)",
    description: "File exports, reports, and delivery",
  },
} as const;

/** Nodes that use real API calls (not mock/sample data).
 *  TR-001 added — it has had a real handler all along; its absence here
 *  was the source of the "DEMO" badge bug (Phase 0 §1.2). TR-024/TR-022/
 *  EX-006 are the Brief-to-IFC v2 (Phase 1) nodes (retired). TR-025/26/27
 *  and EX-007 are the v3 Canvas Unification nodes (2026-05-17). */
export const LIVE_NODES = new Set(['TR-001', 'TR-003', 'TR-007', 'TR-008', 'TR-015', 'TR-016', 'TR-022', 'TR-024', 'TR-025', 'TR-026', 'TR-027', 'TR-028', 'TR-029', 'TR-030', 'TR-031', 'TR-032', 'TR-033', 'TR-034', 'TR-035', 'GN-001', 'GN-003', 'GN-007', 'GN-008', 'GN-009', 'GN-010', 'EX-001', 'EX-002', 'EX-006', 'EX-007']);

// Mark isLive on catalogue items at module init
for (const node of NODE_CATALOGUE) {
  node.isLive = LIVE_NODES.has(node.id);
}
