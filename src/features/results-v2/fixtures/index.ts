import type { ExecutionResult } from "@/features/results-v2/types";

/**
 * Fixtures for the `/dashboard/results-v2-preview` route. Each fixture is a
 * fully-typed `ExecutionResult` — the same shape the live hook produces —
 * so the preview renders the real component stack against realistic data
 * without any DB access.
 *
 * Zero currency fields by construction: the shape doesn't carry one,
 * `stripPrice()` would remove any bypass attempt, and the `ss-` style audit
 * grep in the report confirms no "$N" literals slipped into this file.
 */

// Preview fixtures use picsum.photos URLs (whitelisted in next.config.ts) so
// the preview route renders real pixels without needing access to DALL-E
// output. In live executions these would be `oaidalleapiprodscus.blob.core.windows.net`.
const DALLE_EXTERIOR = "https://picsum.photos/seed/bf-exterior/1440/900";
const DALLE_INTERIOR_1 = "https://picsum.photos/seed/bf-interior-1/1440/900";
const DALLE_INTERIOR_2 = "https://picsum.photos/seed/bf-interior-2/1440/900";

/** Workflow 1 — Floor Plan → Render + Video Walkthrough (HeroVideo primary). */
export const fixtureVideo: ExecutionResult = {
  executionId: "fx-video-01",
  workflowId: "wf-06",
  workflowName: "Floor Plan → Render + Video Walkthrough",
  status: {
    state: "success",
    startedAt: "2026-04-24T11:50:00.000Z",
    completedAt: "2026-04-24T11:55:34.000Z",
    durationMs: 334_000,
  },
  video: {
    nodeId: "n5-kling-2026-04-24",
    // Public sample video — Kling-like cinematic aspect. Replace with an R2 URL
    // in any real execution; for the preview we just need a playable MP4.
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    downloadUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    name: "buildflow-walkthrough.mp4",
    durationSeconds: 15,
    shotCount: 4,
    pipeline: "floor-plan → render → kling",
    segments: [
      { label: "Exterior pull-in", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4", downloadUrl: "", durationSeconds: 4 },
      { label: "Building orbit", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4", downloadUrl: "", durationSeconds: 4 },
      { label: "Interior walkthrough", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4", downloadUrl: "", durationSeconds: 4 },
      { label: "Section rise", videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4", downloadUrl: "", durationSeconds: 3 },
    ],
    status: "complete",
  },
  images: [DALLE_EXTERIOR, DALLE_INTERIOR_1, DALLE_INTERIOR_2],
  model3d: null,
  floorPlan: null,
  tables: [],
  metrics: [
    { label: "Rooms Detected", value: 7 },
    { label: "Exterior Shots", value: 2 },
    { label: "Interior Shots", value: 2 },
  ],
  boqTotalGfa: null,
  boqCurrencySymbol: null,
  downloads: [
    { name: "buildflow-walkthrough.mp4", kind: "video", sizeBytes: 8_214_400, downloadUrl: "#" },
    { name: "exterior-render.png", kind: "drawing", sizeBytes: 1_240_000, downloadUrl: "#" },
    { name: "interior-a.png", kind: "drawing", sizeBytes: 1_180_000, downloadUrl: "#" },
    { name: "interior-b.png", kind: "drawing", sizeBytes: 1_160_000, downloadUrl: "#" },
    { name: "walkthrough-brief.pdf", kind: "document", sizeBytes: 220_000, downloadUrl: "#" },
  ],
  pipeline: [
    { nodeId: "n1", label: "Image Upload", category: "input", catalogueId: "IN-002", status: "success", artifactType: "image" },
    { nodeId: "n2", label: "Floor Plan Analyzer", category: "transform", catalogueId: "TR-006", status: "success", artifactType: "text" },
    { nodeId: "n3", label: "Exterior Render (DALL-E 3)", category: "generate", catalogueId: "GN-003", status: "success", artifactType: "image" },
    { nodeId: "n4", label: "Interior Render (DALL-E 3)", category: "generate", catalogueId: "GN-003", status: "success", artifactType: "image" },
    { nodeId: "n5", label: "Video Walkthrough (Kling)", category: "generate", catalogueId: "GN-009", status: "success", artifactType: "video" },
  ],
  models: [
    { name: "GPT-4o", family: "openai" },
    { name: "DALL-E 3", family: "openai" },
    { name: "Kling 3.0", family: "kling" },
  ],
  summaryText:
    "A two-bedroom residential plan interpreted into a cinematic walkthrough. The exterior establishes material and massing; interior shots focus on living room and kitchen; a section rise closes the sequence.",
};

/** Workflow 2 — Massing / Render-primary (HeroImage). */
export const fixtureImage: ExecutionResult = {
  executionId: "fx-image-02",
  workflowId: "wf-01b",
  workflowName: "Concept Renders · Suburban Residence",
  status: {
    state: "success",
    startedAt: "2026-04-24T10:42:10.000Z",
    completedAt: "2026-04-24T10:42:58.000Z",
    durationMs: 48_000,
  },
  video: null,
  images: [DALLE_EXTERIOR, DALLE_INTERIOR_1, DALLE_INTERIOR_2],
  model3d: null,
  floorPlan: null,
  tables: [],
  metrics: [{ label: "Renders", value: 3 }],
  boqTotalGfa: null,
  boqCurrencySymbol: null,
  downloads: [
    { name: "exterior.png", kind: "drawing", sizeBytes: 1_420_000, downloadUrl: "#" },
    { name: "interior-living.png", kind: "drawing", sizeBytes: 1_210_000, downloadUrl: "#" },
    { name: "interior-kitchen.png", kind: "drawing", sizeBytes: 1_190_000, downloadUrl: "#" },
  ],
  pipeline: [
    { nodeId: "n1", label: "Design Brief", category: "input", catalogueId: "IN-001", status: "success", artifactType: "text" },
    { nodeId: "n2", label: "DALL-E 3 Renderer", category: "generate", catalogueId: "GN-003", status: "success", artifactType: "image" },
  ],
  models: [
    { name: "GPT-4o", family: "openai" },
    { name: "DALL-E 3", family: "openai" },
  ],
  summaryText: "Three concept renders exploring material palette for a suburban residence.",
};

/** Workflow 3 — Text Prompt → 3D Building + IFC Export (HeroViewer3D, procedural). */
export const fixtureViewer3D: ExecutionResult = {
  executionId: "fx-3d-03",
  workflowId: "wf-04",
  workflowName: "Text Prompt → 3D Building + IFC Export",
  status: {
    state: "success",
    startedAt: "2026-04-24T09:10:00.000Z",
    completedAt: "2026-04-24T09:11:26.000Z",
    durationMs: 86_000,
  },
  video: null,
  images: [],
  model3d: {
    kind: "procedural",
    floors: 8,
    height: 32,
    footprint: 640,
    gfa: 5120,
    buildingType: "Mixed-Use",
  },
  floorPlan: null,
  tables: [],
  metrics: [
    { label: "Floors", value: 8 },
    { label: "Height", value: 32, unit: "m" },
    { label: "Footprint", value: 640, unit: "m²" },
    { label: "GFA", value: 5120, unit: "m²" },
  ],
  boqTotalGfa: null,
  boqCurrencySymbol: null,
  downloads: [
    { name: "building.ifc", kind: "model3d", sizeBytes: 3_400_000, downloadUrl: "#" },
    { name: "building.glb", kind: "model3d", sizeBytes: 4_100_000, downloadUrl: "#" },
    { name: "massing-report.pdf", kind: "document", sizeBytes: 280_000, downloadUrl: "#" },
  ],
  pipeline: [
    { nodeId: "n1", label: "Text Prompt", category: "input", catalogueId: "IN-001", status: "success", artifactType: "text" },
    { nodeId: "n2", label: "Massing Engine", category: "generate", catalogueId: "GN-001", status: "success", artifactType: "3d" },
    { nodeId: "n3", label: "IFC Exporter", category: "export", catalogueId: "EX-001", status: "success", artifactType: "file" },
  ],
  models: [{ name: "GPT-4o", family: "openai" }],
  summaryText: "A 5,120 m² mixed-use concept with eight floors, ready for downstream BIM integration.",
};

/** Workflow 4 — Floor Plan (HeroFloorPlan). */
const FLOOR_PLAN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360" width="680" height="408" stroke="currentColor" fill="none">
  <rect x="20" y="20" width="560" height="320" stroke-width="3" />
  <line x1="260" y1="20"  x2="260" y2="200" stroke-width="2" />
  <line x1="20"  y1="200" x2="560" y2="200" stroke-width="2" />
  <line x1="400" y1="200" x2="400" y2="340" stroke-width="2" />
  <line x1="120" y1="200" x2="120" y2="340" stroke-width="2" />

  <!-- Doors (arcs) -->
  <path d="M 180 20 A 40 40 0 0 1 220 60" stroke-width="1.2" />
  <path d="M 260 120 A 40 40 0 0 1 300 160" stroke-width="1.2" />

  <!-- Labels -->
  <text x="140" y="110" fill="currentColor" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">LIVING · 24 m²</text>
  <text x="420" y="110" fill="currentColor" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">KITCHEN · 14 m²</text>
  <text x="70"  y="270" fill="currentColor" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">BATH</text>
  <text x="260" y="270" fill="currentColor" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">BEDROOM 1 · 18 m²</text>
  <text x="480" y="270" fill="currentColor" font-size="13" text-anchor="middle" font-family="Inter, sans-serif">BEDROOM 2 · 16 m²</text>

  <!-- Dimension line -->
  <line x1="20"  y1="352" x2="580" y2="352" stroke-width="0.8" />
  <text x="300" y="358" fill="currentColor" font-size="10" text-anchor="middle" font-family="JetBrains Mono, monospace">12.0 m</text>
</svg>`.trim();

export const fixtureFloorPlan: ExecutionResult = {
  executionId: "fx-plan-04",
  workflowId: "wf-01",
  workflowName: "Text Prompt → Floor Plan",
  status: {
    state: "success",
    startedAt: "2026-04-24T08:02:10.000Z",
    completedAt: "2026-04-24T08:02:38.000Z",
    durationMs: 28_000,
  },
  video: null,
  images: [],
  model3d: null,
  floorPlan: {
    kind: "svg",
    svg: FLOOR_PLAN_SVG,
    label: "Generated floor plan",
    roomCount: 5,
    wallCount: 14,
    totalArea: 96,
    buildingType: "Residential",
  },
  tables: [
    {
      label: "Room Schedule",
      headers: ["Room", "Area (m²)", "Ceiling (m)"],
      rows: [
        ["Living", 24, 3.0],
        ["Kitchen", 14, 3.0],
        ["Bedroom 1", 18, 2.7],
        ["Bedroom 2", 16, 2.7],
        ["Bath", 6, 2.7],
      ],
    },
  ],
  metrics: [],
  boqTotalGfa: null,
  boqCurrencySymbol: null,
  downloads: [
    { name: "floor-plan.svg", kind: "drawing", sizeBytes: 24_000, downloadUrl: "#" },
    { name: "floor-plan.dxf", kind: "drawing", sizeBytes: 64_000, downloadUrl: "#" },
    { name: "room-schedule.csv", kind: "data", sizeBytes: 4_200, downloadUrl: "#" },
  ],
  pipeline: [
    { nodeId: "n1", label: "Text Prompt", category: "input", catalogueId: "IN-001", status: "success", artifactType: "text" },
    { nodeId: "n2", label: "Program Extractor", category: "transform", catalogueId: "TR-001", status: "success", artifactType: "json" },
    { nodeId: "n3", label: "Floor Plan Generator", category: "generate", catalogueId: "GN-002", status: "success", artifactType: "svg" },
  ],
  models: [{ name: "GPT-4o", family: "openai" }],
  summaryText:
    "A 96 m² two-bedroom residential plan with a shared bath and an open living + kitchen zone. Walls are draft-quality and ready for CAD refinement.",
};

/** Workflow 5 — IFC Model → BOQ (HeroKPI). */
export const fixtureKpi: ExecutionResult = {
  executionId: "fx-kpi-05",
  workflowId: "wf-03",
  workflowName: "IFC Model → Bill of Quantities",
  status: {
    state: "success",
    startedAt: "2026-04-24T07:16:02.000Z",
    completedAt: "2026-04-24T07:17:59.000Z",
    durationMs: 117_000,
  },
  video: null,
  images: [],
  model3d: null,
  floorPlan: null,
  tables: [
    {
      label: "Bill of Quantities",
      headers: ["Element", "Unit", "Quantity"],
      rows: [
        ["Reinforced concrete — columns", "m³", 42],
        ["Reinforced concrete — slabs", "m³", 128],
        ["Brickwork — internal", "m²", 860],
        ["Plastering", "m²", 1720],
        ["Flooring — vitrified", "m²", 540],
        ["Waterproofing", "m²", 260],
      ],
      isBoq: true,
    },
  ],
  metrics: [
    { label: "Total Elements", value: 1218 },
    { label: "Slabs", value: 42 },
    { label: "Columns", value: 28 },
    { label: "Doors", value: 18 },
  ],
  boqTotalGfa: 5120,
  boqCurrencySymbol: "₹",
  downloads: [
    { name: "boq-takeoff.xlsx", kind: "data", sizeBytes: 84_000, downloadUrl: "#" },
    { name: "element-breakdown.pdf", kind: "document", sizeBytes: 390_000, downloadUrl: "#" },
    { name: "ifc-source.ifc", kind: "model3d", sizeBytes: 3_400_000, downloadUrl: "#" },
  ],
  pipeline: [
    { nodeId: "n1", label: "IFC Upload", category: "input", catalogueId: "IN-008", status: "success", artifactType: "file" },
    { nodeId: "n2", label: "Quantity Takeoff", category: "transform", catalogueId: "TR-007", status: "success", artifactType: "table" },
    { nodeId: "n3", label: "BOQ Builder", category: "transform", catalogueId: "TR-008", status: "success", artifactType: "table" },
  ],
  models: [{ name: "GPT-4o", family: "openai" }],
  summaryText: "BOQ derived from a 5,120 m² mixed-use IFC model with Indian Standard element naming.",
};

/** Workflow 6 — In-flight execution (HeroSkeleton). */
export const fixtureSkeleton: ExecutionResult = {
  executionId: "fx-skeleton-06",
  workflowId: "wf-06",
  workflowName: "Floor Plan → Render + Video Walkthrough",
  status: {
    state: "running",
    startedAt: "2026-04-24T12:00:00.000Z",
    completedAt: null,
    durationMs: null,
  },
  video: {
    nodeId: "n5-kling-live",
    videoUrl: "",
    downloadUrl: "",
    name: "walkthrough-pending.mp4",
    durationSeconds: 15,
    shotCount: 4,
    status: "rendering",
    progress: 42,
    phase: "Building Orbit",
  },
  images: [],
  model3d: null,
  floorPlan: null,
  tables: [],
  metrics: [],
  boqTotalGfa: null,
  boqCurrencySymbol: null,
  downloads: [],
  pipeline: [
    { nodeId: "n1", label: "Image Upload", category: "input", catalogueId: "IN-002", status: "success", artifactType: "image" },
    { nodeId: "n2", label: "Floor Plan Analyzer", category: "transform", catalogueId: "TR-006", status: "success", artifactType: "text" },
    { nodeId: "n3", label: "Exterior Render", category: "generate", catalogueId: "GN-003", status: "success", artifactType: "image" },
    { nodeId: "n4", label: "Interior Render", category: "generate", catalogueId: "GN-003", status: "success", artifactType: "image" },
    { nodeId: "n5", label: "Video Walkthrough", category: "generate", catalogueId: "GN-009", status: "running" },
  ],
  models: [
    { name: "GPT-4o", family: "openai" },
    { name: "DALL-E 3", family: "openai" },
    { name: "Kling 3.0", family: "kling" },
  ],
  summaryText: null,
};

export const FIXTURES: ReadonlyArray<{
  id: string;
  label: string;
  result: ExecutionResult;
}> = [
  { id: "1-hero-video", label: "HeroVideo — Walkthrough", result: fixtureVideo },
  { id: "2-hero-image", label: "HeroImage — Renders", result: fixtureImage },
  { id: "3-hero-3d", label: "HeroViewer3D — Procedural", result: fixtureViewer3D },
  { id: "4-hero-floorplan", label: "HeroFloorPlan — SVG", result: fixtureFloorPlan },
  { id: "5-hero-kpi", label: "HeroKPI — BOQ summary", result: fixtureKpi },
  { id: "6-hero-skeleton", label: "HeroSkeleton — Rendering", result: fixtureSkeleton },
];
