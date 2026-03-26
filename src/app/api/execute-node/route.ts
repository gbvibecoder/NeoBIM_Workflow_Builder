import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateBuildingDescription, generateConceptImage, generateRenovationRender, generateFloorPlan, parseBriefDocument, analyzeImage, enhanceArchitecturalPrompt, validateRenderWithClaude } from "@/services/openai";
import type { BuildingDescription, RenderQAResult } from "@/services/openai";
import { analyzeSite } from "@/services/site-analysis";
import { generateId } from "@/lib/utils";
import type { ExecutionArtifact } from "@/types/execution";
import { checkRateLimit, logRateLimitHit, isExecutionAlreadyCounted, isAdminUser, checkNodeTypeLimit, consumeReferralBonus } from "@/lib/rate-limit";
import { VIDEO_NODES, MODEL_3D_NODES, RENDER_NODES, getNodeTypeLimits } from "@/lib/stripe";
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
import { generateMassingGeometry } from "@/services/massing-generator";
import { generate3DModel, is3DAIConfigured, calculateKPIs, type BuildingRequirements } from "@/services/threedai-studio";
import { generateIFCFile } from "@/services/ifc-exporter";
import { submitDualWalkthrough, submitDualTextToVideo, submitSingleWalkthrough, submitFloorPlanWalkthrough, buildFloorPlanCombinedPrompt } from "@/services/video-service";
import {
  logWorkflowStart, logRateLimit, logNodeStart, logNodeSuccess,
  logNodeError, logValidationError, logInfo,
} from "@/lib/workflow-logger";
import { logger } from "@/lib/logger";

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

/** Extract building type from free-form text content */
function extractBuildingTypeFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const types = [
    "office tower", "office building", "residential tower", "residential apartment",
    "mixed-use complex", "mixed-use building", "mixed-use tower", "mixed use",
    "warehouse", "industrial", "retail", "commercial", "hospital", "hotel",
    "school", "university", "museum", "gallery", "cultural center",
    "shopping mall", "data center", "parking garage",
  ];
  for (const t of types) {
    if (lower.includes(t)) return t.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  }
  // Fallback: look for common single-word types
  const singleMatch = lower.match(/\b(office|residential|commercial|industrial|retail|hotel|hospital)\b/);
  if (singleMatch) return singleMatch[1][0].toUpperCase() + singleMatch[1].slice(1) + " Building";
  return null;
}

// Node IDs that have real implementations
const REAL_NODE_IDS = new Set(["TR-001", "TR-003", "TR-004", "TR-005", "TR-012", "GN-001", "GN-003", "GN-004", "GN-007", "GN-008", "GN-009", "GN-010", "GN-011", "TR-007", "TR-008", "EX-001", "EX-002", "EX-003"]);

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

