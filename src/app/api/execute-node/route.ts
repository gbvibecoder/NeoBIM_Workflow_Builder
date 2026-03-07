import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateBuildingDescription, generateConceptImage, generateFloorPlan, parseBriefDocument, analyzeImage, enhanceArchitecturalPrompt } from "@/services/openai";
import type { BuildingDescription } from "@/services/openai";
import { analyzeSite } from "@/services/site-analysis";
import { generateId } from "@/lib/utils";
import type { ExecutionArtifact } from "@/types/execution";
import { checkRateLimit, logRateLimitHit } from "@/lib/rate-limit";
import {
  findUnitRate,
  applyRegionalFactor,
  calculateTotalCost,
} from "@/lib/cost-database";
import { assertValidInput } from "@/lib/validation";
import { APIError, UserErrors, formatErrorResponse } from "@/lib/user-errors";
import { generatePDFBase64 } from "@/services/pdf-report-server";

// Node IDs that have real implementations
const REAL_NODE_IDS = new Set(["TR-001", "TR-003", "TR-004", "TR-005", "TR-012", "GN-003", "GN-004", "TR-007", "TR-008", "EX-002", "EX-003"]);

export async function POST(req: NextRequest) {
  const session = await auth();

  // Check authentication
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.UNAUTHORIZED),
      { status: 401 }
    );
  }

  const userId: string = session.user.id;
  const userRole = (session.user as { role?: string }).role as "FREE" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN" || "FREE";

  // Apply rate limiting
  try {

    const userEmail = session.user.email || "";
    const rateLimitResult = await checkRateLimit(userId, userRole, userEmail);

    if (!rateLimitResult.success) {
      const resetDate = new Date(rateLimitResult.reset);
      const hoursUntilReset = Math.ceil((resetDate.getTime() - Date.now()) / (1000 * 60 * 60));

      // Log the rate limit hit
      logRateLimitHit(userId, userRole, rateLimitResult.remaining);

      const rateLimitError = userRole === "FREE"
        ? UserErrors.RATE_LIMIT_FREE(hoursUntilReset)
        : UserErrors.RATE_LIMIT_PRO(Math.ceil(hoursUntilReset * 60));

      return NextResponse.json(
        formatErrorResponse(rateLimitError),
        { 
          status: 429,
          headers: {
            "X-RateLimit-Limit": rateLimitResult.limit.toString(),
            "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            "X-RateLimit-Reset": rateLimitResult.reset.toString(),
          }
        }
      );
    }

  } catch (error) {
    console.error("[execute-node] Rate limit check failed:", error);
    // If rate limiting fails, allow the request to proceed (fail open for better UX)
  }

  const { catalogueId, executionId, tileInstanceId, inputData, userApiKey } = await req.json();

  if (!REAL_NODE_IDS.has(catalogueId)) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.NODE_NOT_IMPLEMENTED(catalogueId)),
      { status: 400 }
    );
  }

  const apiKey = userApiKey || undefined;

  try {
    // STEP 1: Validate input BEFORE hitting any APIs
    assertValidInput(catalogueId, inputData);

    let artifact: ExecutionArtifact;

    if (catalogueId === "TR-003") {
      // Building Description Generator — GPT-4o-mini
      const prompt = inputData?.prompt ?? inputData?.content ?? "Modern mixed-use building";
      const description = await generateBuildingDescription(prompt, apiKey);

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "text",
        data: {
          content: formatBuildingDescription(description),
          label: "Building Description (AI Generated)",
          _raw: description,
        },
        metadata: { model: "gpt-4o-mini", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-001") {
      // Document Parser — PDF text extraction + GPT structuring
      const rawText = inputData?.content ?? inputData?.prompt ?? inputData?.rawText ?? "";
      const pdfBase64 = inputData?.fileData ?? inputData?.buffer ?? null;

      let extractedText = typeof rawText === "string" ? rawText : "";

      // If we have actual PDF data (base64), extract text from it
      if (pdfBase64 && typeof pdfBase64 === "string") {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
          const buffer = Buffer.from(pdfBase64, "base64");
          const pdfData = await pdfParse(buffer);
          extractedText = pdfData.text || "";
        } catch (parseErr) {
          console.error("[TR-001] PDF parsing failed:", parseErr);
          // Fall through to use rawText if available
        }
      }

      if (!extractedText || extractedText.trim().length < 20) {
        return NextResponse.json(
          formatErrorResponse({
            title: "No document content",
            message: "Could not extract text from the document. The PDF may be scanned (image-only) or too short. Try pasting the brief text into a Text Prompt node instead.",
            code: "EMPTY_DOCUMENT",
          }),
          { status: 400 }
        );
      }

      const parsed = await parseBriefDocument(extractedText, apiKey);

      // Build a formatted text output that downstream nodes (TR-002, GN-001) can consume
      const programLines = (parsed.programme ?? [])
        .map(p => `• ${p.space}: ${p.area_m2 ? `${p.area_m2} m²` : "TBD"} (${p.floor ?? "TBD"})`)
        .join("\n");

      const formattedContent = `PROJECT BRIEF — ${parsed.projectTitle.toUpperCase()}

Type: ${parsed.projectType}
${parsed.site?.address ? `Site: ${parsed.site.address}` : ""}
${parsed.site?.area ? `Site Area: ${parsed.site.area}` : ""}

PROGRAMME REQUIREMENTS:
${programLines || "Not specified"}

${parsed.constraints ? `CONSTRAINTS:\n• Max Height: ${parsed.constraints.maxHeight ?? "N/A"}\n• Setbacks: ${parsed.constraints.setbacks ?? "N/A"}\n• Zoning: ${parsed.constraints.zoning ?? "N/A"}` : ""}

${parsed.budget?.amount ? `BUDGET: ${parsed.budget.amount} ${parsed.budget.currency ?? ""}` : ""}

${parsed.sustainability ? `SUSTAINABILITY: ${parsed.sustainability}` : ""}

${parsed.designIntent ? `DESIGN INTENT: ${parsed.designIntent}` : ""}

${parsed.keyRequirements?.length ? `KEY REQUIREMENTS:\n${parsed.keyRequirements.map(r => `• ${r}`).join("\n")}` : ""}`;

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "text",
        data: {
          content: formattedContent,
          label: `Parsed Brief: ${parsed.projectTitle}`,
          _raw: parsed,
          prompt: formattedContent,
        },
        metadata: { model: "gpt-4o-mini", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-004") {
      // Image Understanding — GPT-4o-mini Vision
      const imageBase64 = inputData?.fileData ?? inputData?.imageBase64 ?? inputData?.base64 ?? null;
      const imageUrl = inputData?.url ?? null;
      const mimeType = inputData?.mimeType ?? "image/jpeg";

      let base64Data: string | null = typeof imageBase64 === "string" ? imageBase64 : null;

      // If we have a URL but no base64, try to fetch and convert
      if (!base64Data && imageUrl && typeof imageUrl === "string") {
        try {
          const imgRes = await fetch(imageUrl);
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            base64Data = buffer.toString("base64");
          }
        } catch {
          // Non-fatal — will fall through to error
        }
      }

      if (!base64Data) {
        return NextResponse.json(
          formatErrorResponse({
            title: "No image data",
            message: "No image was provided for analysis. Upload an image using the Image Upload node.",
            code: "NO_IMAGE_DATA",
          }),
          { status: 400 }
        );
      }

      const analysis = await analyzeImage(base64Data, mimeType, apiKey);

      const descriptionText = `IMAGE ANALYSIS — ${analysis.buildingType}

Style: ${analysis.style}
Estimated Floors: ${analysis.floors}

${analysis.description}

FACADE: ${analysis.facade}

MASSING: ${analysis.massing}

SITE: ${analysis.siteRelationship}

KEY FEATURES:
${analysis.features.map(f => `• ${f}`).join("\n")}`;

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "text",
        data: {
          content: descriptionText,
          label: `Image Analysis: ${analysis.buildingType}`,
          prompt: analysis.description,
          _raw: analysis,
        },
        metadata: { model: "gpt-4o-mini", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-012") {
      // Site Analysis — real geographic + climate data from free APIs
      const address = inputData?.content ?? inputData?.prompt ?? inputData?.address ?? "";

      if (!address || typeof address !== "string" || address.trim().length < 3) {
        return NextResponse.json(
          formatErrorResponse({
            title: "No location provided",
            message: "Enter an address or location name using the Location Input node.",
            code: "NO_LOCATION",
          }),
          { status: 400 }
        );
      }

      const siteData = await analyzeSite(address.trim());

      // Build KPI metrics for display
      const kpiMetrics = [
        { label: "Latitude", value: siteData.location.lat.toString(), unit: "°" },
        { label: "Longitude", value: siteData.location.lon.toString(), unit: "°" },
        { label: "Elevation", value: siteData.elevation.value.toString(), unit: "m" },
        { label: "Avg Summer", value: siteData.climate.avgTempSummer.toString(), unit: "°C" },
        { label: "Avg Winter", value: siteData.climate.avgTempWinter.toString(), unit: "°C" },
        { label: "Annual Rain", value: siteData.climate.annualRainfall.toString(), unit: "mm" },
      ];

      const analysisText = `SITE ANALYSIS — ${siteData.location.displayName}

Location: ${siteData.location.lat}°, ${siteData.location.lon}°
Elevation: ${siteData.elevation.value} m
Climate Zone: ${siteData.climate.zone}
${siteData.climate.currentTemp != null ? `Current Weather: ${siteData.climate.currentTemp}°C, ${siteData.climate.currentWeather}` : ""}

SOLAR GEOMETRY:
• Summer solstice noon altitude: ${siteData.solar.summerNoonAltitude}°
• Winter solstice noon altitude: ${siteData.solar.winterNoonAltitude}°
• Equinox noon altitude: ${siteData.solar.equinoxNoonAltitude}°

DESIGN IMPLICATIONS:
${siteData.designImplications.map(d => `• ${d}`).join("\n")}`;

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "kpi",
        data: {
          metrics: kpiMetrics,
          content: analysisText,
          prompt: analysisText,
          label: `Site Analysis: ${address}`,
          _raw: siteData,
        },
        metadata: { model: "site-analysis-v1", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-005") {
      // Style Prompt Composer — GPT-4o-mini enhanced DALL-E 3 prompt
      const upstreamDescription = (inputData?._raw ?? inputData) as Partial<BuildingDescription>;
      const viewType = ((inputData?.viewType as string) ?? "exterior") as "exterior" | "floor_plan" | "site_plan" | "interior";

      const description: BuildingDescription = {
        projectName: upstreamDescription.projectName ?? "Building",
        buildingType: upstreamDescription.buildingType ?? "Mixed-Use",
        floors: upstreamDescription.floors ?? 5,
        totalArea: upstreamDescription.totalArea ?? 5000,
        height: upstreamDescription.height,
        footprint: upstreamDescription.footprint,
        totalGFA: upstreamDescription.totalGFA,
        program: upstreamDescription.program,
        structure: upstreamDescription.structure ?? "Reinforced concrete",
        facade: upstreamDescription.facade ?? "Glass and steel",
        sustainabilityFeatures: upstreamDescription.sustainabilityFeatures ?? [],
        programSummary: upstreamDescription.programSummary ?? "Mixed-use programme",
        estimatedCost: upstreamDescription.estimatedCost ?? "TBD",
        constructionDuration: upstreamDescription.constructionDuration ?? "18 months",
        narrative: upstreamDescription.narrative ?? "",
      };

      const enhancedPrompt = await enhanceArchitecturalPrompt(
        description,
        viewType,
        inputData?.style as string | undefined,
        apiKey
      );

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "text",
        data: {
          content: enhancedPrompt,
          label: "Enhanced Architectural Prompt",
        },
        metadata: { model: "gpt-4o-mini", real: true },
        createdAt: new Date(),
      };

      return NextResponse.json({
        artifact,
        output: { enhancedPrompt },
      });

    } else if (catalogueId === "GN-003") {
      // Concept Image Generator — DALL-E 3
      const description = inputData?._raw ?? null;
      const prompt = inputData?.prompt ?? inputData?.content ?? "Modern mixed-use building, Nordic minimal style";
      const viewType = ((inputData?.viewType as string) ?? "exterior") as "exterior" | "floor_plan" | "site_plan" | "interior";
      const style = (inputData?.style as string) ?? "photorealistic architectural render";

      // Debug: trace what input GN-003 actually receives
      console.log("[GN-003] Input keys:", Object.keys(inputData ?? {}));
      console.log("[GN-003] _raw present:", !!description);
      if (description) {
        const d = description as Record<string, unknown>;
        console.log("[GN-003] _raw.buildingType:", d.buildingType, "| floors:", d.floors, "| facade:", d.facade);
      }
      console.log("[GN-003] prompt (first 120 chars):", String(prompt).slice(0, 120));
      console.log("[GN-003] viewType:", viewType, "| style:", style);

      // If upstream TR-005 already enhanced the prompt, use it directly
      const enhancedPrompt = inputData?.enhancedPrompt as string | undefined;

      let url: string;
      let revisedPrompt: string;

      if (enhancedPrompt) {
        console.log("[GN-003] Using pre-enhanced prompt from TR-005 (first 120 chars):", enhancedPrompt.slice(0, 120));
        // TR-005 already produced the optimised prompt — pass directly to DALL-E 3
        const result = await generateConceptImage(
          enhancedPrompt,
          style,
          apiKey,
          undefined,
          undefined,
          undefined,
          viewType
        );
        url = result.url;
        revisedPrompt = result.revisedPrompt;
      } else {
        // No upstream enhancer — pass BuildingDescription to generateConceptImage
        const desc: BuildingDescription = description ?? {
          projectName: "Building",
          buildingType: "Mixed-Use",
          floors: 5,
          totalArea: 5000,
          structure: "Reinforced concrete",
          facade: "White mineral render with timber accents",
          sustainabilityFeatures: [],
          programSummary: prompt,
          estimatedCost: "TBD",
          constructionDuration: "18 months",
          narrative: "",
        };

        console.log("[GN-003] Using BuildingDescription:", {
          projectName: desc.projectName,
          buildingType: desc.buildingType,
          floors: desc.floors,
          facade: desc.facade?.slice(0, 60),
          fromUpstream: !!description,
        });

        const result = await generateConceptImage(
          desc,
          style,
          apiKey,
          undefined,
          undefined,
          undefined,
          viewType
        );
        url = result.url;
        revisedPrompt = result.revisedPrompt;
      }

      console.log("[GN-003] DALL-E 3 result URL (first 80 chars):", url?.slice(0, 80));
      console.log("[GN-003] Revised prompt (first 120 chars):", revisedPrompt?.slice(0, 120));

      const viewLabel = viewType.replace("_", " ");

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "image",
        data: {
          url,
          label: `${viewLabel.charAt(0).toUpperCase() + viewLabel.slice(1)} render`,
          style: revisedPrompt.substring(0, 100),
        },
        metadata: { model: "dall-e-3", real: true },
        createdAt: new Date(),
      };
    } else if (catalogueId === "GN-004") {
      // Floor Plan Generator — GPT-4o-mini SVG generation
      const description = inputData?._raw ?? inputData ?? {};
      const floorPlan = await generateFloorPlan(description, apiKey);

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "svg",
        data: {
          svg: floorPlan.svg,
          label: "Floor Plan (AI Generated)",
          roomList: floorPlan.roomList,
          totalArea: floorPlan.totalArea,
          floors: floorPlan.floors,
        },
        metadata: { model: "gpt-4o-mini", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-007") {
      // Quantity Extractor — Real IFC parsing with net area calculations
      const ifcData = inputData?.ifcData ?? inputData?.content ?? null;

      const rows: string[][] = [];
      const elements: Array<{
        description: string; category: string; quantity: number; unit: string;
        grossArea?: number; netArea?: number; openingArea?: number; totalVolume?: number;
      }> = [];
      let usedFallback = false;
      let parseSummary = "";

      if (ifcData && typeof ifcData === "object" && ifcData.buffer) {
        // Real IFC file uploaded - parse it
        try {
          const { parseIFCBuffer } = await import("@/services/ifc-parser");
          const buffer = new Uint8Array(ifcData.buffer);
          const parseResult = await parseIFCBuffer(buffer, "uploaded.ifc");

          // Aggregate elements by type across divisions
          const typeAggregates = new Map<string, {
            count: number; grossArea: number; netArea: number; openingArea: number; volume: number; divisionName: string;
          }>();

          for (const division of parseResult.divisions) {
            for (const category of division.categories) {
              for (const element of category.elements) {
                const key = element.type;
                const existing = typeAggregates.get(key) || {
                  count: 0, grossArea: 0, netArea: 0, openingArea: 0, volume: 0, divisionName: division.name,
                };
                existing.count += element.quantities.count ?? 1;
                existing.grossArea += element.quantities.area?.gross ?? 0;
                existing.netArea += element.quantities.area?.net ?? 0;
                existing.openingArea += element.quantities.openingArea ?? 0;
                existing.volume += element.quantities.volume?.base ?? 0;
                typeAggregates.set(key, existing);
              }
            }
          }

          for (const [ifcType, agg] of typeAggregates) {
            const description = ifcType.replace("Ifc", "");
            const primaryQty = agg.grossArea > 0 ? agg.grossArea : agg.volume > 0 ? agg.volume : agg.count;
            const unit = agg.grossArea > 0 ? "m²" : agg.volume > 0 ? "m³" : "EA";

            rows.push([
              agg.divisionName, description,
              agg.grossArea.toFixed(2), agg.openingArea.toFixed(2),
              agg.netArea.toFixed(2), agg.volume.toFixed(2),
              primaryQty.toFixed(2), unit,
            ]);

            elements.push({
              description,
              category: agg.divisionName,
              quantity: primaryQty,
              unit,
              grossArea: agg.grossArea || undefined,
              netArea: agg.netArea || undefined,
              openingArea: agg.openingArea || undefined,
              totalVolume: agg.volume || undefined,
            });
          }

          parseSummary = `Parsed ${parseResult.summary.processedElements} of ${parseResult.summary.totalElements} elements from ${parseResult.summary.buildingStoreys} storeys (${parseResult.meta.ifcSchema})`;
        } catch (parseError) {
          console.error("[TR-007] IFC parsing failed:", parseError);
          usedFallback = true;
        }
      } else {
        usedFallback = true;
      }

      // Fallback: provide realistic quantities with net area if no IFC or parsing failed
      if (rows.length === 0) {
        usedFallback = true;
        // Opening areas: 96 windows × 2.4 m² + 58 doors × 1.89 m² = ~340 m²
        const totalOpenings = 96 * 2.4 + 58 * 1.89;
        const extWallOpenings = Math.round(totalOpenings * 0.7 * 100) / 100;
        const intWallOpenings = Math.round(totalOpenings * 0.3 * 100) / 100;
        const fallbackData = [
          { desc: "External Walls", cat: "Walls", qty: 1240, unit: "m²", grossArea: 1240, openingArea: extWallOpenings, netArea: 1240 - extWallOpenings, volume: 248 },
          { desc: "Internal Walls", cat: "Walls", qty: 2890, unit: "m²", grossArea: 2890, openingArea: intWallOpenings, netArea: 2890 - intWallOpenings, volume: 433.5 },
          { desc: "Floor Slabs", cat: "Slabs", qty: 2400, unit: "m²", grossArea: 2400, openingArea: 0, netArea: 2400, volume: 480 },
          { desc: "Roof Slab", cat: "Slabs", qty: 605, unit: "m²", grossArea: 605, openingArea: 0, netArea: 605, volume: 60.5 },
          { desc: "Windows", cat: "Openings", qty: 96, unit: "EA", grossArea: 230.4, openingArea: 0, netArea: 230.4, volume: 0 },
          { desc: "Doors", cat: "Openings", qty: 58, unit: "EA", grossArea: 109.62, openingArea: 0, netArea: 109.62, volume: 0 },
          { desc: "Columns", cat: "Structure", qty: 20, unit: "EA", grossArea: 0, openingArea: 0, netArea: 0, volume: 18 },
          { desc: "Beams", cat: "Structure", qty: 85, unit: "EA", grossArea: 0, openingArea: 0, netArea: 0, volume: 42.5 },
          { desc: "Stairs", cat: "Stairs", qty: 2, unit: "EA", grossArea: 30, openingArea: 0, netArea: 30, volume: 18 },
          { desc: "Footings", cat: "Footings", qty: 8, unit: "EA", grossArea: 0, openingArea: 0, netArea: 0, volume: 19.2 },
        ];

        for (const item of fallbackData) {
          rows.push([
            item.cat, item.desc,
            item.grossArea.toString(), item.openingArea.toString(),
            item.netArea.toFixed(2), item.volume.toString(),
            item.qty.toString(), item.unit,
          ]);
          elements.push({
            description: item.desc,
            category: item.cat,
            quantity: item.qty,
            unit: item.unit,
            grossArea: item.grossArea || undefined,
            netArea: item.netArea || undefined,
            openingArea: item.openingArea || undefined,
            totalVolume: item.volume || undefined,
          });
        }
        parseSummary = `Sample data: 10 element types — net area accounts for ${totalOpenings.toFixed(0)} m² of openings`;
      }

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "table",
        data: {
          label: "Extracted Quantities (IFC)",
          headers: ["Category", "Element", "Gross Area (m²)", "Opening Area (m²)", "Net Area (m²)", "Volume (m³)", "Qty", "Unit"],
          rows,
          _elements: elements, // Required for TR-008 compatibility
          content: parseSummary,
        },
        metadata: {
          model: "ifc-parser-v2",
          real: true,
          warnings: usedFallback ? ["Using sample quantities (no IFC file provided or parsing failed)"] : undefined,
        },
        createdAt: new Date(),
      };


    } else if (catalogueId === "TR-008") {
      // BOQ Cost Mapper — Real unit rates with regional factors
      const elements = inputData?._elements ?? inputData?.elements ?? inputData?.rows ?? [];
      const region = inputData?.region ?? "USA (baseline)";
      
      const rows: string[][] = [];
      let hardCostSubtotal = 0;
      let estimatedItemsCount = 0;
      
      // Process each element
      for (const elem of elements) {
        const description = typeof elem === "string" ? elem : elem.description ?? elem[0];
        const quantity = typeof elem === "object" ? (elem.quantity ?? elem[2] ?? 1) : 1;
        
        // Find matching unit rate from database
        const unitRateData = findUnitRate(description);
        
        if (unitRateData && unitRateData.category === "hard") {
          // Apply regional factor
          const { adjustedRate } = applyRegionalFactor(
            unitRateData.baseRate,
            region
          );
          
          const lineTotal = quantity * adjustedRate;
          hardCostSubtotal += lineTotal;
          
          rows.push([
            description,
            unitRateData.unit,
            quantity.toFixed(2),
            `$${adjustedRate.toFixed(2)}`,
            `$${lineTotal.toFixed(2)}`,
          ]);
        } else {
          // Fallback: estimate for unknown items
          estimatedItemsCount++;
          const fallbackRate = 100; // $100 per EA as placeholder
          const lineTotal = quantity * fallbackRate;
          hardCostSubtotal += lineTotal;
          
          rows.push([
            description + " (estimated)",
            "EA",
            quantity.toString(),
            `$${fallbackRate.toFixed(2)}`,
            `$${lineTotal.toFixed(2)}`,
          ]);
        }
      }
      
      // Calculate soft costs
      const costSummary = calculateTotalCost(hardCostSubtotal, true, true);
      
      // Add soft cost rows
      rows.push(["", "", "", "", ""]);
      rows.push(["HARD COSTS SUBTOTAL", "", "", "", `$${costSummary.hardCosts.toFixed(2)}`]);
      rows.push(["", "", "", "", ""]);
      rows.push(["SOFT COSTS", "", "", "", ""]);
      
      for (const softItem of costSummary.breakdown) {
        rows.push([
          softItem.item,
          "%",
          softItem.percentage.toString(),
          "",
          `$${softItem.amount.toFixed(2)}`,
        ]);
      }
      
      rows.push(["", "", "", "", ""]);
      rows.push(["SOFT COSTS SUBTOTAL", "", "", "", `$${costSummary.softCosts.toFixed(2)}`]);
      rows.push(["", "", "", "", ""]);
      rows.push(["TOTAL PROJECT COST", "", "", "", `$${costSummary.totalCost.toFixed(2)}`]);

      const warnings = [];
      if (estimatedItemsCount > 0) {
        warnings.push(`${estimatedItemsCount} items used estimated rates (not in cost database)`);
      }

      // Build _boqData for EX-002 compatibility
      const boqLines = rows
        .filter(r => r[0] && !["", "HARD COSTS SUBTOTAL", "SOFT COSTS", "SOFT COSTS SUBTOTAL", "TOTAL PROJECT COST"].includes(r[0]))
        .map(r => ({
          division: "General",
          csiCode: "00 00 00",
          description: r[0],
          unit: r[1],
          quantity: parseFloat(r[2]) || 0,
          materialRate: parseFloat(r[3]?.replace("$", "") || "0"),
          laborRate: 0,
          equipmentRate: 0,
          unitRate: parseFloat(r[3]?.replace("$", "") || "0"),
          materialCost: parseFloat(r[4]?.replace("$", "") || "0"),
          laborCost: 0,
          equipmentCost: 0,
          totalCost: parseFloat(r[4]?.replace("$", "") || "0"),
        }));

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "table",
        data: {
          label: `Bill of Quantities (${region})`,
          headers: ["Description", "Unit", "Qty", "Rate", "Total"],
          rows,
          _currency: "USD",
          _totalCost: costSummary.totalCost,
          _hardCosts: costSummary.hardCosts,
          _softCosts: costSummary.softCosts,
          _region: region,
          _boqData: {
            lines: boqLines,
            subtotalMaterial: costSummary.hardCosts,
            subtotalLabor: 0,
            subtotalEquipment: 0,
            grandTotal: costSummary.totalCost,
          },
        },
        metadata: {
          model: "cost-database-v1",
          real: true,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        createdAt: new Date(),
      };

    } else if (catalogueId === "EX-002") {
      // BOQ Excel Export — professional 3-sheet XLSX
      const XLSX = await import("xlsx");
      const boqData = inputData?._boqData as {
        lines: Array<{ division: string; csiCode: string; description: string; unit: string; quantity: number; materialRate: number; laborRate: number; equipmentRate: number; unitRate: number; materialCost: number; laborCost: number; equipmentCost: number; totalCost: number }>;
        subtotalMaterial: number; subtotalLabor: number; subtotalEquipment: number; grandTotal: number;
      } | undefined;
      const boqSummary = (inputData?.summary ?? {}) as Record<string, unknown>;
      const boqLines = boqData?.lines ?? [];

      const wb = XLSX.utils.book_new();

      // Sheet 1: Summary
      const summaryRows = [
        ["BILL OF QUANTITIES — COST ESTIMATE"],
        [""],
        ["Generated", new Date().toISOString().split("T")[0]],
        ["Generated by", "BuildFlow AI"],
        [""],
        ["COST SUMMARY"],
        ["", "Amount (USD)"],
        ["Material Cost", boqData?.subtotalMaterial ?? boqSummary.subtotalMaterial ?? 0],
        ["Labor Cost", boqData?.subtotalLabor ?? boqSummary.subtotalLabor ?? 0],
        ["Equipment Cost", boqData?.subtotalEquipment ?? boqSummary.subtotalEquipment ?? 0],
        [""],
        ["GRAND TOTAL", boqData?.grandTotal ?? boqSummary.grandTotal ?? 0],
        [""],
        ["Confidence", String(boqSummary.confidence ?? "moderate")],
        ["Note", String(boqSummary.note ?? "Based on CSI MasterFormat unit rates")],
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      summarySheet["!cols"] = [{ wch: 20 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

      // Sheet 2: Bill of Quantities
      if (boqLines.length > 0) {
        const boqHeaders = ["Division", "CSI Code", "Description", "Unit", "Quantity", "Material Rate", "Labor Rate", "Equipment Rate", "Unit Rate", "Material Cost", "Labor Cost", "Equipment Cost", "Total Cost"];
        const boqTableRows = boqLines.map(l => [
          `Div ${l.division}`, l.csiCode, l.description, l.unit, l.quantity,
          l.materialRate, l.laborRate, l.equipmentRate, l.unitRate,
          l.materialCost, l.laborCost, l.equipmentCost, l.totalCost,
        ]);
        boqTableRows.push([
          "", "", "TOTAL", "", "",
          "", "", "", "",
          boqData?.subtotalMaterial ?? 0, boqData?.subtotalLabor ?? 0,
          boqData?.subtotalEquipment ?? 0, boqData?.grandTotal ?? 0,
        ]);

        const boqSheet = XLSX.utils.aoa_to_sheet([boqHeaders, ...boqTableRows]);
        boqSheet["!cols"] = [
          { wch: 8 }, { wch: 14 }, { wch: 35 }, { wch: 6 }, { wch: 10 },
          { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
          { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
        ];
        XLSX.utils.book_append_sheet(wb, boqSheet, "Bill of Quantities");
      } else {
        // Fallback: use raw rows/headers from upstream
        const fallbackRows = (inputData?.rows ?? []) as unknown[][];
        const fallbackHeaders = (inputData?.headers ?? ["Description", "Unit", "Qty", "Rate", "Total"]) as string[];
        const fallbackSheet = XLSX.utils.aoa_to_sheet([fallbackHeaders, ...fallbackRows]);
        fallbackSheet["!cols"] = fallbackHeaders.map(() => ({ wch: 20 }));
        XLSX.utils.book_append_sheet(wb, fallbackSheet, "Bill of Quantities");
      }

      // Sheet 3: By Division
      if (boqLines.length > 0) {
        const divNames: Record<string, string> = {
          "03": "Concrete", "04": "Masonry", "05": "Metals",
          "06": "Wood & Plastics", "07": "Thermal & Moisture", "08": "Openings",
          "09": "Finishes", "22": "Plumbing", "26": "Electrical",
        };
        const divTotals = new Map<string, { name: string; material: number; labor: number; equipment: number; total: number }>();
        for (const line of boqLines) {
          const d = line.division;
          const ex = divTotals.get(d) || { name: divNames[d] || `Division ${d}`, material: 0, labor: 0, equipment: 0, total: 0 };
          ex.material += line.materialCost;
          ex.labor += line.laborCost;
          ex.equipment += line.equipmentCost;
          ex.total += line.totalCost;
          divTotals.set(d, ex);
        }

        const divHeaders = ["Division", "Name", "Material", "Labor", "Equipment", "Total"];
        const divRows = Array.from(divTotals.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, data]) => [
            `Div ${code}`, data.name,
            Math.round(data.material * 100) / 100,
            Math.round(data.labor * 100) / 100,
            Math.round(data.equipment * 100) / 100,
            Math.round(data.total * 100) / 100,
          ]);
        const divSheet = XLSX.utils.aoa_to_sheet([divHeaders, ...divRows]);
        divSheet["!cols"] = [{ wch: 8 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, divSheet, "By Division");
      }

      const xlsxBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
      const base64 = xlsxBuffer.toString("base64");
      const dataUri = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + base64;
      const filename = `BuildFlow_BOQ_${new Date().toISOString().split("T")[0]}.xlsx`;

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "file",
        data: {
          name: filename,
          type: "XLSX Spreadsheet",
          size: xlsxBuffer.length,
          downloadUrl: dataUri,
          label: "BOQ Export (Excel)",
          content: `BOQ Export: ${boqLines.length} line items, Grand Total: $${(boqData?.grandTotal ?? 0).toLocaleString()}`,
        },
        metadata: { real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "EX-003") {
      // PDF Report Export — collect upstream artifacts and generate PDF
      const workflowName = String(inputData?.workflowName ?? inputData?.content ?? "BuildFlow Workflow");

      // Collect upstream artifacts passed through inputData
      const upstreamArtifacts: Array<{ nodeLabel: string; type: string; data: Record<string, unknown> }> = [];

      // The execution engine passes the previous artifact's data as inputData
      // We reconstruct what we can from the available data
      if (inputData?.metrics) {
        upstreamArtifacts.push({
          nodeLabel: String(inputData?._nodeLabel ?? "Massing / KPIs"),
          type: "kpi",
          data: inputData as Record<string, unknown>,
        });
      }
      if (inputData?.content && typeof inputData.content === "string" && inputData.content.length > 20) {
        upstreamArtifacts.push({
          nodeLabel: String(inputData?._nodeLabel ?? "Building Description"),
          type: "text",
          data: { content: inputData.content },
        });
      }
      if (inputData?.rows && inputData?.headers) {
        upstreamArtifacts.push({
          nodeLabel: String(inputData?._nodeLabel ?? "BOQ / Table"),
          type: "table",
          data: inputData as Record<string, unknown>,
        });
      }
      if (inputData?._raw && typeof inputData._raw === "object") {
        const raw = inputData._raw as Record<string, unknown>;
        if (raw.narrative || raw.projectName) {
          upstreamArtifacts.push({
            nodeLabel: "Building Description",
            type: "text",
            data: { content: String(raw.narrative ?? raw.projectName ?? "") },
          });
        }
        if (raw.metrics) {
          upstreamArtifacts.push({
            nodeLabel: "Design Metrics",
            type: "kpi",
            data: raw as Record<string, unknown>,
          });
        }
      }

      // Fallback: if no artifacts extracted, add a summary
      if (upstreamArtifacts.length === 0) {
        upstreamArtifacts.push({
          nodeLabel: "Workflow Output",
          type: "text",
          data: { content: typeof inputData?.content === "string" ? inputData.content : "Workflow executed successfully. Detailed results available in the application." },
        });
      }

      const { base64, fileSize } = generatePDFBase64(workflowName, upstreamArtifacts);
      const filename = `BuildFlow_Report_${new Date().toISOString().split("T")[0]}.pdf`;

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "file",
        data: {
          name: filename,
          type: "PDF Report",
          size: fileSize,
          downloadUrl: base64,
          label: `Execution Report (${upstreamArtifacts.length} sections)`,
          content: `Professional PDF report with ${upstreamArtifacts.length} sections from workflow execution`,
        },
        metadata: { real: true },
        createdAt: new Date(),
      };

    } else {
      return NextResponse.json(
        formatErrorResponse(UserErrors.NODE_NOT_IMPLEMENTED(catalogueId)),
        { status: 400 }
      );
    }

    return NextResponse.json({ artifact });
  } catch (err) {
    // Handle APIError (user-friendly errors)
    if (err instanceof APIError) {
      console.error("[execute-node] API Error:", {
        code: err.userError.code,
        message: err.userError.message,
      });
      return NextResponse.json(
        formatErrorResponse(err.userError),
        { status: err.statusCode }
      );
    }
    
    // Handle generic errors
    const message = err instanceof Error ? err.message : "Execution failed";
    console.error("[execute-node] " + catalogueId + ":", message, err);
    
    return NextResponse.json(
      formatErrorResponse(UserErrors.INTERNAL_ERROR, message),
      { status: 500 }
    );
  }
}

function formatBuildingDescription(d: {
  projectName: string;
  buildingType: string;
  floors: number;
  totalArea: number;
  structure: string;
  facade: string;
  sustainabilityFeatures: string[];
  programSummary: string;
  estimatedCost: string;
  constructionDuration: string;
  narrative?: string;
}): string {
  // If narrative exists (TR-003 v2), use it as the primary output
  if (d.narrative) {
    return `# ${d.projectName}\n\n${d.narrative}\n\n---\n\n**Quick Facts**\nType: ${d.buildingType} | Floors: ${d.floors} | Area: ${d.totalArea.toLocaleString()} m²\nCost: ${d.estimatedCost} | Duration: ${d.constructionDuration}`;
  }
  
  // Fallback to legacy format if no narrative
  return d.projectName.toUpperCase() + " — BUILDING DESCRIPTION\n\nType: " + d.buildingType + "\nFloors: " + d.floors + " | Total Area: " + d.totalArea.toLocaleString() + " m²\nEstimated Cost: " + d.estimatedCost + " | Duration: " + d.constructionDuration + "\n\n" + d.programSummary + "\n\nStructure: " + d.structure + "\nFacade: " + d.facade + "\n\nSustainability: " + (d.sustainabilityFeatures.join(", ") || "TBD");
}

export { REAL_NODE_IDS };
