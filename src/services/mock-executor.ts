/**
 * Mock execution engine — returns realistic AEC data for each node type.
 * Used for demo/development before real API connections are made.
 */

import type { ExecutionArtifact, ArtifactType } from "@/types/execution";
import { generateId } from "@/lib/utils";

const ARCHITECTURAL_IMAGES = [
  "https://picsum.photos/seed/arch1/600/400",
  "https://picsum.photos/seed/arch2/600/400",
  "https://picsum.photos/seed/arch3/600/400",
  "https://picsum.photos/seed/arch4/600/400",
  "https://picsum.photos/seed/arch5/600/400",
];

function mockArtifact(
  executionId: string,
  tileInstanceId: string,
  type: ArtifactType,
  data: unknown
): ExecutionArtifact {
  return {
    id: generateId(),
    executionId,
    tileInstanceId,
    type,
    data,
    metadata: { generatedAt: new Date().toISOString(), mock: true },
    createdAt: new Date(),
  };
}

export async function executeNode(
  catalogueId: string,
  executionId: string,
  tileInstanceId: string,
  inputData?: Record<string, unknown>
): Promise<ExecutionArtifact> {
  // Simulate network delay
  const delay = getNodeDelay(catalogueId);
  await new Promise((r) => setTimeout(r, delay));

  switch (catalogueId) {
    case "IN-001": // Text Prompt
      return mockArtifact(executionId, tileInstanceId, "text", {
        content:
          "5-story mixed-use building with retail ground floor and 4 floors of residential above. Modern Nordic minimal aesthetic with white render and timber accents. Located in urban infill site.",
        label: "Design Brief",
      });

    case "IN-002": // PDF Upload
      return mockArtifact(executionId, tileInstanceId, "json", {
        json: { filename: "project_brief.pdf", pages: 24, sizeKb: 1840 },
        label: "PDF Metadata",
      });

    case "IN-003": // Image Upload
      return mockArtifact(executionId, tileInstanceId, "image", {
        url: ARCHITECTURAL_IMAGES[0],
        label: "Uploaded Reference Image",
      });

    case "IN-004": // IFC Upload
      return mockArtifact(executionId, tileInstanceId, "json", {
        json: {
          filename: "building_model_v3.ifc",
          schema: "IFC4",
          storeys: 5,
          elements: 1247,
          sizeKb: 8420,
        },
        label: "IFC Model Info",
      });

    case "IN-005": // Parameter Input
      return mockArtifact(executionId, tileInstanceId, "kpi", {
        metrics: [
          { label: "Floors", value: 5, unit: "" },
          { label: "Height", value: 22, unit: "m" },
          { label: "Footprint", value: 600, unit: "m²" },
          { label: "GFA", value: 4800, unit: "m²" },
        ],
      });

    case "IN-006": // Location Input
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: "Dronning Eufemias gate, Oslo, Norway (59.9031° N, 10.7527° E)",
        label: "Site Location",
      });

    case "TR-001": // Document Parser
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: `PROJECT BRIEF — OSLO MIXED-USE DEVELOPMENT\n\nClient: Urban Properties AS\nSite: Former industrial lot, Bjørvika waterfront, Oslo\n\nPROGRAMM REQUIREMENTS:\n• Gross Floor Area: 4,800–5,200 m²\n• Floors: 5 above grade, 1 basement parking level\n• Ground floor: 600 m² retail/F&B\n• Floors 2–5: 48 residential units (mix of 1BR, 2BR, 3BR)\n\nCONSTRAINTS:\n• Max height: 22m above grade\n• Site setbacks: 3m all sides\n• Ground floor must be active frontage\n• BREEAM Excellent certification required`,
        label: "Extracted Document Text",
      });

    case "TR-002": // Requirements Extractor
      return mockArtifact(executionId, tileInstanceId, "json", {
        json: {
          building_type: "mixed-use",
          floors: 5,
          total_gfa_m2: 5000,
          program: [
            { name: "retail", area_m2: 600, floor_range: "ground" },
            { name: "housing", area_m2: 4200, floor_range: "2-5" },
            { name: "parking", area_m2: 480, floor_range: "basement" },
          ],
          constraints: {
            max_height_m: 22,
            site_setbacks_m: 3,
            max_coverage_pct: 60,
            orientation_preference: "south-facing",
          },
          style_keywords: ["Nordic minimal", "white render", "timber accents"],
          site_description:
            "Urban infill site, Bjørvika waterfront, Oslo. Former industrial lot adjacent to opera house.",
          certification: "BREEAM Excellent",
        },
        label: "Building Requirements",
      });

    case "TR-003": { // Building Description Generator
      // Incorporate upstream prompt data so downstream nodes (GN-001) get accurate info
      const briefText = String(inputData?.content ?? inputData?.prompt ?? "");
      const fm = briefText.match(/(\d+)[\s-]*(?:stor(?:e?y|ies)|floor)/i);
      const storyCount = fm ? parseInt(fm[1], 10) : 5;
      const residentialFloors = Math.max(storyCount - 1, 1);
      const residentialGFA = residentialFloors * 1050;
      const totalGFA = residentialGFA + 600;
      const maxHeight = Math.round(storyCount * 4.2);
      const userHint = briefText.length > 10 ? briefText.slice(0, 120) : "A mixed-use building with ground-floor retail";
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: `BUILDING DESCRIPTION\n\nDesign concept: ${userHint}\n\nProgramme: ${storyCount}-storey building with ground floor retail (600 m²) and ${residentialFloors} upper residential floors (${residentialGFA.toLocaleString()} m² residential GFA). The facade responds to the site context with a clean expression and floor-to-ceiling glazing.\n\nKey metrics: ${storyCount} floors above grade, ${maxHeight}m max height, ${totalGFA.toLocaleString()} m² GFA.`,
        label: "Building Description",
      });
    }

    case "TR-004": // Image Understanding
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: `IMAGE ANALYSIS — Design Intent Extraction\n\nDetected style: Contemporary Nordic / Scandinavian minimalism\nPredominant palette: White/cream render, natural timber, large glazing\nBuilding typology: Low-to-mid rise urban residential (est. 4-6 storeys)\nFacade character: Rhythmic fenestration, clean horizontal lines, minimal ornamentation\nGround floor: Active frontage with retail/cafe evident\nLandscape integration: Strong connection to street level\nAtmosphere: Calm, dignified, community-facing\n\nSuggested style prompts: "Nordic minimal architecture, white rendered facade, timber brise-soleil, human-scale streetscape, soft natural light"`,
        label: "Image Analysis",
      });

    case "TR-005": // Style Prompt Composer
      return mockArtifact(executionId, tileInstanceId, "image", {
        url: ARCHITECTURAL_IMAGES[1],
        label: "Style Reference (Control Image)",
        style: "Nordic Minimal",
      });

    case "TR-006": // Zoning Compliance
      return mockArtifact(executionId, tileInstanceId, "json", {
        json: {
          overall_status: "PASS",
          rules_checked: 8,
          passed: 7,
          failed: 1,
          warnings: 1,
          results: [
            { rule: "Maximum building height", limit: "22m", actual: "21.6m", status: "PASS" },
            { rule: "Site coverage", limit: "60%", actual: "54%", status: "PASS" },
            { rule: "Front setback", limit: "3m", actual: "3m", status: "PASS" },
            { rule: "Side setback (N)", limit: "3m", actual: "2.8m", status: "FAIL", note: "0.2m non-compliant" },
            { rule: "Residential daylight factor", limit: ">1.5%", actual: "1.8%", status: "PASS" },
            { rule: "Parking minimum", limit: "0.5/unit", actual: "0.5/unit", status: "PASS" },
            { rule: "Active ground floor", limit: ">50%", actual: "78%", status: "PASS" },
            { rule: "Green roof provision", limit: ">25%", actual: "30%", status: "PASS" },
          ],
        },
        label: "Compliance Report",
      });

    case "TR-007": // Quantity Extractor
      return mockArtifact(executionId, tileInstanceId, "table", {
        label: "Extracted Quantities (IFC)",
        headers: ["Element", "Count", "Area (m²)", "Volume (m³)", "Source"],
        rows: [
          ["IfcWall (External)", 48, 1240, 148.8, "Qto_WallBaseQuantities"],
          ["IfcWall (Internal)", 186, 2890, 231.2, "Qto_WallBaseQuantities"],
          ["IfcSlab (Floor)", 5, 600, 120.0, "Qto_SlabBaseQuantities"],
          ["IfcSlab (Roof)", 1, 605, 90.75, "Qto_SlabBaseQuantities"],
          ["IfcWindow", 96, 288, "—", "geometry_computed"],
          ["IfcDoor", 58, 116, "—", "geometry_computed"],
          ["IfcColumn", 20, "—", 8.4, "geometry_computed"],
          ["IfcStair", 2, "—", 12.6, "geometry_computed"],
        ],
      });

    case "TR-008": // BOQ / Cost Mapper
      return mockArtifact(executionId, tileInstanceId, "table", {
        label: "Bill of Quantities",
        headers: ["Description", "Unit", "Qty", "Rate (NOK)", "Total (NOK)"],
        rows: [
          ["External walls — rendered masonry", "m²", 1240, 4500, "5,580,000"],
          ["Internal walls — lightweight partition", "m²", 2890, 1200, "3,468,000"],
          ["Structural slabs — RC 200mm", "m²", 3030, 3800, "11,514,000"],
          ["Roof slab — RC 250mm + green roof", "m²", 605, 5200, "3,146,000"],
          ["Windows — triple glazed, ALU frame", "m²", 288, 8500, "2,448,000"],
          ["Doors — internal solid core", "No.", 58, 12000, "696,000"],
          ["Structural columns — RC 400×400", "m³", 8.4, 15000, "126,000"],
          ["Staircases — precast RC", "No.", 2, 280000, "560,000"],
        ],
      });

    case "TR-009": // BIM Query
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: `BIM Query Result:\n\n"How many windows are on the south facade?"\n\nAnswer: There are 36 windows on the south-facing facade. All are IfcWindow type with ALU frames and triple glazing. Combined glazed area: 108 m².\n\nQueried elements returned: 36 IfcWindow instances filtered by orientation [south ± 45°], all on storeys 1-5.`,
        label: "BIM Query Answer",
      });

    case "TR-010": // Delta Comparator
      return mockArtifact(executionId, tileInstanceId, "json", {
        json: {
          version_a: "building_v2.ifc",
          version_b: "building_v3.ifc",
          summary: "Version 3 adds 12 additional doors on floors 3-5, removes 4 columns, and increases slab thickness from 180mm to 200mm.",
          deltas: [
            { category: "IfcDoor", change_type: "added", count_delta: "+12", area_delta_m2: 24 },
            { category: "IfcColumn", change_type: "removed", count_delta: "-4", volume_delta_m3: -1.6 },
            { category: "IfcSlab", change_type: "modified", count_delta: "0", volume_delta_m3: "+18.2" },
          ],
        },
        label: "Model Delta Report",
      });

    case "TR-012": // GIS Context
      return mockArtifact(executionId, tileInstanceId, "json", {
        json: {
          site: { address: "Dronning Eufemias gate, Oslo", area_m2: 1050, shape: "rectangular" },
          terrain: { elevation_m: 4.2, slope_pct: 0.8, type: "flat" },
          context: {
            buildings_30m: 3,
            nearest_public_transport_m: 180,
            nearest_green_space_m: 320,
            noise_db: 62,
          },
        },
        label: "Site Context Data",
      });

    case "GN-001": { // Massing Generator
      // Parse upstream data for floor count and building description
      const upstreamText = String(inputData?.content ?? inputData?.prompt ?? "");
      const floorMatch = upstreamText.match(/(\d+)[\s-]*(?:stor(?:e?y|ies)|floor)/i);
      const floors = floorMatch ? parseInt(floorMatch[1], 10) : 5;
      const heightPerFloor = 4.2;
      const height = (floors * heightPerFloor).toFixed(1);
      const footprint = 567;
      const gfa = Math.round(floors * footprint * 0.98);
      return mockArtifact(executionId, tileInstanceId, "kpi", {
        metrics: [
          { label: "GFA", value: gfa.toLocaleString(), unit: "m²" },
          { label: "Height", value: height, unit: "m" },
          { label: "Floors", value: floors, unit: "" },
          { label: "Coverage", value: "54", unit: "%" },
          { label: "Footprint", value: String(footprint), unit: "m²" },
          { label: "Plot Ratio", value: (gfa / 1050).toFixed(2), unit: "FAR" },
        ],
      });
    }

    case "GN-002": // Variant Generator
      return mockArtifact(executionId, tileInstanceId, "kpi", {
        metrics: [
          { label: "Variant A — Compact Tower", value: "4,980m² GFA", unit: "21.6m" },
          { label: "Variant B — Wide/Low", value: "4,850m² GFA", unit: "16.5m" },
          { label: "Variant C — Courtyard", value: "5,120m² GFA", unit: "19.2m" },
        ],
      });

    case "GN-003": { // Image Generator
      // Use a deterministic seed based on upstream content for consistent results
      const imgPrompt = String(inputData?.content ?? inputData?.prompt ?? "architectural concept");
      const seed = imgPrompt.slice(0, 20).replace(/\s+/g, "-").toLowerCase() || "building";
      return mockArtifact(executionId, tileInstanceId, "image", {
        url: `https://picsum.photos/seed/${seed}/600/400`,
        label: `Concept Render — ${imgPrompt.slice(0, 40)}`,
        style: "Architectural concept render",
        mockNote: "Mock mode — connect OPENAI_API_KEY for DALL-E 3 renders",
      });
    }

    case "GN-004": // Floor Plan Generator
      return mockArtifact(executionId, tileInstanceId, "image", {
        url: "https://picsum.photos/seed/floorplan/600/400",
        label: "Generated Floor Plan — Level 2",
        style: "Residential layout, 12 units per floor",
      });

    case "EX-001": // IFC Exporter
      return mockArtifact(executionId, tileInstanceId, "file", {
        name: "oslo_mixeduse_v1.ifc",
        type: "IFC 4",
        size: 2847362,
        downloadUrl: "#",
        label: "IFC Export",
      });

    case "EX-002": // BOQ Exporter
      return mockArtifact(executionId, tileInstanceId, "file", {
        name: "oslo_mixeduse_boq.xlsx",
        type: "XLSX Spreadsheet",
        size: 184230,
        downloadUrl: "#",
        label: "BOQ Export",
      });

    case "EX-003": // PDF Report
      return mockArtifact(executionId, tileInstanceId, "file", {
        name: "compliance_report.pdf",
        type: "PDF Document",
        size: 1204800,
        downloadUrl: "#",
        label: "Compliance Report PDF",
      });

    case "EX-004": // Speckle Publisher
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: "https://speckle.xyz/streams/abc123def456/commits/78a9b2c4d5e6",
        label: "Speckle Commit URL",
      });

    case "EX-006": // Image Exporter
      return mockArtifact(executionId, tileInstanceId, "file", {
        name: "concept_renders_4K.zip",
        type: "ZIP Archive",
        size: 28472038,
        downloadUrl: "#",
        label: "High-Res Image Export",
      });

    default:
      return mockArtifact(executionId, tileInstanceId, "json", {
        json: { status: "completed", nodeId: catalogueId },
        label: "Node Output",
      });
  }
}

function getNodeDelay(catalogueId: string): number {
  const delays: Record<string, number> = {
    "IN-001": 500,
    "IN-002": 800,
    "IN-003": 600,
    "IN-004": 1200,
    "IN-005": 300,
    "IN-006": 900,
    "TR-001": 2500,
    "TR-002": 3000,
    "TR-003": 2000,
    "TR-004": 2500,
    "TR-005": 1500,
    "TR-006": 3500,
    "TR-007": 2800,
    "TR-008": 2200,
    "TR-009": 2500,
    "TR-010": 3000,
    "TR-012": 2000,
    "GN-001": 3500,
    "GN-002": 5000,
    "GN-003": 4000,
    "GN-004": 4500,
    "EX-001": 2500,
    "EX-002": 1800,
    "EX-003": 2200,
    "EX-004": 2000,
    "EX-006": 1500,
  };
  return delays[catalogueId] ?? 2000;
}