// Allow up to 180s for heavy GPT-4o vision + 3D AI Studio generation + conversion chains
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const session = await auth();

  // Check authentication
  if (!session?.user?.id) {
    return NextResponse.json(
      formatErrorResponse(UserErrors.UNAUTHORIZED),
      { status: 401 }
    );
  }

  // Email verification is now enforced via pre-execution check on the client.
  // Unverified users get 1 free execution; subsequent runs are blocked by the frontend popup.
  // Backend still allows execution through — the client is responsible for showing the modal.

  const userId: string = session.user.id;
  const userRole = (session.user as { role?: string }).role as "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN" || "FREE";
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
          // Try consuming a referral bonus execution before rejecting
          const usedBonus = await consumeReferralBonus(userId);
          if (!usedBonus) {
            const resetDate = new Date(rateLimitResult.reset);
            const msUntilReset = resetDate.getTime() - Date.now();
            const daysUntilReset = Math.ceil(msUntilReset / (1000 * 60 * 60 * 24));
            const hoursUntilReset = Math.ceil(msUntilReset / (1000 * 60 * 60));

            // Log the rate limit hit
            logRateLimitHit(userId, userRole, rateLimitResult.remaining);
            await logRateLimit(executionId, false, {
              remaining: rateLimitResult.remaining, limit: rateLimitResult.limit,
              reset: rateLimitResult.reset, userRole,
            });

            const rateLimitError = userRole === "FREE"
              ? UserErrors.RATE_LIMIT_FREE(daysUntilReset)
              : userRole === "MINI"
              ? UserErrors.RATE_LIMIT_MINI(daysUntilReset)
              : userRole === "STARTER"
              ? UserErrors.RATE_LIMIT_STARTER(daysUntilReset)
              : UserErrors.RATE_LIMIT_PRO(daysUntilReset);

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
          // Bonus consumed — allow execution to proceed
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

  // ── Per-node-type metered limits (video, 3D, renders) ──
  // Enforced server-side for all users including admins' direct node runs
  if (!isAdmin) {
    const nodeLimits = getNodeTypeLimits(userRole);

    if (VIDEO_NODES.has(catalogueId)) {
      const result = await checkNodeTypeLimit(userId, "video", nodeLimits.videoPerMonth);
      if (!result.allowed) {
        return NextResponse.json(
          formatErrorResponse(UserErrors.VIDEO_LIMIT_REACHED(nodeLimits.videoPerMonth)),
          { status: 429 }
        );
      }
    }

    if (MODEL_3D_NODES.has(catalogueId)) {
      const result = await checkNodeTypeLimit(userId, "3d", nodeLimits.modelsPerMonth);
      if (!result.allowed) {
        return NextResponse.json(
          formatErrorResponse(UserErrors.MODEL_3D_LIMIT_REACHED(nodeLimits.modelsPerMonth)),
          { status: 429 }
        );
      }
    }

    if (RENDER_NODES.has(catalogueId)) {
      const result = await checkNodeTypeLimit(userId, "render", nodeLimits.rendersPerMonth);
      if (!result.allowed) {
        return NextResponse.json(
          formatErrorResponse(UserErrors.RENDER_LIMIT_REACHED(nodeLimits.rendersPerMonth)),
          { status: 429 }
        );
      }
    }
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

      // Inject site analysis location data if upstream TR-012 provided it
      const siteRaw = inputData?._raw as Record<string, unknown> | undefined;
      if (siteRaw?.location && typeof siteRaw.location === "object") {
        const siteLoc = siteRaw.location as { displayName?: string; address?: string };
        if (!description.location && siteLoc.displayName) {
          description.location = siteLoc.displayName;
        }
      }
      // Also extract from the prompt text if GPT didn't set location fields
      if (!description.location && typeof prompt === "string") {
        const locMatch = prompt.match(/SITE ANALYSIS\s*[—–-]\s*(.+)/);
        if (locMatch) description.location = locMatch[1].trim();
      }
      // Carry forward climate zone and design implications from site analysis
      const siteClimate = (siteRaw as Record<string, unknown> | undefined)?.climate as Record<string, unknown> | undefined;
      if (siteClimate?.zone && !description.climateZone) {
        description.climateZone = String(siteClimate.zone);
      }
      const siteDesignImpl = (siteRaw as Record<string, unknown> | undefined)?.designImplications as string[] | undefined;
      if (siteDesignImpl?.length && (!description.designImplications || !description.designImplications.length)) {
        description.designImplications = siteDesignImpl;
      }

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "text",
        data: {
          content: formatBuildingDescription(description),
          label: "Building Description (AI Generated)",
          _raw: description,
          // Preserve the user's original prompt text so GN-001 can use it directly
          // for 3D AI Studio instead of relying only on extracted parameters.
          _originalPrompt: prompt,
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

      logger.debug("[TR-001] rawText from inputData:", typeof rawText, "length:", typeof rawText === "string" ? rawText.length : 0);
      logger.debug("[TR-001] pdfBase64 present:", !!pdfBase64, "type:", typeof pdfBase64, "length:", typeof pdfBase64 === "string" ? pdfBase64.length : 0);

      // If we have actual PDF data (base64), extract text from it
      if (pdfBase64 && typeof pdfBase64 === "string") {
        try {
          // Import from lib/ directly to avoid pdf-parse v1 test-runner bug
          // (index.js tries to open ./test/data/05-versions-space.pdf when !module.parent)
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (buf: Buffer) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
          const buffer = Buffer.from(pdfBase64, "base64");
          logger.debug("[TR-001] PDF buffer size:", buffer.length, "bytes");
          const pdfData = await pdfParse(buffer);
          logger.debug("[TR-001] pdf-parse result — pages:", pdfData.numpages, "text length:", pdfData.text?.length ?? 0);
          logger.debug("[TR-001] Extracted text (first 300):", pdfData.text?.slice(0, 300));
          extractedText = pdfData.text || "";
        } catch (parseErr) {
          console.error("[TR-001] PDF parsing failed:", parseErr);
          // Fall through to use rawText if available
        }
      }

      logger.debug("[TR-001] Final extractedText length:", extractedText.trim().length, "chars");

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

      logger.debug("[TR-001] Parsed brief — rawText length:", parsed.rawText?.length ?? 0, "chars");
      logger.debug("[TR-001] rawText first 300 chars:", parsed.rawText?.slice(0, 300));
      logger.debug("[TR-001] projectTitle:", parsed.projectTitle);

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

      // ═══ STEP 1: Get walls from CubiCasa5K ML service (non-blocking) ═══
      interface MLWall { start: [number, number]; end: [number, number]; thickness: number; type: string }
      interface MLDoor { type: string; center: [number, number]; width: number }
      interface MLWindow { type: string; center: [number, number]; width: number }
      let mlWalls: MLWall[] = [];
      let mlDoors: MLDoor[] = [];
      let mlWindows: MLWindow[] = [];
      try {
        logger.debug("[TR-004] Step 1: Getting walls from CubiCasa5K ML...");
        const mlResponse = await fetch("http://localhost:5001/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64Data }),
          signal: AbortSignal.timeout(5000),
        });
        if (mlResponse.ok) {
          const mlResult = await mlResponse.json();
          mlWalls = mlResult.walls ?? [];
          mlDoors = mlResult.doors ?? [];
          mlWindows = mlResult.windows ?? [];
          logger.debug(`[TR-004] ML walls: ${mlWalls.length} segments, ${mlDoors.length} doors, ${mlWindows.length} windows (${mlResult.inferenceTime}s)`);
        } else {
          logger.debug(`[TR-004] ML service returned ${mlResponse.status}`);
        }
      } catch (mlError: unknown) {
        const msg = mlError instanceof Error ? mlError.message : "connection refused";
        logger.debug(`[TR-004] ML service unavailable: ${msg}`);
      }

      // ═══ STEP 2: GPT-4o analysis (rooms, layout, descriptions) ═══
      // analyzeImage already produces row-based geometry that GN-011 uses
      logger.debug("[TR-004] Step 2: Getting rooms from GPT-4o...");
      let analysis = await analyzeImage(base64Data, mimeType, apiKey);

      if (analysis.isFloorPlan && base64Data) {
        // ── PRIMARY: Potrace pixel tracing + GPT-4o labeling ──
        let traceSucceeded = false;
        try {
          logger.debug("[TR-004] Starting Potrace + GPT-4o hybrid analysis...");
          const { traceFloorPlanToSVG } = await import("@/services/floor-plan-tracer");
          const imageBuffer = Buffer.from(base64Data as string, "base64");
          const trace = await traceFloorPlanToSVG(imageBuffer);

          logger.debug(`[TR-004] Potrace: ${trace.wallSegments.length} walls, ${trace.enclosedRegions.length} regions`);

          // Save debug SVG
          try {
            const fs = await import("fs");
            const path = await import("path");
            fs.writeFileSync(path.join(process.cwd(), "public", "debug-floor-plan.svg"), trace.svg);
            logger.debug("[TR-004] SVG saved to public/debug-floor-plan.svg");
          } catch { /* ignore */ }

          if (trace.enclosedRegions.length >= 1) {
            // GPT-4o labels the rooms Potrace found
            const { labelFloorPlanRooms } = await import("@/services/openai");
            const labels = await labelFloorPlanRooms(
              base64Data as string,
              typeof mimeType === "string" ? mimeType : "image/jpeg",
              trace.enclosedRegions,
              trace.width,
              trace.height,
              apiKey,
            );

            logger.debug(`[TR-004] GPT-4o labeled: ${labels.rooms.length} rooms, building ${labels.buildingWidthMeters}x${labels.buildingDepthMeters}m`);

            const bw = labels.buildingWidthMeters || 10;
            const bd = labels.buildingDepthMeters || 8;
            const pxPerMeterX = trace.width / bw;
            const pxPerMeterY = trace.height / bd;

            // Convert pixel regions → meter-space rooms
            const tracedRooms = labels.rooms.map(label => {
              const region = trace.enclosedRegions.find(r => r.id === label.regionId);
              if (!region) return null;
              return {
                name: label.name,
                type: label.type,
                width: label.widthMeters || +(region.bounds.width / pxPerMeterX).toFixed(2),
                depth: label.depthMeters || +(region.bounds.height / pxPerMeterY).toFixed(2),
                x: +(region.bounds.x / pxPerMeterX).toFixed(2),
                y: +(region.bounds.y / pxPerMeterY).toFixed(2),
                adjacentRooms: [] as string[],
              };
            }).filter((r): r is NonNullable<typeof r> => r !== null);

            // Convert wall segments px → meters
            const tracedWalls = trace.wallSegments.map(w => ({
              start: [w.x1 / pxPerMeterX, w.y1 / pxPerMeterY] as [number, number],
              end: [w.x2 / pxPerMeterX, w.y2 / pxPerMeterY] as [number, number],
              thickness: Math.max(w.thickness / pxPerMeterX, 0.1),
              type: "exterior" as const,
            }));

            // Auto-detect adjacency
            for (let i = 0; i < tracedRooms.length; i++) {
              for (let j = i + 1; j < tracedRooms.length; j++) {
                const a = tracedRooms[i], b = tracedRooms[j];
                const ax2 = a.x + a.width, ay2 = a.y + a.depth;
                const bx2 = b.x + b.width, by2 = b.y + b.depth;
                const hOverlap = Math.min(ax2, bx2) - Math.max(a.x, b.x);
                const vOverlap = Math.min(ay2, by2) - Math.max(a.y, b.y);
                const hGap = Math.min(Math.abs(ax2 - b.x), Math.abs(bx2 - a.x));
                const vGap = Math.min(Math.abs(ay2 - b.y), Math.abs(by2 - a.y));
                if ((hOverlap > 0.3 && hGap < 0.8) || (vOverlap > 0.3 && vGap < 0.8)) {
                  a.adjacentRooms.push(b.name);
                  b.adjacentRooms.push(a.name);
                }
              }
            }

            if (tracedRooms.length >= 1) {
              analysis.geometry = {
                buildingWidth: bw,
                buildingDepth: bd,
                buildingShape: "rectangular",
                walls: tracedWalls,
                rows: [],
                rooms: tracedRooms,
              };
              traceSucceeded = true;
              logger.debug(`[TR-004] ✓ Potrace+GPT-4o: ${tracedRooms.length} rooms, ${tracedWalls.length} walls, ${bw.toFixed(1)}m × ${bd.toFixed(1)}m`);
              tracedRooms.forEach(r => logger.debug(`  ${r.name} (${r.type}): ${r.width}x${r.depth}m at (${r.x},${r.y})`));
            }
          }
        } catch (traceErr) {
          console.warn("[TR-004] Potrace+GPT-4o failed, falling back to Sharp:", traceErr);
        }

        // ── FALLBACK: Sharp pixel detection + GPT-4o labeling ──
        if (!traceSucceeded) {
          try {
            const { detectFloorPlanGeometry } = await import("@/services/floor-plan-detector");
            const sharpResult = await detectFloorPlanGeometry(
              base64Data as string,
              typeof mimeType === "string" ? mimeType : "image/jpeg",
              analysis.footprint ? {
                estimatedFootprintMeters: {
                  width: parseFloat(String(analysis.footprint.width)) || 14,
                  depth: parseFloat(String(analysis.footprint.depth)) || 10,
                },
              } : undefined,
            );

            logger.debug(`[TR-004] Sharp detection: ${sharpResult.geometry.walls.length} walls, ${sharpResult.geometry.rooms.length} rooms, confidence: ${sharpResult.confidence.toFixed(2)}`);

            const useSharp = sharpResult.confidence >= 0.4
              && sharpResult.geometry.walls.length >= 3
              && sharpResult.geometry.rooms.length >= 2;

            if (useSharp) {
              const { labelDetectedRooms } = await import("@/services/openai");
              const labels = await labelDetectedRooms({
                roomCenters: sharpResult.geometry.rooms.map(r => ({
                  center: r.center,
                  width: r.width,
                  depth: r.depth,
                })),
                imageBase64: base64Data as string,
                mimeType: typeof mimeType === "string" ? mimeType : "image/jpeg",
              }, apiKey);

              const mergedRooms = sharpResult.geometry.rooms.map((room, i) => {
                const label = labels.rooms.find(l => l.index === i);
                return {
                  ...room,
                  name: label?.name ?? room.name,
                  type: (label?.type ?? room.type) as import("@/types/floor-plan").FloorPlanRoomType,
                  width: label?.refinedWidth ?? room.width,
                  depth: label?.refinedDepth ?? room.depth,
                };
              });

              const sharpFp = labels.footprint ?? sharpResult.geometry.footprint;
              const sharpRows: Array<Array<{ name: string; type: string; width: number; depth: number }>> = [];
              let sharpRow: Array<{ name: string; type: string; width: number; depth: number }> = [];
              for (const rm of mergedRooms) {
                sharpRow.push({ name: rm.name, type: rm.type as string, width: rm.width, depth: rm.depth });
                if (sharpRow.length >= 3) { sharpRows.push(sharpRow); sharpRow = []; }
              }
              if (sharpRow.length > 0) sharpRows.push(sharpRow);
              let sharpY = 0;
              const sharpRooms: Array<{ name: string; type: string; width: number; depth: number; x: number; y: number; adjacentRooms: string[] | undefined }> = [];
              for (const row of sharpRows) {
                const rowDepth = Math.max(...row.map(r => r.depth));
                let sharpX = 0;
                for (const rm of row) {
                  sharpRooms.push({ name: rm.name, type: rm.type, width: rm.width, depth: rowDepth, x: sharpX, y: sharpY, adjacentRooms: undefined });
                  sharpX += rm.width;
                }
                sharpY += rowDepth;
              }
              analysis.geometry = {
                buildingWidth: sharpFp.width,
                buildingDepth: sharpFp.depth,
                rooms: sharpRooms,
              };

              logger.debug(`[TR-004] Fallback: sharp+GPT hybrid: ${mergedRooms.length} rooms`);
            } else {
              logger.debug("[TR-004] Sharp confidence too low, using GPT-4o geometry as-is");
            }
          } catch (sharpErr) {
            console.warn("[TR-004] Sharp detection also failed, using GPT-4o geometry as-is:", sharpErr);
          }
        }
      }

      // ═══ STEP 3: Merge ML walls into GPT-4o geometry (hybrid) ═══
      if (mlWalls.length > 0 && analysis.geometry) {
        const existingWalls = (analysis.geometry as Record<string, unknown>).walls as MLWall[] | undefined;
        // Use ML walls if we got meaningful data (>3 segments), otherwise keep existing
        if (mlWalls.length > 3 || !existingWalls || existingWalls.length === 0) {
          (analysis.geometry as Record<string, unknown>).walls = mlWalls;
          logger.debug(`[TR-004] ✓ Injected ${mlWalls.length} ML walls into geometry (replacing ${existingWalls?.length ?? 0} existing)`);
        }
        if (mlDoors.length > 0) {
          (analysis.geometry as Record<string, unknown>).doors = mlDoors;
          logger.debug(`[TR-004] ✓ Injected ${mlDoors.length} ML doors`);
        }
        if (mlWindows.length > 0) {
          (analysis.geometry as Record<string, unknown>).windows = mlWindows;
          logger.debug(`[TR-004] ✓ Injected ${mlWindows.length} ML windows`);
        }
      } else if (mlWalls.length > 0 && !analysis.geometry) {
        // GPT-4o didn't produce geometry but ML has walls — create minimal geometry
        analysis.geometry = {
          buildingWidth: parseFloat(String(analysis.footprint?.width ?? "12")),
          buildingDepth: parseFloat(String(analysis.footprint?.depth ?? "8")),
          walls: mlWalls as unknown as NonNullable<typeof analysis.geometry>["walls"],
          rooms: [],
        };
        logger.debug(`[TR-004] ✓ Created geometry with ${mlWalls.length} ML walls (GPT-4o had no geometry)`);
      }

      const roomCount = analysis.geometry
        ? ((analysis.geometry as Record<string, unknown>).rows as unknown[])?.flat()?.length
          ?? ((analysis.geometry as Record<string, unknown>).rooms as unknown[])?.length
          ?? 0
        : 0;
      const wallCount = mlWalls.length;
      const method = mlWalls.length > 3 ? "hybrid (ML walls + GPT-4o rooms)" : "GPT-4o";
      logger.debug(`[TR-004] ✓ Final: ${roomCount} rooms, ${wallCount} walls — ${method}`);

      const roomsText = analysis.rooms?.length
        ? `\nROOMS:\n${analysis.rooms.map(r => `• ${r.name} (${r.dimensions})`).join("\n")}`
        : "";
      const layoutText = analysis.layoutDescription
        ? `\nLAYOUT: ${analysis.layoutDescription}`
        : "";

      const descriptionText = `IMAGE ANALYSIS — ${analysis.buildingType}

Style: ${analysis.style}
Estimated Floors: ${analysis.floors}
${analysis.isFloorPlan ? "Type: 2D Floor Plan" : ""}

${analysis.description}

FACADE: ${analysis.facade}

MASSING: ${analysis.massing}

SITE: ${analysis.siteRelationship}
${roomsText}${layoutText}

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
            logger.debug("[TR-004] Source image uploaded to R2:", sourceImageUrl);
          }
        }
      } catch (r2Err) {
        console.warn("[TR-004] R2 upload of source image failed:", r2Err);
      }

      // Build roomInfo string from extracted rooms for downstream nodes (GN-009)
      const extractedRoomInfo = analysis.rooms?.length
        ? analysis.rooms.map(r => `${r.name} (${r.dimensions})`).join(", ")
        : "";

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
          // Pass room data for downstream GN-009
          ...(analysis.isFloorPlan && { isFloorPlan: true }),
          ...(extractedRoomInfo && { roomInfo: extractedRoomInfo }),
          ...(analysis.layoutDescription && { layoutDescription: analysis.layoutDescription }),
          // Pass the original image through so downstream nodes can use it
          ...(sourceImageUrl && { imageUrl: sourceImageUrl, url: sourceImageUrl }),
          ...(typeof mimeType === "string" && { mimeType }),
          // Rich floor plan data for render pipeline (GPT-4o analysis)
          ...(analysis.richRooms && { richRooms: analysis.richRooms }),
          ...(analysis.footprint && { footprint: analysis.footprint }),
          ...(analysis.circulation && { circulation: analysis.circulation }),
          ...(analysis.exteriorPrompt && { exteriorPrompt: analysis.exteriorPrompt }),
          ...(analysis.interiorPrompt && { interiorPrompt: analysis.interiorPrompt }),
          // Geometric data for GN-011 Interactive 3D Viewer
          ...(analysis.geometry && { geometry: analysis.geometry }),
        },
        metadata: {
          model: analysis.isFloorPlan
            ? (mlWalls.length > 3 ? "hybrid-cubicasa5k-gpt4o" : (process.env.ANTHROPIC_API_KEY ? "claude-sonnet" : "gpt-4o"))
            : "gpt-4o-mini",
          real: true,
        },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-012") {
      // Site Analysis — real geographic + climate data from free APIs
      // Location Input (IN-006) sends structured JSON like {"country":"India","state":"Maharashtra","city":"Pune",...}
      // Extract a geocodable address from it, or fall back to raw string
      let address = inputData?.content ?? inputData?.prompt ?? inputData?.address ?? "";
      if (typeof address === "string" && address.trim().startsWith("{")) {
        try {
          const locJson = JSON.parse(address.trim()) as Record<string, string>;
          const parts = [locJson.city, locJson.state, locJson.country].filter(Boolean);
          if (parts.length > 0) address = parts.join(", ");
        } catch { /* not valid JSON, use as-is */ }
      }
      // Also handle when inputData itself has city/state/country fields directly
      if ((!address || address.trim().startsWith("{")) && (inputData?.city || inputData?.state || inputData?.country)) {
        const parts = [inputData.city, inputData.state, inputData.country].filter(Boolean);
        if (parts.length > 0) address = parts.join(", ");
      }

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

      // Try real geocoding, fall back to synthetic location-aware data if it fails
      let siteData;
      let siteDataSource = "real";
      try {
        siteData = await analyzeSite(address.trim());
      } catch (siteErr) {
        console.warn(`[TR-012] analyzeSite failed for "${address}", generating synthetic data:`, siteErr);
        siteDataSource = "synthetic";

        // Parse location parts from the address for climate estimation
        const addressLower = address.toLowerCase();
        const isIndia = addressLower.includes("india");
        const isTropical = isIndia || addressLower.includes("singapore") || addressLower.includes("thailand") || addressLower.includes("malaysia") || addressLower.includes("indonesia");
        const isArid = addressLower.includes("dubai") || addressLower.includes("riyadh") || addressLower.includes("qatar") || addressLower.includes("saudi");
        const isNordic = addressLower.includes("stockholm") || addressLower.includes("oslo") || addressLower.includes("copenhagen") || addressLower.includes("finland");

        // Generate climate zone based on location keywords
        let climateZone = "temperate";
        let avgSummer = 28;
        let avgWinter = 5;
        let rainfall = 800;
        const designImplications: string[] = [];

        if (isIndia) {
          // Indian climate varies by region
          const isNorthIndia = addressLower.includes("delhi") || addressLower.includes("uttar pradesh") || addressLower.includes("haryana") || addressLower.includes("punjab") || addressLower.includes("rajasthan");
          const isNEIndia = addressLower.includes("assam") || addressLower.includes("guwahati") || addressLower.includes("meghalaya") || addressLower.includes("manipur") || addressLower.includes("mizoram") || addressLower.includes("nagaland") || addressLower.includes("tripura") || addressLower.includes("arunachal") || addressLower.includes("sikkim");
          const isSouthIndia = addressLower.includes("kerala") || addressLower.includes("tamil nadu") || addressLower.includes("karnataka") || addressLower.includes("andhra") || addressLower.includes("telangana") || addressLower.includes("chennai") || addressLower.includes("bangalore") || addressLower.includes("hyderabad");
          const isWestIndia = addressLower.includes("maharashtra") || addressLower.includes("mumbai") || addressLower.includes("pune") || addressLower.includes("goa") || addressLower.includes("gujarat");

          if (isNEIndia) {
            climateZone = "tropical monsoon (humid subtropical)";
            avgSummer = 32; avgWinter = 14; rainfall = 2500;
            designImplications.push("Deep overhangs and covered walkways for heavy monsoon rainfall (2000-3000mm/year)");
            designImplications.push("Cross-ventilation design for hot humid summers (30-35°C)");
            designImplications.push("Raised plinth level for flood resilience during monsoon");
            designImplications.push("Use of local materials — bamboo screens, laterite stone, timber accents");
            designImplications.push("Lush tropical landscaping with native species — areca palms, bamboo, banana");
          } else if (isNorthIndia) {
            climateZone = "hot semi-arid / composite";
            avgSummer = 40; avgWinter = 8; rainfall = 700;
            designImplications.push("High thermal mass walls for extreme temperature range (5-45°C)");
            designImplications.push("Shaded courtyards and jaalis for passive cooling");
            designImplications.push("Double-wall or cavity wall construction for insulation");
            designImplications.push("Dust and pollution resistant facade materials");
          } else if (isSouthIndia) {
            climateZone = "tropical wet-dry";
            avgSummer = 35; avgWinter = 22; rainfall = 1200;
            designImplications.push("Sun shading devices on west and south facades");
            designImplications.push("Natural ventilation corridors for warm humid conditions");
            designImplications.push("Rainwater harvesting system (mandatory in many southern cities)");
            designImplications.push("Tropical vegetation and shade trees in landscape design");
          } else if (isWestIndia) {
            climateZone = "tropical wet-dry / semi-arid";
            avgSummer = 36; avgWinter = 16; rainfall = 1100;
            designImplications.push("Monsoon-responsive design with covered terraces and deep balconies");
            designImplications.push("Cross-ventilation for hot-humid pre-monsoon period");
            designImplications.push("Earthquake-resistant design (Seismic Zone III)");
            designImplications.push("Use of locally available materials — basalt, laterite, Mangalore tiles");
          } else {
            climateZone = "tropical / composite";
            avgSummer = 34; avgWinter = 15; rainfall = 1000;
            designImplications.push("Climate-responsive facade with sun shading");
            designImplications.push("Monsoon drainage and waterproofing design");
            designImplications.push("Natural ventilation strategies for warm conditions");
          }
        } else if (isArid) {
          climateZone = "hot arid desert";
          avgSummer = 42; avgWinter = 18; rainfall = 80;
          designImplications.push("Solar shading and low-E glazing for intense desert sun");
          designImplications.push("High-performance thermal insulation for extreme heat");
          designImplications.push("Sand/dust-resistant facade materials and sealed systems");
        } else if (isNordic) {
          climateZone = "cold maritime / subarctic";
          avgSummer = 18; avgWinter = -3; rainfall = 600;
          designImplications.push("Heavy insulation and triple glazing for cold winters");
          designImplications.push("Passive solar orientation maximizing winter sun exposure");
          designImplications.push("Snow load consideration for roof design");
        } else if (isTropical) {
          climateZone = "tropical humid";
          avgSummer = 32; avgWinter = 24; rainfall = 2000;
          designImplications.push("Cross-ventilation and natural cooling strategies");
          designImplications.push("Deep overhangs for tropical rain and sun protection");
        }

        if (designImplications.length === 0) {
          designImplications.push("Climate-responsive facade design", "Energy-efficient building envelope", "Local material palette");
        }

        siteData = {
          location: { address: address.trim(), lat: 0, lon: 0, displayName: address.trim() },
          elevation: { value: 500, unit: "m" },
          climate: {
            zone: climateZone,
            avgTempSummer: avgSummer,
            avgTempWinter: avgWinter,
            annualRainfall: rainfall,
            currentTemp: null,
            currentWeather: null,
          },
          solar: { summerNoonAltitude: 75, winterNoonAltitude: 45, equinoxNoonAltitude: 60 },
          designImplications,
        };
      }

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
        metadata: { model: siteDataSource === "real" ? "site-analysis-v1" : "site-analysis-synthetic", real: true },
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
        // Pass through location context for accurate renders
        location: upstreamDescription.location,
        city: upstreamDescription.city,
        country: upstreamDescription.country,
        climateZone: upstreamDescription.climateZone,
        designImplications: upstreamDescription.designImplications,
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
        metadata: { model: "gpt-4o", real: true },
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

      // Extract location from upstream data chain (TR-012 → TR-003 → GN-003)
      const descRaw = description as Record<string, unknown> | null;
      const locationFromDesc = (descRaw?.location as string | undefined)
        ?? (descRaw?.city as string | undefined);
      const locationFromContent = typeof inputData?.content === "string"
        ? inputData.content.match(/SITE ANALYSIS\s*[—–-]\s*(.+)/)?.[1]?.trim()
        : undefined;
      const effectiveLocation = locationFromDesc ?? locationFromContent ?? undefined;

      // If upstream TR-005 already enhanced the prompt, use it directly.
      // Also check for render prompts from TR-004 floor plan pipeline (GPT-4o generated).
      const enhancedPrompt = (inputData?.enhancedPrompt as string | undefined)
        ?? (inputData?.exteriorPrompt as string | undefined)
        ?? (inputData?.interiorPrompt as string | undefined);

      let url: string;
      let revisedPrompt: string;

      if (enhancedPrompt) {
        // TR-005 already produced the optimised prompt — pass directly to DALL-E 3
        // If the enhanced prompt doesn't mention the location, prepend it
        let finalPrompt = enhancedPrompt;
        if (effectiveLocation && !enhancedPrompt.toLowerCase().includes(effectiveLocation.toLowerCase().split(",")[0])) {
          finalPrompt = `Setting: ${effectiveLocation}. ${enhancedPrompt}`;
        }
        const result = await generateConceptImage(
          finalPrompt,
          style,
          apiKey,
          effectiveLocation,
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

        // Ensure location is on the description for prompt generation
        if (effectiveLocation && !desc.location) {
          desc.location = effectiveLocation;
        }

        const result = await generateConceptImage(
          desc,
          style,
          apiKey,
          effectiveLocation ?? desc.location,
          undefined,
          undefined,
          viewType
        );
        url = result.url;
        revisedPrompt = result.revisedPrompt;
      }

      // ── Claude Vision QA: validate render accuracy ──
      // Only run QA when we have a BuildingDescription (structured data to check against)
      const descForQA = (inputData?._raw as BuildingDescription | undefined) ?? null;
      let qaResult: RenderQAResult | null = null;
      if (descForQA && url && viewType === "exterior") {
        try {
          qaResult = await validateRenderWithClaude(url, descForQA);

          // If QA fails on floor count, attempt one regeneration with explicit correction
          if (!qaResult.passed && !qaResult.floorCountCorrect && qaResult.detectedFloors !== descForQA.floors) {
            console.log(`[GN-003] QA FAILED: detected ${qaResult.detectedFloors} floors, expected ${descForQA.floors}. Regenerating...`);
            const correctionPrompt = `CRITICAL CORRECTION: The building MUST have EXACTLY ${descForQA.floors} floors. ` +
              `The previous render incorrectly showed ${qaResult.detectedFloors} floors. ` +
              `Count carefully: ${descForQA.floors} distinct floor levels from ground to roof. ` +
              `${qaResult.feedback}. ${revisedPrompt}`;

            const retryResult = await generateConceptImage(
              correctionPrompt,
              style,
              apiKey,
              effectiveLocation,
              undefined,
              undefined,
              viewType
            );
            url = retryResult.url;
            revisedPrompt = retryResult.revisedPrompt;
            console.log("[GN-003] Regenerated render after QA correction");
          }
        } catch (qaErr) {
          console.warn("[GN-003] QA validation error (non-blocking):", qaErr);
        }
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
          ...(qaResult && { _qa: { passed: qaResult.passed, floors: qaResult.detectedFloors, feedback: qaResult.feedback } }),
        },
        metadata: { model: "gpt-image-1", real: true, qaValidated: !!qaResult?.passed },
        createdAt: new Date(),
      };
    } else if (catalogueId === "GN-004") {
      // Floor Plan Generator — GPT-4o SVG generation
      const description = inputData?._raw ?? inputData ?? {};
      const floorPlan = await generateFloorPlan(description, apiKey);

      // Build geometry data for GN-011 consumption
      // Use the first floor's rooms for the 3D viewer, with proper per-floor data
      const floorRoomsForGeometry = floorPlan.perFloorRooms ?? [{ floorLabel: "Ground Floor", rooms: floorPlan.roomList.map(r => ({ name: r.name, area: r.area, type: "living" })) }];
      const primaryFloorRooms = floorRoomsForGeometry[0]?.rooms ?? [];

      // Estimate building dimensions from total area / floors
      const fpArea = floorPlan.totalArea / Math.max(floorPlan.floors, 1);
      const bAspect = 1.33;
      const bW = Math.sqrt(fpArea * bAspect);
      const bD = fpArea / bW;

      // Create room layout for GN-011 3D viewer
      // Use AI-positioned rooms if available, otherwise fall back to row-based layout
      const geometryRows: Array<Array<Record<string, unknown>>> = [];
      let currentGeoRow: Array<Record<string, unknown>> = [];
      for (const rm of primaryFloorRooms) {
        const roomArea = rm.area;
        const roomW = Math.sqrt(roomArea * 1.2);
        const roomD = roomArea / roomW;
        currentGeoRow.push({
          name: rm.name,
          type: rm.type,
          width: Math.round(roomW * 10) / 10,
          depth: Math.round(roomD * 10) / 10,
        });
        if (currentGeoRow.length >= 3) {
          geometryRows.push(currentGeoRow);
          currentGeoRow = [];
        }
      }
      if (currentGeoRow.length > 0) geometryRows.push(currentGeoRow);

      // If AI returned positioned rooms, include them for accurate 3D placement
      const positionedRoomsData = floorPlan.positionedRooms
        ? floorPlan.positionedRooms.map(r => ({
            name: r.name,
            type: r.type,
            x: r.x,
            y: r.y,
            width: r.width,
            depth: r.depth,
          }))
        : undefined;

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
          perFloorRooms: floorPlan.perFloorRooms,
          // Provide geometry data so GN-011 can build accurate 3D
          geometry: {
            buildingWidth: Math.round(bW * 10) / 10,
            buildingDepth: Math.round(bD * 10) / 10,
            rows: geometryRows,
            rooms: positionedRoomsData ?? primaryFloorRooms.map(r => ({
              name: r.name,
              type: r.type,
              width: Math.round(Math.sqrt(r.area * 1.2) * 10) / 10,
              depth: Math.round((r.area / Math.sqrt(r.area * 1.2)) * 10) / 10,
            })),
            positionedRooms: positionedRoomsData,
          },
        },
        metadata: { model: "gpt-4o", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-007") {
      // Quantity Extractor — Real IFC parsing with net area calculations
      // Supports 3 input modes:
      //   1. ifcParsed — pre-parsed result from /api/parse-ifc (large files uploaded to R2)
      //   2. ifcUrl — R2 URL to fetch and parse server-side
      //   3. fileData — inline base64 (small files only, <4MB)
      console.log(`[TR-007] inputData keys: ${Object.keys(inputData ?? {}).join(", ")}`);
      const hasPreParsed = !!inputData?.ifcParsed;
      const hasIfcUrl = !!inputData?.ifcUrl;
      const hasFileData = !!inputData?.fileData;
      console.log(`[TR-007] ifcParsed: ${hasPreParsed}, ifcUrl: ${hasIfcUrl}, fileData: ${hasFileData}`);

      let ifcData: Record<string, unknown> | null = (inputData?.ifcData as Record<string, unknown>) ?? null;

      // IN-004 pass-through sends fileData as a base64 string — decode to buffer (small files only)
      if (!ifcData && inputData?.fileData && typeof inputData.fileData === "string") {
        try {
          const binaryStr = atob(inputData.fileData as string);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          ifcData = { buffer: Array.from(bytes) };
          console.log(`[TR-007] Decoded base64 fileData → ${bytes.length} bytes`);
        } catch (e) {
          console.error("[TR-007] Failed to decode base64 fileData:", e);
        }
      }

      const rows: string[][] = [];
      const elements: Array<{
        description: string; category: string; quantity: number; unit: string;
        grossArea?: number; netArea?: number; openingArea?: number; totalVolume?: number;
        storey?: string; elementCount?: number;
        materialLayers?: Array<{name: string; thickness: number}>;
      }> = [];
      let parseSummary = "";

      // ── Mode 1: Pre-parsed IFC result from /api/parse-ifc (large files) ──
      // The InputNode uploaded the file to R2 and pre-parsed it via /api/parse-ifc.
      // We skip re-parsing and use the result directly.
      const preParsed = inputData?.ifcParsed as Record<string, unknown> | undefined;
      if (preParsed && typeof preParsed === "object" && (preParsed as Record<string, unknown>).divisions) {
        console.log("[TR-007] Using pre-parsed IFC result from /api/parse-ifc");
        try {
          const parseResult = preParsed as {
            divisions: Array<{
              name: string;
              categories: Array<{
                elements: Array<{
                  type: string; storey: string; name: string; material: string;
                  materialLayers?: Array<{name: string; thickness: number}>;
                  quantities: {
                    count?: number;
                    area?: { gross?: number; net?: number };
                    volume?: { base?: number };
                    openingArea?: number;
                  };
                }>;
              }>;
            }>;
            summary?: { processedElements?: number; totalElements?: number; buildingStoreys?: number };
            meta?: { ifcSchema?: string };
          };

          // Use same aggregation logic as inline parsing (below)
          const typeAggregates = new Map<string, {
            count: number; grossArea: number; netArea: number; openingArea: number; volume: number;
            divisionName: string; storey: string; elementType: string;
            materialLayers?: Array<{name: string; thickness: number}>;
          }>();

          for (const division of parseResult.divisions) {
            for (const category of division.categories) {
              for (const element of category.elements) {
                const key = `${element.type}|${element.storey}`;
                const existing = typeAggregates.get(key) || {
                  count: 0, grossArea: 0, netArea: 0, openingArea: 0, volume: 0,
                  divisionName: division.name, storey: element.storey, elementType: element.type,
                };
                existing.count += element.quantities.count ?? 1;
                existing.grossArea += element.quantities.area?.gross ?? 0;
                existing.netArea += element.quantities.area?.net ?? 0;
                existing.openingArea += element.quantities.openingArea ?? 0;
                existing.volume += element.quantities.volume?.base ?? 0;
                if (!existing.materialLayers && element.materialLayers && element.materialLayers.length > 1) {
                  existing.materialLayers = element.materialLayers;
                }
                typeAggregates.set(key, existing);
              }
            }
          }

          for (const [, agg] of typeAggregates) {
            const description = agg.elementType.replace("Ifc", "");
            const primaryQty = agg.grossArea > 0 ? agg.grossArea : agg.volume > 0 ? agg.volume : agg.count;
            const unit = agg.grossArea > 0 ? "m²" : agg.volume > 0 ? "m³" : "EA";
            rows.push([agg.divisionName, description, agg.grossArea.toFixed(2), agg.openingArea.toFixed(2), agg.netArea.toFixed(2), agg.volume.toFixed(2), primaryQty.toFixed(2), unit]);
            elements.push({
              description, category: agg.divisionName, quantity: primaryQty, unit,
              grossArea: agg.grossArea || undefined, netArea: agg.netArea || undefined,
              openingArea: agg.openingArea || undefined, totalVolume: agg.volume || undefined,
              storey: agg.storey, elementCount: agg.count, materialLayers: agg.materialLayers,
            });
          }

          parseSummary = `Parsed ${parseResult.summary?.processedElements ?? "?"} of ${parseResult.summary?.totalElements ?? "?"} elements from ${parseResult.summary?.buildingStoreys ?? "?"} storeys (${parseResult.meta?.ifcSchema ?? "IFC"}) — pre-parsed via R2 upload`;
        } catch (preParseErr) {
          console.error("[TR-007] Failed to process pre-parsed result:", preParseErr);
          parseSummary = "⚠️ Pre-parsed IFC data was corrupted. Please re-upload the file.";
        }
      }

      // ── Mode 2: Fetch from R2 URL and parse server-side ──
      if (rows.length === 0 && inputData?.ifcUrl && typeof inputData.ifcUrl === "string") {
        console.log(`[TR-007] Fetching IFC from R2 URL: ${(inputData.ifcUrl as string).slice(0, 80)}...`);
        try {
          const resp = await fetch(inputData.ifcUrl as string);
          if (!resp.ok) throw new Error(`R2 fetch failed: ${resp.status}`);
          const arrayBuf = await resp.arrayBuffer();
          ifcData = { buffer: Array.from(new Uint8Array(arrayBuf)) };
          console.log(`[TR-007] Fetched ${arrayBuf.byteLength} bytes from R2`);
        } catch (fetchErr) {
          console.error("[TR-007] Failed to fetch IFC from R2:", fetchErr);
        }
      }

      // ── Mode 3: Parse from inline buffer (small files or R2-fetched) ──
      if (rows.length === 0 && ifcData && typeof ifcData === "object" && ifcData.buffer) {
        // Real IFC file — parse it
        try {
          const { parseIFCBuffer } = await import("@/services/ifc-parser");
          const buffer = new Uint8Array(ifcData.buffer as ArrayLike<number>);
          const parseResult = await parseIFCBuffer(buffer, inputData?.fileName as string ?? "uploaded.ifc");

          // Aggregate elements by type + storey for per-floor BOQ breakdown
          const typeAggregates = new Map<string, {
            count: number; grossArea: number; netArea: number; openingArea: number; volume: number;
            divisionName: string; storey: string; elementType: string;
            materialLayers?: Array<{name: string; thickness: number}>;
          }>();

          for (const division of parseResult.divisions) {
            for (const category of division.categories) {
              for (const element of category.elements) {
                const key = `${element.type}|${element.storey}`;
                const existing = typeAggregates.get(key) || {
                  count: 0, grossArea: 0, netArea: 0, openingArea: 0, volume: 0,
                  divisionName: division.name, storey: element.storey, elementType: element.type,
                };
                existing.count += element.quantities.count ?? 1;
                existing.grossArea += element.quantities.area?.gross ?? 0;
                existing.netArea += element.quantities.area?.net ?? 0;
                existing.openingArea += element.quantities.openingArea ?? 0;
                existing.volume += element.quantities.volume?.base ?? 0;
                // Capture material layers from first element with layers
                if (!existing.materialLayers && element.materialLayers && element.materialLayers.length > 1) {
                  existing.materialLayers = element.materialLayers;
                }
                typeAggregates.set(key, existing);
              }
            }
          }

          for (const [, agg] of typeAggregates) {
            const description = agg.elementType.replace("Ifc", "");
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
              storey: agg.storey,
              elementCount: agg.count,
              materialLayers: agg.materialLayers,
            });
          }

          parseSummary = `Parsed ${parseResult.summary.processedElements} of ${parseResult.summary.totalElements} elements from ${parseResult.summary.buildingStoreys} storeys (${parseResult.meta.ifcSchema})`;
        } catch (parseError) {
          const errMsg = parseError instanceof Error ? parseError.message : String(parseError);
          console.error("[TR-007] IFC parsing failed:", errMsg);
          parseSummary = `⚠️ IFC parsing encountered errors: ${errMsg.slice(0, 200)}. Partial results may be shown.`;
        }
      }

      // If parsing produced zero elements, provide a clear and helpful error
      if (rows.length === 0) {
        const reason = !ifcData ? "No IFC file data received. Make sure the IFC Upload node (IN-004) is connected and has a file loaded."
          : !ifcData.buffer ? "IFC file data was received but could not be decoded. The file may be corrupted or too large."
          : "The IFC file was parsed but contained no recognizable building elements (IfcWall, IfcSlab, IfcColumn, etc.). This can happen with: (1) IFC files containing only spaces/zones but no geometry, (2) Coordination models without architectural elements, (3) IFC files exported with geometry stripped.";
        return NextResponse.json(
          formatErrorResponse({
            title: "No quantities extracted",
            message: reason,
            code: "NODE_001",
          }),
          { status: 422 }
        );
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
        },
        createdAt: new Date(),
      };


    } else if (catalogueId === "TR-008") {
      // BOQ Cost Mapper — Professional QS-grade with waste, M/L/E breakdown, escalation, project type
      const elements = inputData?._elements ?? inputData?.elements ?? inputData?.rows ?? [];
      const buildingDescription = inputData?.buildingDescription ?? inputData?.content ?? inputData?.prompt ?? "";
      let escalationMonths = Number(inputData?.escalationMonths ?? 6);
      let escalationRate = 0.06;
      let contingencyPct = 0.10;

      // ── Location-aware pricing (from IN-006 Location Input or text detection) ──
      // IN-006 stores JSON in inputData.content/prompt: { country, state, city, currency }
      let locationData: { country?: string; state?: string; city?: string; currency?: string; escalation?: string; contingency?: string; months?: string } | null = null;
      for (const field of [inputData?.content, inputData?.prompt, inputData?.region, inputData?.location]) {
        if (typeof field === "string" && field.startsWith("{")) {
          try { locationData = JSON.parse(field); break; } catch { /* not JSON */ }
        }
      }

      // Import regional factors
      const { resolveProjectLocation } = await import("@/constants/regional-factors");

      let activeRegion = "USA (baseline)";
      let regionWasAutoDetected = true;
      let locationFactor = 1.0;
      let currencySymbol = "$";
      let currencyCode = "USD";
      let exchangeRate = 1.0;
      let locationLabel = "";

      if (locationData?.country) {
        // Structured location from IN-006
        const loc = resolveProjectLocation(
          locationData.country,
          locationData.state || "",
          locationData.city || "",
          locationData.currency
        );
        activeRegion = `${loc.city || loc.state || loc.country} (${loc.country})`;
        locationFactor = loc.combinedFactor;
        currencySymbol = loc.currencySymbol;
        currencyCode = loc.currency;
        exchangeRate = loc.exchangeRate;
        regionWasAutoDetected = false;
        locationLabel = `${loc.city ? loc.city + ", " : ""}${loc.state ? loc.state + ", " : ""}${loc.country}`;
        // Read user-configurable escalation/contingency/months from location data
        if (locationData.escalation != null) escalationRate = Number(locationData.escalation) / 100;
        if (locationData.contingency != null) contingencyPct = Number(locationData.contingency) / 100;
        if (locationData.months != null) escalationMonths = Number(locationData.months);
        console.log(`[TR-008] Location: ${locationLabel}, factor=${loc.combinedFactor.toFixed(3)}, currency=${currencyCode}, escalation=${(escalationRate*100).toFixed(1)}%/yr, contingency=${(contingencyPct*100).toFixed(0)}%, months=${escalationMonths}`);
      } else {
        // Fall back to text-based region detection
        const regionInput = inputData?.region ?? inputData?.location ?? "USA (baseline)";
        const upstreamNarrative = inputData?.content ?? inputData?.narrative ?? "";
        const explicitRegion = regionInput !== "USA (baseline)" ? regionInput : "";
        const detectedRegion = detectRegionFromText(
          typeof explicitRegion === "string" && explicitRegion
            ? explicitRegion
            : (typeof upstreamNarrative === "string" ? upstreamNarrative : "")
        );
        activeRegion = (typeof detectedRegion === "string" && detectedRegion) || (typeof regionInput === "string" ? regionInput : "USA (baseline)");
        regionWasAutoDetected = !detectedRegion && regionInput === "USA (baseline)";
      }

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
        storey?: string; elementCount?: number;
        is1200Code?: string; // IS 1200 code for Indian projects
      }> = [];

      // ── IS 1200 Indian Standard: Use native CPWD rates for Indian projects ──
      const isIndianProject = locationData?.country?.toLowerCase() === "india"
        || currencyCode === "INR"
        || locationLabel.toLowerCase().includes("india");
      let is1200Module: typeof import("@/constants/is1200-rates") | null = null;
      if (isIndianProject) {
        is1200Module = await import("@/constants/is1200-rates");
        console.log("[TR-008] Indian project detected — using IS 1200 codes + CPWD DSR rates in INR");
      }

      // Expand elements with material layers into separate line items per layer
      const expandedElements: typeof elements = [];
      for (const elem of elements) {
        const layers = typeof elem === "object" ? (elem as Record<string, unknown>).materialLayers as Array<{name: string; thickness: number}> | undefined : undefined;
        if (layers && layers.length > 1 && typeof elem === "object") {
          const baseArea = Number((elem as Record<string, unknown>).grossArea ?? (elem as Record<string, unknown>).quantity ?? 0);
          for (const layer of layers) {
            expandedElements.push({
              ...elem,
              description: `${layer.name} (${Math.round(layer.thickness * 1000)}mm)`,
              quantity: baseArea, // area same for all layers
              unit: "m²",
              grossArea: baseArea,
              totalVolume: baseArea * layer.thickness,
              materialLayers: undefined, // don't re-expand
            });
          }
        } else {
          expandedElements.push(elem);
        }
      }

      // Process each element (may include expanded material layers)
      for (const elem of expandedElements) {
        const description = typeof elem === "string" ? elem : elem.description ?? elem[0];
        const quantity = typeof elem === "object" ? (Number(elem.quantity) || Number(elem[2]) || 1) : 1;
        const sourceUnit = typeof elem === "object" ? ((elem as Record<string, unknown>).unit as string ?? "EA") : "EA";
        const sourceVolume = typeof elem === "object" ? Number((elem as Record<string, unknown>).totalVolume ?? 0) : 0;
        const sourceArea = typeof elem === "object" ? Number((elem as Record<string, unknown>).grossArea ?? 0) : 0;
        const elemCategory = typeof elem === "object" ? ((elem as Record<string, unknown>).category as string ?? "") : "";
        const elemStorey = typeof elem === "object" ? ((elem as Record<string, unknown>).storey as string ?? "") : "";
        const elemCount = typeof elem === "object" ? Number((elem as Record<string, unknown>).elementCount ?? 0) : 0;

        // ── IS 1200 path: use native Indian rates (INR) for Indian projects ──
        if (is1200Module && isIndianProject) {
          // Determine IFC type from description (TR-007 strips "Ifc" prefix)
          const ifcType = "Ifc" + description.replace(/\s+/g, "");
          const materialHint = elemCategory || description;
          const is1200Rates = is1200Module.getIS1200RatesForElement(ifcType, materialHint);
          const is1200Label = is1200Module.getIS1200PartLabel(ifcType, materialHint);

          if (is1200Rates.length > 0) {
            for (const rate of is1200Rates) {
              // Determine quantity based on rate unit (already in metric — no conversion needed)
              let qty: number;
              if (rate.unit === "EA") {
                qty = elemCount || quantity;
              } else if (rate.unit === "m²") {
                qty = sourceArea > 0 ? sourceArea : quantity;
              } else if (rate.unit === "m³") {
                qty = sourceVolume > 0 ? sourceVolume : quantity;
              } else if (rate.unit === "kg") {
                // Rebar/steel: kg from volume × density or count × estimate
                qty = sourceVolume > 0 ? sourceVolume * 150 : quantity * 50; // rough steel estimate
              } else if (rate.unit === "Rmt") {
                qty = quantity; // linear measure
              } else {
                qty = quantity;
              }

              const wasteFactor = is1200Module.getIS1200Rate(rate.is1200Code)
                ? (({ "Concrete": 0.07, "Steel": 0.10, "Masonry": 0.08, "Finishes": 0.12, "Doors & Windows": 0.03 })[rate.subcategory] ?? 0.08)
                : 0.08;
              const adjQty = Math.round(qty * (1 + wasteFactor) * 100) / 100;

              // Apply city tier factor (within India) but NOT country factor (rates already in INR)
              const cityFactor = locationData?.city
                ? (({ metro: 1.15, city: 0.95, town: 0.80, rural: 0.70 } as Record<string, number>)[
                    (() => { const c = (locationData.city || "").toLowerCase(); return ["mumbai","delhi","bangalore","bengaluru","chennai","hyderabad","kolkata"].includes(c) ? "metro" : ["pune","ahmedabad","jaipur","lucknow","chandigarh","kochi","indore","nagpur","surat"].includes(c) ? "city" : "town"; })()
                  ] ?? 1.0)
                : 1.0;

              const adjRate = Math.round(rate.rate * cityFactor * 100) / 100;
              const matCost = Math.round(adjQty * rate.material * cityFactor * 100) / 100;
              const labCost = Math.round(adjQty * rate.labour * cityFactor * 100) / 100;
              const eqpCost = Math.round(adjQty * (rate.rate - rate.material - rate.labour) * cityFactor * 100) / 100;
              const lineTot = Math.round(adjQty * adjRate * 100) / 100;

              hardCostSubtotal += lineTot;
              totalMaterial += matCost;
              totalLabor += labCost;
              totalEquipment += Math.max(0, eqpCost);

              // Note: do NOT add countLabel here — it's added in the storey-grouped display
              rows.push([
                rate.description, rate.unit, qty.toFixed(2),
                `${(wasteFactor * 100).toFixed(0)}%`, adjQty.toFixed(2),
                `₹${adjRate.toFixed(2)}`,
                `₹${matCost.toFixed(2)}`, `₹${labCost.toFixed(2)}`,
                `₹${Math.max(0, eqpCost).toFixed(2)}`, `₹${lineTot.toFixed(2)}`,
              ]);

              boqLines.push({
                division: is1200Label,
                csiCode: rate.is1200Code,
                description: rate.description,
                unit: rate.unit,
                quantity: qty,
                wasteFactor,
                adjustedQty: adjQty,
                materialRate: Math.round(rate.material * cityFactor * 100) / 100,
                laborRate: Math.round(rate.labour * cityFactor * 100) / 100,
                equipmentRate: Math.round((rate.rate - rate.material - rate.labour) * cityFactor * 100) / 100,
                unitRate: adjRate,
                materialCost: matCost,
                laborCost: labCost,
                equipmentCost: Math.max(0, eqpCost),
                totalCost: lineTot,
                storey: elemStorey || undefined,
                elementCount: elemCount || undefined,
                is1200Code: rate.is1200Code,
              });
            }
            continue; // Skip the USD rate path for this element
          }
          // If no IS 1200 rate found, fall through to USD path below
        }

        // ── Standard path: USD rates with regional factor conversion ──
        // Build specific search: try "Concrete Wall" before generic "Wall"
        // Material/category context from TR-007 helps disambiguate rate matching
        const specificDesc = elemCategory && !description.toLowerCase().includes(elemCategory.toLowerCase())
          ? `${elemCategory} ${description}`
          : description;
        const unitRateData = findUnitRate(specificDesc) || findUnitRate(description);

        if (unitRateData && unitRateData.category === "hard") {
          // Select correct quantity and convert metric → imperial to match rate unit
          const rateU = unitRateData.unit.toUpperCase();
          let convertedQty = quantity;
          let displayUnit = unitRateData.unit;

          if (rateU === "CY" && sourceVolume > 0) {
            // Rate expects volume in CY — use totalVolume (m³ → CY)
            convertedQty = Math.round(sourceVolume * 1.30795 * 100) / 100;
          } else if (rateU === "CY" && (sourceUnit === "m³" || sourceUnit === "m3")) {
            convertedQty = Math.round(quantity * 1.30795 * 100) / 100;
          } else if ((rateU === "SF" || rateU === "SFCA") && sourceArea > 0) {
            // Rate expects area in SF — use grossArea (m² → SF)
            convertedQty = Math.round(sourceArea * 10.7639 * 100) / 100;
          } else if ((rateU === "SF" || rateU === "SFCA") && (sourceUnit === "m²" || sourceUnit === "m2")) {
            convertedQty = Math.round(quantity * 10.7639 * 100) / 100;
          } else if (rateU === "LF" && sourceUnit === "m") {
            convertedQty = Math.round(quantity * 3.28084 * 100) / 100;
          } else if (rateU === "TON" && sourceVolume > 0) {
            // Steel: m³ → tonnage (7850 kg/m³ density)
            convertedQty = Math.round(sourceVolume * 7.85 * 100) / 100;
            displayUnit = "ton";
          }

          const lineItem = calculateLineItemCost(unitRateData, convertedQty, activeRegion, projectTypeInfo.type);

          // Apply location-based factor (country × city tier) and convert currency
          const lf = locationFactor; // 1.0 for USA baseline
          const fx = exchangeRate;   // 1.0 for USD
          const cs = currencySymbol; // "$" for USD
          const adjRate = Math.round(lineItem.adjustedRate * lf * fx * 100) / 100;
          const matCost = Math.round(lineItem.materialCost * lf * fx * 100) / 100;
          const labCost = Math.round(lineItem.laborCost * lf * fx * 100) / 100;
          const eqpCost = Math.round(lineItem.equipmentCost * lf * fx * 100) / 100;
          const lineTot = Math.round(lineItem.lineTotal * lf * fx * 100) / 100;

          hardCostSubtotal += lineTot;
          totalMaterial += matCost;
          totalLabor += labCost;
          totalEquipment += eqpCost;

          rows.push([
            description,
            displayUnit,
            convertedQty.toFixed(2),
            `${(lineItem.wasteFactor * 100).toFixed(0)}%`,
            lineItem.totalQty.toFixed(2),
            `${cs}${adjRate.toFixed(2)}`,
            `${cs}${matCost.toFixed(2)}`,
            `${cs}${labCost.toFixed(2)}`,
            `${cs}${eqpCost.toFixed(2)}`,
            `${cs}${lineTot.toFixed(2)}`,
          ]);

          boqLines.push({
            division: unitRateData.subcategory,
            csiCode: "00 00 00",
            description,
            unit: displayUnit,
            quantity: convertedQty,
            wasteFactor: lineItem.wasteFactor,
            adjustedQty: lineItem.totalQty,
            materialRate: Math.round(adjRate * getCostBreakdown(unitRateData.subcategory).material * 100) / 100,
            laborRate: Math.round(adjRate * getCostBreakdown(unitRateData.subcategory).labor * 100) / 100,
            equipmentRate: Math.round(adjRate * getCostBreakdown(unitRateData.subcategory).equipment * 100) / 100,
            unitRate: adjRate,
            materialCost: matCost,
            laborCost: labCost,
            equipmentCost: eqpCost,
            totalCost: lineTot,
            storey: elemStorey || undefined,
            elementCount: elemCount || undefined,
          });
        } else {
          // Fallback for unknown items — estimate with default waste
          estimatedItemsCount++;
          const fallbackRate = 100 * locationFactor * exchangeRate;
          const defaultWaste = 0.10;
          const adjQty = quantity * (1 + defaultWaste);
          const lineTotal = adjQty * fallbackRate;
          const breakdown = getCostBreakdown("Finishes"); // default
          hardCostSubtotal += lineTotal;
          totalMaterial += lineTotal * breakdown.material;
          totalLabor += lineTotal * breakdown.labor;
          totalEquipment += lineTotal * breakdown.equipment;

          const cs1 = currencySymbol;
          rows.push([
            description + " (est.)",
            "EA",
            quantity.toFixed(2),
            `${(defaultWaste * 100).toFixed(0)}%`,
            adjQty.toFixed(2),
            `${cs1}${fallbackRate.toFixed(2)}`,
            `${cs1}${(lineTotal * breakdown.material).toFixed(2)}`,
            `${cs1}${(lineTotal * breakdown.labor).toFixed(2)}`,
            `${cs1}${(lineTotal * breakdown.equipment).toFixed(2)}`,
            `${cs1}${lineTotal.toFixed(2)}`,
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

      // ── Derived quantities: Formwork, Rebar, Finishing ──
      // For Indian projects, use CPWD rates directly with IS 1200 codes.
      // For non-Indian, use DERIVED_RATES from regional-factors.ts.
      const { DERIVED_RATES } = await import("@/constants/regional-factors");
      const derivedLines: typeof boqLines = [];

      // IS 1200 codes for derived quantities
      const DERIVED_IS1200: Record<string, { code: string; division: string }> = {
        "formwork-wall":    { code: "IS1200-P5-FW-WALL", division: "IS 1200 Part 5 — Formwork" },
        "formwork-slab":    { code: "IS1200-P5-FW-SLAB", division: "IS 1200 Part 5 — Formwork" },
        "formwork-column":  { code: "IS1200-P5-FW-COL", division: "IS 1200 Part 5 — Formwork" },
        "formwork-beam":    { code: "IS1200-P5-FW-BEAM", division: "IS 1200 Part 5 — Formwork" },
        "rebar":            { code: "IS1200-P6-REBAR-500", division: "IS 1200 Part 6 — Reinforcement" },
        "plastering":       { code: "IS1200-P8-PLASTER", division: "IS 1200 Part 8 — Plastering" },
        "ceiling-plaster":  { code: "IS1200-P8-PLASTER", division: "IS 1200 Part 8 — Plastering" },
        "painting":         { code: "IS1200-P10-PAINT", division: "IS 1200 Part 10 — Painting" },
      };

      for (const elem of expandedElements) {
        if (typeof elem !== "object") continue;
        const e = elem as Record<string, unknown>;
        const st = (e.storey as string) || "";
        const desc = (e.description as string) || "";
        const area = Number(e.grossArea ?? 0);
        const vol = Number(e.totalVolume ?? 0);
        const descLower = desc.toLowerCase();

        const applyDerived = (name: string, baseQty: number, rateUSD: number, dUnit: string, source: string, is1200Key: string) => {
          if (baseQty <= 0) return;
          // For Indian projects, use CPWD rate directly if available
          let adjRate: number;
          if (isIndianProject && is1200Key === "rebar" && is1200Module) {
            const rebarRate = is1200Module.getIS1200Rate("IS1200-P6-REBAR-500");
            adjRate = rebarRate ? rebarRate.rate : Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
          } else if (isIndianProject && is1200Key.startsWith("formwork") && is1200Module) {
            // Use CPWD formwork rates (already in INR)
            const fwRates: Record<string, number> = { "formwork-wall": 400, "formwork-slab": 380, "formwork-column": 480, "formwork-beam": 420 };
            adjRate = fwRates[is1200Key] ?? Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
          } else if (isIndianProject && (is1200Key === "plastering" || is1200Key === "ceiling-plaster") && is1200Module) {
            const plastRate = is1200Module.getIS1200Rate("IS1200-P8-PLASTER");
            adjRate = plastRate ? plastRate.rate : Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
          } else {
            adjRate = Math.round(rateUSD * locationFactor * exchangeRate * 100) / 100;
          }

          const waste = 0.05;
          const adjQty = Math.round(baseQty * (1 + waste) * 100) / 100;
          const total = Math.round(adjQty * adjRate * 100) / 100;
          const breakdown = { material: 0.45, labor: 0.50, equipment: 0.05 };
          const matC = Math.round(total * breakdown.material * 100) / 100;
          const labC = Math.round(total * breakdown.labor * 100) / 100;
          const eqpC = Math.round(total * breakdown.equipment * 100) / 100;
          hardCostSubtotal += total;
          totalMaterial += matC; totalLabor += labC; totalEquipment += eqpC;

          const is1200Info = isIndianProject ? DERIVED_IS1200[is1200Key] : null;
          derivedLines.push({
            division: is1200Info?.division ?? source,
            csiCode: is1200Info?.code ?? "00 00 00",
            description: name, unit: dUnit,
            quantity: Math.round(baseQty * 100) / 100, wasteFactor: waste, adjustedQty: adjQty,
            materialRate: Math.round(adjRate * breakdown.material * 100) / 100,
            laborRate: Math.round(adjRate * breakdown.labor * 100) / 100,
            equipmentRate: Math.round(adjRate * breakdown.equipment * 100) / 100,
            unitRate: adjRate, materialCost: matC, laborCost: labC, equipmentCost: eqpC, totalCost: total,
            storey: st || undefined, elementCount: undefined,
            is1200Code: is1200Info?.code,
          });
        };

        if (descLower.includes("wall")) {
          applyDerived(`Formwork — ${desc}`, area * 2, DERIVED_RATES.formwork.wall.rate, "m²", "Formwork (Measured)", "formwork-wall");
          applyDerived(`Rebar — ${desc} (Est.)`, vol * DERIVED_RATES.rebar.wall.kgPerM3, DERIVED_RATES.rebar.wall.rate, "kg", "Rebar (Estimated)", "rebar");
          applyDerived(`Plastering — ${desc}`, area * 2, DERIVED_RATES.finishing.plastering.rate, "m²", "Finishing (Measured)", "plastering");
        } else if (descLower.includes("slab")) {
          applyDerived(`Formwork — ${desc}`, area, DERIVED_RATES.formwork.slab.rate, "m²", "Formwork (Measured)", "formwork-slab");
          applyDerived(`Rebar — ${desc} (Est.)`, vol * DERIVED_RATES.rebar.slab.kgPerM3, DERIVED_RATES.rebar.slab.rate, "kg", "Rebar (Estimated)", "rebar");
          applyDerived(`Ceiling Plaster — ${desc}`, area, DERIVED_RATES.finishing.ceilingPlaster.rate, "m²", "Finishing (Measured)", "ceiling-plaster");
        } else if (descLower.includes("column")) {
          const colHeight = Number(e.totalVolume ?? 0) > 0 ? 3.5 : 0;
          const colRadius = vol > 0 && colHeight > 0 ? Math.sqrt(vol / (Math.PI * colHeight)) : 0.3;
          const colFormworkArea = 2 * Math.PI * colRadius * colHeight * Number(e.elementCount ?? 1);
          applyDerived(`Formwork — ${desc}`, colFormworkArea, DERIVED_RATES.formwork.column.rate, "m²", "Formwork (Measured)", "formwork-column");
          applyDerived(`Rebar — ${desc} (Est.)`, vol * DERIVED_RATES.rebar.column.kgPerM3, DERIVED_RATES.rebar.column.rate, "kg", "Rebar (Estimated)", "rebar");
        }
      }

      // Add derived lines to boqLines
      boqLines.push(...derivedLines);

      // Rebuild rows grouped by storey (if storey data available)
      const hasStoreyData = boqLines.some(l => l.storey && l.storey !== "Unassigned");
      if (hasStoreyData) {
        // Clear inline rows and rebuild grouped
        rows.length = 0;
        const storeyOrder = [...new Set(boqLines.filter(l => l.storey).map(l => l.storey!))];
        // Add lines without storey first
        const unassigned = boqLines.filter(l => !l.storey || l.storey === "Unassigned");
        const cs0 = currencySymbol;

        for (const storey of storeyOrder) {
          const storeyLines = boqLines.filter(l => l.storey === storey);
          if (storeyLines.length === 0) continue;

          rows.push([`── ${storey.toUpperCase()} ──`, "", "", "", "", "", "", "", "", ""]);

          let storeyTotal = 0;
          for (const l of storeyLines) {
            const countLabel = l.elementCount ? ` (${l.elementCount} nr)` : "";
            rows.push([
              `  ${l.description}${countLabel}`, l.unit, l.quantity.toFixed(2),
              `${(l.wasteFactor * 100).toFixed(0)}%`, l.adjustedQty.toFixed(2),
              `${cs0}${l.unitRate.toFixed(2)}`,
              `${cs0}${l.materialCost.toFixed(2)}`, `${cs0}${l.laborCost.toFixed(2)}`,
              `${cs0}${l.equipmentCost.toFixed(2)}`, `${cs0}${l.totalCost.toFixed(2)}`,
            ]);
            storeyTotal += l.totalCost;
          }
          rows.push([`  ${storey} Subtotal`, "", "", "", "", "", "", "", "", `${cs0}${storeyTotal.toFixed(2)}`]);
          rows.push(["", "", "", "", "", "", "", "", "", ""]);
        }

        // Unassigned items
        for (const l of unassigned) {
          rows.push([
            l.description, l.unit, l.quantity.toFixed(2),
            `${(l.wasteFactor * 100).toFixed(0)}%`, l.adjustedQty.toFixed(2),
            `${cs0}${l.unitRate.toFixed(2)}`,
            `${cs0}${l.materialCost.toFixed(2)}`, `${cs0}${l.laborCost.toFixed(2)}`,
            `${cs0}${l.equipmentCost.toFixed(2)}`, `${cs0}${l.totalCost.toFixed(2)}`,
          ]);
        }
      }

      // Hard costs subtotal row
      const cs = currencySymbol;
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push(["HARD COSTS SUBTOTAL", "", "", "", "", "", `${cs}${totalMaterial.toFixed(2)}`, `${cs}${totalLabor.toFixed(2)}`, `${cs}${totalEquipment.toFixed(2)}`, `${cs}${hardCostSubtotal.toFixed(2)}`]);

      // Project type multiplier info
      if (projectTypeInfo.multiplier !== 1.0) {
        rows.push([`Project Type: ${projectTypeInfo.type} (${projectTypeInfo.multiplier}x)`, "", "", "", "", "", "", "", "", "Applied"]);
      }

      // Location factor info
      if (locationFactor !== 1.0) {
        rows.push([`Location: ${locationLabel} (${locationFactor.toFixed(2)}x)`, "", "", "", "", "", "", "", "", "Applied"]);
      }

      // Escalation
      const escalation = calculateEscalation(hardCostSubtotal, escalationRate, escalationMonths);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push([`Cost Escalation (${escalation.annualRate * 100}%/yr, ${escalation.months}mo)`, "", "", "", "", "", "", "", "", `${cs}${escalation.amount.toFixed(2)}`]);

      const hardCostWithEscalation = hardCostSubtotal + escalation.amount;
      rows.push(["HARD COSTS + ESCALATION", "", "", "", "", "", "", "", "", `${cs}${hardCostWithEscalation.toFixed(2)}`]);

      // Soft costs
      const costSummary = calculateTotalCost(hardCostWithEscalation, true, contingencyPct > 0);
      // Override contingency percentage if user specified a custom value
      if (contingencyPct !== 0.10) {
        const contingencyItem = costSummary.breakdown.find(b => b.item === "Contingency");
        if (contingencyItem) {
          const oldAmt = contingencyItem.amount;
          contingencyItem.amount = Math.round(hardCostWithEscalation * contingencyPct * 100) / 100;
          contingencyItem.percentage = Math.round(contingencyPct * 100 * 10) / 10;
          costSummary.softCosts += contingencyItem.amount - oldAmt;
          costSummary.totalCost += contingencyItem.amount - oldAmt;
        }
      }
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push(["SOFT COSTS", "", "", "", "", "", "", "", "", ""]);

      for (const softItem of costSummary.breakdown) {
        rows.push([
          softItem.item, "%", softItem.percentage.toString(), "", "", "", "", "", "",
          `${cs}${softItem.amount.toFixed(2)}`,
        ]);
      }

      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push(["SOFT COSTS SUBTOTAL", "", "", "", "", "", "", "", "", `${cs}${costSummary.softCosts.toFixed(2)}`]);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push(["TOTAL PROJECT COST", "", "", "", "", "", "", "", "", `${cs}${costSummary.totalCost.toFixed(2)}`]);
      rows.push(["", "", "", "", "", "", "", "", "", ""]);
      rows.push([COST_DISCLAIMERS.accuracy, "", "", "", "", "", "", "", "", ""]);

      const warnings: string[] = [];
      if (regionWasAutoDetected) {
        warnings.push("No project location specified — using USA baseline rates. Provide a region/location for accurate regional pricing.");
      }
      if (estimatedItemsCount > 0) {
        warnings.push(`${estimatedItemsCount} items used estimated rates (not in cost database)`);
      }

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "table",
        data: {
          label: `Bill of Quantities${isIndianProject ? " (IS 1200 / CPWD DSR)" : ""} — ${projectTypeInfo.type} (${activeRegion})`,
          headers,
          rows,
          _currency: currencyCode,
          _currencySymbol: currencySymbol,
          _totalCost: costSummary.totalCost,
          _hardCosts: hardCostWithEscalation,
          _softCosts: costSummary.softCosts,
          _escalation: escalation.amount,
          _region: activeRegion,
          _locationFactor: locationFactor,
          _projectType: projectTypeInfo.type,
          _projectMultiplier: projectTypeInfo.multiplier,
          _disclaimer: COST_DISCLAIMERS.full,
          content: `Total: ${cs}${costSummary.totalCost.toFixed(2)} ${currencyCode} (Hard: ${cs}${costSummary.hardCosts.toFixed(2)}, Soft: ${cs}${costSummary.softCosts.toFixed(2)}) | Region: ${activeRegion} | Type: ${projectTypeInfo.type}`,
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
      const currencyCode = String(inputData?._currency ?? "USD");
      const currencySymbol = String(inputData?._currencySymbol ?? "$");

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
        ["", `Escalation amount: ${currencySymbol}${escalationAmt.toLocaleString()}`],
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
        // Add IS 1200 code column for Indian projects
        const hasIS1200 = boqLines.some(l => (l as Record<string, unknown>).is1200Code);
        const boqHeaders = hasIS1200
          ? [
              "IS 1200 Code", "Division", "Description", "Unit",
              "Base Qty", "Waste %", "Adj Qty",
              "Material Rate", "Labor Rate", "Equip Rate", "Unit Rate",
              "Material Cost", "Labor Cost", "Equip Cost", "Total Cost",
            ]
          : [
              "Division", "Description", "Unit",
              "Base Qty", "Waste %", "Adj Qty",
              "Material Rate", "Labor Rate", "Equip Rate", "Unit Rate",
              "Material Cost", "Labor Cost", "Equip Cost", "Total Cost",
            ];

        // Group by storey (if available), then by division within each storey
        const hasStoreys = boqLines.some(l => (l as Record<string, unknown>).storey && (l as Record<string, unknown>).storey !== "Unassigned");
        const boqTableRows: (string | number)[][] = [];

        if (hasStoreys) {
          // Storey-grouped layout
          const storeyOrder = [...new Set(boqLines.filter(l => (l as Record<string, unknown>).storey).map(l => (l as Record<string, unknown>).storey as string))];

          for (const storey of storeyOrder) {
            const storeyLines = boqLines.filter(l => (l as Record<string, unknown>).storey === storey);
            if (storeyLines.length === 0) continue;

            // Storey header
            const emptyRow = hasIS1200 ? ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""] : ["", "", "", "", "", "", "", "", "", "", "", "", "", ""];
            boqTableRows.push([storey.toUpperCase(), ...emptyRow.slice(1)]);

            let storeyMat = 0, storeyLab = 0, storeyEqp = 0, storeyTot = 0;
            for (const l of storeyLines) {
              const wastePercent = l.wasteFactor ? `${(l.wasteFactor * 100).toFixed(0)}%` : "—";
              const adjQty = l.adjustedQty ?? l.quantity;
              const countLabel = (l as Record<string, unknown>).elementCount ? ` (${(l as Record<string, unknown>).elementCount} nr)` : "";
              const baseRow = [
                "", `${l.description}${countLabel}`, l.unit,
                l.quantity, wastePercent, adjQty,
                l.materialRate, l.laborRate, l.equipmentRate, l.unitRate,
                l.materialCost, l.laborCost, l.equipmentCost, l.totalCost,
              ];
              if (hasIS1200) baseRow.unshift((l as Record<string, unknown>).is1200Code as string ?? "");
              boqTableRows.push(baseRow);
              storeyMat += l.materialCost; storeyLab += l.laborCost;
              storeyEqp += l.equipmentCost; storeyTot += l.totalCost;
            }

            boqTableRows.push([
              "", `${storey} Subtotal`, "", "", "", "",
              "", "", "", "",
              Math.round(storeyMat * 100) / 100, Math.round(storeyLab * 100) / 100,
              Math.round(storeyEqp * 100) / 100, Math.round(storeyTot * 100) / 100,
            ]);
            boqTableRows.push(["", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
          }
        } else {
          // Flat division-grouped layout (backward compatible)
          const divisionGroups = new Map<string, typeof boqLines>();
          for (const line of boqLines) {
            const div = line.division || "General";
            if (!divisionGroups.has(div)) divisionGroups.set(div, []);
            divisionGroups.get(div)!.push(line);
          }

          for (const [divName, lines] of divisionGroups) {
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
              divMaterial += l.materialCost; divLabor += l.laborCost;
              divEquip += l.equipmentCost; divTotal += l.totalCost;
            }

            boqTableRows.push([
              "", `${divName} Subtotal`, "", "", "", "",
              "", "", "", "",
              Math.round(divMaterial * 100) / 100, Math.round(divLabor * 100) / 100,
              Math.round(divEquip * 100) / 100, Math.round(divTotal * 100) / 100,
            ]);
            boqTableRows.push(["", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
          }
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
        ["COST BREAKDOWN BY TYPE", "", `Amount (${currencyCode})`, "% of Hard Costs"],
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
          content: `BOQ Export: ${boqLines.length} line items across 4 sheets. Grand Total: ${currencySymbol}${(boqData?.grandTotal ?? 0).toLocaleString()} ${currencyCode}. ${COST_DISCLAIMERS.accuracy}`,
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

      logger.debug("========== GN-009 VIDEO WALKTHROUGH START ==========");
      logger.debug("[GN-009] All input keys:", Object.keys(inputData ?? {}));
      logger.debug("[GN-009] fileData present:", !!(inputData?.fileData));
      logger.debug("[GN-009] fileData length:", typeof inputData?.fileData === "string" ? inputData.fileData.length : 0);
      logger.debug("[GN-009] imageUrl present:", !!(inputData?.imageUrl));
      logger.debug("[GN-009] url present:", !!(inputData?.url));
      logger.debug("[GN-009] svg present:", !!(inputData?.svg));
      logger.debug("[GN-009] content (buildingDesc) present:", !!(inputData?.content));
      logger.debug("[GN-009] content value:", JSON.stringify(inputData?.content)?.slice(0, 200));
      logger.debug("[GN-009] description present:", !!(inputData?.description));
      logger.debug("[GN-009] mimeType:", inputData?.mimeType);
      logger.debug("[GN-009] KLING_ACCESS_KEY set:", !!process.env.KLING_ACCESS_KEY, "KLING_SECRET_KEY set:", !!process.env.KLING_SECRET_KEY);

      const hasKlingKeys = !!(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);

      // ── Resolve the SOURCE IMAGE for Kling (priority order) ──
      let renderImageUrl = "";
      let isFloorPlanInput = false;
      let isRenovationInput = false; // true when user uploaded building photos (IN-008) — triggers renovation prompts
      let roomInfo = "";

      logger.debug("[KLING] Step 1: fileData present:", !!(inputData?.fileData), "size:", typeof inputData?.fileData === "string" ? inputData.fileData.length : 0);
      logger.debug("[KLING] Step 1: url present:", !!(inputData?.url), "imageUrl present:", !!(inputData?.imageUrl), "svg present:", !!(inputData?.svg));

      // ── Priority 1: Direct image upload from IN-003/IN-008 (original user file) ──
      // FIX F: Send base64 directly to Kling API — no temp-image URL needed.
      // Kling's image field accepts both URLs and base64 encoded strings.
      // Skip non-image files (PDFs, docs) — they should use text2video path instead.
      const inputMimeType = (inputData?.mimeType as string) ?? "";
      const isImageFile = inputMimeType.startsWith("image/") || !inputMimeType;
      if (inputData?.fileData && typeof inputData.fileData === "string" && isImageFile) {
        const imgMime = inputMimeType || "image/jpeg";
        const rawImg = inputData.fileData as string;
        const cleanBase64 = rawImg.startsWith("data:") ? rawImg.split(",")[1] ?? rawImg : rawImg;

        logger.debug("[KLING] Step 2: Clean base64 length:", cleanBase64.length, "mime:", imgMime);

        // Strategy: R2 URL (if configured) → raw base64 directly to Kling
        // Try R2 first (if configured) — a URL is fastest for Kling
        try {
          const { uploadToR2, isR2Configured } = await import("@/lib/r2");
          if (isR2Configured()) {
            logger.debug("[KLING] Step 2a: R2 is configured, uploading...");
            const ext = imgMime.includes("png") ? "png" : "jpg";
            const imgBuffer = Buffer.from(cleanBase64, "base64");
            const uploadResult = await uploadToR2(imgBuffer, `building-photo-${generateId()}.${ext}`, imgMime);
            if (uploadResult.success) {
              renderImageUrl = uploadResult.url;
              logger.debug("[KLING] Step 2a: R2 upload succeeded:", renderImageUrl);
            }
          } else {
            logger.debug("[KLING] Step 2a: R2 not configured, skipping");
          }
        } catch (r2Err) {
          console.warn("[KLING] Step 2a: R2 upload failed:", r2Err);
        }

        // FIX F: Send raw base64 directly to Kling (skip temp-image entirely)
        if (!renderImageUrl) {
          logger.debug("[KLING] Step 2b: Sending base64 DIRECTLY to Kling (Fix F — no temp-image URL)");
          renderImageUrl = cleanBase64;
          logger.debug("[KLING] Step 2b: Using raw base64, length:", cleanBase64.length);
        }

        // Only mark as floor plan if TR-004 analysis flagged it or if upstream says so.
        // Building photos from IN-008 are NOT floor plans — they should use image2video path.
        const upstreamIsFloorPlan = !!(inputData?.isFloorPlan);
        isFloorPlanInput = upstreamIsFloorPlan;

        // Building photos from IN-008 trigger renovation prompts —
        // transform the old/existing building into a modernized, polished version.
        // Detect via isMultiImage flag (set by IN-008 handler) or absence of floor plan flag.
        if (!upstreamIsFloorPlan) {
          isRenovationInput = !!(inputData?.isMultiImage) || !!(inputData?.fileDataArray);
        }
      }

      // ── Priority 2: Floor plan SVG from GN-004 ──
      // FIX F: Convert SVG→PNG, then send base64 directly to Kling.
      if (!renderImageUrl && inputData?.svg && typeof inputData.svg === "string") {
        logger.debug("[KLING] Step 2 (SVG): Floor plan SVG detected, converting to PNG...");
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
              logger.debug("[KLING] Step 2 (SVG): R2 upload:", renderImageUrl);
            } else {
              console.warn("[KLING] Step 2 (SVG): R2 upload failed:", uploadResult.error);
            }
          }

          // FIX F: Send PNG base64 directly to Kling (skip temp-image)
          if (!renderImageUrl) {
            logger.debug("[KLING] Step 2 (SVG): Sending PNG base64 DIRECTLY to Kling (Fix F)");
            renderImageUrl = pngBuffer.toString("base64");
            logger.debug("[KLING] Step 2 (SVG): Using raw base64, length:", renderImageUrl.length);
          }
          isFloorPlanInput = true;
        } catch (svgErr) {
          console.warn("[KLING] Step 2 (SVG): SVG→PNG conversion failed:", svgErr);
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
          logger.debug("[KLING] Step 2 (Priority 3): Using upstream URL:", renderImageUrl.slice(0, 120));
        }
      }

      // Build video from building description (from upstream TR-004 or fallback)
      // Use original PDF text (_raw.rawText) as source of truth when available
      const buildingDesc = originalPdfText
        ?? (inputData?.content as string)
        ?? (inputData?.description as string)
        ?? (inputData?.prompt as string)
        ?? "Modern architectural building";

      // Pick up roomInfo from TR-004 output (GPT-4o extracted rooms) or SVG roomList
      if (!roomInfo && inputData?.roomInfo && typeof inputData.roomInfo === "string") {
        roomInfo = inputData.roomInfo as string;
        logger.debug("[GN-009] roomInfo from TR-004 (GPT-4o):", roomInfo.slice(0, 300));
      }

      // Also pick up layoutDescription from TR-004
      const layoutDescription = (inputData?.layoutDescription as string) ?? "";

      // Fallback renovation detection: if we have building photo data specifically from IN-008
      // (identified by isMultiImage or fileDataArray flags) and it's not a floor plan.
      // DO NOT match IN-003 single image uploads — those use standard prompts.
      if (!isRenovationInput && !isFloorPlanInput) {
        const hasMultiImageMarker = !!(inputData?.isMultiImage) || !!(inputData?.fileDataArray);
        if (hasMultiImageMarker) {
          isRenovationInput = true;
          logger.debug("[GN-009] Fallback: detected IN-008 multi-image markers → enabling renovation mode");
        }
      }

      logger.debug("===== GN-009 VIDEO DEBUG =====");
      logger.debug("[GN-009] All inputData keys:", Object.keys(inputData ?? {}));
      logger.debug("[GN-009] buildingDescription:", JSON.stringify(buildingDesc)?.slice(0, 800));
      logger.debug("[GN-009] roomInfo:", JSON.stringify(roomInfo)?.slice(0, 800));
      logger.debug("[GN-009] layoutDescription:", JSON.stringify(layoutDescription)?.slice(0, 500));
      logger.debug("[GN-009] isFloorPlan:", isFloorPlanInput);
      logger.debug("[GN-009] isRenovation:", isRenovationInput);
      logger.debug("[GN-009] isMultiImage:", !!(inputData?.isMultiImage));
      logger.debug("[GN-009] fileDataArray:", !!(inputData?.fileDataArray));
      logger.debug("[GN-009] renderImageUrl resolved:", renderImageUrl ? renderImageUrl.slice(0, 120) : "EMPTY");
      logger.debug("==============================");

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

        logger.debug("[GN-009] About to call video function:");
        logger.debug("[GN-009] Image being passed (first 100 chars):", renderImageUrl?.slice(0, 100));
        logger.debug("[GN-009] Image type:", renderImageUrl?.startsWith("http") ? "URL" : renderImageUrl?.startsWith("data:") ? "data URI" : "raw base64");
        logger.debug("[GN-009] Image total length:", renderImageUrl?.length);
        logger.debug("[GN-009] Mode: pro");
        logger.debug("[GN-009] isFloorPlan flag:", isFloorPlanInput);
        logger.debug("[GN-009] buildingDesc (first 200 chars):", buildingDesc?.slice(0, 200));

        try {
          if (isFloorPlanInput) {
            // ── Floor plan video: tries Kling 3.0 Omni (12s) → fallback v2.6 (10s) ──
            logger.debug("[GN-009] Function: submitFloorPlanWalkthrough (Omni v3 12s → fallback v2.6 10s)");
            logger.debug("[GN-009] buildFloorPlanCombinedPrompt args — buildingDesc length:", buildingDesc?.length, "roomInfo length:", roomInfo?.length);
            const combinedPrompt = buildFloorPlanCombinedPrompt(buildingDesc, roomInfo);
            logger.debug("[GN-009] FINAL PROMPT SENT TO KLING:", combinedPrompt?.slice(0, 1500));

            const submitted = await submitFloorPlanWalkthrough(renderImageUrl, combinedPrompt, "pro");

            logger.debug("[GN-009] Floor plan task submitted! taskId:", submitted.taskId, "usedOmni:", submitted.usedOmni, "duration:", submitted.durationSeconds);

            artifact = {
              id: generateId(),
              executionId: executionId ?? "local",
              tileInstanceId,
              type: "video",
              data: {
                name: `walkthrough_${generateId()}.mp4`,
                videoUrl: "",
                downloadUrl: "",
                label: submitted.usedOmni
                  ? `Floor Plan → Kling 3.0 Walkthrough — ${submitted.durationSeconds}s (generating...)`
                  : `Floor Plan → Cinematic Walkthrough — ${submitted.durationSeconds}s (generating...)`,
                content: `${submitted.durationSeconds}s AEC walkthrough: exterior + interior in one continuous shot — ${buildingDesc.slice(0, 100)}`,
                durationSeconds: submitted.durationSeconds,
                shotCount: 1,
                pipeline: submitted.usedOmni
                  ? `floor plan → Kling 3.0 Omni (pro, ${submitted.durationSeconds}s) → MP4`
                  : `floor plan → Kling v2.6 (pro, ${submitted.durationSeconds}s) → MP4`,
                costUsd: submitted.durationSeconds * 0.10,
                videoGenerationStatus: "processing",
                taskId: submitted.taskId,
                generationProgress: 0,
                isFloorPlanInput: true,
                usedOmni: submitted.usedOmni,
              },
              metadata: {
                engine: "kling-official",
                real: true,
                taskId: submitted.taskId,
                submittedAt: submitted.submittedAt,
                isFloorPlanInput: true,
                usedOmni: submitted.usedOmni,
              },
              createdAt: new Date(),
            };
            logger.debug("[GN-009] Artifact data.taskId:", submitted.taskId);
            logger.debug("[GN-009] Artifact data.usedOmni:", submitted.usedOmni);
            logger.debug("[GN-009] Artifact data.durationSeconds:", submitted.durationSeconds);
          } else {
            // ── DUAL video for non-floor-plan (concept renders or building photos) ──
            logger.debug("[GN-009] Function: submitDualWalkthrough (dual 5s+10s), isRenovation:", isRenovationInput);

            // ── RENOVATION PATH: Generate a DALL-E 3 renovation render first ──
            // Kling image2video preserves the source image too faithfully — old cracked
            // walls stay cracked. So for building photo inputs, we first generate a
            // DALL-E 3 "renovated" version of the building, then feed THAT to Kling.
            let klingSourceImage = renderImageUrl;
            let renovationRenderUrl: string | undefined;

            // Use env OPENAI_API_KEY as fallback when user doesn't have a personal key
            const dalleKey = apiKey || process.env.OPENAI_API_KEY || undefined;

            // Get the original building photo base64 for GPT-4o vision
            // This is the actual image the user uploaded — GPT-4o will SEE it
            // and write a DALL-E prompt that preserves the exact building geometry.
            const originalPhotoBase64 = (inputData?.fileData as string) ?? "";
            const originalPhotoMime = (inputData?.mimeType as string) ?? "image/jpeg";

            if (isRenovationInput && dalleKey && originalPhotoBase64) {
              logger.debug("[GN-009] Renovation: GPT-4o will analyze the ACTUAL photo → write DALL-E prompt → render");
              logger.debug("[GN-009] Original photo base64 length:", originalPhotoBase64.length);
              logger.debug("[GN-009] Building analysis:", buildingDesc.slice(0, 300));

              try {
                // Step 1: GPT-4o SEES the building photo → writes precise DALL-E prompt
                // Step 2: DALL-E 3 renders the renovated version from that prompt
                // The result looks like the SAME building but completely renovated.
                const dalleResult = await generateRenovationRender(
                  originalPhotoBase64.startsWith("data:") ? originalPhotoBase64.split(",")[1] ?? originalPhotoBase64 : originalPhotoBase64,
                  buildingDesc,
                  originalPhotoMime,
                  dalleKey,
                );

                if (dalleResult.url) {
                  renovationRenderUrl = dalleResult.url;
                  klingSourceImage = dalleResult.url;
                  logger.debug("[GN-009] Renovation render SUCCESS! URL:", dalleResult.url.slice(0, 100));
                  logger.debug("[GN-009] GPT-4o renovation prompt:", dalleResult.renovationPrompt.slice(0, 200));
                }
              } catch (dalleErr) {
                // Non-fatal — fall back to original image for Kling
                console.warn("[GN-009] Renovation render failed, falling back to original photo:", dalleErr);
              }
            } else if (isRenovationInput) {
              logger.debug("[GN-009] Renovation skipped — missing:", !dalleKey ? "OPENAI_API_KEY" : "originalPhotoBase64");
            }

            const submitted = await submitDualWalkthrough(klingSourceImage, buildingDesc, "pro", {
              isRenovation: isRenovationInput,
            });

            logger.debug("[GN-009] Dual tasks submitted! exterior:", submitted.exteriorTaskId, "interior:", submitted.interiorTaskId);

            const videoLabel = isRenovationInput
              ? "Building Renovation Walkthrough — 15s (generating...)"
              : "AEC Cinematic Walkthrough — 15s (generating...)";
            const videoContent = isRenovationInput
              ? `15s renovation walkthrough: 5s exterior transformation + 10s renovated interior — ${buildingDesc.slice(0, 100)}`
              : `15s AEC walkthrough: 5s exterior + 10s interior — ${buildingDesc.slice(0, 100)}`;
            const videoPipelineLabel = isRenovationInput
              ? "building photo → DALL-E 3 renovation render → Kling Official API (pro, image2video) → 2x MP4 video"
              : "concept render → Kling Official API (pro, image2video) → 2x MP4 video";

            artifact = {
              id: generateId(),
              executionId: executionId ?? "local",
              tileInstanceId,
              type: "video",
              data: {
                name: `walkthrough_${generateId()}.mp4`,
                videoUrl: "",
                downloadUrl: "",
                label: videoLabel,
                content: videoContent,
                durationSeconds: 15,
                shotCount: 2,
                pipeline: videoPipelineLabel,
                costUsd: isRenovationInput ? 1.54 : 1.50, // +$0.04 for DALL-E 3 HD render
                segments: [],
                videoGenerationStatus: "processing",
                videoPipeline: "image2video",
                exteriorTaskId: submitted.exteriorTaskId,
                interiorTaskId: submitted.interiorTaskId,
                generationProgress: 0,
                isFloorPlanInput: false,
                isRenovation: isRenovationInput,
                ...(renovationRenderUrl && { renovationRenderUrl }),
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
          logger.debug("========== GN-009 VIDEO WALKTHROUGH END ==========");
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
        logger.debug("[GN-009] Text2Video — using original PDF text as source of truth");
        logger.debug("[GN-009] Source:", originalPdfText ? "rawText from PDF" : "fallback content");
        logger.debug("[GN-009] Prompt length:", buildingDesc.length, "chars");
        logger.debug("[GN-009] First 200 chars:", buildingDesc.slice(0, 200));

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

    } else if (catalogueId === "GN-011") {
      // ── Interactive 3D Viewer ────────────────────────────────────────────
      // Generates a self-contained Three.js HTML file from floor plan geometry.
      // Uses absolute x,y positions from GPT-4o → rooms tile together with no gaps.

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawGeometry = (inputData?.geometry ?? (inputData?._raw as Record<string, unknown>)?.geometry ?? null) as Record<string, unknown> | null;

      type LayoutRoom = { name: string; type: string; width: number; depth: number; x: number; y: number; adjacentRooms?: string[]; polygon?: [number, number][]; area?: number };

      // Guess room type from name — comprehensive fuzzy matching for any floor plan
      function guessType(name: string): string {
        const n = name.toLowerCase();
        if (n.includes("living") || n.includes("lounge") || n.includes("drawing") || n.includes("sitting") || n.includes("family room") || n.includes("movie") || n.includes("cinema") || n.includes("theater") || n.includes("theatre") || n.includes("media")) return "living";
        if (n.includes("bed") || n.includes("master") || n.includes("guest bed") || n.includes("nursery")) return "bedroom";
        if (n.includes("kitchen") || n.includes("pantry") || n.includes("kitchenette")) return "kitchen";
        if (n.includes("dining") || n.includes("nook") || n.includes("dinette") || n.includes("breakfast")) return "dining";
        if (n.includes("bath") || n.includes("toilet") || n.includes("wc") || n.includes("powder") || n.includes("lavatory") || n.includes("washroom") || n.includes("restroom") || n.includes("shower") || /t\s*&\s*b/i.test(n) || /\bc\.?\s*b\b/i.test(n)) return "bathroom";
        if (n.includes("verand") || n.includes("porch")) return "veranda";
        if (n.includes("balcon")) return "balcony";
        if (n.includes("hall") || n.includes("corridor") || n.includes("lobby")) return "hallway";
        if (n.includes("passage") || n.includes("foyer")) return "passage";
        if (n.includes("office") || n.includes("study") || n.includes("den") || n.includes("workspace")) return "office";
        if (n.includes("store") || n.includes("storage") || n.includes("cellar") || n.includes("garage") || n.includes("shed") || n.includes("carport")) return "storage";
        if (n.includes("closet") || n.includes("wardrobe") || n.includes("dressing") || n.includes("hanging")) return "closet";
        if (n.includes("utility") || n.includes("laundry") || n.includes("mechanical")) return "utility";
        if (n.includes("patio") || n.includes("terrace") || n.includes("deck") || n.includes("courtyard")) return "patio";
        if (n.includes("entrance") || n.includes("entry") || /\bentr\b/.test(n)) return "entrance";
        if (n.includes("stair") || n.includes("steps")) return "staircase";
        if (n.includes("studio")) return "studio";
        if (n.includes("gym") || n.includes("spa") || n.includes("sauna") || n.includes("workout")) return "living";
        if (n.includes("light well") || n.includes("shaft") || n.includes("void")) return "other";
        // Compound names (Kitchen/Living → try each part)
        const parts = n.split(/[\/,&+]/);
        if (parts.length > 1) {
          for (const part of parts) {
            const sub = guessType(part.trim());
            if (sub !== "other") return sub;
          }
        }
        return "other";
      }

      // ── Convert row-based layout to positioned rooms ──
      function rowsToPositions(rows: Array<Array<Record<string, unknown>>>): { rooms: LayoutRoom[]; width: number; depth: number } {
        const result: LayoutRoom[] = [];
        let currentY = 0;
        let maxRowWidth = 0;

        for (const row of rows) {
          if (!Array.isArray(row) || row.length === 0) continue;
          // Row height = max depth of rooms in this row
          const rowDepth = Math.max(...row.map(r => Math.max(1.0, Number(r.depth ?? 3))));
          let currentX = 0;

          for (const room of row) {
            const w = Math.max(1.0, Number(room.width ?? 3));
            const name = String(room.name ?? "Room");
            result.push({
              name,
              type: String(room.type ?? guessType(name)),
              width: w,
              depth: rowDepth,
              x: currentX,
              y: currentY,
              adjacentRooms: Array.isArray(room.adjacentRooms) ? (room.adjacentRooms as string[]) : undefined,
            });
            currentX += w;
          }

          if (currentX > maxRowWidth) maxRowWidth = currentX;
          currentY += rowDepth;
        }

        return { rooms: result, width: maxRowWidth, depth: currentY };
      }

      const layoutRooms: LayoutRoom[] = [];
      let bW = Number(rawGeometry?.buildingWidth ?? 14);
      let bD = Number(rawGeometry?.buildingDepth ?? 10);

      // ── Priority 0: GPT-4o ACCURATE positions (percentage-based) ──
      // If rooms have positionLeftPercent/positionTopPercent, convert to meters.
      // This is far more accurate than the row-based grid layout.
      const rawRows = rawGeometry?.rows as Array<Array<Record<string, unknown>>> | undefined;
      const allRoomsFlat: Array<Record<string, unknown>> = [];
      if (Array.isArray(rawRows)) {
        for (const row of rawRows) {
          if (Array.isArray(row)) for (const rm of row) allRoomsFlat.push(rm);
        }
      }
      const hasPercentPositions = allRoomsFlat.length > 0 &&
        allRoomsFlat.filter(r => typeof r.positionLeftPercent === "number" && typeof r.positionTopPercent === "number").length >= allRoomsFlat.length * 0.6;

      if (hasPercentPositions) {
        logger.debug(`[GN-011] Using GPT-4o ACCURATE positions (${allRoomsFlat.length} rooms with percentage coordinates)`);
        for (const r of allRoomsFlat) {
          const name = String(r.name ?? "Room");
          const w = Math.max(1.0, Number(r.width ?? 3));
          const d = Math.max(1.0, Number(r.depth ?? 3));
          const leftPct = Number(r.positionLeftPercent ?? 0);
          const topPct = Number(r.positionTopPercent ?? 0);
          const x = Math.round(((leftPct / 100) * bW) * 100) / 100;
          const y = Math.round(((topPct / 100) * bD) * 100) / 100;
          layoutRooms.push({
            name,
            type: String(r.type ?? guessType(name)),
            width: w,
            depth: d,
            x,
            y,
            adjacentRooms: Array.isArray(r.adjacentRooms) ? (r.adjacentRooms as string[]) : undefined,
          });
        }

        // ── Overlap resolution: nudge overlapping rooms apart ──
        for (let i = 0; i < layoutRooms.length; i++) {
          for (let j = i + 1; j < layoutRooms.length; j++) {
            const a = layoutRooms[i], b = layoutRooms[j];
            const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
            if (overlapX > 0.2 && overlapY > 0.2) {
              logger.debug(`[GN-011] Overlap: ${a.name} & ${b.name} (${overlapX.toFixed(1)}×${overlapY.toFixed(1)}m) — nudging`);
              const smaller = (a.width * a.depth) < (b.width * b.depth) ? a : b;
              const larger = smaller === a ? b : a;
              if (overlapX < overlapY) {
                smaller.x = smaller.x < larger.x
                  ? larger.x - smaller.width - 0.15
                  : larger.x + larger.width + 0.15;
              } else {
                smaller.y = smaller.y < larger.y
                  ? larger.y - smaller.depth - 0.15
                  : larger.y + larger.depth + 0.15;
              }
            }
          }
        }

        // Clamp rooms within building bounds
        for (const rm of layoutRooms) {
          rm.x = Math.max(0, Math.min(rm.x, bW - rm.width));
          rm.y = Math.max(0, Math.min(rm.y, bD - rm.depth));
        }

        // Log positions for debugging
        logger.debug("[GN-011] Room positions (accurate):");
        for (const rm of layoutRooms) {
          const origR = allRoomsFlat.find(r => r.name === rm.name);
          logger.debug(`  ${rm.name}: x=${rm.x.toFixed(1)} y=${rm.y.toFixed(1)} ${rm.width}×${rm.depth}m (from ${origR?.positionLeftPercent ?? "?"}%, ${origR?.positionTopPercent ?? "?"}%)`);
        }
      }

      // ── Priority 1: Row-based layout from GPT-4o (fallback) ──
      if (layoutRooms.length === 0 && Array.isArray(rawRows) && rawRows.length > 0) {
        logger.debug(`[GN-011] Using ROW-BASED layout: ${rawRows.length} rows`);
        const result = rowsToPositions(rawRows);
        for (const rm of result.rooms) layoutRooms.push(rm);
        bW = result.width;
        bD = result.depth;
      }

      // ── Priority 2: Legacy x,y positioned rooms ──
      if (layoutRooms.length === 0) {
        const rawRooms = (rawGeometry?.rooms ?? []) as Array<Record<string, unknown>>;
        for (let idx = 0; idx < rawRooms.length; idx++) {
          const r = rawRooms[idx];
          const hasXY = r.x !== undefined && r.y !== undefined;
          const name = String(r.name ?? "Room");
          layoutRooms.push({
            name,
            type: String(r.type ?? guessType(name)),
            width: Math.max(1.0, Number(r.width ?? 3)),
            depth: Math.max(1.0, Number(r.depth ?? 3)),
            x: hasXY ? Number(r.x) : Number(r.col ?? (idx % 3)) * 3.5,
            y: hasXY ? Number(r.y) : Number(r.row ?? Math.floor(idx / 3)) * 3.5,
            adjacentRooms: Array.isArray(r.adjacentRooms) ? (r.adjacentRooms as string[]) :
                           Array.isArray(r.connections) ? (r.connections as string[]) : undefined,
            polygon: Array.isArray(r.polygon) ? (r.polygon as [number, number][]) : undefined,
            area: typeof r.area === "number" ? r.area : undefined,
          });
        }
      }

      // ── Priority 3: Reconstruct from richRooms/rooms (no geometry at all) ──
      if (layoutRooms.length === 0) {
        const basicRooms = (inputData?.rooms ?? []) as Array<Record<string, unknown>>;
        const richRoomsArr = (inputData?.richRooms ?? []) as Array<Record<string, unknown>>;
        const fallbackSource = richRoomsArr.length > basicRooms.length ? richRoomsArr : basicRooms;

        if (fallbackSource.length > 0) {
          console.warn(`[GN-011] No geometry — reconstructing from ${fallbackSource.length} rooms`);
          // Build rows: 3 rooms per row
          const fakeRows: Array<Array<Record<string, unknown>>> = [];
          let currentRow: Array<Record<string, unknown>> = [];
          for (const fr of fallbackSource) {
            const name = String(fr.name ?? "Room");
            const dimStr = String(fr.dimensions ?? "");
            const dimMatch = dimStr.match(/(\d+\.?\d*)\s*m?\s*[x×X]\s*(\d+\.?\d*)/i);
            currentRow.push({
              name,
              type: String(fr.type ?? guessType(name)),
              width: dimMatch ? Math.max(1.0, parseFloat(dimMatch[1])) : 3,
              depth: dimMatch ? Math.max(1.0, parseFloat(dimMatch[2])) : 3,
              adjacentRooms: Array.isArray(fr.connections) ? fr.connections : undefined,
            });
            if (currentRow.length >= 3) { fakeRows.push(currentRow); currentRow = []; }
          }
          if (currentRow.length > 0) fakeRows.push(currentRow);
          const result = rowsToPositions(fakeRows);
          for (const rm of result.rooms) layoutRooms.push(rm);
          bW = result.width;
          bD = result.depth;
        }
      }

      // ── Priority 4: Hardcoded fallback (only when everything fails) ──
      if (layoutRooms.length < 2) {
        console.warn(`[GN-011] Only ${layoutRooms.length} rooms — using hardcoded fallback`);
        layoutRooms.length = 0;
        const fallbackRows = [
          [
            { name: "Veranda", type: "veranda", width: 1.8, depth: 3.6, adjacentRooms: ["Living Room"] },
            { name: "Living Room", type: "living", width: 3.2, depth: 3.6, adjacentRooms: ["Veranda", "Dining", "Hallway"] },
            { name: "Dining", type: "dining", width: 3.2, depth: 3.6, adjacentRooms: ["Living Room", "Kitchen"] },
            { name: "Kitchen", type: "kitchen", width: 3.2, depth: 3.6, adjacentRooms: ["Dining"] },
          ],
          [
            { name: "Hallway", type: "hallway", width: 11.4, depth: 1.5, adjacentRooms: ["Living Room", "Bedroom 3", "Bedroom 2", "Bedroom 1"] },
          ],
          [
            { name: "Bedroom 3", type: "bedroom", width: 4.1, depth: 3.5, adjacentRooms: ["Hallway"] },
            { name: "Bath", type: "bathroom", width: 2.0, depth: 3.5, adjacentRooms: ["Hallway"] },
            { name: "Bedroom 2", type: "bedroom", width: 3.0, depth: 3.5, adjacentRooms: ["Hallway"] },
            { name: "Bedroom 1", type: "bedroom", width: 2.3, depth: 3.5, adjacentRooms: ["Hallway"] },
          ],
        ];
        const result = rowsToPositions(fallbackRows as unknown as Array<Array<Record<string, unknown>>>);
        for (const rm of result.rooms) layoutRooms.push(rm);
        bW = result.width;
        bD = result.depth;
      }

      // ── Edge snapping: close small gaps between rooms ──
      function snapEdges(rooms: LayoutRoom[]) {
        const TOL = 0.4;
        for (let i = 0; i < rooms.length; i++) {
          for (let j = i + 1; j < rooms.length; j++) {
            const a = rooms[i], b = rooms[j];
            const gapH = b.x - (a.x + a.width);
            if (gapH > 0.01 && gapH < TOL) a.width += gapH;
            const gapH2 = a.x - (b.x + b.width);
            if (gapH2 > 0.01 && gapH2 < TOL) b.width += gapH2;
            const gapV = b.y - (a.y + a.depth);
            if (gapV > 0.01 && gapV < TOL) a.depth += gapV;
            const gapV2 = a.y - (b.y + b.depth);
            if (gapV2 > 0.01 && gapV2 < TOL) b.depth += gapV2;
          }
        }
      }
      snapEdges(layoutRooms);

      // Compute actual building size from placed rooms
      let maxX = 0, maxZ = 0;
      for (const rm of layoutRooms) {
        const rx = rm.x + rm.width;
        const rz = rm.y + rm.depth;
        if (rx > maxX) maxX = rx;
        if (rz > maxZ) maxZ = rz;
      }
      const finalW = Math.max(bW, maxX);
      const finalD = Math.max(bD, maxZ);

      logger.debug(`[GN-011] ${layoutRooms.length} rooms, building ${finalW.toFixed(1)}x${finalD.toFixed(1)}m`);
      for (const rm of layoutRooms) {
        logger.debug(`  ${rm.name}: x=${rm.x.toFixed(1)} y=${rm.y.toFixed(1)} ${rm.width.toFixed(1)}x${rm.depth.toFixed(1)}m (${rm.type})`);
      }

      // Build FloorPlanGeometry — center derived from x,y
      const fpRooms = layoutRooms.map((rm) => ({
        name: rm.name,
        center: [rm.x + rm.width / 2, rm.y + rm.depth / 2] as [number, number],
        width: rm.width,
        depth: rm.depth,
        type: rm.type as import("@/types/floor-plan").FloorPlanRoomType,
        x: rm.x,
        y: rm.y,
        adjacentRooms: rm.adjacentRooms,
        polygon: rm.polygon,
        area: rm.area,
      }));

      // Walls: use SVG-parsed walls if available, otherwise generate perimeter
      const geometryWalls = rawGeometry?.walls as Array<{ start: [number, number]; end: [number, number]; thickness: number; type: "exterior" | "interior" }> | undefined;
      const fpWalls: Array<{ start: [number, number]; end: [number, number]; thickness: number; type: "exterior" | "interior" }> =
        (Array.isArray(geometryWalls) && geometryWalls.length > 4)
          ? geometryWalls
          : [
              { start: [0, 0], end: [finalW, 0], thickness: 0.2, type: "exterior" },
              { start: [finalW, 0], end: [finalW, finalD], thickness: 0.2, type: "exterior" },
              { start: [finalW, finalD], end: [0, finalD], thickness: 0.2, type: "exterior" },
              { start: [0, finalD], end: [0, 0], thickness: 0.2, type: "exterior" },
            ];

      // Pass through building shape + outline for non-rectangular buildings
      const buildingShape = rawGeometry?.buildingShape as string | undefined;
      const buildingOutline = rawGeometry?.buildingOutline as [number, number][] | undefined;

      const fpGeometry: import("@/types/floor-plan").FloorPlanGeometry = {
        footprint: { width: finalW, depth: finalD },
        wallHeight: 2.8,
        walls: fpWalls,
        doors: [],
        windows: [],
        rooms: fpRooms,
        ...(buildingShape && { buildingShape }),
        ...(buildingOutline && { buildingOutline }),
      };

      const { buildFloorPlan3D } = await import("@/services/threejs-builder");

      // Fetch source image for image-as-floor approach
      let sourceImageDataUrl = "";
      const sourceImgUrl = inputData?.imageUrl ?? inputData?.url;
      if (sourceImgUrl && typeof sourceImgUrl === "string" && sourceImgUrl.startsWith("http")) {
        try {
          const imgResp = await fetch(sourceImgUrl);
          const imgBuf = Buffer.from(await imgResp.arrayBuffer());
          const imgMime = imgResp.headers.get("content-type") || "image/jpeg";
          sourceImageDataUrl = `data:${imgMime};base64,${imgBuf.toString("base64")}`;
          logger.debug(`[GN-011] Fetched source image: ${(imgBuf.length / 1024).toFixed(0)}KB`);
        } catch (imgErr) {
          console.warn("[GN-011] Failed to fetch source image for 3D floor:", imgErr);
        }
      }

      const html = buildFloorPlan3D(fpGeometry, sourceImageDataUrl || undefined);

      let viewerUrl = "";
      try {
        const { isR2Configured } = await import("@/lib/r2");
        if (isR2Configured()) {
          const r2Result = await uploadBase64ToR2(
            Buffer.from(html, "utf-8").toString("base64"),
            `3d-viewer-${generateId()}.html`,
            "text/html"
          );
          if (r2Result && r2Result.startsWith("http")) viewerUrl = r2Result;
        }
      } catch (r2Err) {
        console.warn("[GN-011] R2 upload failed:", r2Err);
      }

      // ── DALL-E 3 Photorealistic Render (non-blocking) ──
      // Use same key resolution as TR-004: user key → env var fallback
      const renderApiKey = apiKey || process.env.OPENAI_API_KEY || undefined;
      let aiRenderUrl = "";
      try {
        const { generateFloorPlanRender } = await import("@/services/openai");
        const renderRooms = fpRooms.map((r: { name: string; type: string; width: number; depth: number }) => ({
          name: r.name, type: r.type, width: r.width, depth: r.depth,
        }));
        logger.debug(`[GN-011] Generating DALL-E 3 photorealistic render for ${renderRooms.length} rooms...`);
        logger.debug(`[GN-011] API key present: ${!!renderApiKey}, source: ${apiKey ? "user" : process.env.OPENAI_API_KEY ? "env" : "NONE"}, key prefix: ${renderApiKey ? renderApiKey.substring(0, 8) + "..." : "NONE"}`);
        const renderResult = await generateFloorPlanRender(
          renderRooms,
          { width: fpGeometry.footprint.width, depth: fpGeometry.footprint.depth },
          { userApiKey: renderApiKey },
        );
        aiRenderUrl = renderResult.imageUrl;
        logger.debug(`[GN-011] DALL-E render ready: ${aiRenderUrl ? aiRenderUrl.substring(0, 60) + "..." : "EMPTY"} (${(aiRenderUrl.length / 1024).toFixed(0)}KB)`);
      } catch (renderErr: unknown) {
        const errMsg = renderErr instanceof Error ? renderErr.message : String(renderErr);
        const stack = renderErr instanceof Error ? renderErr.stack : "";
        console.warn(`[GN-011] DALL-E render failed (non-critical): ${errMsg}`);
        if (stack) console.warn(`[GN-011] Stack: ${stack}`);
      }
      logger.debug(`[GN-011] Final aiRenderUrl: ${aiRenderUrl ? "YES (" + aiRenderUrl.length + " chars)" : "NONE"}`);

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "html",
        data: {
          html,
          label: `Interactive 3D Floor Plan — ${fpRooms.length} rooms`,
          width: "100%",
          height: "600px",
          fileName: `floorplan-3d-${generateId()}.html`,
          downloadUrl: viewerUrl || undefined,
          mimeType: "text/html",
          roomCount: fpRooms.length,
          wallCount: fpWalls.length,
          floorPlanGeometry: fpGeometry,
          sourceImageUrl: inputData?.imageUrl ?? inputData?.url ?? undefined,
          aiRenderUrl: aiRenderUrl || undefined,
        },
        metadata: { engine: "threejs-r128", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "GN-001") {
      // ── Massing Generator (3D AI Studio — Text-to-3D) ────────────────
      // Takes building description from TR-003 and generates a real AI 3D model.
      // Primary: 3D AI Studio Text-to-3D API → GLB model
      // Fallback: procedural massing-generator (if API key not configured)
      const rawData = (inputData?._raw ?? inputData) as Record<string, unknown>;
      // Prefer the user's original prompt (preserved through TR-003) over the
      // formatted/summarized content. This ensures rich architectural descriptions
      // pass through to 3D AI Studio without being reduced to generic parameters.
      const rawOriginal = inputData?._originalPrompt;
      const originalPrompt = (typeof rawOriginal === "string" && rawOriginal.length > 0) ? rawOriginal : "";
      const textContent = originalPrompt || (() => {
        const c = inputData?.content ?? inputData?.prompt;
        return (typeof c === "string" && c.length > 0) ? c : "";
      })();

      // Helper: extract a number from text using regex patterns
      const extractFromText = (patterns: RegExp[], fallback: number): number => {
        for (const pat of patterns) {
          const m = textContent.match(pat);
          if (m) {
            const v = parseFloat(m[1].replace(/,/g, ""));
            if (!isNaN(v) && v > 0) return v;
          }
        }
        return fallback;
      };

      // Extract floors
      const rawFloors = Number(rawData?.floors ?? rawData?.number_of_floors ?? 0);
      const floors = rawFloors > 0 ? rawFloors : extractFromText([
        /(\d+)\s*(?:floors?|stor(?:ey|ies)|levels?)/i,
        /(\d+)[-\s]?stor(?:ey|y)/i,
      ], 5);

      // Extract footprint — skip object footprints (handled separately at line 2724)
      const rawFpValue = rawData?.footprint_m2 ?? (typeof rawData?.footprint === "number" ? rawData.footprint : 0);
      const rawFootprint = Number(rawFpValue) || 0;
      const rawTotalArea = Number(rawData?.totalArea ?? rawData?.total_area ?? 0);
      const computedFootprint = rawFootprint > 0
        ? rawFootprint
        : (rawTotalArea > 0 && floors > 0)
          ? Math.round(rawTotalArea / floors)
          : extractFromText([
              /footprint[:\s]*(?:approx\.?\s*)?(\d[\d,]*)\s*m/i,
              /(\d[\d,]*)\s*m²?\s*(?:per\s+floor|footprint)/i,
              /floor\s*(?:area|plate)[:\s]*(\d[\d,]*)/i,
            ], 500);

      // Extract building type — avoid String(undefined) producing "undefined"
      const rawBuildingType = rawData?.buildingType ?? rawData?.building_type ?? rawData?.projectType;
      const buildingType = (typeof rawBuildingType === "string" && rawBuildingType.length > 0)
        ? rawBuildingType
        : (extractBuildingTypeFromText(textContent) ?? "Mixed-Use Building");

      // Extract GFA
      const rawGFA = Number(rawData?.totalGFA ?? rawData?.total_gfa_m2 ?? rawData?.gfa ?? 0);
      const gfa = rawGFA > 0 ? rawGFA : (rawTotalArea > 0 ? rawTotalArea : undefined);

      // Extract height, style, materials, features from raw data
      const rawHeight = Number(rawData?.height ?? 0);
      const height = rawHeight > 0 ? rawHeight : undefined;

      logger.debug("[GN-001] rawData keys:", Object.keys(rawData ?? {}));

      if (is3DAIConfigured()) {
        // ── PRIMARY PATH: 3D AI Studio Text-to-3D ──
        logger.debug("[GN-001] Using 3D AI Studio Text-to-3D API");

        const requirements: BuildingRequirements = {
          buildingType,
          floors,
          floorToFloorHeight: Number(rawData?.floorToFloorHeight ?? rawData?.floor_height ?? 3.5),
          height,
          style: (typeof (rawData?.style ?? rawData?.architecturalStyle) === "string") ? String(rawData?.style ?? rawData?.architecturalStyle) : "",
          massing: (typeof (rawData?.massing ?? rawData?.massingType) === "string") ? String(rawData?.massing ?? rawData?.massingType) : "",
          materials: Array.isArray(rawData?.materials) ? rawData.materials as string[] : undefined,
          footprint_m2: computedFootprint,
          features: Array.isArray(rawData?.features) ? rawData.features as string[] : undefined,
          context: (rawData?.context ?? undefined) as BuildingRequirements["context"],
          siteArea: Number(rawData?.siteArea ?? rawData?.site_area ?? 0) || undefined,
          total_gfa_m2: gfa,
          content: textContent,
          prompt: String(inputData?.prompt ?? textContent),
        };

        // If footprint is an object (from structured input)
        if (rawData?.footprint && typeof rawData.footprint === "object") {
          const fp = rawData.footprint as Record<string, unknown>;
          requirements.footprint = {
            shape: String(fp.shape ?? "rectangular"),
            width: Number(fp.width ?? 0) || undefined,
            depth: Number(fp.depth ?? 0) || undefined,
            area: Number(fp.area ?? 0) || undefined,
          };
        }

        logger.debug("[GN-001] requirements:", JSON.stringify(requirements, null, 2));

        let result;
        try {
          result = await generate3DModel(requirements);
        } catch (genErr) {
          const genMsg = genErr instanceof Error ? genErr.message : String(genErr);
          console.error("[GN-001] generate3DModel FAILED:", genMsg, genErr);
          throw new Error(`3D model generation failed: ${genMsg}`);
        }

        logger.debug("[GN-001] 3D AI Studio result:", {
          taskId: result.taskId,
          glbUrl: result.glbUrl?.slice(0, 80),
          generationTimeMs: result.metadata.generationTimeMs,
          pollAttempts: result.metadata.pollAttempts,
        });

        // Build KPI metrics array for display
        const kpis = result.kpis;
        const metrics = [
          { label: "Gross Floor Area", value: kpis.grossFloorArea.toLocaleString(), unit: "m²" },
          { label: "Net Floor Area", value: kpis.netFloorArea.toLocaleString(), unit: "m²" },
          { label: "Efficiency", value: String(kpis.efficiency), unit: "%" },
          { label: "Building Height", value: String(kpis.totalHeight), unit: "m" },
          { label: "Floors", value: String(kpis.floors), unit: "" },
          { label: "Footprint Area", value: kpis.footprintArea.toLocaleString(), unit: "m²" },
          { label: "Estimated Volume", value: kpis.estimatedVolume.toLocaleString(), unit: "m³" },
          { label: "Facade Area", value: kpis.facadeArea.toLocaleString(), unit: "m²" },
          { label: "S/V Ratio", value: String(kpis.surfaceToVolumeRatio), unit: "" },
          { label: "Structural Grid", value: kpis.structuralGrid, unit: "" },
          { label: "Est. EUI", value: String(kpis.sustainability.estimatedEUI), unit: kpis.sustainability.euiUnit },
          { label: "Daylight Potential", value: kpis.sustainability.daylightPotential, unit: "" },
          ...(kpis.floorAreaRatio !== null ? [{ label: "Floor Area Ratio", value: String(kpis.floorAreaRatio), unit: "" }] : []),
          ...(kpis.siteCoverage !== null ? [{ label: "Site Coverage", value: String(kpis.siteCoverage), unit: "%" }] : []),
        ];

        artifact = {
          id: generateId(),
          executionId: executionId ?? "local",
          tileInstanceId,
          type: "3d",
          data: {
            glbUrl: result.glbUrl,
            thumbnailUrl: result.thumbnailUrl,
            floors: kpis.floors,
            height: kpis.totalHeight,
            footprint: kpis.footprintArea,
            gfa: kpis.grossFloorArea,
            buildingType: kpis.buildingType,
            metrics,
            content: textContent || `${kpis.floors}-storey ${kpis.buildingType}, ${kpis.grossFloorArea.toLocaleString()} m² GFA`,
            prompt: result.prompt,
            kpis,
            _raw: rawData,
          },
          metadata: {
            engine: "3daistudio",
            model: result.metadata.model,
            real: true,
            taskId: result.taskId,
            generationTimeMs: result.metadata.generationTimeMs,
          },
          createdAt: new Date(),
        };
      } else {
        // ── FALLBACK: Procedural massing generator ──
        logger.debug("[GN-001] THREEDAI_API_KEY not set, falling back to procedural massing generator");

        const massingInput = {
          floors,
          footprint_m2: computedFootprint,
          building_type: buildingType,
          total_gfa_m2: gfa,
          height,
          content: textContent,
          prompt: String(inputData?.prompt ?? textContent),
        };

        logger.debug("[GN-001] massingInput:", JSON.stringify(massingInput, null, 2));

        const geometry = generateMassingGeometry(massingInput);

        logger.debug("[GN-001] geometry result:", { floors: geometry.floors, height: geometry.totalHeight, footprint: geometry.footprintArea, gfa: geometry.gfa, buildingType: geometry.buildingType });

        artifact = {
          id: generateId(),
          executionId: executionId ?? "local",
          tileInstanceId,
          type: "3d",
          data: {
            floors: geometry.floors,
            height: geometry.totalHeight,
            footprint: geometry.footprintArea,
            gfa: geometry.gfa,
            buildingType: geometry.buildingType,
            metrics: geometry.metrics,
            content: massingInput.content || `${geometry.floors}-storey ${geometry.buildingType}, ${geometry.gfa.toLocaleString()} m² GFA`,
            prompt: massingInput.prompt || massingInput.content,
            _geometry: geometry,
            _raw: rawData,
            style: {
              glassHeavy: false,
              hasRiver: false,
              hasLake: false,
              isModern: true,
              isTower: geometry.floors >= 10,
              exteriorMaterial: "mixed" as const,
              environment: "urban" as const,
              usage: "mixed" as const,
              typology: geometry.floors >= 15 ? "tower" as const : "generic" as const,
              facadePattern: "none" as const,
              floorHeightOverride: geometry.totalHeight / geometry.floors,
              maxFloorCap: 30,
            },
          },
          metadata: { engine: "massing-generator", real: true },
          createdAt: new Date(),
        };
      }

    } else if (catalogueId === "EX-001") {
      // ── IFC Exporter ──────────────────────────────────────────────────
      // Generates a downloadable .ifc file from upstream data.
      // Path A: Real geometry from GN-001 (_geometry with storeys + footprint)
      // Path B: Structured data from TR-001/TR-003 (_raw with ParsedBrief or BuildingDescription)
      // Path C: Basic numeric fields (floors, footprint, buildingType) from any upstream node
      const upstreamGeometry = inputData?._geometry as Record<string, unknown> | undefined;

      let ifcContent: string;
      let resolvedBuildingType = "Mixed-Use Building";
      let resolvedProjectName = "BuildFlow Export";

      if (upstreamGeometry?.storeys && upstreamGeometry?.footprint) {
        // ── Path A: Real geometry from GN-001 ──
        const { generateIFCFile: genIFC } = await import("@/services/ifc-exporter");
        const upstreamRaw = (inputData?._raw ?? {}) as Record<string, unknown>;
        resolvedProjectName = String(upstreamRaw?.projectName ?? inputData?.buildingType ?? inputData?.content ?? "BuildFlow Export");
        resolvedBuildingType = String(upstreamRaw?.projectName ?? inputData?.buildingType ?? "Generated Building");
        ifcContent = genIFC(
          upstreamGeometry as unknown as import("@/types/geometry").MassingGeometry,
          { projectName: resolvedProjectName, buildingName: resolvedBuildingType }
        );
      } else {
        // ── Path B/C: Extract building parameters from upstream data ──
        // This handles TR-001 (ParsedBrief), TR-003 (BuildingDescription),
        // or any node that passes numeric fields directly.
        const rawData = (inputData?._raw ?? {}) as Record<string, unknown>;
        const textContent = String(inputData?.content ?? inputData?.prompt ?? "");

        // Helper: extract a number from text using regex patterns (same as GN-001)
        const extractFromText = (patterns: RegExp[], fallback: number): number => {
          for (const pat of patterns) {
            const m = textContent.match(pat);
            if (m) {
              const v = parseFloat(m[1].replace(/,/g, ""));
              if (!isNaN(v) && v > 0) return v;
            }
          }
          return fallback;
        };

        // ── Extract floors ──
        // Sources: inputData.floors → _raw.floors → _raw.number_of_floors → text regex → default 5
        const rawFloors = Number(inputData?.floors ?? rawData?.floors ?? rawData?.number_of_floors ?? 0);
        const floors = rawFloors > 0 ? rawFloors : extractFromText([
          /(\d+)\s*(?:floors?|stor(?:ey|ies)|levels?)/i,
          /(\d+)[-\s]?stor(?:ey|y)/i,
        ], 5);

        // ── Extract footprint ──
        // Sources: inputData.footprint → _raw.footprint → compute from totalArea/floors → text regex → default 500
        const rawFootprint = Number(inputData?.footprint ?? rawData?.footprint_m2 ?? rawData?.footprint ?? 0);
        const rawTotalArea = Number(rawData?.totalArea ?? rawData?.total_area ?? 0);
        // For ParsedBrief from TR-001: sum programme areas if available
        const programme = rawData?.programme as Array<{ space?: string; area_m2?: number }> | undefined;
        const programmeTotal = programme?.reduce((sum, p) => sum + (p.area_m2 ?? 0), 0) ?? 0;
        const effectiveTotalArea = rawTotalArea > 0 ? rawTotalArea : (programmeTotal > 0 ? programmeTotal : 0);

        const computedFootprint = rawFootprint > 0
          ? rawFootprint
          : (effectiveTotalArea > 0 && floors > 0)
            ? Math.round(effectiveTotalArea / floors)
            : extractFromText([
                /footprint[:\s]*(?:approx\.?\s*)?(\d[\d,]*)\s*m/i,
                /(\d[\d,]*)\s*m²?\s*(?:per\s+floor|footprint)/i,
                /floor\s*(?:area|plate)[:\s]*(\d[\d,]*)/i,
              ], 500);

        // ── Extract building type ──
        // Sources: inputData.buildingType → _raw.buildingType → _raw.projectType → text extraction → default
        resolvedBuildingType = String(
          inputData?.buildingType ?? rawData?.buildingType ?? rawData?.building_type ?? rawData?.projectType
          ?? extractBuildingTypeFromText(textContent)
          ?? "Mixed-Use Building"
        );

        // ── Extract GFA ──
        const rawGFA = Number(inputData?.gfa ?? rawData?.totalGFA ?? rawData?.total_gfa_m2 ?? rawData?.gfa ?? 0);
        const gfa = rawGFA > 0 ? rawGFA : (effectiveTotalArea > 0 ? effectiveTotalArea : undefined);

        // ── Extract height ──
        // Sources: inputData.height → _raw.height → _raw.constraints.maxHeight (parse number) → undefined
        let height: number | undefined;
        const rawHeight = Number(inputData?.height ?? rawData?.height ?? 0);
        if (rawHeight > 0) {
          height = rawHeight;
        } else {
          // Try to parse height from constraints (TR-001 puts "40m" in constraints.maxHeight)
          const constraints = rawData?.constraints as Record<string, unknown> | undefined;
          const maxHeightStr = String(constraints?.maxHeight ?? "");
          const heightMatch = maxHeightStr.match(/(\d+(?:\.\d+)?)\s*m/i);
          if (heightMatch) {
            height = parseFloat(heightMatch[1]);
          } else {
            // Try text content
            const textHeightMatch = textContent.match(/(?:max(?:imum)?\s*)?height[:\s]*(\d+(?:\.\d+)?)\s*m/i);
            if (textHeightMatch) height = parseFloat(textHeightMatch[1]);
          }
        }

        // ── Resolve project name ──
        resolvedProjectName = String(
          rawData?.projectTitle ?? rawData?.projectName ?? inputData?.buildingType ?? resolvedBuildingType
        );

        logger.debug("[EX-001] Extracted params:", { floors, footprint: computedFootprint, buildingType: resolvedBuildingType, gfa, height, projectName: resolvedProjectName, programmeTotal });

        const fallbackGeometry = generateMassingGeometry({
          floors,
          footprint_m2: computedFootprint,
          building_type: resolvedBuildingType,
          total_gfa_m2: gfa,
          height,
          content: textContent,
          programme: programme as import("@/types/geometry").ProgrammeEntry[] | undefined,
        });
        ifcContent = generateIFCFile(fallbackGeometry, {
          projectName: resolvedProjectName,
          buildingName: resolvedBuildingType,
        });
      }

      const bldgNameSlug = String(resolvedBuildingType ?? "building").replace(/\s+/g, "_").toLowerCase();
      const fileName = `${bldgNameSlug}_${new Date().toISOString().split("T")[0]}.ifc`;
      const ifcBase64 = Buffer.from(ifcContent).toString("base64");

      // Try to upload to R2 for persistent storage
      let downloadUrl: string | null = null;
      try {
        const r2Url = await uploadBase64ToR2(ifcBase64, fileName, "application/x-step");
        // uploadBase64ToR2 returns the input unchanged if R2 is not configured
        if (r2Url && r2Url !== ifcBase64 && r2Url.startsWith("http")) {
          downloadUrl = r2Url;
        }
      } catch {
        // R2 not available — fall through to inline approach
      }

      // Fallback: store content inline as _ifcContent so the client can create a blob URL
      // data: URIs fail for large files in most browsers
      if (!downloadUrl) {
        downloadUrl = `data:application/x-step;base64,${ifcBase64}`;
      }

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "file",
        data: {
          name: fileName,
          type: "IFC 4",
          size: ifcContent.length,
          downloadUrl,
          label: "IFC Export",
          _ifcContent: ifcContent,
        },
        metadata: { engine: "ifc-exporter", real: true, schema: "IFC4" },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-013") {
      // ── Condition Router ──────────────────────────────────────
      const conditionText = (inputData?.condition as string) || (inputData?.content as string) || "true";
      const dataStr = typeof inputData === "string" ? inputData : JSON.stringify(inputData || {});
      const conditionMet = conditionText.toLowerCase() === "true" || dataStr.toLowerCase().includes(conditionText.toLowerCase());

      artifact = {
        id: `art_${tileInstanceId}_${Date.now()}`,
        executionId,
        tileInstanceId,
        type: "json",
        data: {
          result: conditionMet ? (inputData || {}) : null,
          conditionMet,
          condition: conditionText,
          outputPort: conditionMet ? "true-out" : "false-out",
          summary: `Condition "${conditionText}" evaluated to ${conditionMet}`,
        },
        metadata: { engine: "condition-router", real: true, conditionMet },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-014") {
      // ── Data Merge ────────────────────────────────────────────
      const mergedData: Record<string, unknown> = {};
      if (inputData && typeof inputData === "object") {
        Object.entries(inputData).forEach(([key, value]) => {
          mergedData[key] = value;
        });
      }

      artifact = {
        id: `art_${tileInstanceId}_${Date.now()}`,
        executionId,
        tileInstanceId,
        type: "json",
        data: {
          merged: mergedData,
          inputCount: Object.keys(mergedData).length,
          summary: `Merged ${Object.keys(mergedData).length} field(s) into a single dataset`,
        },
        metadata: { engine: "data-merge", real: true, inputCount: Object.keys(mergedData).length },
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

    // Handle generic errors — surface the real message so users can debug
    const message = err instanceof Error ? err.message : "Execution failed";
    console.error("[execute-node] " + catalogueId + ":", message, err);
    await logNodeError(executionId, catalogueId, tileInstanceId, err, Date.now() - nodeStartTime);

    return NextResponse.json(
      {
        error: {
          title: `${catalogueId} failed`,
          message,
          code: "SYS_001",
          action: "Try Again",
        },
      },
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
