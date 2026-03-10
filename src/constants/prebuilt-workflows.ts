import type { WorkflowTemplate } from "@/types/workflow";

// ─── Layout Constants ────────────────────────────────────────────────────────
// Input nodes are 320px wide, standard nodes are 220px wide.
// We use generous gaps (200px after input, 120px between standard nodes)
// to prevent visual overlap from glows, corner accents, and fitView scaling.
const INPUT_W = 320;
const NODE_W = 220;
const GAP_AFTER_INPUT = 200;  // gap between input right edge and next node
const GAP_BETWEEN = 120;      // gap between standard nodes

const X1 = 0;                                          // input node
const X2 = X1 + INPUT_W + GAP_AFTER_INPUT;             // 520
const X3 = X2 + NODE_W + GAP_BETWEEN;                  // 860
const X4 = X3 + NODE_W + GAP_BETWEEN;                  // 1200
const X5 = X4 + NODE_W + GAP_BETWEEN;                  // 1540
const X6 = X5 + NODE_W + GAP_BETWEEN;                  // 1880

const Y = 200; // default vertical position

export const PREBUILT_WORKFLOWS: WorkflowTemplate[] = [
  {
    id: "wf-01",
    name: "Text Prompt → Concept Building",
    description:
      "Enter a building idea in plain text → get a full building description, 3D massing model, and concept render in under a minute.",
    tags: ["concept", "visualization", "quick-start", "text-to-building"],
    category: "Concept Design",
    complexity: "simple",
    estimatedRunTime: "~45 seconds",
    requiredInputs: ["Text description of your building concept"],
    expectedOutputs: ["Building description card", "3D massing model", "Concept architectural image"],
    thumbnail: "https://picsum.photos/seed/wf01/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-001",
            label: "Text Prompt",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "text-out", label: "Text", type: "text" }],
            icon: "Type",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "TR-003",
            label: "Design Brief Analyzer",
            category: "transform",
            status: "idle",
            inputs: [{ id: "json-in", label: "Requirements", type: "json" }],
            outputs: [
              { id: "text-out", label: "Description", type: "text" },
              { id: "prog-out", label: "Program Blocks", type: "json" },
            ],
            icon: "Building2",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: Y },
          data: {
            catalogueId: "GN-001",
            label: "Massing Generator",
            category: "generate",
            status: "idle",
            inputs: [{ id: "req-in", label: "Requirements", type: "json" }],
            outputs: [
              { id: "geo-out", label: "3D Massing", type: "geometry" },
              { id: "kpi-out", label: "KPIs", type: "json" },
            ],
            icon: "Box",
          },
        },
        {
          id: "n4",
          type: "workflowNode",
          position: { x: X4, y: Y },
          data: {
            catalogueId: "GN-003",
            label: "Concept Render Generator",
            category: "generate",
            status: "idle",
            inputs: [
              { id: "ctrl-in", label: "Control Image", type: "image" },
              { id: "prompt-in", label: "Style Prompt", type: "text" },
            ],
            outputs: [{ id: "images-out", label: "Concept Images", type: "image" }],
            icon: "Palette",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "text-out", target: "n2", targetHandle: "json-in", type: "animatedEdge" },
        { id: "e2-3", source: "n2", sourceHandle: "prog-out", target: "n3", targetHandle: "req-in", type: "animatedEdge" },
        { id: "e3-4", source: "n3", sourceHandle: "geo-out", target: "n4", targetHandle: "ctrl-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-03",
    name: "Massing → Concept Images",
    description:
      "Provide a reference image → get an AI-analyzed building concept with a matching render.",
    tags: ["visualization", "render", "styles", "concept"],
    category: "Visualization",
    complexity: "simple",
    estimatedRunTime: "~45 seconds",
    requiredInputs: ["3D massing model or parameters"],
    expectedOutputs: ["3 concept images in different styles (Nordic, Brick urban, Timber contemporary)"],
    thumbnail: "https://picsum.photos/seed/wf03/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-005",
            label: "Parameter Input",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "params-out", label: "Parameters", type: "json" }],
            icon: "Sliders",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "TR-005",
            label: "Visualization Style Composer",
            category: "transform",
            status: "idle",
            inputs: [
              { id: "geo-in", label: "3D Geometry", type: "geometry" },
              { id: "text-in", label: "Style Text", type: "text" },
            ],
            outputs: [
              { id: "prompt-out", label: "Composed Prompt", type: "text" },
              { id: "ctrl-out", label: "Control Image", type: "image" },
            ],
            icon: "Wand2",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: Y },
          data: {
            catalogueId: "GN-003",
            label: "Concept Render Generator",
            category: "generate",
            status: "idle",
            inputs: [
              { id: "ctrl-in", label: "Control Image", type: "image" },
              { id: "prompt-in", label: "Style Prompt", type: "text" },
            ],
            outputs: [{ id: "images-out", label: "Concept Images", type: "image" }],
            icon: "Palette",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "params-out", target: "n2", targetHandle: "geo-in", type: "animatedEdge" },
        { id: "e2-3a", source: "n2", sourceHandle: "ctrl-out", target: "n3", targetHandle: "ctrl-in", type: "animatedEdge" },
        { id: "e2-3b", source: "n2", sourceHandle: "prompt-out", target: "n3", targetHandle: "prompt-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-04",
    name: "Parameters → 3D Building",
    description:
      "Start from a reference image → generate a 3D massing model that matches the building's proportions.",
    tags: ["parametric", "3d", "quick", "massing", "sliders"],
    category: "Concept Design",
    complexity: "simple",
    estimatedRunTime: "~20 seconds",
    requiredInputs: ["Building parameters (floors, height, area)"],
    expectedOutputs: ["Interactive 3D building model", "Building KPIs"],
    thumbnail: "https://picsum.photos/seed/wf04/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-005",
            label: "Parameter Input",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "params-out", label: "Parameters", type: "json" }],
            icon: "Sliders",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "GN-001",
            label: "Massing Generator",
            category: "generate",
            status: "idle",
            inputs: [{ id: "req-in", label: "Requirements", type: "json" }],
            outputs: [
              { id: "geo-out", label: "3D Massing", type: "geometry" },
              { id: "kpi-out", label: "KPIs", type: "json" },
            ],
            icon: "Box",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "params-out", target: "n2", targetHandle: "req-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-05",
    name: "Massing → IFC Export",
    description:
      "Create a 3D massing model from a reference image and export it as an IFC file for BIM software.",
    tags: ["ifc", "bim", "export", "bridge"],
    category: "BIM Export",
    complexity: "simple",
    estimatedRunTime: "2-3 minutes",
    requiredInputs: ["3D massing model"],
    expectedOutputs: ["Downloadable IFC file (.ifc)", "Export summary with element list"],
    thumbnail: "https://picsum.photos/seed/wf05/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-005",
            label: "Parameter Input",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "params-out", label: "Parameters", type: "json" }],
            icon: "Sliders",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "GN-001",
            label: "Massing Generator",
            category: "generate",
            status: "idle",
            inputs: [{ id: "req-in", label: "Requirements", type: "json" }],
            outputs: [
              { id: "geo-out", label: "3D Massing", type: "geometry" },
              { id: "kpi-out", label: "KPIs", type: "json" },
            ],
            icon: "Box",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: Y },
          data: {
            catalogueId: "EX-001",
            label: "IFC Exporter",
            category: "export",
            status: "idle",
            inputs: [
              { id: "geo-in", label: "3D Geometry", type: "geometry" },
              { id: "meta-in", label: "Metadata", type: "json" },
            ],
            outputs: [{ id: "ifc-out", label: "IFC File", type: "ifc" }],
            icon: "Download",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "params-out", target: "n2", targetHandle: "req-in", type: "animatedEdge" },
        { id: "e2-3a", source: "n2", sourceHandle: "geo-out", target: "n3", targetHandle: "geo-in", type: "animatedEdge" },
        { id: "e2-3b", source: "n2", sourceHandle: "kpi-out", target: "n3", targetHandle: "meta-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-09",
    name: "IFC → Quantity Takeoff → BOQ",
    description:
      "Upload a photo of a building → get IFC quantities extracted, costs mapped, and a downloadable BOQ spreadsheet.",
    tags: ["ifc", "qto", "boq", "cost", "quantities", "estimating"],
    category: "Cost Estimation",
    complexity: "intermediate",
    estimatedRunTime: "~90 seconds",
    requiredInputs: ["IFC model file"],
    expectedOutputs: ["Quantities table by element category", "BOQ with unit prices and totals", "Downloadable XLSX/CSV"],
    thumbnail: "https://picsum.photos/seed/wf09/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-004",
            label: "IFC Upload",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "ifc-out", label: "IFC Model", type: "ifc" }],
            icon: "Box",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "TR-007",
            label: "Quantity Extractor",
            category: "transform",
            status: "idle",
            inputs: [{ id: "ifc-in", label: "IFC Model", type: "ifc" }],
            outputs: [{ id: "qty-out", label: "Quantities JSON", type: "json" }],
            icon: "Calculator",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: Y },
          data: {
            catalogueId: "TR-008",
            label: "BOQ / Cost Mapper",
            category: "transform",
            status: "idle",
            inputs: [{ id: "qty-in", label: "Quantities", type: "json" }],
            outputs: [{ id: "boq-out", label: "BOQ Line Items", type: "json" }],
            icon: "DollarSign",
          },
        },
        {
          id: "n4",
          type: "workflowNode",
          position: { x: X4, y: Y },
          data: {
            catalogueId: "EX-002",
            label: "BOQ / Spreadsheet Exporter",
            category: "export",
            status: "idle",
            inputs: [{ id: "boq-in", label: "BOQ Data", type: "json" }],
            outputs: [{ id: "xlsx-out", label: "XLSX + CSV", type: "csv" }],
            icon: "Table",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "ifc-out", target: "n2", targetHandle: "ifc-in", type: "animatedEdge" },
        { id: "e2-3", source: "n2", sourceHandle: "qty-out", target: "n3", targetHandle: "qty-in", type: "animatedEdge" },
        { id: "e3-4", source: "n3", sourceHandle: "boq-out", target: "n4", targetHandle: "boq-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-11",
    name: "Text Prompt → Floor Plan",
    description:
      "Enter a text prompt → get a building description with a detailed SVG floor plan layout.",
    tags: ["floor-plan", "ai", "layout", "architecture", "quick-start"],
    category: "Concept Design",
    complexity: "simple",
    estimatedRunTime: "~30 seconds",
    requiredInputs: ["Text description of building program"],
    expectedOutputs: ["Building description", "SVG floor plan with room labels"],
    thumbnail: "https://picsum.photos/seed/wf11/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-001",
            label: "Text Prompt",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "text-out", label: "Text", type: "text" }],
            icon: "Type",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "TR-003",
            label: "Design Brief Analyzer",
            category: "transform",
            status: "idle",
            inputs: [{ id: "json-in", label: "Requirements", type: "json" }],
            outputs: [
              { id: "text-out", label: "Description", type: "text" },
              { id: "prog-out", label: "Program Blocks", type: "json" },
            ],
            icon: "Building2",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: Y },
          data: {
            catalogueId: "GN-004",
            label: "Floor Plan Generator",
            category: "generate",
            status: "idle",
            inputs: [{ id: "prog-in", label: "Room Program", type: "json" }],
            outputs: [
              { id: "plan-out", label: "Floor Plan", type: "geometry" },
              { id: "img-out", label: "Plan Image", type: "image" },
            ],
            icon: "LayoutGrid",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "text-out", target: "n2", targetHandle: "json-in", type: "animatedEdge" },
        { id: "e2-3", source: "n2", sourceHandle: "prog-out", target: "n3", targetHandle: "prog-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-12",
    name: "Text → Floor Plan + Render (Branching)",
    description:
      "Enter text → get a full building description, floor plan, and concept render — the most comprehensive quick-start workflow.",
    tags: ["floor-plan", "render", "branching", "ai", "concept"],
    category: "Concept Design",
    complexity: "intermediate",
    estimatedRunTime: "~60 seconds",
    requiredInputs: ["Text description of building program"],
    expectedOutputs: ["Building description", "SVG floor plan", "Concept architectural image"],
    thumbnail: "https://picsum.photos/seed/wf12/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: 250 },
          data: {
            catalogueId: "IN-001",
            label: "Text Prompt",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "text-out", label: "Text", type: "text" }],
            icon: "Type",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: 250 },
          data: {
            catalogueId: "TR-003",
            label: "Design Brief Analyzer",
            category: "transform",
            status: "idle",
            inputs: [{ id: "json-in", label: "Requirements", type: "json" }],
            outputs: [
              { id: "text-out", label: "Description", type: "text" },
              { id: "prog-out", label: "Program Blocks", type: "json" },
            ],
            icon: "Building2",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: 100 },
          data: {
            catalogueId: "GN-004",
            label: "Floor Plan Generator",
            category: "generate",
            status: "idle",
            inputs: [{ id: "prog-in", label: "Room Program", type: "json" }],
            outputs: [
              { id: "plan-out", label: "Floor Plan", type: "geometry" },
              { id: "img-out", label: "Plan Image", type: "image" },
            ],
            icon: "LayoutGrid",
          },
        },
        {
          id: "n4",
          type: "workflowNode",
          position: { x: X3, y: 400 },
          data: {
            catalogueId: "GN-003",
            label: "Concept Render Generator",
            category: "generate",
            status: "idle",
            inputs: [
              { id: "ctrl-in", label: "Control Image", type: "image" },
              { id: "prompt-in", label: "Style Prompt", type: "text" },
            ],
            outputs: [{ id: "images-out", label: "Concept Images", type: "image" }],
            icon: "Palette",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "text-out", target: "n2", targetHandle: "json-in", type: "animatedEdge" },
        { id: "e2-3", source: "n2", sourceHandle: "prog-out", target: "n3", targetHandle: "prog-in", type: "animatedEdge" },
        { id: "e2-4", source: "n2", sourceHandle: "text-out", target: "n4", targetHandle: "ctrl-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-13",
    name: "Location → Site Analysis → Building Concept",
    description:
      "Upload a site photo → get climate analysis, AI-written design brief, concept render, and massing — full site-to-concept pipeline.",
    tags: ["site-analysis", "climate", "solar", "location", "concept"],
    category: "Concept Design",
    complexity: "intermediate",
    estimatedRunTime: "~60 seconds",
    requiredInputs: ["Address or location name"],
    expectedOutputs: ["Site analysis with climate data", "Building description", "Concept architectural image"],
    thumbnail: "https://picsum.photos/seed/wf13/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-006",
            label: "Location Input",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "geo-out", label: "GeoJSON", type: "geojson" }],
            icon: "MapPin",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "TR-012",
            label: "Site Analysis",
            category: "transform",
            status: "idle",
            inputs: [{ id: "geo-in", label: "GeoJSON Location", type: "geojson" }],
            outputs: [
              { id: "ctx-geo-out", label: "Context Mesh", type: "geometry" },
              { id: "site-out", label: "Site Data", type: "json" },
            ],
            icon: "Globe",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: Y },
          data: {
            catalogueId: "TR-003",
            label: "Design Brief Analyzer",
            category: "transform",
            status: "idle",
            inputs: [{ id: "json-in", label: "Requirements", type: "json" }],
            outputs: [
              { id: "text-out", label: "Description", type: "text" },
              { id: "prog-out", label: "Program Blocks", type: "json" },
            ],
            icon: "Building2",
          },
        },
        {
          id: "n4",
          type: "workflowNode",
          position: { x: X4, y: Y },
          data: {
            catalogueId: "GN-003",
            label: "Concept Render Generator",
            category: "generate",
            status: "idle",
            inputs: [
              { id: "ctrl-in", label: "Control Image", type: "image" },
              { id: "prompt-in", label: "Style Prompt", type: "text" },
            ],
            outputs: [{ id: "images-out", label: "Concept Images", type: "image" }],
            icon: "Palette",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "geo-out", target: "n2", targetHandle: "geo-in", type: "animatedEdge" },
        { id: "e2-3", source: "n2", sourceHandle: "site-out", target: "n3", targetHandle: "json-in", type: "animatedEdge" },
        { id: "e3-4", source: "n3", sourceHandle: "text-out", target: "n4", targetHandle: "ctrl-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-14",
    name: "Detailed PDF → 3D Video Walkthrough",
    description:
      "Upload a detailed PDF brief → extract the original text faithfully → produce an ultra-realistic cinematic 3D walkthrough video strictly based on the PDF content — 5s exterior + 10s interior.",
    tags: ["pdf", "video", "walkthrough", "3d", "full-pipeline", "brief"],
    category: "Concept Design",
    complexity: "simple",
    estimatedRunTime: "~3 minutes",
    requiredInputs: ["Detailed PDF project brief"],
    expectedOutputs: [
      "Parsed brief text (faithful to original PDF)",
      "Ultra-realistic cinematic 3D walkthrough video (5s exterior + 10s interior)",
    ],
    thumbnail: "https://picsum.photos/seed/wf14/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-002",
            label: "PDF Upload",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "pdf-out", label: "PDF", type: "pdf" }],
            icon: "FileText",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "TR-001",
            label: "Brief Parser",
            category: "transform",
            status: "idle",
            inputs: [{ id: "pdf-in", label: "PDF", type: "pdf" }],
            outputs: [{ id: "text-out", label: "Structured Text", type: "text" }],
            icon: "ScanText",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: Y },
          data: {
            catalogueId: "GN-009",
            label: "Video Walkthrough Generator",
            category: "generate",
            status: "idle",
            inputs: [
              { id: "geo-in", label: "3D Model / Renders", type: "geometry" },
              { id: "style-in", label: "Style & Camera", type: "json" },
            ],
            outputs: [{ id: "video-out", label: "MP4 Video", type: "binary" }],
            icon: "Video",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "pdf-out", target: "n2", targetHandle: "pdf-in", type: "animatedEdge" },
        { id: "e2-3", source: "n2", sourceHandle: "text-out", target: "n3", targetHandle: "geo-in", type: "animatedEdge" },
      ],
    },
  },
  {
    id: "wf-15",
    name: "2D Floor Plan → Video Render",
    description:
      "Upload a 2D floor plan image → AI analyzes the layout → Kling generates a cinematic 15s video walkthrough directly from the floor plan.",
    tags: ["floor-plan", "video", "walkthrough", "3d", "animation"],
    category: "Visualization",
    complexity: "intermediate",
    estimatedRunTime: "~4 minutes",
    requiredInputs: ["2D floor plan image (scan, screenshot, or export)"],
    expectedOutputs: [
      "Floor plan analysis & extracted features",
      "Cinematic 15s MP4 video walkthrough",
    ],
    thumbnail: "https://picsum.photos/seed/wf15/600/400",
    tileGraph: {
      nodes: [
        {
          id: "n1",
          type: "workflowNode",
          position: { x: X1, y: Y },
          data: {
            catalogueId: "IN-003",
            label: "Image Upload",
            category: "input",
            status: "idle",
            inputs: [],
            outputs: [{ id: "image-out", label: "Image", type: "image" }],
            icon: "Image",
          },
        },
        {
          id: "n2",
          type: "workflowNode",
          position: { x: X2, y: Y },
          data: {
            catalogueId: "TR-004",
            label: "Image Understanding",
            category: "transform",
            status: "idle",
            inputs: [{ id: "image-in", label: "Image", type: "image" }],
            outputs: [
              { id: "text-out", label: "Design Interpretation", type: "text" },
              { id: "feat-out", label: "Extracted Features", type: "json" },
            ],
            icon: "Eye",
          },
        },
        {
          id: "n3",
          type: "workflowNode",
          position: { x: X3, y: Y },
          data: {
            catalogueId: "GN-009",
            label: "Video Walkthrough Generator",
            category: "generate",
            status: "idle",
            inputs: [
              { id: "image-in", label: "Source Image", type: "image" },
              { id: "geo-in", label: "3D Model / Renders", type: "geometry" },
              { id: "style-in", label: "Style & Camera", type: "json" },
            ],
            outputs: [{ id: "video-out", label: "MP4 Video", type: "binary" }],
            icon: "Video",
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "n1", sourceHandle: "image-out", target: "n2", targetHandle: "image-in", type: "animatedEdge" },
        { id: "e1-3", source: "n1", sourceHandle: "image-out", target: "n3", targetHandle: "image-in", type: "animatedEdge" },
        { id: "e2-3a", source: "n2", sourceHandle: "text-out", target: "n3", targetHandle: "style-in", type: "animatedEdge" },
      ],
    },
  },
];

export const PREBUILT_WORKFLOWS_MAP = new Map(
  PREBUILT_WORKFLOWS.map((wf) => [wf.id, wf])
);
