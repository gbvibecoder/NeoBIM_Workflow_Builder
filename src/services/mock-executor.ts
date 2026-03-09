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

    case "GN-009": { // Video Walkthrough Generator — mock (Kling 3.0 Official API)
      const vidDesc = String(inputData?.content ?? inputData?.description ?? "modern building");
      return mockArtifact(executionId, tileInstanceId, "video", {
        name: `walkthrough_${Date.now()}.mp4`,
        videoUrl: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
        downloadUrl: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
        label: "Cinematic Walkthrough — Kling 3.0 (3 shots) — Mock",
        content: `15s cinematic multi-shot walkthrough (3 camera angles) — ${vidDesc.slice(0, 100)}`,
        durationSeconds: 15,
        shotCount: 3,
        pipeline: "concept render → Kling 3.0 Official API (multi-shot) → MP4 video",
        costUsd: 1.50,
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
    "IN-001": 200, "IN-002": 300, "IN-003": 250, "IN-004": 500, "IN-005": 150, "IN-006": 400,
    "TR-001": 800, "TR-002": 1000, "TR-003": 700, "TR-004": 800, "TR-005": 500, "TR-006": 1200,
    "TR-007": 900, "TR-008": 700, "TR-009": 800, "TR-010": 1000, "TR-012": 700,
    "GN-001": 1200, "GN-002": 1800, "GN-003": 1400, "GN-004": 1600, "GN-008": 1800,
    "EX-001": 800, "EX-002": 600, "EX-003": 700, "EX-004": 700, "EX-006": 500,
  };
  return delays[catalogueId] ?? 600;
}
