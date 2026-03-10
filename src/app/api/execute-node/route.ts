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
  calculateLineItemCost,
  calculateEscalation,
  detectProjectType,
  COST_DISCLAIMERS,
  getWasteFactor,
  getCostBreakdown,
} from "@/lib/cost-database";
import { assertValidInput } from "@/lib/validation";
import { APIError, UserErrors, formatErrorResponse } from "@/lib/user-errors";
import { generatePDFBase64 } from "@/services/pdf-report-server";
import { uploadBase64ToR2 } from "@/lib/r2";
import { reconstructHiFi3D, isMeshyConfigured } from "@/services/meshy-service";
import { generateWalkthroughVideo, buildArchitecturalMultiShot } from "@/services/video-service";

// Detect region/city from text for cost estimation
function detectRegionFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const regionMap: Array<[string[], string]> = [
    [["mumbai", "pune", "maharashtra"], "Mumbai, India"],
    [["delhi", "ncr", "noida", "gurgaon"], "Delhi, India"],
    [["bangalore", "bengaluru", "karnataka"], "Bangalore, India"],
    [["chennai", "tamil nadu"], "Mumbai, India"],
    [["hyderabad", "telangana"], "Bangalore, India"],
    [["kolkata", "west bengal"], "Mumbai, India"],
    [["london", "manchester", "birmingham", "edinburgh", "uk", "united kingdom"], "London, UK"],
    [["new york", "manhattan", "brooklyn"], "New York City, NY (USA)"],
    [["san francisco", "bay area"], "San Francisco, CA (USA)"],
    [["los angeles", "la"], "Los Angeles, CA (USA)"],
    [["chicago"], "Chicago, IL (USA)"],
    [["houston", "texas", "dallas"], "Houston, TX (USA)"],
    [["berlin", "hamburg"], "Berlin, Germany"],
    [["munich", "münchen"], "Munich, Germany"],
    [["paris", "lyon", "marseille", "france"], "Paris, France"],
    [["amsterdam", "rotterdam", "netherlands"], "Amsterdam, Netherlands"],
    [["tokyo", "osaka", "japan"], "Tokyo, Japan"],
    [["dubai", "abu dhabi", "uae"], "Dubai, UAE"],
    [["singapore"], "Singapore"],
    [["sydney", "melbourne", "brisbane", "australia"], "Sydney, Australia"],
    [["toronto", "vancouver", "montreal", "canada"], "Toronto, Canada"],
    [["são paulo", "sao paulo", "rio", "brazil"], "São Paulo, Brazil"],
    [["mexico city", "mexico"], "Mexico City, Mexico"],
  ];
  for (const [keywords, regionName] of regionMap) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return regionName;
    }
  }
  return null;
}

// Node IDs that have real implementations
const REAL_NODE_IDS = new Set(["TR-001", "TR-003", "TR-004", "TR-005", "TR-012", "GN-003", "GN-004", "GN-007", "GN-008", "GN-009", "GN-010", "TR-007", "TR-008", "EX-002", "EX-003"]);

