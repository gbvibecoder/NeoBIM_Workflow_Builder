import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateBuildingDescription, generateConceptImage } from "@/services/openai";
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

// Node IDs that have real implementations
const REAL_NODE_IDS = new Set(["TR-003", "GN-003", "TR-007", "TR-008", "EX-002"]);

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

    // Log successful request with remaining quota
    if (process.env.NODE_ENV === "development") console.log("[execute-node] User " + userId + " (" + userRole + ") - Remaining: " + rateLimitResult.remaining + "/" + rateLimitResult.limit);
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
    } else if (catalogueId === "TR-007") {
      // Quantity Extractor — Real IFC parsing
      const ifcData = inputData?.ifcData ?? inputData?.content ?? null;
      
      let rows: string[][] = [];
      let elements: Array<{ description: string; category: string; quantity: number; unit: string }> = [];
      let usedFallback = false;
      
      if (ifcData && typeof ifcData === "object" && ifcData.buffer) {
        // Real IFC file uploaded - parse it
        try {
          const { parseIFCBuffer } = await import("@/services/ifc-parser");
          const buffer = new Uint8Array(ifcData.buffer);
          const parseResult = await parseIFCBuffer(buffer, "uploaded.ifc");
          
          // Convert divisions to table format
          for (const division of parseResult.divisions) {
            for (const category of division.categories) {
              for (const element of category.elements) {
                const qty = element.quantities.count ?? 1;
                const area = element.quantities.area?.gross ?? 0;
                const volume = element.quantities.volume?.base ?? 0;
                
                let unit = "EA";
                let quantity = qty;
                
                if (volume > 0) {
                  unit = "m³";
                  quantity = volume;
                } else if (area > 0) {
                  unit = "m²";
                  quantity = area;
                }
                
                const description = `${element.type} (${division.name})`;
                
                rows.push([
                  description,
                  element.name,
                  quantity.toFixed(2),
                  unit,
                ]);
                
                elements.push({
                  description,
                  category: division.name,
                  quantity,
                  unit,
                });
              }
            }
          }
        } catch (parseError) {
          console.error("[TR-007] IFC parsing failed:", parseError);
          usedFallback = true;
        }
      } else {
        usedFallback = true;
      }
      
      // Fallback: provide realistic quantities if no IFC or parsing failed
      if (rows.length === 0) {
        usedFallback = true;
        const fallbackData = [
          { desc: "External Walls", cat: "Walls", qty: 1240, unit: "m²" },
          { desc: "Internal Walls", cat: "Walls", qty: 2890, unit: "m²" },
          { desc: "Floor Slabs", cat: "Slabs", qty: 2400, unit: "m²" },
          { desc: "Roof Slab", cat: "Slabs", qty: 605, unit: "m²" },
          { desc: "Windows", cat: "Openings", qty: 96, unit: "EA" },
          { desc: "Doors", cat: "Openings", qty: 58, unit: "EA" },
          { desc: "Columns", cat: "Structure", qty: 20, unit: "EA" },
          { desc: "Beams", cat: "Structure", qty: 85, unit: "EA" },
        ];
        
        for (const item of fallbackData) {
          rows.push([item.cat, item.desc, item.qty.toString(), item.unit]);
          elements.push({
            description: item.desc,
            category: item.cat,
            quantity: item.qty,
            unit: item.unit,
          });
        }
      }

      artifact = {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "table",
        data: {
          label: "Extracted Quantities (IFC)",
          headers: ["Category", "Element", "Quantity", "Unit"],
          rows,
          _elements: elements, // Required for TR-008 compatibility
        },
        metadata: { 
          model: "ifc-parser-v1", 
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
        let quantity = typeof elem === "object" ? (elem.quantity ?? elem[2] ?? 1) : 1;
        
        // Find matching unit rate from database
        const unitRateData = findUnitRate(description);
        
        if (unitRateData && unitRateData.category === "hard") {
          // Apply regional factor
          const { adjustedRate, multiplier } = applyRegionalFactor(
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
