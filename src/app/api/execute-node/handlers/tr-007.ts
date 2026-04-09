import { NextResponse, formatErrorResponse, generateId } from "./deps";
import type { NodeHandler } from "./types";

/**
 * TR-007 — Quantity Extractor (real IFC parsing with net area calculations)
 * Pure copy from execute-node/route.ts (lines 1321-1746 of the pre-decomposition file).
 *
 * Supports 3 input modes:
 *   1. ifcParsed — pre-parsed result from /api/parse-ifc (large files uploaded to R2)
 *   2. ifcUrl — R2 URL to fetch and parse server-side
 *   3. fileData — inline base64 (small files only, <4MB)
 */
export const handleTR007: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // Quantity Extractor — Real IFC parsing with net area calculations
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const hasPreParsed = !!inputData?.ifcParsed;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const hasIfcUrl = !!inputData?.ifcUrl;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const hasFileData = !!inputData?.fileData;

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

  // Normalize IFC storey names — fixes typos like "Grond floor" → "Ground Floor"
  const normalizeStorey = (s: string): string => {
    if (!s) return s;
    return s
      .replace(/\bGrond\b/gi, "Ground")
      .replace(/\bgrond\b/g, "ground")
      .replace(/\b(\w)/g, (_, c) => c.toUpperCase()); // Title case
  };

  // ── Mode 1: Pre-parsed IFC result from /api/parse-ifc (large files) ──
  // The InputNode uploaded the file to R2 and pre-parsed it via /api/parse-ifc.
  // We skip re-parsing and use the result directly.
  const preParsed = inputData?.ifcParsed as Record<string, unknown> | undefined;
  if (preParsed && typeof preParsed === "object" && (preParsed as Record<string, unknown>).divisions) {
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
        count: number; grossArea: number; netArea: number; openingArea: number; volume: number; length: number;
        divisionName: string; storey: string; elementType: string;
        materialLayers?: Array<{name: string; thickness: number}>;
        coveringType?: string;
        concreteGrade?: string;
      }>();

      for (const division of parseResult.divisions) {
        for (const category of division.categories) {
          for (const element of category.elements) {
            const coveringType = element.type === "IfcCovering" && (element as unknown as Record<string, unknown>).properties
              ? String(((element as unknown as Record<string, unknown>).properties as Record<string, unknown>)?.PredefinedType ?? "")
              : "";
            const key = `${element.type}${coveringType ? ":" + coveringType : ""}|${normalizeStorey(element.storey)}`;
            const concreteGrade = (element as unknown as Record<string, unknown>).properties
              ? String(((element as unknown as Record<string, unknown>).properties as Record<string, unknown>)?.concreteGrade ?? "")
              : "";
            const existing = typeAggregates.get(key) || {
              count: 0, grossArea: 0, netArea: 0, openingArea: 0, volume: 0, length: 0,
              divisionName: division.name, storey: normalizeStorey(element.storey), elementType: element.type,
              coveringType,
              concreteGrade: concreteGrade || undefined,
            };
            existing.count += element.quantities.count ?? 1;
            existing.grossArea += element.quantities.area?.gross ?? 0;
            existing.netArea += element.quantities.area?.net ?? 0;
            existing.openingArea += element.quantities.openingArea ?? 0;
            existing.volume += element.quantities.volume?.base ?? 0;
            existing.length += (element.quantities as Record<string, unknown>).length as number ?? 0;
            if (!existing.concreteGrade && concreteGrade) existing.concreteGrade = concreteGrade;
            if (element.type === "IfcRailing" && !((element.quantities as Record<string, unknown>).length) && existing.length === 0) {
              existing.length += ((element.quantities as Record<string, unknown>).height as number) ?? 3.0;
            }
            if (!existing.materialLayers && element.materialLayers && element.materialLayers.length > 1) {
              existing.materialLayers = element.materialLayers;
            }
            typeAggregates.set(key, existing);
          }
        }
      }

      const LINEAR_TYPES_P = new Set(["IfcRailing", "IfcMember"]);

      for (const [, agg] of typeAggregates) {
        let description = agg.elementType.replace("Ifc", "");
        if (agg.coveringType) {
          const ctLabel: Record<string, string> = { FLOORING: "Flooring", CEILING: "Ceiling", CLADDING: "Cladding", ROOFING: "Roof Covering" };
          description = ctLabel[agg.coveringType] ?? `Covering (${agg.coveringType})`;
        }
        let primaryQty: number;
        let unit: string;
        if (LINEAR_TYPES_P.has(agg.elementType) && agg.length > 0.5) {
          primaryQty = agg.length; unit = "Rmt";
        } else if (LINEAR_TYPES_P.has(agg.elementType) && agg.count > 0) {
          primaryQty = agg.count * (agg.elementType === "IfcRailing" ? 3.0 : 4.0); unit = "Rmt";
        } else if (agg.grossArea > 0) {
          primaryQty = agg.grossArea; unit = "m²";
        } else if (agg.volume > 0) {
          primaryQty = agg.volume; unit = "m³";
        } else {
          primaryQty = agg.count; unit = "EA";
        }
        rows.push([agg.divisionName, description, agg.grossArea.toFixed(2), agg.openingArea.toFixed(2), agg.netArea.toFixed(2), agg.volume.toFixed(2), primaryQty.toFixed(2), unit]);
        elements.push({
          description, category: agg.divisionName, quantity: primaryQty, unit,
          grossArea: agg.grossArea || undefined, netArea: agg.netArea || undefined,
          openingArea: agg.openingArea || undefined, totalVolume: agg.volume || undefined,
          storey: agg.storey, elementCount: agg.count, materialLayers: agg.materialLayers,
          ...(agg.coveringType ? { coveringType: agg.coveringType } : {}),
          ...(agg.concreteGrade ? { concreteGrade: agg.concreteGrade } : {}),
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
    try {
      const resp = await fetch(inputData.ifcUrl as string);
      if (!resp.ok) throw new Error(`R2 fetch failed: ${resp.status}`);
      const arrayBuf = await resp.arrayBuffer();
      ifcData = { buffer: Array.from(new Uint8Array(arrayBuf)) };
    } catch (fetchErr) {
      console.error("[TR-007] Failed to fetch IFC from R2:", fetchErr);
    }
  }

  // ── Mode 3: Parse from inline buffer (small files or R2-fetched) ──
  if (rows.length === 0 && ifcData && typeof ifcData === "object" && ifcData.buffer) {
    // Real IFC file — parse it
    try {
      const { parseIFCBuffer } = await import("@/features/ifc/services/ifc-parser");
      const buffer = new Uint8Array(ifcData.buffer as ArrayLike<number>);
      const parseResult = await parseIFCBuffer(buffer, inputData?.fileName as string ?? "uploaded.ifc");

      // Aggregate elements by type + storey for per-floor BOQ breakdown
      const typeAggregates = new Map<string, {
        count: number; grossArea: number; netArea: number; openingArea: number; volume: number; length: number;
        divisionName: string; storey: string; elementType: string;
        materialLayers?: Array<{name: string; thickness: number}>;
        coveringType?: string;
        concreteGrade?: string;
      }>();

      for (const division of parseResult.divisions) {
        for (const category of division.categories) {
          for (const element of category.elements) {
            const coveringType = element.type === "IfcCovering" && (element as unknown as Record<string, unknown>).properties
              ? String(((element as unknown as Record<string, unknown>).properties as Record<string, unknown>)?.PredefinedType ?? "")
              : "";
            const concreteGradeInline = (element as unknown as Record<string, unknown>).properties
              ? String(((element as unknown as Record<string, unknown>).properties as Record<string, unknown>)?.concreteGrade ?? "")
              : "";
            const key = `${element.type}${coveringType ? ":" + coveringType : ""}|${normalizeStorey(element.storey)}`;
            const existing = typeAggregates.get(key) || {
              count: 0, grossArea: 0, netArea: 0, openingArea: 0, volume: 0, length: 0,
              divisionName: division.name, storey: normalizeStorey(element.storey), elementType: element.type,
              coveringType,
              concreteGrade: concreteGradeInline || undefined,
            };
            existing.count += element.quantities.count ?? 1;
            existing.grossArea += element.quantities.area?.gross ?? 0;
            existing.netArea += element.quantities.area?.net ?? 0;
            existing.openingArea += element.quantities.openingArea ?? 0;
            existing.volume += element.quantities.volume?.base ?? 0;
            existing.length += element.quantities.length ?? 0;
            if (!existing.concreteGrade && concreteGradeInline) existing.concreteGrade = concreteGradeInline;
            // Railing fallback: if no length, estimate from height (vertical railing) or 3m default
            if (element.type === "IfcRailing" && !(element.quantities.length) && existing.length === 0) {
              existing.length += element.quantities.height ?? 3.0; // 3m per railing segment default
            }
            if (!existing.materialLayers && element.materialLayers && element.materialLayers.length > 1) {
              existing.materialLayers = element.materialLayers;
            }
            typeAggregates.set(key, existing);
          }
        }
      }

      // Linear element types: use length (Rmt) as primary quantity
      const LINEAR_TYPES = new Set(["IfcRailing", "IfcMember"]);

      for (const [, agg] of typeAggregates) {
        let description = agg.elementType.replace("Ifc", "");
        if (agg.coveringType) {
          const ctLabel: Record<string, string> = { FLOORING: "Flooring", CEILING: "Ceiling", CLADDING: "Cladding", ROOFING: "Roof Covering" };
          description = ctLabel[agg.coveringType] ?? `Covering (${agg.coveringType})`;
        }
        // Railings and members: use length as primary quantity in Rmt
        let primaryQty: number;
        let unit: string;
        if (LINEAR_TYPES.has(agg.elementType) && agg.length > 0.5) {
          primaryQty = agg.length;
          unit = "Rmt";
        } else if (LINEAR_TYPES.has(agg.elementType) && agg.count > 0) {
          // No usable length — estimate: 3m per railing, 4m per member
          primaryQty = agg.count * (agg.elementType === "IfcRailing" ? 3.0 : 4.0);
          unit = "Rmt";
        } else if (agg.grossArea > 0) {
          primaryQty = agg.grossArea;
          unit = "m²";
        } else if (agg.volume > 0) {
          primaryQty = agg.volume;
          unit = "m³";
        } else {
          primaryQty = agg.count;
          unit = "EA";
        }

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
          ...(agg.coveringType ? { coveringType: agg.coveringType } : {}),
          ...(agg.concreteGrade ? { concreteGrade: agg.concreteGrade } : {}),
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

  // ── Merge supplementary IFC data (structural, MEP) if provided ──
  let hasStructuralFoundation = false;
  let hasMEPData = false;

  const structParsed = inputData?.structuralIFCParsed as { divisions?: Array<{ categories: Array<{ elements: Array<{ type: string; name: string; storey: string; quantities: Record<string, unknown> }> }> }> } | undefined;
  if (structParsed?.divisions) {
    for (const div of structParsed.divisions) {
      for (const cat of div.categories) {
        for (const elem of cat.elements) {
          if (elem.type === "IfcFooting" || elem.type === "IfcPile") hasStructuralFoundation = true;
          const vol = Number(((elem.quantities as Record<string, unknown>).volume as Record<string, unknown>)?.base ?? 0);
          const area = Number(((elem.quantities as Record<string, unknown>).area as Record<string, unknown>)?.gross ?? 0);
          const qty = area > 0 ? area : vol > 0 ? vol : 1;
          const unit = area > 0 ? "m²" : vol > 0 ? "m³" : "EA";
          const desc = elem.type.replace("Ifc", "");
          elements.push({
            description: desc, category: "Substructure (Structural IFC)", quantity: qty, unit,
            grossArea: area || undefined, totalVolume: vol || undefined,
            storey: elem.storey || "Foundation", elementCount: 1,
            // dataSource passed as extra field for Excel transparency
          });
          rows.push(["Substructure", desc, (area || 0).toFixed(2), "0.00", (area || 0).toFixed(2), (vol || 0).toFixed(2), qty.toFixed(2), unit]);
        }
      }
    }
    parseSummary += ` | Structural IFC merged (foundation data)`;
  }

  const mepParsed = inputData?.mepIFCParsed as typeof structParsed | undefined;
  if (mepParsed?.divisions) {
    hasMEPData = true;
    for (const div of mepParsed.divisions) {
      for (const cat of div.categories) {
        for (const elem of cat.elements) {
          const len = Number((elem.quantities as Record<string, unknown>).length ?? 0);
          const area = Number(((elem.quantities as Record<string, unknown>).area as Record<string, unknown>)?.gross ?? 0);
          const qty = len > 0 ? len : area > 0 ? area : 1;
          const unit = len > 0 ? "m" : area > 0 ? "m²" : "EA";
          const desc = elem.type.replace("Ifc", "");
          // Classify MEP element
          const mepCat = elem.type.includes("Pipe") ? "Plumbing (MEP IFC)"
            : elem.type.includes("Duct") ? "HVAC (MEP IFC)"
            : elem.type.includes("Cable") ? "Electrical (MEP IFC)"
            : "MEP Services (MEP IFC)";
          elements.push({
            description: desc, category: mepCat, quantity: qty, unit,
            grossArea: area || undefined, totalVolume: undefined,
            storey: elem.storey || "MEP", elementCount: 1,
            // dataSource passed as extra field for Excel transparency
          });
          rows.push([mepCat.split(" (")[0], desc, "0.00", "0.00", "0.00", "0.00", qty.toFixed(2), unit]);
        }
      }
    }
    parseSummary += ` | MEP IFC merged (pipe/duct/fixture data)`;
  }

  // ── Apply QS corrections from learning database ──
  // If 3+ QS professionals have corrected this element type in this region,
  // apply the average correction ratio to improve accuracy over time.
  try {
    const correctionNotes: string[] = [];
    for (const elem of elements) {
      if (!elem.description || !elem.quantity) continue;
      const ifcType = "Ifc" + elem.description.replace(/\s*[—\-].*/g, "").replace(/\s*\(.*\)/g, "").trim();
      // Internal API call (same server, no network hop)
      const { prisma } = await import("@/lib/db");
      const corrections = await prisma.quantityCorrection.findMany({
        where: { elementType: ifcType },
        select: { correctionRatio: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      if (corrections.length >= 3) {
        const ratios = corrections.map((c: { correctionRatio: number }) => c.correctionRatio).sort((a: number, b: number) => a - b);
        const trimmed = ratios.slice(1, -1); // drop min and max
        if (trimmed.length > 0) {
          const avgRatio = trimmed.reduce((a: number, b: number) => a + b, 0) / trimmed.length;
          if (Math.abs(avgRatio - 1.0) > 0.05) { // Only apply if >5% difference
            const oldQty = elem.quantity;
            elem.quantity = Math.round(elem.quantity * avgRatio * 100) / 100;
            if (elem.grossArea) elem.grossArea = Math.round(elem.grossArea * avgRatio * 100) / 100;
            correctionNotes.push(`${elem.description}: adjusted ${avgRatio > 1 ? "+" : ""}${Math.round((avgRatio - 1) * 100)}% (${corrections.length} QS corrections, was ${oldQty.toFixed(1)})`);
          }
        }
      }
    }
    if (correctionNotes.length > 0) {
      parseSummary += ` | QS corrections applied: ${correctionNotes.length} adjustments`;
    }
  } catch (corrErr) {
    // Non-fatal — corrections are best-effort
    console.warn("[TR-007] QS correction lookup failed (non-fatal):", corrErr instanceof Error ? corrErr.message : corrErr);
  }

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "table",
    data: {
      label: "Extracted Quantities (IFC)",
      headers: ["Category", "Element", "Gross Area (m²)", "Opening Area (m²)", "Net Area (m²)", "Volume (m³)", "Qty", "Unit"],
      rows,
      _elements: elements,
      _hasStructuralFoundation: hasStructuralFoundation,
      _hasMEPData: hasMEPData,
      _ifcContext: (() => {
        const slabArea = elements.reduce((s: number, e: unknown) => s + (String((e as Record<string, unknown>).description ?? "").toLowerCase().includes("slab") ? Number((e as Record<string, unknown>).grossArea ?? 0) : 0), 0);
        const wallArea = elements.reduce((s: number, e: unknown) => s + (String((e as Record<string, unknown>).description ?? "").toLowerCase().includes("wall") ? Number((e as Record<string, unknown>).grossArea ?? 0) : 0), 0);
        const openingArea = elements.reduce((s: number, e: unknown) => s + Number((e as Record<string, unknown>).openingArea ?? 0), 0);
        const floors = new Set(elements.map((e: unknown) => (e as Record<string, unknown>).storey).filter(Boolean)).size || 1;
        const hasSteelMembers = elements.some((e: unknown) => String((e as Record<string, unknown>).description ?? "").toLowerCase().includes("member") || String((e as Record<string, unknown>).description ?? "").toLowerCase().includes("plate"));
        return {
          totalFloors: floors,
          totalGFA: Math.round(slabArea),
          estimatedHeight: Math.round(floors * 3.2),
          dominantStructure: hasSteelMembers ? "steel frame" : "RCC frame",
          openingRatio: wallArea > 0 ? Math.round((openingArea / wallArea) * 100) / 100 : 0,
          slabToWallRatio: wallArea > 0 ? Math.round((slabArea / wallArea) * 100) / 100 : 0,
        };
      })(),
      content: parseSummary,
    },
    metadata: {
      model: "ifc-parser-v2",
      real: true,
      hasStructuralIFC: !!structParsed,
      hasMEPIFC: !!mepParsed,
    },
    createdAt: new Date(),
  };
};
