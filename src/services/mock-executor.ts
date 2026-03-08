/**
 * Mock execution engine — returns realistic AEC data for each node type.
 * Used for demo/development before real API connections are made.
 */

import type { ExecutionArtifact, ArtifactType } from "@/types/execution";
import { generateId } from "@/lib/utils";
import { calculateBOQ } from "@/constants/unit-rates";

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

    case "TR-001": // Brief Parser
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: `PROJECT BRIEF — OSLO MIXED-USE DEVELOPMENT\n\nClient: Urban Properties AS\nSite: Former industrial lot, Bjørvika waterfront, Oslo\n\nPROGRAMME REQUIREMENTS:\n• Gross Floor Area: 4,800–5,200 m²\n• Floors: 5 above grade, 1 basement parking level\n• Ground floor: 600 m² retail/F&B\n• Floors 2–5: 48 residential units (mix of 1BR, 2BR, 3BR)\n\nCONSTRAINTS:\n• Max height: 22m above grade\n• Site setbacks: 3m all sides\n• Ground floor must be active frontage\n• BREEAM Excellent certification required`,
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

    case "TR-003": { // Design Brief Analyzer
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

    case "TR-005": // Visualization Style Composer
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

    case "TR-007": { // Quantity Extractor
      // Opening areas: 96 windows × 1.2m × 2.0m = 230.4 m², 58 doors × 0.9m × 2.1m = 109.62 m²
      const totalOpeningArea = 230.4 + 109.62; // = 340.02 m²
      // External walls: 70% of openings, Internal walls: 30% of openings
      const extWallOpenings = Math.round(totalOpeningArea * 0.7 * 100) / 100; // 238.01 m²
      const intWallOpenings = Math.round(totalOpeningArea * 0.3 * 100) / 100; // 102.01 m²
      const qtoElements = [
        { description: "External Walls", category: "Walls", quantity: 1240, unit: "m²", grossArea: 1240, openingArea: extWallOpenings, netArea: Math.round((1240 - extWallOpenings) * 100) / 100, totalVolume: 248 },
        { description: "Internal Walls", category: "Walls", quantity: 2890, unit: "m²", grossArea: 2890, openingArea: intWallOpenings, netArea: Math.round((2890 - intWallOpenings) * 100) / 100, totalVolume: 433.5 },
        { description: "Floor Slabs", category: "Slabs", quantity: 2400, unit: "m²", grossArea: 2400, openingArea: 0, netArea: 2400, totalVolume: 480 },
        { description: "Roof Slab", category: "Slabs", quantity: 605, unit: "m²", grossArea: 605, openingArea: 0, netArea: 605, totalVolume: 60.5 },
        { description: "Windows", category: "Openings", quantity: 96, unit: "EA", grossArea: 230.4, openingArea: 0, netArea: 230.4, totalVolume: 0 },
        { description: "Doors", category: "Openings", quantity: 58, unit: "EA", grossArea: 109.62, openingArea: 0, netArea: 109.62, totalVolume: 0 },
        { description: "Columns", category: "Structure", quantity: 20, unit: "EA", grossArea: 0, openingArea: 0, netArea: 0, totalVolume: 18 },
        { description: "Beams", category: "Structure", quantity: 85, unit: "EA", grossArea: 0, openingArea: 0, netArea: 0, totalVolume: 42.5 },
        { description: "Stairs", category: "Stairs", quantity: 2, unit: "EA", grossArea: 30, openingArea: 0, netArea: 30, totalVolume: 18 },
        { description: "Footings", category: "Footings", quantity: 8, unit: "EA", grossArea: 0, openingArea: 0, netArea: 0, totalVolume: 19.2 },
        { description: "Roof", category: "Roof", quantity: 1, unit: "EA", grossArea: 605, openingArea: 0, netArea: 605, totalVolume: 0 },
      ];
      return mockArtifact(executionId, tileInstanceId, "table", {
        label: "Extracted Quantities (IFC)",
        headers: ["Category", "Element", "Gross Area (m²)", "Opening Area (m²)", "Net Area (m²)", "Volume (m³)", "Qty", "Unit"],
        rows: qtoElements.map(e => [
          e.category, e.description,
          e.grossArea.toString(), e.openingArea.toString(),
          e.netArea.toString(), e.totalVolume.toString(),
          e.quantity.toString(), e.unit,
        ]),
        _elements: qtoElements, // Required for TR-008 compatibility
        content: `Parsed 1,319 elements across 11 categories from 5 storeys — net area accounts for ${totalOpeningArea.toFixed(0)} m² of openings`,
      });
    }

    case "TR-008": { // BOQ / Cost Mapper — real CSI unit rates
      // Map TR-007 category/description names to IFC element types
      const CATEGORY_TO_IFC: Record<string, string> = {
        "Walls": "IfcWall", "External Walls": "IfcWall", "Internal Walls": "IfcWall",
        "Slabs": "IfcSlab", "Floor Slabs": "IfcSlab", "Roof Slab": "IfcRoof",
        "Openings": "IfcWindow", "Windows": "IfcWindow", "Doors": "IfcDoor",
        "Structure": "IfcColumn", "Columns": "IfcColumn", "Beams": "IfcBeam",
        "Roof": "IfcRoof", "Stairs": "IfcStair", "Footings": "IfcFooting",
        "Curtain Walls": "IfcCurtainWall", "Railings": "IfcRailing",
      };

      // Parse upstream quantities from TR-007
      const boqQuantities = inputData?._elements || inputData?.rows || [];

      let boqElements: Array<{
        type: string; count: number; area?: number;
        grossArea?: number; netArea?: number; openingArea?: number; volume?: number;
      }> = [];

      if (Array.isArray(boqQuantities) && boqQuantities.length > 0) {
        boqElements = (boqQuantities as Record<string, unknown>[]).map((q) => {
          const raw = (q.type as string) || (q.description as string) || (q.category as string) || "IfcWall";
          const ifcType = CATEGORY_TO_IFC[raw] || raw;
          return {
            type: ifcType,
            count: Number(q.count ?? q.quantity ?? 1),
            area: q.totalArea != null || q.area != null
              ? Number(q.totalArea ?? q.area)
              : undefined,
            grossArea: q.grossArea != null ? Number(q.grossArea) : undefined,
            netArea: q.netArea != null ? Number(q.netArea) : undefined,
            openingArea: q.openingArea != null ? Number(q.openingArea) : undefined,
            volume: q.totalVolume != null || q.volume != null
              ? Number(q.totalVolume ?? q.volume)
              : undefined,
          };
        });
      } else {
        // Fallback: generate realistic elements from a typical 5-storey building
        const boqFloors = Number(inputData?.floors) || 5;
        const wallGross = 200 * boqFloors;
        const wallOpenings = boqFloors * 6 * 2.4 + boqFloors * 4 * 1.89; // windows + doors
        boqElements = [
          { type: "IfcSlab", count: boqFloors + 1, area: 500 * (boqFloors + 1), grossArea: 500 * (boqFloors + 1), netArea: 500 * (boqFloors + 1), volume: 500 * (boqFloors + 1) * 0.2 },
          { type: "IfcWall", count: boqFloors * 12, area: wallGross, grossArea: wallGross, openingArea: wallOpenings, netArea: wallGross - wallOpenings, volume: wallGross * 0.2 },
          { type: "IfcColumn", count: boqFloors * 8, volume: boqFloors * 8 * 0.9 },
          { type: "IfcWindow", count: boqFloors * 6, grossArea: boqFloors * 6 * 2.4 },
          { type: "IfcDoor", count: boqFloors * 4, grossArea: boqFloors * 4 * 1.89 },
          { type: "IfcStair", count: 2, area: 30, volume: 18 },
          { type: "IfcRoof", count: 1, area: 500, grossArea: 500, netArea: 500 },
          { type: "IfcFooting", count: 8, volume: 19.2 },
        ];
      }

      const boq = calculateBOQ(boqElements);

      const boqHeaders = ["Division", "CSI Code", "Description", "Unit", "Qty", "Material", "Labor", "Equipment", "Total"];
      const boqRows = boq.lines.map(line => [
        `Div ${line.division}`,
        line.csiCode,
        line.description,
        line.unit,
        line.quantity.toLocaleString(),
        `$${line.materialCost.toLocaleString()}`,
        `$${line.laborCost.toLocaleString()}`,
        `$${line.equipmentCost.toLocaleString()}`,
        `$${line.totalCost.toLocaleString()}`,
      ]);

      return mockArtifact(executionId, tileInstanceId, "table", {
        label: "Bill of Quantities — Cost Estimate",
        headers: boqHeaders,
        rows: boqRows,
        _boqData: boq,
        content: `Cost estimate: ${boq.lines.length} line items, Grand Total: $${boq.grandTotal.toLocaleString()}`,
        summary: {
          lineItems: boq.lines.length,
          subtotalMaterial: boq.subtotalMaterial,
          subtotalLabor: boq.subtotalLabor,
          subtotalEquipment: boq.subtotalEquipment,
          grandTotal: boq.grandTotal,
          currency: "USD",
          confidence: "moderate",
          note: "Based on CSI MasterFormat unit rates, National Average 2024",
        },
      });
    }

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
      // Check json field (from TR-002), then text content, then defaults
      const jsonData = inputData?.json as Record<string, unknown> | undefined;
      const upstreamText = String(inputData?.content ?? inputData?.prompt ?? "");

      const floors = (() => {
        if (jsonData?.floors) return Number(jsonData.floors);
        if (inputData?._raw && typeof inputData._raw === "object" && (inputData._raw as Record<string, unknown>).floors)
          return Number((inputData._raw as Record<string, unknown>).floors);
        const fm = upstreamText.match(/(\d+)[\s-]*(?:stor(?:e?y|ies)|floor)/i);
        if (fm) return parseInt(fm[1], 10);
        return 5;
      })();

      const heightPerFloor = 4.2;
      const height = (floors * heightPerFloor).toFixed(1);
      const footprint = 567;
      const totalGFA = jsonData?.total_gfa_m2 ? Number(jsonData.total_gfa_m2) : undefined;
      const gfa = totalGFA ?? Math.round(floors * footprint * 0.98);
      return mockArtifact(executionId, tileInstanceId, "3d", {
        // 3D massing viewer data
        floors,
        height: parseFloat(height),
        footprint,
        gfa,
        buildingType: jsonData?.building_type as string ?? "Mixed-Use",
        // KPI metrics (also displayed below the 3D viewer)
        metrics: [
          { label: "GFA", value: gfa.toLocaleString(), unit: "m²" },
          { label: "Height", value: height, unit: "m" },
          { label: "Floors", value: floors, unit: "" },
          { label: "Coverage", value: "54", unit: "%" },
          { label: "Footprint", value: String(footprint), unit: "m²" },
          { label: "Plot Ratio", value: (gfa / 1050).toFixed(2), unit: "FAR" },
        ],
        // Pass through upstream text data so downstream nodes (GN-003) can read it
        content: inputData?.content ?? inputData?.prompt
          ?? (jsonData ? `${floors}-storey ${jsonData.building_type ?? "mixed-use"} building, ${gfa.toLocaleString()} m² GFA` : "Modern mixed-use building"),
        prompt: inputData?.prompt ?? inputData?.content
          ?? (jsonData ? `${floors}-storey ${jsonData.building_type ?? "mixed-use"} building, ${gfa.toLocaleString()} m² GFA` : "Modern mixed-use building"),
        _raw: inputData?._raw ?? null,
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

    case "GN-003": { // Concept Render Generator
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
      return mockArtifact(executionId, tileInstanceId, "svg", {
        svg: `<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="800" height="600" fill="#FAFAFA" stroke="#333" stroke-width="2"/><text x="400" y="30" text-anchor="middle" font-size="16" fill="#333" font-weight="bold">Mixed-Use — Typical Unit Plan</text><rect x="40" y="60" width="300" height="200" fill="#E8F5E9" stroke="#333" stroke-width="2"/><text x="190" y="165" text-anchor="middle" font-size="12" fill="#333">Living Room (35 m²)</text><rect x="340" y="60" width="200" height="120" fill="#E3F2FD" stroke="#333" stroke-width="2"/><text x="440" y="125" text-anchor="middle" font-size="12" fill="#333">Bedroom 1 (20 m²)</text><rect x="340" y="180" width="200" height="80" fill="#E3F2FD" stroke="#333" stroke-width="2"/><text x="440" y="225" text-anchor="middle" font-size="12" fill="#333">Bedroom 2 (15 m²)</text><rect x="540" y="60" width="220" height="100" fill="#FFF3E0" stroke="#333" stroke-width="2"/><text x="650" y="115" text-anchor="middle" font-size="12" fill="#333">Kitchen (18 m²)</text><rect x="540" y="160" width="110" height="100" fill="#F3E5F5" stroke="#333" stroke-width="2"/><text x="595" y="215" text-anchor="middle" font-size="12" fill="#333">Bath (8 m²)</text><rect x="650" y="160" width="110" height="100" fill="#ECEFF1" stroke="#333" stroke-width="1"/><text x="705" y="215" text-anchor="middle" font-size="12" fill="#333">Hall (7 m²)</text><rect x="40" y="260" width="720" height="40" fill="#ECEFF1" stroke="#333" stroke-width="1"/><text x="400" y="285" text-anchor="middle" font-size="12" fill="#333">Corridor (24 m²)</text><text x="750" y="580" text-anchor="end" font-size="10" fill="#999">0 — 5m — 10m</text><polygon points="750,50 745,70 755,70" fill="#333"/><text x="750" y="80" text-anchor="middle" font-size="10" fill="#333">N</text></svg>`,
        label: "Generated Floor Plan — Typical Floor",
        roomList: [
          { name: "Living Room", area: 35, unit: "m²", x: -6.5, y: -4.5, width: 7.5, depth: 5.5, type: "living" },
          { name: "Bedroom 1", area: 20, unit: "m²", x: 1.0, y: -4.5, width: 5.0, depth: 3.3, type: "bedroom" },
          { name: "Bedroom 2", area: 15, unit: "m²", x: 1.0, y: -1.2, width: 5.0, depth: 2.2, type: "bedroom" },
          { name: "Kitchen", area: 18, unit: "m²", x: 6.0, y: -4.5, width: 5.5, depth: 2.7, type: "kitchen" },
          { name: "Bathroom", area: 8, unit: "m²", x: 6.0, y: -1.8, width: 2.7, depth: 2.8, type: "bathroom" },
          { name: "Hall", area: 7, unit: "m²", x: 8.7, y: -1.8, width: 2.8, depth: 2.8, type: "hallway" },
          { name: "Corridor", area: 24, unit: "m²", x: -6.5, y: 1.0, width: 18.0, depth: 1.1, type: "hallway" },
        ],
        totalArea: 127,
        floors: 5,
      });

    case "EX-001": { // IFC Exporter
      const ifcContent = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('BuildFlow Mock Export'),'2;1');\nFILE_NAME('mock_building.ifc','${new Date().toISOString().split("T")[0]}',('BuildFlow'),('BuildFlow'),'','','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCPROJECT('0001',#2,$,'Mock Building Project',$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;`;
      const ifcBase64 = typeof Buffer !== "undefined" ? Buffer.from(ifcContent).toString("base64") : btoa(ifcContent);
      return mockArtifact(executionId, tileInstanceId, "file", {
        name: "oslo_mixeduse_v1.ifc",
        type: "IFC 4",
        size: ifcContent.length,
        downloadUrl: `data:application/octet-stream;base64,${ifcBase64}`,
        label: "IFC Export",
      });
    }

    case "EX-002": { // BOQ Exporter — professional CSV with CSI codes
      const upstreamBoq = inputData?._boqData as {
        lines: Array<{ division: string; csiCode: string; description: string; unit: string; quantity: number; materialRate: number; laborRate: number; equipmentRate: number; unitRate: number; materialCost: number; laborCost: number; equipmentCost: number; totalCost: number }>;
        subtotalMaterial: number; subtotalLabor: number; subtotalEquipment: number; grandTotal: number;
      } | undefined;
      let exportCsvContent: string;
      let exportLineCount: number;
      let exportGrandTotal: number;

      if (upstreamBoq?.lines?.length) {
        // Build professional CSV from BOQ data
        const csvLines = [
          "Division,CSI Code,Description,Unit,Quantity,Material Rate,Labor Rate,Equipment Rate,Unit Rate,Material Cost,Labor Cost,Equipment Cost,Total Cost",
          ...upstreamBoq.lines.map(l =>
            `Div ${l.division},${l.csiCode},${l.description},${l.unit},${l.quantity},${l.materialRate},${l.laborRate},${l.equipmentRate},${l.unitRate},${l.materialCost},${l.laborCost},${l.equipmentCost},${l.totalCost}`
          ),
          "",
          `,,SUBTOTAL - Material,,,,,,,,${upstreamBoq.subtotalMaterial},,,`,
          `,,SUBTOTAL - Labor,,,,,,,,,${upstreamBoq.subtotalLabor},,`,
          `,,SUBTOTAL - Equipment,,,,,,,,,,${upstreamBoq.subtotalEquipment},`,
          `,,GRAND TOTAL,,,,,,,,,,,${upstreamBoq.grandTotal}`,
        ];
        exportCsvContent = csvLines.join("\n");
        exportLineCount = upstreamBoq.lines.length;
        exportGrandTotal = upstreamBoq.grandTotal;
      } else {
        // Fallback CSV
        exportCsvContent = "Description,Unit,Qty,Unit Rate,Total\nNo BOQ data available,,,,$0";
        exportLineCount = 0;
        exportGrandTotal = 0;
      }

      const exportCsvBase64 = typeof Buffer !== "undefined"
        ? Buffer.from(exportCsvContent).toString("base64")
        : btoa(exportCsvContent);

      return mockArtifact(executionId, tileInstanceId, "file", {
        name: `BuildFlow_BOQ_${new Date().toISOString().split("T")[0]}.csv`,
        type: "CSV Spreadsheet",
        size: exportCsvContent.length,
        downloadUrl: `data:text/csv;base64,${exportCsvBase64}`,
        label: "BOQ Export",
        content: `BOQ Export: ${exportLineCount} line items, Grand Total: $${exportGrandTotal.toLocaleString()}`,
      });
    }

    case "EX-003": { // PDF Report
      const reportText = `BuildFlow Compliance Report\nGenerated: ${new Date().toISOString()}\n\nOverall Status: PASS (7/8 rules)\n\nResults:\n- Maximum building height: 21.6m / 22m — PASS\n- Site coverage: 54% / 60% — PASS\n- Front setback: 3m / 3m — PASS\n- Side setback (N): 2.8m / 3m — FAIL (0.2m non-compliant)\n- Residential daylight: 1.8% / >1.5% — PASS\n- Parking minimum: 0.5/unit — PASS\n- Active ground floor: 78% / >50% — PASS\n- Green roof: 30% / >25% — PASS\n\nNote: This is a mock report. Full PDF generation coming soon.`;
      const reportBase64 = typeof Buffer !== "undefined" ? Buffer.from(reportText).toString("base64") : btoa(reportText);
      return mockArtifact(executionId, tileInstanceId, "file", {
        name: "compliance_report.txt",
        type: "Text Report",
        size: reportText.length,
        downloadUrl: `data:text/plain;base64,${reportBase64}`,
        label: "Compliance Report",
      });
    }

    case "EX-004": // Speckle Publisher
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: "https://speckle.xyz/streams/abc123def456/commits/78a9b2c4d5e6",
        label: "Speckle Commit URL",
      });

    case "EX-006": { // Image Exporter
      // Pass through any upstream image URL for download
      const imageUrl = String(inputData?.url ?? "https://picsum.photos/seed/export/1024/768");
      return mockArtifact(executionId, tileInstanceId, "file", {
        name: "concept_render_4K.png",
        type: "PNG Image",
        size: 2847203,
        downloadUrl: imageUrl,
        label: "High-Res Image Export",
      });
    }

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