// Nodes that require OpenAI API calls
const OPENAI_NODES = new Set(["TR-003", "TR-004", "TR-005", "TR-012", "GN-003", "GN-004", "GN-008"]);

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
    return NextResponse.json(
      formatErrorResponse({ title: "Service unavailable", message: "Rate limit service temporarily unavailable. Please try again in a moment.", code: "RATE_LIMIT_UNAVAILABLE" }),
      { status: 503 }
    );
  }

  const { catalogueId, executionId, tileInstanceId, inputData, userApiKey } = await req.json();

  if (!REAL_NODE_IDS.has(catalogueId)) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.NODE_NOT_IMPLEMENTED(catalogueId)),
      { status: 400 }
    );
  }

  const apiKey = userApiKey || undefined;

    // Validate OpenAI key for nodes that need it
    if (OPENAI_NODES.has(catalogueId) && !apiKey && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        formatErrorResponse({ title: "API key required", message: "OpenAI API key not configured. Add your key in Settings or contact support.", code: "MISSING_API_KEY" }),
        { status: 400 }
      );
    }

  try {
    // STEP 1: Validate input BEFORE hitting any APIs
    assertValidInput(catalogueId, inputData);

    let artifact: ExecutionArtifact;

    if (catalogueId === "TR-003") {
      // Design Brief Analyzer — GPT-4o-mini
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
      // Brief Parser — PDF text extraction + GPT structuring
      const rawText = inputData?.content ?? inputData?.prompt ?? inputData?.rawText ?? "";
      const pdfBase64 = inputData?.fileData ?? inputData?.buffer ?? null;

      // Validate PDF file size (base64 → ~20MB raw ≈ 26.7MB base64)
      const MAX_PDF_BASE64_LEN = 27 * 1024 * 1024;
      if (pdfBase64 && typeof pdfBase64 === "string") {
        if (pdfBase64.length === 0) {
          return NextResponse.json(
            formatErrorResponse({ title: "Empty file", message: "The uploaded file is empty. Please select a valid PDF file.", code: "EMPTY_FILE" }),
            { status: 400 }
          );
        }
        if (pdfBase64.length > MAX_PDF_BASE64_LEN) {
          return NextResponse.json(
            formatErrorResponse({ title: "File too large", message: "File too large. Maximum size is 20MB.", code: "FILE_TOO_LARGE" }),
            { status: 413 }
          );
        }
      }

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

      // Validate image file: type and size (base64 → ~10MB raw ≈ 13.4MB base64)
      const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      if (typeof mimeType === "string" && !ALLOWED_IMAGE_TYPES.includes(mimeType.toLowerCase())) {
        return NextResponse.json(
          formatErrorResponse({ title: "Invalid file type", message: "Invalid file type. Please upload a .png, .jpg, or .webp image.", code: "INVALID_FILE_TYPE" }),
          { status: 400 }
        );
      }
      const MAX_IMAGE_BASE64_LEN = 14 * 1024 * 1024;
      if (typeof imageBase64 === "string") {
        if (imageBase64.length === 0) {
          return NextResponse.json(
            formatErrorResponse({ title: "Empty file", message: "The uploaded file is empty. Please select a valid image.", code: "EMPTY_FILE" }),
            { status: 400 }
          );
        }
        if (imageBase64.length > MAX_IMAGE_BASE64_LEN) {
          return NextResponse.json(
            formatErrorResponse({ title: "File too large", message: "File too large. Maximum size is 10MB.", code: "FILE_TOO_LARGE" }),
            { status: 413 }
          );
        }
      }

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
      // Visualization Style Composer — GPT-4o-mini enhanced DALL-E 3 prompt
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
          enhancedPrompt,
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
      // Concept Render Generator — DALL-E 3
      const description = inputData?._raw ?? null;
      const prompt = inputData?.prompt ?? inputData?.content ?? "Modern mixed-use building, Nordic minimal style";
      const viewType = ((inputData?.viewType as string) ?? "exterior") as "exterior" | "floor_plan" | "site_plan" | "interior";
      const style = (inputData?.style as string) ?? "photorealistic architectural render";

      // If upstream TR-005 already enhanced the prompt, use it directly
      const enhancedPrompt = inputData?.enhancedPrompt as string | undefined;

      let url: string;
      let revisedPrompt: string;

      if (enhancedPrompt) {
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
      // BOQ Cost Mapper — Professional QS-grade with waste, M/L/E breakdown, escalation, project type
      const elements = inputData?._elements ?? inputData?.elements ?? inputData?.rows ?? [];
      const region = inputData?.region ?? "USA (baseline)";
      const buildingDescription = inputData?.buildingDescription ?? inputData?.content ?? inputData?.prompt ?? "";
      const escalationMonths = inputData?.escalationMonths ?? 6;

      // Detect region from upstream building description if not explicitly provided
      const upstreamNarrative = inputData?.content ?? inputData?.narrative ?? "";
      const detectedRegion = detectRegionFromText(region !== "USA (baseline)" ? region : (typeof upstreamNarrative === "string" ? upstreamNarrative : ""));
      const activeRegion = detectedRegion || region;

      // Detect project type from description
      const projectTypeInfo = detectProjectType(typeof buildingDescription === "string" ? buildingDescription : "commercial");

      // Enhanced headers with waste and M/L/E
      const headers = ["Description", "Unit", "Qty", "Waste %", "Adj Qty", "Rate", "Material", "Labor", "Equipment", "Total"];
      const rows: string[][] = [];
      let hardCostSubtotal = 0;
      let totalMaterial = 0;
      let totalLabor = 0;
      let totalEquipment = 0;
      let estimatedItemsCount = 0;

      // Build structured BOQ lines for EX-002
      const boqLines: Array<{
        division: string; csiCode: string; description: string; unit: string;
        quantity: number; wasteFactor: number; adjustedQty: number;
        materialRate: number; laborRate: number; equipmentRate: number; unitRate: number;
        materialCost: number; laborCost: number; equipmentCost: number; totalCost: number;
      }> = [];

      // Process each element
      for (const elem of elements) {
        const description = typeof elem === "string" ? elem : elem.description ?? elem[0];
        const quantity = typeof elem === "object" ? (Number(elem.quantity) || Number(elem[2]) || 1) : 1;

        const unitRateData = findUnitRate(description);

        if (unitRateData && unitRateData.category === "hard") {
          const lineItem = calculateLineItemCost(unitRateData, quantity, activeRegion, projectTypeInfo.type);

          hardCostSubtotal += lineItem.lineTotal;
          totalMaterial += lineItem.materialCost;
          totalLabor += lineItem.laborCost;
          totalEquipment += lineItem.equipmentCost;


          rows.push([
            description,
            unitRateData.unit,
            quantity.toFixed(2),
            `${(lineItem.wasteFactor * 100).toFixed(0)}%`,
            lineItem.totalQty.toFixed(2),
            `$${lineItem.adjustedRate.toFixed(2)}`,
            `$${lineItem.materialCost.toFixed(2)}`,
            `$${lineItem.laborCost.toFixed(2)}`,
            `$${lineItem.equipmentCost.toFixed(2)}`,
            `$${lineItem.lineTotal.toFixed(2)}`,
          ]);

          boqLines.push({
            division: unitRateData.subcategory,
            csiCode: "00 00 00",
            description,
            unit: unitRateData.unit,
            quantity,
            wasteFactor: lineItem.wasteFactor,
            adjustedQty: lineItem.totalQty,
            materialRate: Math.round(lineItem.adjustedRate * getCostBreakdown(unitRateData.subcategory).material * 100) / 100,
            laborRate: Math.round(lineItem.adjustedRate * getCostBreakdown(unitRateData.subcategory).labor * 100) / 100,
            equipmentRate: Math.round(lineItem.adjustedRate * getCostBreakdown(unitRateData.subcategory).equipment * 100) / 100,
            unitRate: lineItem.adjustedRate,
            materialCost: lineItem.materialCost,
            laborCost: lineItem.laborCost,
            equipmentCost: lineItem.equipmentCost,
            totalCost: lineItem.lineTotal,
          });
        } else {
          // Fallback for unknown items — estimate with default waste
          estimatedItemsCount++;
          const fallbackRate = 100;
          const defaultWaste = 0.10;
          const adjQty = quantity * (1 + defaultWaste);
          const lineTotal = adjQty * fallbackRate;
          const breakdown = getCostBreakdown("Finishes"); // default
          hardCostSubtotal += lineTotal;
          totalMaterial += lineTotal * breakdown.material;
          totalLabor += lineTotal * breakdown.labor;
          totalEquipment += lineTotal * breakdown.equipment;

          rows.push([
            description + " (est.)",
            "EA",
            quantity.toFixed(2),
            `${(defaultWaste * 100).toFixed(0)}%`,
            adjQty.toFixed(2),
            `$${fallbackRate.toFixed(2)}`,
            `$${(lineTotal * breakdown.material).toFixed(2)}`,
            `$${(lineTotal * breakdown.labor).toFixed(2)}`,
            `$${(lineTotal * breakdown.equipment).toFixed(2)}`,
            `$${lineTotal.toFixed(2)}`,
          ]);

          boqLines.push({
            division: "General",
            csiCode: "00 00 00",
            description: description + " (est.)",
            unit: "EA",
            quantity,
            wasteFactor: defaultWaste,
            adjustedQty: adjQty,
            materialRate: fallbackRate * breakdown.material,
            laborRate: fallbackRate * breakdown.labor,
            equipmentRate: fallbackRate * breakdown.equipment,
            unitRate: fallbackRate,
            materialCost: Math.round(lineTotal * breakdown.material * 100) / 100,
            laborCost: Math.round(lineTotal * breakdown.labor * 100) / 100,
            equipmentCost: Math.round(lineTotal * breakdown.equipment * 100) / 100,
            totalCost: Math.round(lineTotal * 100) / 100,
          });
        }
      }

      // Hard costs subtotal row
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push(["HARD COSTS SUBTOTAL", "", "", "", "", "", `$${totalMaterial.toFixed(2)}`, `$${totalLabor.toFixed(2)}`, `$${totalEquipment.toFixed(2)}`, `$${hardCostSubtotal.toFixed(2)}`]);

      // Project type multiplier info
      if (projectTypeInfo.multiplier !== 1.0) {
        rows.push([`Project Type: ${projectTypeInfo.type} (${projectTypeInfo.multiplier}x)`, "", "", "", "", "", "", "", "", "Applied"]);
      }

      // Escalation
      const escalation = calculateEscalation(hardCostSubtotal, 0.06, escalationMonths);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push([`Cost Escalation (${escalation.annualRate * 100}%/yr, ${escalation.months}mo)`, "", "", "", "", "", "", "", "", `$${escalation.amount.toFixed(2)}`]);

      const hardCostWithEscalation = hardCostSubtotal + escalation.amount;
      rows.push(["HARD COSTS + ESCALATION", "", "", "", "", "", "", "", "", `$${hardCostWithEscalation.toFixed(2)}`]);

      // Soft costs
      const costSummary = calculateTotalCost(hardCostWithEscalation, true, true);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push(["SOFT COSTS", "", "", "", "", "", "", "", "", ""]);

      for (const softItem of costSummary.breakdown) {
        rows.push([
          softItem.item, "%", softItem.percentage.toString(), "", "", "", "", "", "",
          `$${softItem.amount.toFixed(2)}`,
        ]);
      }

      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push(["SOFT COSTS SUBTOTAL", "", "", "", "", "", "", "", "", `$${costSummary.softCosts.toFixed(2)}`]);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push(["TOTAL PROJECT COST", "", "", "", "", "", "", "", "", `$${costSummary.totalCost.toFixed(2)}`]);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push([COST_DISCLAIMERS.accuracy, "", "", "", "", "", "", "", "", ""]);

      const warnings: string[] = [];
      if (estimatedItemsCount > 0) {
        warnings.push(`${estimatedItemsCount} items used estimated rates (not in cost database)`);
      }

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "table",
        data: {
          label: `Bill of Quantities — ${projectTypeInfo.type} (${activeRegion})`,
          headers,
          rows,
          _currency: "USD",
          _totalCost: costSummary.totalCost,
          _hardCosts: hardCostWithEscalation,
          _softCosts: costSummary.softCosts,
          _escalation: escalation.amount,
          _region: activeRegion,
          _projectType: projectTypeInfo.type,
          _projectMultiplier: projectTypeInfo.multiplier,
          _disclaimer: COST_DISCLAIMERS.full,
          content: `Total: $${costSummary.totalCost.toFixed(2)} (Hard: $${costSummary.hardCosts.toFixed(2)}, Soft: $${costSummary.softCosts.toFixed(2)}) | Region: ${activeRegion} | Type: ${projectTypeInfo.type}`,
          _boqData: {
            lines: boqLines,
            subtotalMaterial: Math.round(totalMaterial * 100) / 100,
            subtotalLabor: Math.round(totalLabor * 100) / 100,
            subtotalEquipment: Math.round(totalEquipment * 100) / 100,
            escalation: escalation.amount,
            projectType: projectTypeInfo.type,
            projectMultiplier: projectTypeInfo.multiplier,
            grandTotal: costSummary.totalCost,
            disclaimer: COST_DISCLAIMERS.full,
          },
        },
        metadata: {
          model: "cost-database-v2",
          real: true,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        createdAt: new Date(),
      };

    } else if (catalogueId === "EX-002") {
      // BOQ Excel Export — Professional 4-sheet XLSX (Cover, Assumptions, BOQ, Summary)
      const XLSX = await import("xlsx");
      const boqData = inputData?._boqData as {
        lines: Array<{
          division: string; csiCode: string; description: string; unit: string;
          quantity: number; wasteFactor?: number; adjustedQty?: number;
          materialRate: number; laborRate: number; equipmentRate: number; unitRate: number;
          materialCost: number; laborCost: number; equipmentCost: number; totalCost: number;
        }>;
        subtotalMaterial: number; subtotalLabor: number; subtotalEquipment: number;
        escalation?: number; projectType?: string; projectMultiplier?: number;
        grandTotal: number; disclaimer?: string;
      } | undefined;
      const boqSummary = (inputData?.summary ?? {}) as Record<string, unknown>;
      const boqLines = boqData?.lines ?? [];
      const dateStr = new Date().toISOString().split("T")[0];

      const wb = XLSX.utils.book_new();

      // ─── Sheet 1: Cover Sheet ───────────────────────────────────────────
      const coverRows = [
        [""],
        ["BILL OF QUANTITIES"],
        ["PRELIMINARY COST ESTIMATE"],
        [""],
        ["Project:", String(inputData?.label ?? inputData?.workflowName ?? "Building Project")],
        ["Date:", dateStr],
        ["Prepared By:", "NeoBIM Workflow Builder"],
        ["Estimate Class:", "AACE Class 4 (±15-20%)"],
        [""],
        ["ESTIMATE ACCURACY"],
        ["", "This is a preliminary budget estimate for planning purposes only."],
        ["", "Accuracy range: ±15% to ±20% of actual construction costs."],
        ["", "Based on RSMeans 2024/2025 national average unit rates."],
        ["", ""],
        ["", "This estimate should NOT be used for:"],
        ["", "  - Contract bidding or procurement"],
        ["", "  - Final budget approval without QS review"],
        ["", "  - Loan applications or financial commitments"],
        [""],
        ["VALIDITY"],
        ["", "Unit rates valid for 90 days from estimate date."],
        ["", "Market conditions, supply chain, and labor availability may cause variance."],
        [""],
        [boqData?.disclaimer ?? COST_DISCLAIMERS.full],
      ];
      const coverSheet = XLSX.utils.aoa_to_sheet(coverRows);
      coverSheet["!cols"] = [{ wch: 18 }, { wch: 65 }];
      XLSX.utils.book_append_sheet(wb, coverSheet, "Cover Sheet");

      // ─── Sheet 2: Assumptions ───────────────────────────────────────────
      const projectType = boqData?.projectType ?? "commercial";
      const projectMultiplier = boqData?.projectMultiplier ?? 1.0;
      const escalationAmt = boqData?.escalation ?? 0;

      const assumptionRows = [
        ["ASSUMPTIONS & BASIS OF ESTIMATE"],
        [""],
        ["RATE SOURCES"],
        ["", "RSMeans Building Construction Cost Data 2024/2025"],
        ["", "US national average unit rates (city cost index adjustments applied)"],
        [""],
        ["WASTE FACTORS"],
        ["Material Type", "Waste %", "Notes"],
        ["Concrete", "7%", "Spillage, over-pour, testing samples"],
        ["Steel", "10%", "Cut-off, welding loss, galvanizing"],
        ["Masonry", "8%", "Breakage, cutting, mortar waste"],
        ["Finishes", "12%", "Cutting, pattern matching, damage"],
        ["Doors & Windows", "3%", "Factory-made, minimal site waste"],
        ["Roofing", "10%", "Overlap, cutting at edges/penetrations"],
        ["MEP", "8%", "Pipe/duct cut-off, fittings"],
        ["Sitework", "15%", "Compaction, over-excavation, grading loss"],
        [""],
        ["REGIONAL ADJUSTMENT"],
        ["", `Region: ${inputData?._region ?? "USA (baseline)"}`],
        [""],
        ["PROJECT TYPE ADJUSTMENT"],
        ["", `Type: ${projectType} (${projectMultiplier}x multiplier)`],
        [""],
        ["COST ESCALATION"],
        ["", `Annual rate: 6%`],
        ["", `Months to construction: 6`],
        ["", `Escalation amount: $${escalationAmt.toLocaleString()}`],
        [""],
        ["EXCLUSIONS"],
        ["", "Land acquisition costs"],
        ["", "Financing and carrying costs"],
        ["", "Developer fees and profit"],
        ["", "Furniture, fixtures & equipment (FF&E)"],
        ["", "Specialty systems (data, security, AV)"],
        ["", "Hazardous material abatement"],
        ["", "Off-site infrastructure improvements"],
        ["", "Sales tax (varies by jurisdiction)"],
        [""],
        ["INCLUSIONS"],
        ["", "Direct construction costs (hard costs) with waste factors"],
        ["", "General conditions and contractor overhead (18%)"],
        ["", "Professional fees (architectural, structural, MEP, civil)"],
        ["", "Permits and inspection fees (2%)"],
        ["", "Contingency (10%)"],
        ["", "Insurance and bonding (2.5%)"],
      ];
      const assumptionSheet = XLSX.utils.aoa_to_sheet(assumptionRows);
      assumptionSheet["!cols"] = [{ wch: 22 }, { wch: 55 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(wb, assumptionSheet, "Assumptions");

      // ─── Sheet 3: Bill of Quantities (Enhanced) ─────────────────────────
      if (boqLines.length > 0) {
        const boqHeaders = [
          "Division", "Description", "Unit",
          "Base Qty", "Waste %", "Adj Qty",
          "Material Rate", "Labor Rate", "Equip Rate", "Unit Rate",
          "Material Cost", "Labor Cost", "Equip Cost", "Total Cost",
        ];

        // Group by division for subtotals
        const divisionGroups = new Map<string, typeof boqLines>();
        for (const line of boqLines) {
          const div = line.division || "General";
          if (!divisionGroups.has(div)) divisionGroups.set(div, []);
          divisionGroups.get(div)!.push(line);
        }

        const boqTableRows: (string | number)[][] = [];
        for (const [divName, lines] of divisionGroups) {
          // Division header
          boqTableRows.push([divName.toUpperCase(), "", "", "", "", "", "", "", "", "", "", "", "", ""]);

          let divMaterial = 0, divLabor = 0, divEquip = 0, divTotal = 0;
          for (const l of lines) {
            const wastePercent = l.wasteFactor ? `${(l.wasteFactor * 100).toFixed(0)}%` : "—";
            const adjQty = l.adjustedQty ?? l.quantity;
            boqTableRows.push([
              "", l.description, l.unit,
              l.quantity, wastePercent, adjQty,
              l.materialRate, l.laborRate, l.equipmentRate, l.unitRate,
              l.materialCost, l.laborCost, l.equipmentCost, l.totalCost,
            ]);
            divMaterial += l.materialCost;
            divLabor += l.laborCost;
            divEquip += l.equipmentCost;
            divTotal += l.totalCost;
          }

          // Division subtotal
          boqTableRows.push([
            "", `${divName} Subtotal`, "", "", "", "",
            "", "", "", "",
            Math.round(divMaterial * 100) / 100,
            Math.round(divLabor * 100) / 100,
            Math.round(divEquip * 100) / 100,
            Math.round(divTotal * 100) / 100,
          ]);
          boqTableRows.push(["", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
        }

        // Grand subtotal
        boqTableRows.push([
          "", "HARD COSTS SUBTOTAL", "", "", "", "",
          "", "", "", "",
          boqData?.subtotalMaterial ?? 0,
          boqData?.subtotalLabor ?? 0,
          boqData?.subtotalEquipment ?? 0,
          (boqData?.subtotalMaterial ?? 0) + (boqData?.subtotalLabor ?? 0) + (boqData?.subtotalEquipment ?? 0),
        ]);

        // Escalation line
        if (escalationAmt > 0) {
          boqTableRows.push([
            "", "Cost Escalation (6%/yr, 6mo)", "", "", "", "",
            "", "", "", "",
            "", "", "", escalationAmt,
          ]);
        }

        // Grand total
        boqTableRows.push([
          "", "GRAND TOTAL (excl. soft costs)", "", "", "", "",
          "", "", "", "",
          "", "", "", boqData?.grandTotal ?? 0,
        ]);

        // Disclaimer row
        boqTableRows.push(["", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
        boqTableRows.push([COST_DISCLAIMERS.accuracy, "", "", "", "", "", "", "", "", "", "", "", "", ""]);

        const boqSheet = XLSX.utils.aoa_to_sheet([boqHeaders, ...boqTableRows]);
        boqSheet["!cols"] = [
          { wch: 16 }, { wch: 35 }, { wch: 6 },
          { wch: 10 }, { wch: 8 }, { wch: 10 },
          { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
          { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
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

      // ─── Sheet 4: Summary & Breakdown ───────────────────────────────────
      const hardTotal = (boqData?.subtotalMaterial ?? 0) + (boqData?.subtotalLabor ?? 0) + (boqData?.subtotalEquipment ?? 0);
      const summaryRows = [
        ["COST ESTIMATE SUMMARY"],
        [""],
        ["Date:", dateStr],
        ["Project Type:", `${projectType} (${projectMultiplier}x)`],
        ["Region:", String(inputData?._region ?? "USA (baseline)")],
        [""],
        ["COST BREAKDOWN BY TYPE", "", "Amount (USD)", "% of Hard Costs"],
        ["Material Costs", "", boqData?.subtotalMaterial ?? 0, hardTotal > 0 ? `${(((boqData?.subtotalMaterial ?? 0) / hardTotal) * 100).toFixed(1)}%` : "—"],
        ["Labor Costs", "", boqData?.subtotalLabor ?? 0, hardTotal > 0 ? `${(((boqData?.subtotalLabor ?? 0) / hardTotal) * 100).toFixed(1)}%` : "—"],
        ["Equipment Costs", "", boqData?.subtotalEquipment ?? 0, hardTotal > 0 ? `${(((boqData?.subtotalEquipment ?? 0) / hardTotal) * 100).toFixed(1)}%` : "—"],
        ["Hard Cost Subtotal", "", hardTotal, "100.0%"],
        [""],
        ["Cost Escalation (6%/yr, 6mo)", "", escalationAmt, ""],
        ["Hard Costs + Escalation", "", hardTotal + escalationAmt, ""],
        [""],
        ["SOFT COSTS"],
        ["Architectural Fees (8%)", "", Math.round((hardTotal + escalationAmt) * 0.08 * 100) / 100, ""],
        ["Structural Engineering (2%)", "", Math.round((hardTotal + escalationAmt) * 0.02 * 100) / 100, ""],
        ["MEP Engineering (3.5%)", "", Math.round((hardTotal + escalationAmt) * 0.035 * 100) / 100, ""],
        ["Civil Engineering (1.5%)", "", Math.round((hardTotal + escalationAmt) * 0.015 * 100) / 100, ""],
        ["Permits & Inspections (2%)", "", Math.round((hardTotal + escalationAmt) * 0.02 * 100) / 100, ""],
        ["GC Overhead & Profit (18%)", "", Math.round((hardTotal + escalationAmt) * 0.18 * 100) / 100, ""],
        ["Contingency (10%)", "", Math.round((hardTotal + escalationAmt) * 0.10 * 100) / 100, ""],
        ["Insurance & Bonding (2.5%)", "", Math.round((hardTotal + escalationAmt) * 0.025 * 100) / 100, ""],
        [""],
        ["TOTAL PROJECT COST", "", boqData?.grandTotal ?? 0, ""],
        [""],
        ["DISCLAIMER"],
        [COST_DISCLAIMERS.full],
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      summarySheet["!cols"] = [{ wch: 32 }, { wch: 5 }, { wch: 18 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

      const xlsxBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
      const base64 = xlsxBuffer.toString("base64");
      const dataUri = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + base64;
      const filename = `BuildFlow_BOQ_${dateStr}.xlsx`;

      // Upload to R2 (falls back to base64 data URI if R2 unavailable)
      const downloadUrl = await uploadBase64ToR2(
        dataUri,
        filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "file",
        data: {
          name: filename,
          type: "XLSX Spreadsheet",
          size: xlsxBuffer.length,
          downloadUrl,
          label: "BOQ Export (Professional Excel)",
          content: `BOQ Export: ${boqLines.length} line items across 4 sheets. Grand Total: $${(boqData?.grandTotal ?? 0).toLocaleString()}. ${COST_DISCLAIMERS.accuracy}`,
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

      // Upload to R2 (falls back to base64 data URI if R2 unavailable)
      const downloadUrl = await uploadBase64ToR2(base64, filename, "application/pdf");

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "file",
        data: {
          name: filename,
          type: "PDF Report",
          size: fileSize,
          downloadUrl,
          label: `Execution Report (${upstreamArtifacts.length} sections)`,
          content: `Professional PDF report with ${upstreamArtifacts.length} sections from workflow execution`,
        },
        metadata: { real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "GN-008") {
      // Text to 3D Generator — DALL-E 3 + SAM 3D pipeline
      if (!process.env.FAL_KEY) {
        return NextResponse.json(
          formatErrorResponse({ title: "API key required", message: "FAL_KEY is not configured. Add your fal.ai API key in environment variables.", code: "SAM3D_001" }),
          { status: 400 }
        );
      }

      const { textTo3D } = await import("@/services/text-to-3d-service");

      const prompt = String(inputData?.prompt ?? inputData?.content ?? "");
      const description = inputData?._raw as BuildingDescription | undefined;
      const viewType = ((inputData?.viewType as string) ?? "exterior") as "exterior" | "floor_plan" | "site_plan" | "interior";
      const style = (inputData?.style as string) ?? undefined;
      const seed = inputData?.seed as number | undefined;

      const result = await textTo3D({
        prompt,
        buildingDescription: description,
        viewType,
        style,
        seed,
        apiKey,
      });

      // Return a combined artifact with both the 3D model and the intermediate image
      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "3d",
        data: {
          glbUrl: result.job.glbModel?.downloadUrl,
          plyUrl: result.job.plyModel?.downloadUrl,
          seed: result.job.glbModel?.seed,
          label: "3D Model (Text to 3D)",
          // Include the generated image so the viewer can show both
          sourceImageUrl: result.imageUrl,
          revisedPrompt: result.revisedPrompt,
          metadata: {
            glbFileSize: result.job.glbModel?.fileSize,
            plyFileSize: result.job.plyModel?.fileSize,
            expiresAt: result.job.glbModel?.expiresAt,
            costUsd: (result.job.glbModel?.costUsd ?? 0) + 0.04, // DALL-E 3 HD cost + SAM 3D cost
            pipeline: "text → DALL-E 3 → SAM 3D",
          },
        },
        metadata: {
          engine: "dall-e-3 + fal-ai/sam-3",
          real: true,
          jobId: result.job.id,
          generatedAt: result.job.completedAt,
        },
        createdAt: new Date(),
      };

    } else if (catalogueId === "GN-007") {
      // Image to 3D (SAM 3D) — fal.ai
      const imageUrl = inputData?.url ?? inputData?.imageUrl ?? null;
      const imageBase64 = inputData?.fileData ?? inputData?.imageBase64 ?? inputData?.base64 ?? null;

      if (!imageUrl && !imageBase64) {
        return NextResponse.json(
          formatErrorResponse({ title: "Missing image", message: "Provide a building image for 3D conversion.", code: "SAM3D_003" }),
          { status: 400 }
        );
      }

      if (!process.env.FAL_KEY) {
        return NextResponse.json(
          formatErrorResponse({ title: "API key required", message: "FAL_KEY is not configured. Add your fal.ai API key in environment variables.", code: "SAM3D_001" }),
          { status: 400 }
        );
      }

      const { convertImageTo3D } = await import("@/services/sam3d-service");

      let resolvedUrl = imageUrl;
      if (!resolvedUrl && imageBase64) {
        const prefix = typeof imageBase64 === "string" && imageBase64.startsWith("data:") ? "" : "data:image/png;base64,";
        resolvedUrl = `${prefix}${imageBase64}`;
      }

      const job = await convertImageTo3D(resolvedUrl, {
        seed: inputData?.seed as number | undefined,
        textPrompt: inputData?.textPrompt as string | undefined,
      });

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "3d",
        data: {
          glbUrl: job.glbModel?.downloadUrl,
          plyUrl: job.plyModel?.downloadUrl,
          seed: job.glbModel?.seed,
          label: "3D Model (SAM 3D)",
          metadata: {
            glbFileSize: job.glbModel?.fileSize,
            plyFileSize: job.plyModel?.fileSize,
            expiresAt: job.glbModel?.expiresAt,
            costUsd: job.glbModel?.costUsd,
          },
        },
        metadata: { engine: "fal-ai/sam-3", real: true, jobId: job.id },
        createdAt: new Date(),
      };

    } else if (catalogueId === "GN-009") {
      // ── Video Walkthrough Generator ────────────────────────────────────
      // Takes a concept render image (from GN-003) + building description
      // and generates a cinematic walkthrough video via Kling 3.0 Official API.

      if (!process.env.KLING_ACCESS_KEY || !process.env.KLING_SECRET_KEY) {
        return NextResponse.json(
          formatErrorResponse({
            title: "Kling API keys required",
            message: "KLING_ACCESS_KEY and KLING_SECRET_KEY are not configured. Get your keys from klingai.com/global/dev to enable video generation.",
            code: "MISSING_API_KEY",
          }),
          { status: 400 }
        );
      }

      // Extract render image URL from upstream GN-003
      const renderImageUrl =
        (inputData?.url as string) ??
        (inputData?.images_out as string) ??
        (inputData?.imageUrl as string) ??
        "";

      if (!renderImageUrl) {
        return NextResponse.json(
          formatErrorResponse({
            title: "No render image provided",
            message: "GN-009 requires an upstream concept render. Connect a Concept Render Generator (GN-003) node.",
            code: "NODE_001",
          }),
          { status: 400 }
        );
      }

      // Build multi-shot camera prompts from building description
      const buildingDesc =
        (inputData?.content as string) ??
        (inputData?.description as string) ??
        (inputData?.prompt as string) ??
        "Modern architectural building";

      const multiPrompt = buildArchitecturalMultiShot(buildingDesc);

      const videoResult = await generateWalkthroughVideo({
        imageUrl: renderImageUrl,
        multiPrompt,
        duration: "15",
      });

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "video",
        data: {
          name: videoResult.fileName,
          videoUrl: videoResult.videoUrl,
          downloadUrl: videoResult.videoUrl,
          label: `Cinematic Walkthrough — Kling 3.0 (${videoResult.shotCount} shots)`,
          content: `${videoResult.durationSeconds}s cinematic multi-shot walkthrough — ${buildingDesc.slice(0, 100)}`,
          durationSeconds: videoResult.durationSeconds,
          shotCount: videoResult.shotCount,
          pipeline: "concept render → Kling 3.0 Official API (multi-shot) → MP4 video",
          costUsd: videoResult.costUsd,
        },
        metadata: { engine: "kling-v3-official", real: true, jobId: videoResult.id },
        createdAt: new Date(),
      };

    } else if (catalogueId === "GN-010") {
      // ── Hi-Fi 3D Reconstructor ─────────────────────────────────────────
      // Takes multi-view renders (from GN-003) + building description
      // and reconstructs a hyper-detailed textured 3D mesh via Meshy API.

      if (!isMeshyConfigured()) {
        return NextResponse.json(
          formatErrorResponse({
            title: "Meshy API key required",
            message: "MESHY_API_KEY is not configured. Add your Meshy API key to enable Hi-Fi 3D reconstruction.",
            code: "MISSING_API_KEY",
          }),
          { status: 400 }
        );
      }

      // Extract image URL from upstream GN-003 (concept renders)
      const imageUrl =
        (inputData?.url as string) ??
        (inputData?.images_out as string) ??
        (inputData?.imageUrl as string) ??
        "";

      if (!imageUrl) {
        return NextResponse.json(
          formatErrorResponse({
            title: "No render image provided",
            message: "GN-010 requires upstream concept render images. Connect a Concept Render Generator (GN-003) node.",
            code: "NODE_001",
          }),
          { status: 400 }
        );
      }

      // Extract building description for guidance
      const description =
        (inputData?.content as string) ??
        (inputData?.description as string) ??
        (inputData?.prompt as string) ??
        "Architectural building";

      const result = await reconstructHiFi3D({
        imageUrl,
        description,
        topology: "quad",
        targetPolycount: 30000,
      });

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "3d",
        data: {
          glbUrl: result.glbUrl,
          thumbnailUrl: result.thumbnailUrl,
          textureUrls: result.textureUrls,
          label: "Hi-Fi 3D Model (Meshy v4)",
          content: description.slice(0, 200),
          metadata: {
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            taskId: result.taskId,
            pipeline: "multi-view renders → Meshy v4 → textured GLB",
            topology: "quad",
            polycount: 30000,
          },
        },
        metadata: { engine: "meshy-v4", real: true, jobId: result.taskId },
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
