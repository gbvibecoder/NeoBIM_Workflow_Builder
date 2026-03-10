import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateBuildingDescription, generateConceptImage, generateFloorPlan, parseBriefDocument, analyzeImage, enhanceArchitecturalPrompt } from "@/services/openai";
import type { BuildingDescription } from "@/services/openai";
import { analyzeSite } from "@/services/site-analysis";
import { generateId } from "@/lib/utils";
import type { ExecutionArtifact } from "@/types/execution";
import { checkRateLimit, logRateLimitHit, isExecutionAlreadyCounted, isAdminUser } from "@/lib/rate-limit";
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
import { submitDualWalkthrough, submitDualTextToVideo, submitSingleWalkthrough, buildFloorPlanCombinedPrompt } from "@/services/video-service";
import {
  logWorkflowStart, logRateLimit, logNodeStart, logNodeSuccess,
  logNodeError, logValidationError, logInfo,
} from "@/lib/workflow-logger";

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

// In-memory set of executionIds that have already been rate-limited this run.
// This ensures we count rate limit once per workflow execution, not once per node.
// Entries auto-expire after 10 minutes to prevent memory leaks.
const rateLimitedExecutions = new Map<string, number>();

function cleanupRateLimitCache() {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [key, ts] of rateLimitedExecutions) {
    if (ts < tenMinutesAgo) rateLimitedExecutions.delete(key);
  }
}

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
  const userEmail = session.user.email || "";

  // Parse body first so we can read executionId for rate-limit deduplication
  const { catalogueId, executionId, tileInstanceId, inputData, userApiKey } = await req.json();
  const nodeStartTime = Date.now();

  // ── Detailed file logging (dev only) ──
  await logWorkflowStart(executionId, userId, userRole, userEmail);
  await logNodeStart(executionId, catalogueId, tileInstanceId, inputData);

  // Admin users bypass ALL rate limiting — check before any Redis calls
  const isAdmin = isAdminUser(userEmail) ||
    userRole === "PLATFORM_ADMIN" ||
    userRole === "TEAM_ADMIN";

  if (!isAdmin) {
    // Apply rate limiting — count once per workflow execution, not per node.
    // The first node in a workflow run consumes the rate limit slot.
    // Subsequent nodes in the same execution (same executionId) pass through.
    try {
      const alreadyCounted = executionId
        ? await isExecutionAlreadyCounted(userId, executionId)
        : false;

      if (!alreadyCounted) {
        // Cleanup stale entries periodically
        if (rateLimitedExecutions.size > 500) cleanupRateLimitCache();

        const rateLimitResult = await checkRateLimit(userId, userRole, userEmail);

        if (!rateLimitResult.success) {
          const resetDate = new Date(rateLimitResult.reset);
          const hoursUntilReset = Math.ceil((resetDate.getTime() - Date.now()) / (1000 * 60 * 60));

          // Log the rate limit hit
          logRateLimitHit(userId, userRole, rateLimitResult.remaining);
          await logRateLimit(executionId, false, {
            remaining: rateLimitResult.remaining, limit: rateLimitResult.limit,
            reset: rateLimitResult.reset, userRole,
          });

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

        await logRateLimit(executionId, true, {
          remaining: rateLimitResult.remaining, limit: rateLimitResult.limit,
          reset: rateLimitResult.reset, userRole,
        });

        // Mark this execution as rate-limited so subsequent nodes skip the check
        if (executionId) {
          rateLimitedExecutions.set(`${userId}:${executionId}`, Date.now());
        }
      }

    } catch (error) {
      console.error("[execute-node] Rate limit check failed:", error);
      await logNodeError(executionId, catalogueId, tileInstanceId, error, Date.now() - nodeStartTime);
      return NextResponse.json(
        formatErrorResponse({ title: "Service unavailable", message: "Rate limit service temporarily unavailable. Please try again in a moment.", code: "RATE_LIMIT_UNAVAILABLE" }),
        { status: 503 }
      );
    }
  } else {
    await logRateLimit(executionId, true, { skipped: true, userRole });
  }

  if (!REAL_NODE_IDS.has(catalogueId)) {
    await logValidationError(executionId, catalogueId, `Node ${catalogueId} not in REAL_NODE_IDS`);
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

    let artifact!: ExecutionArtifact;

    if (catalogueId === "TR-003") {
      // Design Brief Analyzer — GPT-4o-mini
      // Accept text prompt OR structured JSON from TR-002
      let prompt: string;
      if (inputData?.building_type || inputData?.buildingType || inputData?.floors) {
        // Structured JSON from TR-002 — stringify it as input for GPT
        prompt = JSON.stringify(inputData);
      } else {
        prompt = (inputData?.prompt as string) ?? (inputData?.content as string) ?? "Modern mixed-use building";
      }
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

      console.log("[TR-001] rawText from inputData:", typeof rawText, "length:", typeof rawText === "string" ? rawText.length : 0);
      console.log("[TR-001] pdfBase64 present:", !!pdfBase64, "type:", typeof pdfBase64, "length:", typeof pdfBase64 === "string" ? pdfBase64.length : 0);

      // If we have actual PDF data (base64), extract text from it
      if (pdfBase64 && typeof pdfBase64 === "string") {
        try {
          // Import from lib/ directly to avoid pdf-parse v1 test-runner bug
          // (index.js tries to open ./test/data/05-versions-space.pdf when !module.parent)
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (buf: Buffer) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
          const buffer = Buffer.from(pdfBase64, "base64");
          console.log("[TR-001] PDF buffer size:", buffer.length, "bytes");
          const pdfData = await pdfParse(buffer);
          console.log("[TR-001] pdf-parse result — pages:", pdfData.numpages, "text length:", pdfData.text?.length ?? 0);
          console.log("[TR-001] Extracted text (first 300):", pdfData.text?.slice(0, 300));
          extractedText = pdfData.text || "";
        } catch (parseErr) {
          console.error("[TR-001] PDF parsing failed:", parseErr);
          // Fall through to use rawText if available
        }
      }

      console.log("[TR-001] Final extractedText length:", extractedText.trim().length, "chars");

      if (!extractedText || extractedText.trim().length < 20) {
        console.error("[TR-001] Text too short or empty — returning 400. Text:", JSON.stringify(extractedText.slice(0, 100)));
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

      console.log("[TR-001] Parsed brief — rawText length:", parsed.rawText?.length ?? 0, "chars");
      console.log("[TR-001] rawText first 300 chars:", parsed.rawText?.slice(0, 300));
      console.log("[TR-001] projectTitle:", parsed.projectTitle);

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

      // Upload the original image to R2 so downstream nodes (GN-009) can access it via URL
      let sourceImageUrl: string | undefined;
      try {
        const { uploadBase64ToR2, isR2Configured } = await import("@/lib/r2");
        if (isR2Configured()) {
          const imgName = `image-input-${generateId()}.${typeof mimeType === "string" && mimeType.includes("png") ? "png" : "jpg"}`;
          const r2Url = await uploadBase64ToR2(base64Data as string, imgName, (typeof mimeType === "string" ? mimeType : "image/jpeg"));
          // uploadBase64ToR2 returns the URL string (or original data URI on failure)
          if (r2Url && r2Url.startsWith("http")) {
            sourceImageUrl = r2Url;
            console.log("[TR-004] Source image uploaded to R2:", sourceImageUrl);
          }
        }
      } catch (r2Err) {
        console.warn("[TR-004] R2 upload of source image failed:", r2Err);
      }

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
          // Pass the original image through so downstream nodes can use it
          ...(sourceImageUrl && { imageUrl: sourceImageUrl, url: sourceImageUrl }),
          ...(typeof mimeType === "string" && { mimeType }),
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
      // Generates a cinematic walkthrough video. Supports three paths:
      // 1. Image-to-video via Kling API (when upstream GN-003 provides a render image)
      // 2. Text-to-video via Kling API (when no image, e.g. PDF → video pipeline)
      // 3. Three.js client-side fallback (when no Kling keys configured)

      // Extract building description from upstream data.
      // IMPORTANT: For the PDF → video pipeline, we use the ORIGINAL PDF text
      // (preserved in _raw.rawText by TR-001) as the sole source of truth.
      // This ensures the video matches exactly what the user uploaded in the PDF.
      const raw = (inputData?._raw ?? null) as Record<string, unknown> | null;

      // Priority: original PDF text (_raw.rawText) > formatted content > fallback
      // _raw.rawText is the original text extracted from the PDF by TR-001,
      // before any GPT rewriting. This is critical for faithful video generation.
      const originalPdfText = (raw?.rawText as string) ?? null;
      const upFloors = Number(raw?.floors ?? inputData?.floors) || 5;
      const upTotalArea = Number(raw?.totalArea ?? inputData?.totalArea) || 0;
      const upHeight = Number(raw?.height ?? inputData?.height) || 0;
      const upFloorHeight = upHeight > 0 ? upHeight / upFloors : 3.6;
      const upFootprint = Number(raw?.footprint ?? inputData?.footprint) || (upTotalArea > 0 ? Math.round(upTotalArea / upFloors) : 600);
      const upBuildingType = String(raw?.buildingType ?? inputData?.buildingType ?? "modern office building");
      const upFacade = String(raw?.facade ?? inputData?.facade ?? "");
      const upStructure = String(raw?.structure ?? inputData?.structure ?? "");
      const upNarrative = String(raw?.narrative ?? "");

      // Map facade description to exteriorMaterial for Three.js BuildingStyle
      function inferExteriorMaterial(facade: string): "glass" | "concrete" | "brick" | "wood" | "steel" | "stone" | "terracotta" | "mixed" {
        const f = facade.toLowerCase();
        if (f.includes("glass") || f.includes("curtain wall") || f.includes("glazed")) return "glass";
        if (f.includes("brick") || f.includes("masonry")) return "brick";
        if (f.includes("timber") || f.includes("wood") || f.includes("clt")) return "wood";
        if (f.includes("steel") || f.includes("corten") || f.includes("metal")) return "steel";
        if (f.includes("stone") || f.includes("limestone") || f.includes("marble")) return "stone";
        if (f.includes("terracotta") || f.includes("clay")) return "terracotta";
        if (f.includes("concrete") || f.includes("render") || f.includes("stucco")) return "concrete";
        return "mixed";
      }

      // Map buildingType to usage category
      function inferUsage(bt: string): "residential" | "office" | "mixed" | "commercial" | "hotel" | "educational" | "healthcare" | "cultural" | "industrial" | "civic" {
        const t = bt.toLowerCase();
        if (t.includes("residential") || t.includes("apartment") || t.includes("housing")) return "residential";
        if (t.includes("office") || t.includes("workplace") || t.includes("corporate")) return "office";
        if (t.includes("hotel") || t.includes("hospitality")) return "hotel";
        if (t.includes("school") || t.includes("university") || t.includes("education")) return "educational";
        if (t.includes("hospital") || t.includes("clinic") || t.includes("health")) return "healthcare";
        if (t.includes("museum") || t.includes("gallery") || t.includes("cultural") || t.includes("theater")) return "cultural";
        if (t.includes("retail") || t.includes("shop") || t.includes("commercial")) return "commercial";
        if (t.includes("industrial") || t.includes("warehouse") || t.includes("factory")) return "industrial";
        if (t.includes("mixed")) return "mixed";
        return "office";
      }

      // Map to facade pattern
      function inferFacadePattern(facade: string): "curtain-wall" | "punched-window" | "ribbon-window" | "brise-soleil" | "none" {
        const f = facade.toLowerCase();
        if (f.includes("curtain") || f.includes("glazed")) return "curtain-wall";
        if (f.includes("ribbon")) return "ribbon-window";
        if (f.includes("brise") || f.includes("louvre") || f.includes("louver")) return "brise-soleil";
        if (f.includes("punch")) return "punched-window";
        return "curtain-wall";
      }

      console.log("========== GN-009 VIDEO WALKTHROUGH START ==========");
      console.log("[GN-009] All input keys:", Object.keys(inputData ?? {}));
      console.log("[GN-009] fileData present:", !!(inputData?.fileData));
      console.log("[GN-009] fileData length:", typeof inputData?.fileData === "string" ? inputData.fileData.length : 0);
      console.log("[GN-009] imageUrl present:", !!(inputData?.imageUrl));
      console.log("[GN-009] url present:", !!(inputData?.url));
      console.log("[GN-009] svg present:", !!(inputData?.svg));
      console.log("[GN-009] content (buildingDesc) present:", !!(inputData?.content));
      console.log("[GN-009] content value:", JSON.stringify(inputData?.content)?.slice(0, 200));
      console.log("[GN-009] description present:", !!(inputData?.description));
      console.log("[GN-009] mimeType:", inputData?.mimeType);
      console.log("[GN-009] KLING_ACCESS_KEY set:", !!process.env.KLING_ACCESS_KEY, "KLING_SECRET_KEY set:", !!process.env.KLING_SECRET_KEY);

      const hasKlingKeys = !!(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);

      // ── Resolve the SOURCE IMAGE for Kling (priority order) ──
      let renderImageUrl = "";
      let isFloorPlanInput = false;
      let roomInfo = "";

      console.log("[KLING] Step 1: fileData present:", !!(inputData?.fileData), "size:", typeof inputData?.fileData === "string" ? inputData.fileData.length : 0);
      console.log("[KLING] Step 1: url present:", !!(inputData?.url), "imageUrl present:", !!(inputData?.imageUrl), "svg present:", !!(inputData?.svg));

      // ── Priority 1: Direct image upload from IN-003 (original user file) ──
      // FIX F: Send base64 directly to Kling API — no temp-image URL needed.
      // Kling's image field accepts both URLs and base64 encoded strings.
      if (inputData?.fileData && typeof inputData.fileData === "string") {
        const imgMime = (inputData.mimeType as string) ?? "image/jpeg";
        const rawFileData = inputData.fileData as string;
        const cleanBase64 = rawFileData.startsWith("data:") ? rawFileData.split(",")[1] ?? rawFileData : rawFileData;

        console.log("[KLING] Step 2: Clean base64 length:", cleanBase64.length, "mime:", imgMime);

        // Strategy: R2 URL (if configured) → raw base64 directly to Kling
        // Try R2 first (if configured) — a URL is fastest for Kling
        try {
          const { uploadToR2, isR2Configured } = await import("@/lib/r2");
          if (isR2Configured()) {
            console.log("[KLING] Step 2a: R2 is configured, uploading...");
            const ext = imgMime.includes("png") ? "png" : "jpg";
            const imgBuffer = Buffer.from(cleanBase64, "base64");
            const uploadResult = await uploadToR2(imgBuffer, `floorplan-upload-${generateId()}.${ext}`, imgMime);
            if (uploadResult.success) {
              renderImageUrl = uploadResult.url;
              console.log("[KLING] Step 2a: R2 upload succeeded:", renderImageUrl);
            }
          } else {
            console.log("[KLING] Step 2a: R2 not configured, skipping");
          }
        } catch (r2Err) {
          console.warn("[KLING] Step 2a: R2 upload failed:", r2Err);
        }

        // FIX F: Send raw base64 directly to Kling (skip temp-image entirely)
        if (!renderImageUrl) {
          console.log("[KLING] Step 2b: Sending base64 DIRECTLY to Kling (Fix F — no temp-image URL)");
          renderImageUrl = cleanBase64;
          console.log("[KLING] Step 2b: Using raw base64, length:", cleanBase64.length);
        }

        isFloorPlanInput = true;
      }

      // ── Priority 2: Floor plan SVG from GN-004 ──
      // FIX F: Convert SVG→PNG, then send base64 directly to Kling.
      if (!renderImageUrl && inputData?.svg && typeof inputData.svg === "string") {
        console.log("[KLING] Step 2 (SVG): Floor plan SVG detected, converting to PNG...");
        try {
          const sharp = (await import("sharp")).default;
          const pngBuffer = await sharp(Buffer.from(inputData.svg))
            .resize(1280, 960, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
            .png({ quality: 90 })
            .toBuffer();

          // Try R2 first (if configured)
          const { uploadToR2, isR2Configured } = await import("@/lib/r2");
          if (isR2Configured()) {
            const uploadResult = await uploadToR2(pngBuffer, `floorplan-${generateId()}.png`, "image/png");
            if (uploadResult.success) {
              renderImageUrl = uploadResult.url;
              console.log("[KLING] Step 2 (SVG): R2 upload:", renderImageUrl);
            } else {
              console.warn("[KLING] Step 2 (SVG): R2 upload failed:", uploadResult.error);
            }
          }

          // FIX F: Send PNG base64 directly to Kling (skip temp-image)
          if (!renderImageUrl) {
            console.log("[KLING] Step 2 (SVG): Sending PNG base64 DIRECTLY to Kling (Fix F)");
            renderImageUrl = pngBuffer.toString("base64");
            console.log("[KLING] Step 2 (SVG): Using raw base64, length:", renderImageUrl.length);
          }
          isFloorPlanInput = true;
        } catch (svgErr) {
          console.warn("[KLING] Step 2 (SVG): SVG->PNG conversion failed:", svgErr);
        }

        // Extract room info for richer prompts
        const roomList = inputData.roomList as Array<{ name: string; area: number }> | undefined;
        if (roomList?.length) {
          roomInfo = roomList.map(r => `${r.name} (${r.area}m²)`).join(", ");
        }
      }

      // ── Priority 3: URL from upstream (GN-003 concept render or TR-004 R2 upload) ──
      if (!renderImageUrl) {
        renderImageUrl =
          (inputData?.url as string) ??
          (inputData?.images_out as string) ??
          (inputData?.imageUrl as string) ??
          "";
        if (renderImageUrl) {
          console.log("[KLING] Step 2 (Priority 3): Using upstream URL:", renderImageUrl.slice(0, 120));
        }
      }

      // Build video from building description (from upstream TR-003 or fallback)
      // Use original PDF text (_raw.rawText) as source of truth when available
      const buildingDesc = originalPdfText
        ?? (inputData?.content as string)
        ?? (inputData?.description as string)
        ?? (inputData?.prompt as string)
        ?? "Modern architectural building";

      console.log("[KLING] Step 3: renderImageUrl resolved:", renderImageUrl ? renderImageUrl.slice(0, 120) : "EMPTY");
      console.log("[KLING] Step 3: isFloorPlan:", isFloorPlanInput, "buildingDesc length:", buildingDesc.length);

      if (!hasKlingKeys) {
        // ── No Kling API keys — fall back to Three.js client-side rendering ──
        // Build a rich BuildingStyle from the PDF-extracted description
        const inferredStyle = {
          glassHeavy: upFacade.toLowerCase().includes("glass") || upFacade.toLowerCase().includes("glazed"),
          hasRiver: buildingDesc.toLowerCase().includes("river") || buildingDesc.toLowerCase().includes("waterfront"),
          hasLake: buildingDesc.toLowerCase().includes("lake"),
          isModern: buildingDesc.toLowerCase().includes("modern") || buildingDesc.toLowerCase().includes("contemporary") || !buildingDesc.toLowerCase().includes("traditional"),
          isTower: upFloors > 8,
          exteriorMaterial: inferExteriorMaterial(upFacade),
          environment: (buildingDesc.toLowerCase().includes("urban") || buildingDesc.toLowerCase().includes("city")) ? "urban" as const : "suburban" as const,
          usage: inferUsage(upBuildingType),
          promptText: upNarrative || buildingDesc.slice(0, 200),
          typology: (upFloors > 8 ? "tower" : upFloors <= 3 ? "villa" : "slab") as "tower" | "slab" | "villa",
          facadePattern: inferFacadePattern(upFacade),
          maxFloorCap: 30,
        };

        artifact = {
          id: generateId(),
          executionId: executionId ?? "local",
          tileInstanceId,
          type: "video",
          data: {
            name: `walkthrough_${generateId()}.webm`,
            videoUrl: "",
            downloadUrl: "",
            label: "AEC Cinematic Walkthrough — 15s Three.js Render",
            content: `15s AEC walkthrough: 5s exterior drone orbit + 10s interior flythrough — ${buildingDesc.slice(0, 100)}`,
            durationSeconds: 15,
            shotCount: 4,
            pipeline: "Three.js client-side → WebM video",
            costUsd: 0,
            videoGenerationStatus: "client-rendering",
            _buildingConfig: {
              floors: upFloors,
              floorHeight: upFloorHeight,
              footprint: upFootprint,
              buildingType: upBuildingType,
              style: inferredStyle,
            },
          },
          metadata: { engine: "threejs-client", real: false },
          createdAt: new Date(),
        };
      } else if (renderImageUrl) {
        // ── Kling image-to-video path (has a source image) ──
        // Detect if image is base64 (Fix F) vs URL
        const isBase64Direct = !renderImageUrl.startsWith("http");
        if (!isBase64Direct && (renderImageUrl.includes("localhost") || renderImageUrl.includes("127.0.0.1"))) {
          console.warn("[KLING] Image URL is localhost — Kling API cannot access this.");
          console.warn("[KLING]    To fix: deploy to a public URL, or use ngrok to tunnel localhost.");
        }

        console.log("[GN-009] About to call video function:");
        console.log("[GN-009] Image being passed (first 100 chars):", renderImageUrl?.slice(0, 100));
        console.log("[GN-009] Image type:", renderImageUrl?.startsWith("http") ? "URL" : renderImageUrl?.startsWith("data:") ? "data URI" : "raw base64");
        console.log("[GN-009] Image total length:", renderImageUrl?.length);
        console.log("[GN-009] Mode: pro");
        console.log("[GN-009] isFloorPlan flag:", isFloorPlanInput);
        console.log("[GN-009] buildingDesc (first 200 chars):", buildingDesc?.slice(0, 200));

        try {
          if (isFloorPlanInput) {
            // ── SINGLE 10s video for floor plans (continuous exterior→interior shot) ──
            console.log("[GN-009] Function: submitSingleWalkthrough (floor plan → single 10s continuous shot)");
            const combinedPrompt = buildFloorPlanCombinedPrompt(buildingDesc, roomInfo);
            console.log("[GN-009] Combined prompt:", combinedPrompt);

            const submitted = await submitSingleWalkthrough(renderImageUrl, combinedPrompt, "pro");

            console.log("[GN-009] Single task submitted! taskId:", submitted.taskId);

            artifact = {
              id: generateId(),
              executionId: executionId ?? "local",
              tileInstanceId,
              type: "video",
              data: {
                name: `walkthrough_${generateId()}.mp4`,
                videoUrl: "",
                downloadUrl: "",
                label: "Floor Plan -> Cinematic Walkthrough — 10s (generating...)",
                content: `10s AEC walkthrough: exterior + interior in one continuous shot — ${buildingDesc.slice(0, 100)}`,
                durationSeconds: 10,
                shotCount: 1,
                pipeline: "floor plan image → Kling Official API (pro, single 10s) → MP4",
                costUsd: 1.00,
                videoGenerationStatus: "processing",
                taskId: submitted.taskId,
                generationProgress: 0,
                isFloorPlanInput: true,
              },
              metadata: {
                engine: "kling-official",
                real: true,
                taskId: submitted.taskId,
                submittedAt: submitted.submittedAt,
                isFloorPlanInput: true,
              },
              createdAt: new Date(),
            };
            console.log("[GN-009] Artifact data.taskId:", submitted.taskId);
            console.log("[GN-009] Artifact data.durationSeconds: 10");
          } else {
            // ── DUAL video for non-floor-plan (concept renders) ──
            console.log("[GN-009] Function: submitDualWalkthrough (concept render → dual 5s+10s)");
            const submitted = await submitDualWalkthrough(renderImageUrl, buildingDesc, "pro");

            console.log("[GN-009] Dual tasks submitted! exterior:", submitted.exteriorTaskId, "interior:", submitted.interiorTaskId);

            artifact = {
              id: generateId(),
              executionId: executionId ?? "local",
              tileInstanceId,
              type: "video",
              data: {
                name: `walkthrough_${generateId()}.mp4`,
                videoUrl: "",
                downloadUrl: "",
                label: "AEC Cinematic Walkthrough — 15s (generating...)",
                content: `15s AEC walkthrough: 5s exterior + 10s interior — ${buildingDesc.slice(0, 100)}`,
                durationSeconds: 15,
                shotCount: 2,
                pipeline: "concept render → Kling Official API (pro, image2video) → 2x MP4 video",
                costUsd: 1.50,
                segments: [],
                videoGenerationStatus: "processing",
                videoPipeline: "image2video",
                exteriorTaskId: submitted.exteriorTaskId,
                interiorTaskId: submitted.interiorTaskId,
                generationProgress: 0,
                isFloorPlanInput: false,
              },
              metadata: {
                engine: "kling-official",
                real: true,
                videoPipeline: "image2video",
                exteriorTaskId: submitted.exteriorTaskId,
                interiorTaskId: submitted.interiorTaskId,
                submittedAt: submitted.submittedAt,
                isFloorPlanInput: false,
              },
              createdAt: new Date(),
            };
          }
          console.log("========== GN-009 VIDEO WALKTHROUGH END ==========");
        } catch (klingErr) {
          const errMsg = klingErr instanceof Error ? klingErr.message : String(klingErr);
          console.error("[GN-009] Kling API failed:", errMsg);

          const isLocal = !isBase64Direct && (renderImageUrl.includes("localhost") || renderImageUrl.includes("127.0.0.1"));
          const userMessage = isLocal
            ? "Kling cannot access the image because the app is running on localhost. Deploy the app to a public URL, or use ngrok to tunnel localhost (e.g. ngrok http 3000)."
            : `Kling video generation failed: ${errMsg}`;

          return NextResponse.json(
            formatErrorResponse({
              title: "Video generation failed",
              message: userMessage,
              code: "OPENAI_001",
            }),
            { status: 502 }
          );
        }
      } else {
        // ── Kling text-to-video path ──
        // No render image available (e.g. PDF → video pipeline).
        // Generate ultra-realistic video directly from the ORIGINAL PDF text.
        console.log("[GN-009] Text2Video — using original PDF text as source of truth");
        console.log("[GN-009] Source:", originalPdfText ? "rawText from PDF" : "fallback content");
        console.log("[GN-009] Prompt length:", buildingDesc.length, "chars");
        console.log("[GN-009] First 200 chars:", buildingDesc.slice(0, 200));

        const submitted = await submitDualTextToVideo(
          buildingDesc,
          "pro",
        );

        artifact = {
          id: generateId(),
          executionId: executionId ?? "local",
          tileInstanceId,
          type: "video",
          data: {
            name: `walkthrough_${generateId()}.mp4`,
            videoUrl: "",
            downloadUrl: "",
            label: "AEC Cinematic Walkthrough — 15s (generating from PDF summary...)",
            content: `15s ultra-realistic walkthrough: 5s exterior orbit + 10s interior flythrough — ${buildingDesc.slice(0, 100)}`,
            durationSeconds: 15,
            shotCount: 2,
            pipeline: "PDF summary → Kling Official API (pro, text2video) → 2x MP4 video",
            costUsd: 1.50,
            segments: [],
            videoGenerationStatus: "processing",
            videoPipeline: "text2video",
            exteriorTaskId: submitted.exteriorTaskId,
            interiorTaskId: submitted.interiorTaskId,
            generationProgress: 0,
          },
          metadata: {
            engine: "kling-official",
            real: true,
            videoPipeline: "text2video",
            exteriorTaskId: submitted.exteriorTaskId,
            interiorTaskId: submitted.interiorTaskId,
            submittedAt: submitted.submittedAt,
          },
          createdAt: new Date(),
        };
      }

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

    await logNodeSuccess(executionId, catalogueId, tileInstanceId, Date.now() - nodeStartTime, {
      type: artifact.type, dataKeys: Object.keys(artifact.data ?? {}),
    });
    return NextResponse.json({ artifact });
  } catch (err) {
    // Handle APIError (user-friendly errors)
    if (err instanceof APIError) {
      console.error("[execute-node] API Error:", {
        code: err.userError.code,
        message: err.userError.message,
      });
      await logNodeError(executionId, catalogueId, tileInstanceId, err, Date.now() - nodeStartTime);
      return NextResponse.json(
        formatErrorResponse(err.userError),
        { status: err.statusCode }
      );
    }

    // Handle generic errors
    const message = err instanceof Error ? err.message : "Execution failed";
    console.error("[execute-node] " + catalogueId + ":", message, err);
    await logNodeError(executionId, catalogueId, tileInstanceId, err, Date.now() - nodeStartTime);

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
