/**
 * Mock execution engine — returns realistic AEC data for each node type.
 * Used for demo/development before real API connections are made.
 */

import type { ExecutionArtifact, ArtifactType } from "@/types/execution";
import type { FloorPlanGeometry, FloorPlanRoom } from "@/features/floor-plan/types/floor-plan";
import { generateId } from "@/lib/utils";
import { calculateBOQ } from "@/constants/unit-rates";
import { convertGeometryToProject } from "@/features/floor-plan/lib/pipeline-adapter";

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

    case "IN-008": { // Multi-Image Upload
      const imgCount = Number(inputData?.imageCount) || 1;
      const fNames = (inputData?.fileNames as string[]) ?? ["building_photo.jpg"];
      return mockArtifact(executionId, tileInstanceId, "image", {
        url: ARCHITECTURAL_IMAGES[0],
        urls: ARCHITECTURAL_IMAGES.slice(0, Math.min(imgCount, 5)),
        label: `${imgCount} Building Photo${imgCount > 1 ? "s" : ""} Uploaded`,
        imageCount: imgCount,
        fileNames: fNames,
        isMultiImage: true,
      });
    }

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

    case "TR-004": { // Image Understanding
      // Parse upstream content for hints about building type
      const imgContent = String(inputData?.content ?? inputData?.prompt ?? "");
      const imgLower = imgContent.toLowerCase();

      // Infer building characteristics from the image description or user text
      const imgFloors = (() => {
        const m = imgContent.match(/(\d+)[\s-]*(?:stor(?:e?y|ies)|floors?|levels?)/i);
        if (m) return parseInt(m[1], 10);
        if (/high[\s-]?rise|tower|skyscraper/i.test(imgLower)) return 12;
        if (/mid[\s-]?rise/i.test(imgLower)) return 6;
        if (/villa|house|bungalow/i.test(imgLower)) return 2;
        return 5;
      })();

      const imgBuildingType = /office|corporate/i.test(imgLower) ? "Office Building"
        : /hotel|resort/i.test(imgLower) ? "Hotel"
        : /school|university/i.test(imgLower) ? "Educational Facility"
        : /hospital|medical/i.test(imgLower) ? "Healthcare Facility"
        : /warehouse|industrial/i.test(imgLower) ? "Industrial Building"
        : "Mixed-Use Residential";

      const imgStyle = /modern|contemporary|minimal/i.test(imgLower) ? "Contemporary Nordic / Scandinavian minimalism"
        : /classical|traditional|heritage/i.test(imgLower) ? "Classical European"
        : /brutalist|concrete/i.test(imgLower) ? "Brutalist Concrete"
        : "Contemporary Nordic / Scandinavian minimalism";

      return mockArtifact(executionId, tileInstanceId, "text", {
        content: `IMAGE ANALYSIS — Design Intent Extraction\n\nDetected style: ${imgStyle}\nPredominant palette: White/cream render, natural timber, large glazing\nBuilding typology: ${imgBuildingType} (est. ${imgFloors} storeys)\nFacade character: Rhythmic fenestration, clean horizontal lines, minimal ornamentation\nGround floor: Active frontage with retail/cafe evident\nLandscape integration: Strong connection to street level\nAtmosphere: Calm, dignified, community-facing\n\nSuggested style prompts: "Nordic minimal architecture, white rendered facade, timber brise-soleil, human-scale streetscape, soft natural light"`,
        label: `Image Analysis: ${imgBuildingType}`,
        prompt: `${imgFloors}-storey ${imgBuildingType.toLowerCase()}, ${imgStyle.toLowerCase()}, rhythmic fenestration, active ground floor retail`,
        isFloorPlan: true,
        roomInfo: "Living Room (5.0m x 4.0m), Kitchen (3.5m x 3.0m), Bedroom 1 (4.0m x 3.5m), Bedroom 2 (3.5m x 3.0m), Bathroom (2.5m x 2.0m), Hallway (5.0m x 1.5m)",
        layoutDescription: "Rectangular floor plan with central hallway. Living room and kitchen on the south side, bedrooms on the north, bathroom adjacent to hallway.",
        richRooms: [
          { name: "Living Room", dimensions: "5.0m x 4.0m", position: "south-west", connections: ["Kitchen", "Hallway"], doors: ["east wall to hallway"], windows: ["south wall", "west wall"], furniture: ["L-shaped sofa", "coffee table", "TV unit", "rug"] },
          { name: "Kitchen", dimensions: "3.5m x 3.0m", position: "south-east", connections: ["Living Room", "Hallway"], doors: ["north wall to hallway"], windows: ["south wall"], furniture: ["kitchen island", "cabinets", "dining table for 4"] },
          { name: "Bedroom 1", dimensions: "4.0m x 3.5m", position: "north-west", connections: ["Hallway"], doors: ["south wall to hallway"], windows: ["north wall", "west wall"], furniture: ["double bed", "wardrobe", "nightstand"] },
          { name: "Bedroom 2", dimensions: "3.5m x 3.0m", position: "north-east", connections: ["Hallway"], doors: ["south wall to hallway"], windows: ["north wall"], furniture: ["single bed", "desk", "bookshelf"] },
          { name: "Bathroom", dimensions: "2.5m x 2.0m", position: "center-east", connections: ["Hallway"], doors: ["west wall to hallway"], windows: ["east wall"], furniture: ["bathtub", "sink", "toilet"] },
          { name: "Hallway", dimensions: "5.0m x 1.5m", position: "center", connections: ["Living Room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bathroom"], doors: ["all rooms"], windows: [], furniture: ["shoe rack", "coat hooks"] },
        ],
        footprint: { shape: "Rectangular", width: "12", depth: "8" },
        circulation: "Central east-west hallway connects all rooms. Living areas to the south, private rooms to the north.",
        geometry: {
          footprint: { width: 12, depth: 8 },
          wallHeight: 3.0,
          walls: [
            { start: [0, 0], end: [12, 0], thickness: 0.2, type: "exterior" },
            { start: [12, 0], end: [12, 8], thickness: 0.2, type: "exterior" },
            { start: [12, 8], end: [0, 8], thickness: 0.2, type: "exterior" },
            { start: [0, 8], end: [0, 0], thickness: 0.2, type: "exterior" },
            { start: [0, 4.0], end: [5.0, 4.0], thickness: 0.15, type: "interior" },
            { start: [5.0, 0], end: [5.0, 4.0], thickness: 0.15, type: "interior" },
            { start: [5.0, 4.0], end: [5.0, 5.5], thickness: 0.15, type: "interior" },
            { start: [5.0, 5.5], end: [12, 5.5], thickness: 0.15, type: "interior" },
            { start: [5.0, 5.5], end: [0, 5.5], thickness: 0.15, type: "interior" },
            { start: [8.5, 0], end: [8.5, 4.0], thickness: 0.15, type: "interior" },
            { start: [8.5, 4.0], end: [12, 4.0], thickness: 0.15, type: "interior" },
          ],
          doors: [
            { position: [2.5, 4.0], width: 0.9, wallId: 4, type: "single" },
            { position: [5.0, 2.0], width: 0.9, wallId: 5, type: "single" },
            { position: [5.0, 5.0], width: 0.9, wallId: 6, type: "single" },
            { position: [7.0, 5.5], width: 0.9, wallId: 7, type: "single" },
            { position: [3.0, 5.5], width: 0.9, wallId: 8, type: "single" },
            { position: [8.5, 2.0], width: 0.9, wallId: 9, type: "single" },
          ],
          windows: [
            { position: [2.5, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
            { position: [7.0, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
            { position: [10.5, 0], width: 1.2, height: 1.2, sillHeight: 0.9 },
            { position: [0, 2.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
            { position: [0, 7.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
            { position: [12, 2.0], width: 1.0, height: 1.0, sillHeight: 1.0 },
            { position: [6.0, 8], width: 1.5, height: 1.2, sillHeight: 0.9 },
            { position: [10.0, 8], width: 1.5, height: 1.2, sillHeight: 0.9 },
          ],
          rooms: [
            { name: "Living Room", center: [2.5, 6.75], width: 5.0, depth: 4.0, type: "living" },
            { name: "Kitchen", center: [8.5, 6.75], width: 3.5, depth: 3.0, type: "kitchen" },
            { name: "Bedroom 1", center: [2.5, 2.0], width: 4.0, depth: 3.5, type: "bedroom" },
            { name: "Bedroom 2", center: [10.25, 2.0], width: 3.5, depth: 3.0, type: "bedroom" },
            { name: "Bathroom", center: [10.25, 4.75], width: 2.5, depth: 2.0, type: "bathroom" },
            { name: "Hallway", center: [6.5, 4.75], width: 5.0, depth: 1.5, type: "hallway" },
          ],
        },
        _raw: {
          buildingType: imgBuildingType,
          floors: imgFloors,
          style: imgStyle,
          features: ["glazing", "timber accents", "active frontage", "clean lines"],
          facade: "Rhythmic fenestration, clean horizontal lines, minimal ornamentation",
          massing: `${imgFloors}-storey ${imgBuildingType.toLowerCase()} with rectangular footprint`,
          description: `${imgFloors}-storey ${imgBuildingType.toLowerCase()} with ${imgStyle.toLowerCase()} aesthetic`,
          isFloorPlan: true,
        },
      });
    }

    case "TR-005": { // Visualization Style Composer
      const styleDesc = String(inputData?.content ?? inputData?.prompt ?? "modern mixed-use building");
      const enhancedPromptMock = `Ultra-photorealistic architectural exterior render of a ${styleDesc}, golden hour lighting, Nordic minimal style, 8K resolution, cinematic composition`;
      return mockArtifact(executionId, tileInstanceId, "text", {
        content: enhancedPromptMock,
        enhancedPrompt: enhancedPromptMock,
        label: "Enhanced Architectural Prompt",
        style: "Nordic Minimal",
      });
    }

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
        content: `⚠️ DEMO DATA — not from a real IFC file. Sample: 1,319 elements across 11 categories from 5 storeys — net area accounts for ${totalOpeningArea.toFixed(0)} m² of openings`,
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

    case "TR-012": { // GIS Context — preserve user's location from upstream
      // Extract the actual location from the upstream Location Input data
      let mockAddress = "Dronning Eufemias gate, Oslo";
      let mockClimateZone = "temperate maritime";
      const mockDesignImplications = ["Climate-responsive facade design", "Energy-efficient building envelope", "Local material palette"];

      // Try to parse the user's actual location from inputData
      const rawContent = String(inputData?.content ?? inputData?.prompt ?? inputData?.address ?? "");
      if (rawContent.startsWith("{")) {
        try {
          const locJson = JSON.parse(rawContent) as Record<string, string>;
          const parts = [locJson.city, locJson.state, locJson.country].filter(Boolean);
          if (parts.length > 0) {
            mockAddress = parts.join(", ");
            if (locJson.country?.toLowerCase() === "india") mockClimateZone = "tropical / composite";
          }
        } catch { /* ignore */ }
      } else if (rawContent.length > 2) {
        mockAddress = rawContent;
      }

      // Also check direct fields
      if (inputData?.city || inputData?.state || inputData?.country) {
        const parts = [inputData.city, inputData.state, inputData.country].filter(Boolean).map(String);
        if (parts.length > 0) mockAddress = parts.join(", ");
      }

      return mockArtifact(executionId, tileInstanceId, "kpi", {
        metrics: [
          { label: "Location", value: mockAddress, unit: "" },
          { label: "Climate", value: mockClimateZone, unit: "" },
        ],
        content: `SITE ANALYSIS — ${mockAddress}\n\nClimate Zone: ${mockClimateZone}\n\nDESIGN IMPLICATIONS:\n${mockDesignImplications.map(d => `• ${d}`).join("\n")}`,
        prompt: `SITE ANALYSIS — ${mockAddress}\n\nClimate Zone: ${mockClimateZone}\n\nDESIGN IMPLICATIONS:\n${mockDesignImplications.map(d => `• ${d}`).join("\n")}`,
        label: `Site Analysis: ${mockAddress}`,
        _raw: {
          location: { address: mockAddress, lat: 0, lon: 0, displayName: mockAddress },
          elevation: { value: 500, unit: "m" },
          climate: { zone: mockClimateZone, avgTempSummer: 30, avgTempWinter: 15, annualRainfall: 1000, currentTemp: null, currentWeather: null },
          solar: { summerNoonAltitude: 70, winterNoonAltitude: 40, equinoxNoonAltitude: 55 },
          designImplications: mockDesignImplications,
        },
        mockNote: `Mock mode — Site Analysis using estimated data for ${mockAddress}`,
      });
    }

    case "GN-001": { // Massing Generator
      // Parse upstream data for floor count and building description
      const jsonData = inputData?.json as Record<string, unknown> | undefined;
      const upstreamText = String(inputData?.content ?? inputData?.prompt ?? "");
      const promptLower = upstreamText.toLowerCase();

      // ── Floor count: explicit → typology-inferred → default ──
      const rawFloors = (() => {
        if (jsonData?.floors) return Number(jsonData.floors);
        if (inputData?._raw && typeof inputData._raw === "object" && (inputData._raw as Record<string, unknown>).floors)
          return Number((inputData._raw as Record<string, unknown>).floors);
        // Match: "12 floor", "12-storey", "12 story", "12-level", "12 stories", "12 floors"
        const fm = upstreamText.match(/(\d+)[\s-]*(?:stor(?:e?y|ies)|floors?|levels?)/i);
        if (fm) return parseInt(fm[1], 10);
        // Typology-based inference
        if (/skyscraper|super\s*tall/i.test(promptLower)) return 30;
        if (/high[\s-]?rise/i.test(promptLower)) return 15;
        if (/mid[\s-]?rise/i.test(promptLower)) return 8;
        if (/low[\s-]?rise/i.test(promptLower)) return 3;
        if (/villa|bungalow|cottage|cabin|tiny\s*house/i.test(promptLower)) return 1;
        if (/duplex|townhouse|maisonette|row\s*house/i.test(promptLower)) return 2;
        if (/warehouse|industrial|factory|depot/i.test(promptLower)) return 2;
        if (/museum|gallery|library|theater|theatre/i.test(promptLower)) return 3;
        if (/school|university|campus|academy/i.test(promptLower)) return 3;
        if (/hospital|medical\s*center|clinic/i.test(promptLower)) return 6;
        if (/hotel|resort|inn/i.test(promptLower)) return 8;
        if (/\btower\b/i.test(promptLower)) return 12;
        return 5;
      })();
      const floors = Math.max(1, Math.min(rawFloors, 30));

      // ── Parse prompt for building style hints ──────────────────
      const glassHeavy = /glass|glazed|curtain\s*wall|transparent|crystal/i.test(promptLower);
      const hasRiver = /river|riverside|canal|creek/i.test(promptLower);
      const hasLake = /lake|lakeside|pond/i.test(promptLower);
      const hasWaterfront = /waterfront/i.test(promptLower);
      const isModern = /modern|contemporary|minimal|sleek|futuristic|parametric/i.test(promptLower);
      const isTower = /\btower\b|skyscraper|high[\s-]?rise/i.test(promptLower) || floors >= 10;

      // Material
      type ExtMat = "glass" | "concrete" | "brick" | "wood" | "steel" | "stone" | "terracotta" | "mixed";
      const exteriorMaterial: ExtMat =
        glassHeavy ? "glass" :
        /concrete|brutalist|exposed\s*concrete/i.test(promptLower) ? "concrete" :
        /brick|masonry|red\s*brick/i.test(promptLower) ? "brick" :
        /wood|timber|clt|cross[\s-]?laminated/i.test(promptLower) ? "wood" :
        /steel|metal|corten|cor[\s-]?ten|alumi?n[iu]um/i.test(promptLower) ? "steel" :
        /stone|limestone|granite|sandstone|marble/i.test(promptLower) ? "stone" :
        /terracotta|terra[\s-]?cotta|clay/i.test(promptLower) ? "terracotta" : "mixed";

      // Environment
      type Env = "urban" | "suburban" | "waterfront" | "park" | "desert" | "coastal" | "mountain" | "campus";
      const environment: Env =
        (hasRiver || hasLake || hasWaterfront) ? "waterfront" :
        /coastal|beachfront|beach|seaside|oceanfront/i.test(promptLower) ? "coastal" :
        /mountain|hillside|alpine|hilltop/i.test(promptLower) ? "mountain" :
        /campus|university|school\s+grounds/i.test(promptLower) ? "campus" :
        /urban|city|downtown|metropolitan|cbd/i.test(promptLower) ? "urban" :
        /park|garden|green|botanical/i.test(promptLower) ? "park" :
        /desert|arid|dry/i.test(promptLower) ? "desert" : "suburban";

      // Usage
      type Use = "residential" | "office" | "mixed" | "commercial" | "hotel" | "educational" | "healthcare" | "cultural" | "industrial" | "civic";
      const usage: Use =
        /office|corporate|workspace|coworking/i.test(promptLower) ? "office" :
        /hotel|hospitality|resort|inn|boutique\s*hotel/i.test(promptLower) ? "hotel" :
        /residential|apartment|housing|home|condo|flat|dwelling/i.test(promptLower) ? "residential" :
        /commercial|retail|shop|mall|market/i.test(promptLower) ? "commercial" :
        /school|university|campus|educational|academy|classroom/i.test(promptLower) ? "educational" :
        /hospital|clinic|medical|healthcare|ward/i.test(promptLower) ? "healthcare" :
        /museum|gallery|library|theater|theatre|concert|cultural|exhibition/i.test(promptLower) ? "cultural" :
        /warehouse|industrial|factory|workshop|depot|storage/i.test(promptLower) ? "industrial" :
        /civic|government|courthouse|city\s*hall|municipal/i.test(promptLower) ? "civic" : "mixed";

      // Typology
      type Typo = "tower" | "slab" | "courtyard" | "villa" | "warehouse" | "podium-tower" | "generic";
      const typology: Typo =
        /courtyard/i.test(promptLower) ? "courtyard" :
        /villa|bungalow|house|cottage/i.test(promptLower) ? "villa" :
        /warehouse|industrial|factory/i.test(promptLower) ? "warehouse" :
        /podium.*tower|tower.*podium/i.test(promptLower) ? "podium-tower" :
        (floors >= 15 || /\btower\b|skyscraper/i.test(promptLower)) ? "tower" :
        "generic";

      // Facade pattern
      type Facade = "curtain-wall" | "punched-window" | "ribbon-window" | "brise-soleil" | "none";
      const facadePattern: Facade =
        glassHeavy ? "curtain-wall" :
        /brise[\s-]?soleil|louv/i.test(promptLower) ? "brise-soleil" :
        /ribbon\s*window/i.test(promptLower) ? "ribbon-window" :
        /brick|stone|traditional|masonry/i.test(promptLower) ? "punched-window" : "none";

      // Floor height override by usage
      const floorHeightOverride =
        /warehouse|industrial|factory/i.test(promptLower) ? 5.0 :
        /museum|gallery|cultural|exhibition/i.test(promptLower) ? 4.5 :
        /commercial|retail|mall/i.test(promptLower) ? 4.2 :
        /office|corporate/i.test(promptLower) ? 3.8 :
        /residential|apartment|housing/i.test(promptLower) ? 3.0 :
        3.6;

      // ── Dynamic footprint based on typology and floors ─────────
      const footprint = (() => {
        if (jsonData?.footprint_m2) return Math.round(Number(jsonData.footprint_m2));
        if (/villa|cottage|cabin/i.test(promptLower)) return 120 + Math.round(Math.random() * 80);
        if (/duplex|townhouse/i.test(promptLower)) return 100 + Math.round(Math.random() * 60);
        if (/warehouse|industrial|factory/i.test(promptLower)) return 800 + Math.round(Math.random() * 400);
        if (/museum|gallery/i.test(promptLower)) return 600 + Math.round(Math.random() * 300);
        if (/school|university/i.test(promptLower)) return 500 + Math.round(Math.random() * 300);
        if (/hospital/i.test(promptLower)) return 700 + Math.round(Math.random() * 400);
        if (/skyscraper|super\s*tall/i.test(promptLower)) return 400 + Math.round(Math.random() * 200);
        // General: taller buildings → smaller footprints
        if (floors >= 15) return 350 + Math.round(Math.random() * 150);
        if (floors >= 8) return 450 + Math.round(Math.random() * 200);
        if (floors >= 4) return 500 + Math.round(Math.random() * 200);
        return 400 + Math.round(Math.random() * 200);
      })();

      const heightPerFloor = floorHeightOverride;
      const height = (floors * heightPerFloor).toFixed(1);
      const totalGFA = jsonData?.total_gfa_m2 ? Number(jsonData.total_gfa_m2) : undefined;
      const gfa = totalGFA ?? Math.round(floors * footprint * 0.98);

      const buildingType = jsonData?.building_type as string ??
        (isTower ? `${usage.charAt(0).toUpperCase() + usage.slice(1)} Tower` :
         `${usage.charAt(0).toUpperCase() + usage.slice(1)} Building`);

      const style = {
        glassHeavy,
        hasRiver: hasRiver || hasWaterfront,
        hasLake,
        isModern: isModern || glassHeavy,
        isTower,
        exteriorMaterial,
        environment,
        usage,
        promptText: upstreamText,
        typology,
        facadePattern,
        floorHeightOverride,
        maxFloorCap: 30,
      };

      return mockArtifact(executionId, tileInstanceId, "3d", {
        floors,
        height: parseFloat(height),
        footprint,
        gfa,
        buildingType,
        style,
        metrics: [
          { label: "GFA", value: gfa.toLocaleString(), unit: "m²" },
          { label: "Height", value: height, unit: "m" },
          { label: "Floors", value: floors, unit: "" },
          { label: "Coverage", value: "54", unit: "%" },
          { label: "Footprint", value: String(footprint), unit: "m²" },
          { label: "Plot Ratio", value: (gfa / 1050).toFixed(2), unit: "FAR" },
        ],
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

    case "GN-007": // Image to 3D (SAM 3D) — mock
      return mockArtifact(executionId, tileInstanceId, "3d", {
        glbUrl: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Box/glTF-Binary/Box.glb",
        plyUrl: null,
        seed: 42,
        label: "3D Model (SAM 3D) — Mock",
        metadata: {
          glbFileSize: 648,
          plyFileSize: null,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          costUsd: 0.02,
        },
      });

    case "GN-009": { // Video Walkthrough Generator — client-side Three.js rendering
      // Use original PDF text (_raw.rawText) as source of truth when available
      const mockRaw = (inputData?._raw ?? null) as Record<string, unknown> | null;
      const mockOriginalText = (mockRaw?.rawText as string) ?? null;
      const vidDesc = mockOriginalText ?? String(inputData?.content ?? inputData?.description ?? "modern building");
      const upstreamFloors = Number(mockRaw?.floors ?? inputData?.floors) || 5;
      const upstreamTotalArea = Number(mockRaw?.totalArea ?? inputData?.totalArea) || 0;
      const upstreamHeight = Number(mockRaw?.height ?? inputData?.height) || 0;
      const upstreamFloorHeight = upstreamHeight > 0 ? upstreamHeight / upstreamFloors : 3.6;
      const upstreamFootprint = Number(mockRaw?.footprint ?? inputData?.footprint) || (upstreamTotalArea > 0 ? Math.round(upstreamTotalArea / upstreamFloors) : 600);
      const upstreamBuildingType = String(mockRaw?.buildingType ?? inputData?.buildingType ?? "modern office building");
      const upstreamFacade = String(mockRaw?.facade ?? inputData?.facade ?? "");

      // Infer style from building description for richer 3D rendering
      const facadeLower = upstreamFacade.toLowerCase();
      const descLower = vidDesc.toLowerCase();
      const typeLower = upstreamBuildingType.toLowerCase();
      const extMat = facadeLower.includes("glass") || facadeLower.includes("glazed") ? "glass" as const
        : facadeLower.includes("brick") ? "brick" as const
        : facadeLower.includes("timber") || facadeLower.includes("wood") ? "wood" as const
        : facadeLower.includes("steel") || facadeLower.includes("metal") ? "steel" as const
        : facadeLower.includes("stone") ? "stone" as const
        : facadeLower.includes("concrete") || facadeLower.includes("render") ? "concrete" as const
        : "mixed" as const;

      return mockArtifact(executionId, tileInstanceId, "video", {
        name: `walkthrough_${Date.now()}.webm`,
        videoUrl: "", // empty — will be populated after client-side rendering
        downloadUrl: "",
        label: "AEC Cinematic Walkthrough — 15s Three.js Render",
        content: `15s AEC walkthrough: 5s exterior drone orbit + 10s interior flythrough — ${vidDesc.slice(0, 100)}`,
        durationSeconds: 15,
        shotCount: 4,
        pipeline: "Three.js client-side → WebM video",
        costUsd: 0,
        videoGenerationStatus: "client-rendering" as const,
        _buildingConfig: {
          floors: upstreamFloors,
          floorHeight: upstreamFloorHeight,
          footprint: upstreamFootprint,
          buildingType: upstreamBuildingType,
          style: {
            glassHeavy: facadeLower.includes("glass") || facadeLower.includes("glazed"),
            hasRiver: descLower.includes("river") || descLower.includes("waterfront"),
            hasLake: descLower.includes("lake"),
            isModern: descLower.includes("modern") || descLower.includes("contemporary") || !descLower.includes("traditional"),
            isTower: upstreamFloors > 8,
            exteriorMaterial: extMat,
            environment: (descLower.includes("urban") || descLower.includes("city")) ? "urban" : "suburban",
            usage: typeLower.includes("residential") || typeLower.includes("apartment") ? "residential"
              : typeLower.includes("hotel") ? "hotel"
              : typeLower.includes("mixed") ? "mixed"
              : "office",
            promptText: vidDesc.slice(0, 200),
            typology: upstreamFloors > 8 ? "tower" : upstreamFloors <= 3 ? "villa" : "slab",
            facadePattern: facadeLower.includes("curtain") ? "curtain-wall" : "punched-window",
            maxFloorCap: 30,
          },
        },
      });
    }

    case "GN-010": { // Hi-Fi 3D Reconstructor — mock
      const hifiDesc = String(inputData?.content ?? inputData?.description ?? "modern building");
      const hifiSeed = hifiDesc.slice(0, 15).replace(/\s+/g, "-").toLowerCase() || "building";
      return mockArtifact(executionId, tileInstanceId, "3d", {
        glbUrl: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Box/glTF-Binary/Box.glb",
        thumbnailUrl: `https://picsum.photos/seed/${hifiSeed}-3d/512/512`,
        textureUrls: [],
        label: "Hi-Fi 3D Model (Meshy v4) — Mock",
        content: hifiDesc.slice(0, 200),
        metadata: {
          costUsd: 0.10,
          durationMs: 45000,
          taskId: `mock-meshy-${Date.now()}`,
          pipeline: "multi-view renders → Meshy v4 → textured GLB",
          topology: "quad",
          polycount: 30000,
        },
      });
    }

    case "GN-011": { // Interactive 3D Viewer — mock
      // Build from geometry data if available (e.g. from TR-004 mock with geometry)
      const geoData = inputData?.geometry ?? (inputData?._raw as Record<string, unknown> | undefined)?.geometry;
      const rooms011 = inputData?.richRooms ?? inputData?.rooms ?? [];
      const fp011 = inputData?.footprint as Record<string, unknown> | undefined;
      const mockRoomCount = Array.isArray(rooms011) ? rooms011.length : 6;
      const mockHtml = `<!DOCTYPE html><html><head><title>3D Floor Plan Viewer (Mock)</title><style>body{margin:0;background:#07070D;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column}h2{color:#4F8AFF}p{color:#888;max-width:400px;text-align:center}</style></head><body><h2>Interactive 3D Viewer</h2><p>Mock mode — ${mockRoomCount} rooms detected. Connect to a real TR-004 node with a floor plan image to see the full interactive 3D model with walk mode, room highlighting, and furniture.</p><p style="color:#4F8AFF;margin-top:2rem">Rooms: ${Array.isArray(rooms011) ? rooms011.map((r: Record<string, unknown>) => r.name).join(", ") : "Living Room, Kitchen, Bedroom 1, Bedroom 2, Bathroom, Hallway"}</p></body></html>`;

      return mockArtifact(executionId, tileInstanceId, "html", {
        html: mockHtml,
        label: `Interactive 3D Floor Plan (Mock — ${mockRoomCount} rooms)`,
        width: "100%",
        height: "600px",
        fileName: `floorplan-3d-mock-${Date.now()}.html`,
        mimeType: "text/html",
        roomCount: mockRoomCount,
        hasGeometry: !!geoData,
        footprint: fp011 ? `${fp011.width ?? 12}m x ${fp011.depth ?? 8}m` : "12m x 8m",
      });
    }

    case "GN-012": { // Floor Plan Editor — mock
      const mockRooms012 = [
        { name: "Living Room", type: "living", area_sqm: 25.5, width_m: 5.1, length_m: 5.0 },
        { name: "Kitchen", type: "kitchen", area_sqm: 12.0, width_m: 4.0, length_m: 3.0 },
        { name: "Bedroom 1", type: "bedroom", area_sqm: 16.0, width_m: 4.0, length_m: 4.0 },
        { name: "Bedroom 2", type: "bedroom", area_sqm: 12.0, width_m: 4.0, length_m: 3.0 },
        { name: "Bathroom 1", type: "bathroom", area_sqm: 4.5, width_m: 2.5, length_m: 1.8 },
        { name: "Bathroom 2", type: "bathroom", area_sqm: 3.5, width_m: 2.0, length_m: 1.75 },
        { name: "Hallway", type: "hallway", area_sqm: 6.0, width_m: 6.0, length_m: 1.0 },
        { name: "Balcony", type: "balcony", area_sqm: 5.0, width_m: 5.0, length_m: 1.0 },
      ];
      const totalArea012 = mockRooms012.reduce((s, r) => s + r.area_sqm, 0);

      // Build valid FloorPlanProject from mock rooms
      const geoRooms012: FloorPlanRoom[] = [
        { name: "Living Room",  type: "living",   x: 0,   y: 0,   width: 5.1, depth: 5.0, center: [2.55, 2.5]  },
        { name: "Bedroom 1",    type: "bedroom",  x: 5.1, y: 0,   width: 4.0, depth: 4.0, center: [7.1, 2.0]   },
        { name: "Bathroom 1",   type: "bathroom", x: 9.1, y: 0,   width: 2.5, depth: 1.8, center: [10.35, 0.9] },
        { name: "Bathroom 2",   type: "bathroom", x: 9.1, y: 1.8, width: 2.0, depth: 1.75, center: [10.1, 2.675] },
        { name: "Bedroom 2",    type: "bedroom",  x: 5.1, y: 4.0, width: 4.0, depth: 3.0, center: [7.1, 5.5]   },
        { name: "Kitchen",      type: "kitchen",  x: 0,   y: 5.0, width: 4.0, depth: 3.0, center: [2.0, 6.5]   },
        { name: "Hallway",      type: "hallway",  x: 4.0, y: 5.0, width: 6.0, depth: 1.0, center: [7.0, 5.5]   },
        { name: "Balcony",      type: "balcony",  x: 0,   y: 8.0, width: 5.0, depth: 1.0, center: [2.5, 8.5]   },
      ];
      const mockGeometry012: FloorPlanGeometry = {
        footprint: { width: 11.6, depth: 9.0 },
        wallHeight: 3.0,
        walls: [
          { start: [0, 0], end: [11.6, 0], thickness: 0.23, type: "exterior" },
          { start: [11.6, 0], end: [11.6, 9.0], thickness: 0.23, type: "exterior" },
          { start: [11.6, 9.0], end: [0, 9.0], thickness: 0.23, type: "exterior" },
          { start: [0, 9.0], end: [0, 0], thickness: 0.23, type: "exterior" },
          { start: [5.1, 0], end: [5.1, 7.0], thickness: 0.15, type: "interior" },
          { start: [9.1, 0], end: [9.1, 3.55], thickness: 0.15, type: "interior" },
          { start: [0, 5.0], end: [10.0, 5.0], thickness: 0.15, type: "interior" },
          { start: [4.0, 5.0], end: [4.0, 6.0], thickness: 0.15, type: "interior" },
        ],
        doors: [
          { position: [2.5, 5.0], width: 0.9, wallId: 6, type: "single" },
          { position: [5.1, 2.0], width: 0.9, wallId: 4, type: "single" },
          { position: [5.1, 5.5], width: 0.9, wallId: 4, type: "single" },
          { position: [9.1, 0.9], width: 0.75, wallId: 5, type: "single" },
          { position: [9.1, 2.7], width: 0.75, wallId: 5, type: "single" },
          { position: [2.0, 5.0], width: 0.9, wallId: 6, type: "single" },
          { position: [5.5, 0], width: 1.05, wallId: 0, type: "single" },
        ],
        windows: [
          { position: [2.5, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
          { position: [7.1, 0], width: 1.5, height: 1.2, sillHeight: 0.9 },
          { position: [0, 2.5], width: 1.5, height: 1.2, sillHeight: 0.9 },
          { position: [0, 6.5], width: 1.2, height: 1.2, sillHeight: 0.9 },
          { position: [11.6, 5.0], width: 1.2, height: 1.0, sillHeight: 1.0 },
          { position: [2.5, 9.0], width: 1.5, height: 1.2, sillHeight: 0.9 },
        ],
        rooms: geoRooms012,
      };
      const mockProject012 = convertGeometryToProject(mockGeometry012, "2BHK Apartment — Mock");

      return mockArtifact(executionId, tileInstanceId, "json", {
        label: "Floor Plan Editor — 2BHK Apartment (Mock)",
        interactive: true,
        sourceType: "tr004",
        warnings: ["Mock mode — using sample floor plan data"],
        floorPlanProject: mockProject012,
        boqQuantities: {
          walls: {
            exterior: { length_m: 38.2, area_sqm: 114.6, volume_cum: 26.36, material: "brick_230mm" },
            interior: { length_m: 22.5, area_sqm: 67.5, volume_cum: 10.13, material: "brick_150mm" },
            partition: { length_m: 5.0, area_sqm: 15.0, volume_cum: 1.5, material: "drywall_100mm" },
          },
          doors: [
            { type: "single swing", width_mm: 1050, height_mm: 2100, count: 1, description: "Main / Entrance" },
            { type: "single swing", width_mm: 900, height_mm: 2100, count: 4, description: "Room" },
            { type: "single swing", width_mm: 750, height_mm: 2100, count: 2, description: "Bathroom" },
          ],
          windows: [
            { type: "sliding", width_mm: 1500, height_mm: 1200, count: 4, area_sqm: 7.2 },
            { type: "sliding", width_mm: 900, height_mm: 600, count: 2, area_sqm: 1.08 },
          ],
          flooring: { total_area_sqm: totalArea012, by_room_type: { living: 25.5, kitchen: 12.0, bedroom: 28.0, bathroom: 8.0, hallway: 6.0, balcony: 5.0 } },
          plastering: { interior_wall_area_sqm: 135.0, ceiling_area_sqm: totalArea012, exterior_wall_area_sqm: 114.6 },
          skirting: { total_length_m: 65.0 },
          painting: { wall_area_sqm: 230.0, ceiling_area_sqm: totalArea012 },
          structural: { columns_count: 4, columns_volume_cum: 1.08, slab_area_sqm: totalArea012, slab_volume_cum: totalArea012 * 0.15, stairs_count: 0 },
        },
        roomSchedule: mockRooms012.map((r, i) => ({
          room_number: i + 1,
          name: r.name,
          type: r.type,
          area_sqm: r.area_sqm,
          width_m: r.width_m,
          length_m: r.length_m,
          floor: "Ground Floor",
        })),
        massingGeometry: null,
        svgContent: "",
        // EX-002 compatible BOQ data
        _boqData: {
          lines: [
            { division: "04 — Masonry", csiCode: "04 21 13", description: "Exterior brick masonry (230mm)", unit: "cum", quantity: 26.36, wasteFactor: 0.05, adjustedQty: 27.68, materialRate: 5500, laborRate: 2500, equipmentRate: 500, unitRate: 8500, materialCost: 152240, laborCost: 69200, equipmentCost: 13840, totalCost: 235280 },
            { division: "04 — Masonry", csiCode: "04 21 13", description: "Interior brick masonry (150mm)", unit: "cum", quantity: 10.13, wasteFactor: 0.05, adjustedQty: 10.64, materialRate: 5200, laborRate: 2400, equipmentRate: 400, unitRate: 8000, materialCost: 55328, laborCost: 25536, equipmentCost: 4256, totalCost: 85120 },
            { division: "03 — Concrete", csiCode: "03 30 00", description: "RCC slab (M25 grade)", unit: "cum", quantity: 12.68, wasteFactor: 0.03, adjustedQty: 13.06, materialRate: 4800, laborRate: 1800, equipmentRate: 600, unitRate: 7200, materialCost: 62688, laborCost: 23508, equipmentCost: 7836, totalCost: 94032 },
            { division: "09 — Finishes", csiCode: "09 24 00", description: "Interior wall plaster (12mm cement)", unit: "sqm", quantity: 135.0, wasteFactor: 0.05, adjustedQty: 141.75, materialRate: 280, laborRate: 150, equipmentRate: 20, unitRate: 450, materialCost: 39690, laborCost: 21263, equipmentCost: 2835, totalCost: 63788 },
            { division: "09 — Finishes", csiCode: "09 30 00", description: "Vitrified tile flooring (600×600)", unit: "sqm", quantity: 84.5, wasteFactor: 0.08, adjustedQty: 91.26, materialRate: 850, laborRate: 280, equipmentRate: 70, unitRate: 1200, materialCost: 77571, laborCost: 25553, equipmentCost: 6388, totalCost: 109512 },
            { division: "09 — Finishes", csiCode: "09 91 00", description: "Interior wall painting (2 coats emulsion)", unit: "sqm", quantity: 230.0, wasteFactor: 0.05, adjustedQty: 241.5, materialRate: 110, laborRate: 80, equipmentRate: 10, unitRate: 200, materialCost: 26565, laborCost: 19320, equipmentCost: 2415, totalCost: 48300 },
            { division: "08 — Openings", csiCode: "08 11 13", description: "Main / Entrance door (single swing, 1050×2100mm)", unit: "nos", quantity: 1, wasteFactor: 0, adjustedQty: 1, materialRate: 16000, laborRate: 4500, equipmentRate: 500, unitRate: 21000, materialCost: 16000, laborCost: 4500, equipmentCost: 500, totalCost: 21000 },
            { division: "08 — Openings", csiCode: "08 11 13", description: "Room door (single swing, 900×2100mm)", unit: "nos", quantity: 4, wasteFactor: 0, adjustedQty: 4, materialRate: 9000, laborRate: 3200, equipmentRate: 500, unitRate: 12700, materialCost: 36000, laborCost: 12800, equipmentCost: 2000, totalCost: 50800 },
            { division: "08 — Openings", csiCode: "08 51 13", description: "Sliding window (1500×1200mm)", unit: "nos", quantity: 4, wasteFactor: 0, adjustedQty: 4, materialRate: 7500, laborRate: 3750, equipmentRate: 1250, unitRate: 12500, materialCost: 30000, laborCost: 15000, equipmentCost: 5000, totalCost: 50000 },
          ],
          subtotalMaterial: 496082,
          subtotalLabor: 216680,
          subtotalEquipment: 45070,
          grandTotal: 757832,
          projectType: "residential",
          projectMultiplier: 1.0,
          disclaimer: "Mock data — indicative Indian market rates (2024–25).",
        },
        _currency: "INR",
        _currencySymbol: "₹",
        _region: "India",
        _gfa: Math.round(totalArea012 * 100) / 100,
        _totalCost: 757832,
        // EX-002 validation: rows + headers table format
        headers: ["Division", "CSI Code", "Description", "Unit", "Qty", "Material Rate", "Labor Rate", "Equip Rate", "Unit Rate", "Material Cost", "Labor Cost", "Equip Cost", "Total Cost"],
        rows: [
          ["04 — Masonry", "04 21 13", "Exterior brick masonry (230mm)", "cum", 26.36, 5500, 2500, 500, 8500, 152240, 69200, 13840, 235280],
          ["04 — Masonry", "04 21 13", "Interior brick masonry (150mm)", "cum", 10.13, 5200, 2400, 400, 8000, 55328, 25536, 4256, 85120],
          ["03 — Concrete", "03 30 00", "RCC slab (M25 grade)", "cum", 12.68, 4800, 1800, 600, 7200, 62688, 23508, 7836, 94032],
          ["09 — Finishes", "09 24 00", "Interior wall plaster (12mm cement)", "sqm", 135.0, 280, 150, 20, 450, 39690, 21263, 2835, 63788],
          ["09 — Finishes", "09 30 00", "Vitrified tile flooring (600×600)", "sqm", 84.5, 850, 280, 70, 1200, 77571, 25553, 6388, 109512],
          ["09 — Finishes", "09 91 00", "Interior wall painting (2 coats emulsion)", "sqm", 230.0, 110, 80, 10, 200, 26565, 19320, 2415, 48300],
          ["08 — Openings", "08 11 13", "Main / Entrance door (single swing, 1050×2100mm)", "nos", 1, 16000, 4500, 500, 21000, 16000, 4500, 500, 21000],
          ["08 — Openings", "08 11 13", "Room door (single swing, 900×2100mm)", "nos", 4, 9000, 3200, 500, 12700, 36000, 12800, 2000, 50800],
          ["08 — Openings", "08 51 13", "Sliding window (1500×1200mm)", "nos", 4, 7500, 3750, 1250, 12500, 30000, 15000, 5000, 50000],
        ],
        summary: {
          totalRooms: mockRooms012.length,
          totalArea_sqm: Math.round(totalArea012 * 100) / 100,
          totalWalls: 18,
          totalDoors: 7,
          totalWindows: 6,
          totalColumns: 4,
          totalStairs: 0,
          floorCount: 1,
          buildingType: "residential",
        },
        _outputs: {
          "project-out": null,
          "geo-out": null,
          "schedule-out": mockRooms012.map((r, i) => ({ room_number: i + 1, ...r, floor: "Ground Floor" })),
          "boq-out": { walls: { exterior: { length_m: 38.2 }, interior: { length_m: 22.5 }, partition: { length_m: 5.0 } } },
          "svg-out": "",
        },
      });
    }

    case "GN-008": { // Text to 3D Generator — mock
      const t2dPrompt = String(inputData?.content ?? inputData?.prompt ?? "modern building");
      const t2dSeed = t2dPrompt.slice(0, 15).replace(/\s+/g, "-").toLowerCase() || "building";
      return mockArtifact(executionId, tileInstanceId, "3d", {
        glbUrl: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Box/glTF-Binary/Box.glb",
        plyUrl: null,
        seed: 42,
        label: "3D Model (Text to 3D) — Mock",
        sourceImageUrl: `https://picsum.photos/seed/${t2dSeed}/1024/1024`,
        revisedPrompt: `Photorealistic architectural rendering of: ${t2dPrompt}`,
        metadata: {
          glbFileSize: 648,
          plyFileSize: null,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          costUsd: 0.06,
          pipeline: "text → DALL-E 3 → SAM 3D",
        },
      });
    }

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
    "IN-001": 200, "IN-002": 300, "IN-003": 250, "IN-004": 500, "IN-005": 150, "IN-006": 400, "IN-008": 300,
    "TR-001": 800, "TR-002": 1000, "TR-003": 700, "TR-004": 800, "TR-005": 500, "TR-006": 1200,
    "TR-007": 900, "TR-008": 700, "TR-009": 800, "TR-010": 1000, "TR-012": 700,
    "GN-001": 1200, "GN-002": 1800, "GN-003": 1400, "GN-004": 1600, "GN-008": 1800,
    "EX-001": 800, "EX-002": 600, "EX-003": 700, "EX-004": 700, "EX-006": 500,
  };
  return delays[catalogueId] ?? 600;
}
