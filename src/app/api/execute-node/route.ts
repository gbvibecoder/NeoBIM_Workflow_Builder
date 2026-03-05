import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateBuildingDescription, generateConceptImage } from "@/services/openai";
import { generateId } from "@/lib/utils";
import type { ExecutionArtifact } from "@/types/execution";
import OpenAI from "openai";
import * as XLSX from "xlsx";
import { checkRateLimit, logRateLimitHit } from "@/lib/rate-limit";

// Node IDs that have real implementations
const REAL_NODE_IDS = new Set(["TR-003", "GN-003", "TR-008", "EX-002"]);

export async function POST(req: NextRequest) {
  const session = await auth();

  // Check authentication
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId: string = session.user.id;
  const userRole = (session.user as { role?: string }).role as "FREE" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN" || "FREE";

  // Apply rate limiting
  try {
    const rateLimitResult = await checkRateLimit(userId, userRole);

    if (!rateLimitResult.success) {
      const resetDate = new Date(rateLimitResult.reset);
      const hoursUntilReset = Math.ceil((resetDate.getTime() - Date.now()) / (1000 * 60 * 60));

      // Log the rate limit hit
      logRateLimitHit(userId, userRole, rateLimitResult.remaining);

      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          message: userRole === "FREE" 
            ? "Free tier limit: 3 executions per day. Upgrade to Pro for unlimited executions. Resets in " + hoursUntilReset + "h."
            : "Rate limit exceeded. Please try again later.",
          remaining: rateLimitResult.remaining,
          reset: rateLimitResult.reset,
          upgradeUrl: "/dashboard/billing",
        },
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

    // Log successful request with remaining quota
    console.log("[execute-node] User " + userId + " (" + userRole + ") - Remaining: " + rateLimitResult.remaining + "/" + rateLimitResult.limit);

  } catch (error) {
    console.error("[execute-node] Rate limit check failed:", error);
    // If rate limiting fails, allow the request to proceed (fail open for better UX)
  }

  const { catalogueId, executionId, tileInstanceId, inputData, userApiKey } = await req.json();

  if (!REAL_NODE_IDS.has(catalogueId)) {
    return NextResponse.json({ error: `No real implementation for ${catalogueId}` }, { status: 400 });
  }

  const apiKey = userApiKey || undefined;

  try {
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

    } else if (catalogueId === "GN-003") {
      // Concept Image Generator — DALL-E 3
      const description = inputData?._raw ?? null;
      const prompt = inputData?.prompt ?? inputData?.content ?? "Modern mixed-use building, Nordic minimal style";

      const { url, revisedPrompt } = await generateConceptImage(
        description ?? {
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
        },
        "photorealistic architectural render, professional photography",
        apiKey
      );

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "image",
        data: {
          url,
          label: "Concept Render (DALL-E 3)",
          style: revisedPrompt.substring(0, 100),
        },
        metadata: { model: "dall-e-3", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "TR-008") {
      // BOQ Cost Mapper — GPT-4o-mini structured JSON
      const openai = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
      const elementsJson = JSON.stringify(inputData?.elements ?? inputData?.rows ?? []);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an AEC cost estimator. Given a list of building elements, generate a Bill of Quantities with realistic UK/European unit rates.\nRespond with JSON: { \"rows\": [[description, unit, qty, rate, total], ...], \"currency\": \"GBP\", \"totalCost\": number }",
          },
          {
            role: "user",
            content: "Generate BOQ for these building elements: " + elementsJson,
          },
        ],
      });

      const boqData = JSON.parse(completion.choices[0]?.message?.content ?? "{}");

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "table",
        data: {
          label: "Bill of Quantities (AI Generated)",
          headers: ["Description", "Unit", "Qty", "Rate", "Total"],
          rows: boqData.rows ?? [],
          _currency: boqData.currency ?? "GBP",
          _totalCost: boqData.totalCost,
        },
        metadata: { model: "gpt-4o-mini", real: true },
        createdAt: new Date(),
      };

    } else if (catalogueId === "EX-002") {
      // BOQ Excel Export — generate real XLSX file
      const rows = (inputData?.rows ?? []) as string[][];
      const headers = (inputData?.headers ?? ["Description", "Unit", "Qty", "Rate", "Total"]) as string[];

      const wb = XLSX.utils.book_new();
      const wsData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Style header row width
      ws["!cols"] = headers.map(() => ({ wch: 20 }));
      XLSX.utils.book_append_sheet(wb, ws, "Bill of Quantities");

      const xlsxBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
      const base64 = xlsxBuffer.toString("base64");
      const dataUri = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + base64;

      const filename = "boq_" + new Date().toISOString().split("T")[0] + ".xlsx";

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
        },
        metadata: { real: true },
        createdAt: new Date(),
      };

    } else {
      return NextResponse.json({ error: "Unknown node" }, { status: 400 });
    }

    return NextResponse.json({ artifact });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Execution failed";
    console.error("[execute-node] " + catalogueId + ":", message);
    return NextResponse.json({ error: message }, { status: 500 });
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
}): string {
  return d.projectName.toUpperCase() + " — BUILDING DESCRIPTION\n\nType: " + d.buildingType + "\nFloors: " + d.floors + " | Total Area: " + d.totalArea.toLocaleString() + " m²\nEstimated Cost: " + d.estimatedCost + " | Duration: " + d.constructionDuration + "\n\n" + d.programSummary + "\n\nStructure: " + d.structure + "\nFacade: " + d.facade + "\n\nSustainability: " + (d.sustainabilityFeatures.join(", ") || "TBD");
}

export { REAL_NODE_IDS };
