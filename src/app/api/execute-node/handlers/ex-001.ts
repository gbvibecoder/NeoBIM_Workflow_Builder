import {
  generateId,
  uploadBase64ToR2,
  generateMassingGeometry,
  extractBuildingTypeFromText,
  logger,
  type ExecutionArtifact,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * EX-001 — IFC Exporter (multi-discipline IFC generation + R2 upload)
 * Pure copy from execute-node/route.ts (lines 5634-5874 of the pre-decomposition file).
 *
 * NOTE: the original Path 0 (`if (upstreamIfcUrl ...) { artifact = ... }`) sets
 * an artifact then falls through and the later branches always overwrite it.
 * That overwrite behaviour is preserved verbatim — no logic changes.
 */
export const handleEX001: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // ── IFC Exporter ──────────────────────────────────────────────────
  // Generates a downloadable .ifc file from upstream data.
  // Path 0: If upstream GN-001 already uploaded IFC to R2, pass through the URL
  // Path A: Real geometry from GN-001 (_geometry with storeys + footprint)
  // Path B: Structured data from TR-001/TR-003 (_raw with ParsedBrief or BuildingDescription)
  // Path C: Basic numeric fields (floors, footprint, buildingType) from any upstream node

  let artifact: ExecutionArtifact | undefined;

  // ── Path 0: Reuse IFC from GN-001 unified pipeline ──
  const upstreamIfcUrl = inputData?.ifcUrl as string | undefined;
  if (upstreamIfcUrl && typeof upstreamIfcUrl === "string" && upstreamIfcUrl.startsWith("http")) {
    logger.debug("[EX-001] Reusing IFC from upstream GN-001:", upstreamIfcUrl.slice(0, 60));
    artifact = {
      id: generateId(),
      executionId: executionId ?? "local",
      tileInstanceId,
      type: "file",
      data: {
        url: upstreamIfcUrl,
        filename: `${(inputData?.buildingType as string || "building").toLowerCase().replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}_combined.ifc`,
        contentType: "application/x-step",
        label: "IFC Export (from BIM pipeline)",
        discipline: "all",
      },
      metadata: { engine: "ifc-exporter", real: true, reused: true },
      createdAt: new Date(),
    };
  }

  const upstreamGeometry = inputData?._geometry as Record<string, unknown> | undefined;

  let resolvedBuildingType = "Mixed-Use Building";
  let resolvedProjectName = "BuildFlow Export";
  let resolvedGeometry: import("@/types/geometry").MassingGeometry;

  if (upstreamGeometry?.storeys && upstreamGeometry?.footprint) {
    // ── Path A: Real geometry from GN-001 ──
    const upstreamRaw = (inputData?._raw ?? {}) as Record<string, unknown>;
    resolvedProjectName = String(upstreamRaw?.projectName ?? inputData?.buildingType ?? inputData?.content ?? "BuildFlow Export");
    resolvedBuildingType = String(upstreamRaw?.projectName ?? inputData?.buildingType ?? "Generated Building");
    resolvedGeometry = upstreamGeometry as unknown as import("@/types/geometry").MassingGeometry;
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

    resolvedGeometry = generateMassingGeometry({
      floors,
      footprint_m2: computedFootprint,
      building_type: resolvedBuildingType,
      total_gfa_m2: gfa,
      height,
      content: textContent,
      programme: programme as import("@/types/geometry").ProgrammeEntry[] | undefined,
    });
  }

  const bldgNameSlug = String(resolvedBuildingType ?? "building").replace(/\s+/g, "_").toLowerCase();
  const dateStr = new Date().toISOString().split("T")[0];
  const filePrefix = `${bldgNameSlug}_${dateStr}`;

  // ── Try Python IfcOpenShell service first (production-quality IFC) ──
  let ifcServiceUsed = false;
  let files: Array<{
    name: string; type: string; size: number; downloadUrl: string;
    label: string; discipline: string; _ifcContent?: string;
  }> = [];

  try {
    const { generateIFCViaService } = await import("@/services/ifc-service-client");
    const serviceResult = await generateIFCViaService(
      resolvedGeometry,
      { projectName: resolvedProjectName, buildingName: resolvedBuildingType },
      filePrefix,
    );

    if (serviceResult) {
      ifcServiceUsed = true;
      files = serviceResult.files.map(f => ({
        name: f.file_name,
        type: "IFC 4",
        size: f.size,
        downloadUrl: f.download_url,
        label: `${f.discipline.charAt(0).toUpperCase() + f.discipline.slice(1)} IFC`,
        discipline: f.discipline,
        _ifcContent: undefined as unknown as string,
      }));
      logger.debug("[EX-001] IFC generated via IfcOpenShell service", {
        files: files.length,
        engine: serviceResult.metadata.engine,
        timeMs: serviceResult.metadata.generation_time_ms,
      });
    }
  } catch (err) {
    logger.debug("[EX-001] IfcOpenShell service unavailable, using TS fallback", { error: String(err) });
  }

  // ── Fallback: TypeScript IFC exporter ──
  if (!ifcServiceUsed) {
    const { generateMultipleIFCFiles: genMulti } = await import("@/services/ifc-exporter");
    const ifcFiles = genMulti(resolvedGeometry, {
      projectName: resolvedProjectName, buildingName: resolvedBuildingType,
    });

    const disciplines = [
      { key: "architectural" as const, label: "Architectural", suffix: "architectural" },
      { key: "structural" as const, label: "Structural", suffix: "structural" },
      { key: "mep" as const, label: "MEP", suffix: "mep" },
      { key: "combined" as const, label: "Combined", suffix: "combined" },
    ];

    files = await Promise.all(disciplines.map(async (d) => {
      const content = ifcFiles[d.key];
      const fileName = `${bldgNameSlug}_${d.suffix}_${dateStr}.ifc`;
      const b64 = Buffer.from(content).toString("base64");
      let downloadUrl: string | null = null;
      try {
        const r2Url = await uploadBase64ToR2(b64, fileName, "application/x-step");
        if (r2Url && r2Url !== b64 && r2Url.startsWith("http")) downloadUrl = r2Url;
      } catch { /* R2 not available */ }
      if (!downloadUrl) downloadUrl = `data:application/x-step;base64,${b64}`;
      return {
        name: fileName,
        type: "IFC 4",
        size: content.length,
        downloadUrl,
        label: `${d.label} IFC`,
        discipline: d.key,
        _ifcContent: content,
      };
    }));
  }

  const combinedFile = files.find(f => f.discipline === "combined") ?? files[0];

  artifact = {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "file",
    data: {
      // Multi-file array
      files,
      label: "IFC Export (4 Discipline Files)",
      totalSize: files.reduce((s, f) => s + f.size, 0),
      // Backward compatible: top-level fields from combined file
      name: combinedFile.name,
      type: "IFC 4",
      size: combinedFile.size,
      downloadUrl: combinedFile.downloadUrl,
      _ifcContent: combinedFile._ifcContent,
    },
    metadata: {
      engine: ifcServiceUsed ? "ifcopenshell" : "ifc-exporter",
      real: true,
      schema: "IFC4",
      multiFile: true,
      ifcServiceUsed,
    },
    createdAt: new Date(),
  };

  return artifact;
};
