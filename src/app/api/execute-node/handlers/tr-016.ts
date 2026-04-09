import { APIError, UserErrors, generateId } from "./deps";
import type { NodeHandler } from "./types";

/**
 * TR-016 — Clash Detector (AABB-based spatial overlap analysis)
 * Pure copy from execute-node/route.ts (lines 2989-3170 of the pre-decomposition file).
 *
 * Supports single-model (ifcUrl/fileData) and multi-model (ifcModels[]) modes.
 */
export const handleTR016: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // ── Clash Detector — AABB-based spatial overlap analysis ──
  // Supports single-model (ifcUrl/fileData) and multi-model (ifcModels array) modes.

  // ── Multi-model mode: ifcModels array from federated upload ──
  const ifcModels = inputData?.ifcModels as Array<{ ifcUrl: string; discipline: string; fileName: string }> | undefined;

  if (Array.isArray(ifcModels) && ifcModels.length > 0) {
    try {
      // Fetch all model buffers in parallel
      const modelBuffers = await Promise.all(
        ifcModels.map(async (model) => {
          const resp = await fetch(model.ifcUrl);
          if (!resp.ok) throw new Error(`Failed to fetch ${model.discipline} model: ${resp.status}`);
          const arrayBuf = await resp.arrayBuffer();
          return { buffer: new Uint8Array(arrayBuf), discipline: model.discipline, fileName: model.fileName };
        })
      );

      const { detectClashesFromMultipleBuffers } = await import("@/features/3d-render/services/clash-detector");
      const result = await detectClashesFromMultipleBuffers(modelBuffers, {
        tolerance: 0.025,
        maxClashes: 5000,
      });

      const { meta, clashes } = result;

      // Multi-model table includes "Model A" and "Model B" columns
      const tableRows = clashes.map((c, i) => [
        String(i + 1),
        c.severity.toUpperCase(),
        `${c.elementA.type} "${c.elementA.name}"`,
        `#${c.elementA.expressID}`,
        c.elementA.sourceModel,
        `${c.elementB.type} "${c.elementB.name}"`,
        `#${c.elementB.expressID}`,
        c.elementB.sourceModel,
        c.elementA.storey || c.elementB.storey || "—",
        c.overlapVolume.toFixed(4),
      ]);

      const summaryParts = [];
      if (meta.hardClashes > 0) summaryParts.push(`${meta.hardClashes} hard`);
      if (meta.softClashes > 0) summaryParts.push(`${meta.softClashes} soft`);
      if (meta.clearanceClashes > 0) summaryParts.push(`${meta.clearanceClashes} clearance`);
      const crossNote = meta.crossModelClashes > 0 ? ` (${meta.crossModelClashes} cross-model)` : "";
      const summaryStr = summaryParts.length > 0
        ? `Found ${meta.clashesFound} clashes${crossNote} (${summaryParts.join(", ")}) across ${meta.modelCount} models, ${meta.totalElements} elements in ${(meta.processingTimeMs / 1000).toFixed(1)}s`
        : `No clashes detected among ${meta.totalElements} elements from ${meta.modelCount} models (processed in ${(meta.processingTimeMs / 1000).toFixed(1)}s)`;

      return {
        id: generateId(),
        executionId: executionId ?? "local",
        tileInstanceId,
        type: "table",
        data: {
          label: `Cross-Model Clash Report (${meta.modelCount} models)`,
          headers: ["#", "Severity", "Element A", "ID A", "Model A", "Element B", "ID B", "Model B", "Storey", "Overlap (m³)"],
          rows: tableRows,
          content: summaryStr,
          _clashes: clashes,
          _meta: meta,
        },
        metadata: {
          real: true,
          processingTimeMs: meta.processingTimeMs,
          totalElements: meta.totalElements,
          clashesFound: meta.clashesFound,
          modelCount: meta.modelCount,
          crossModelClashes: meta.crossModelClashes,
        },
        createdAt: new Date(),
      };
    } catch (clashErr) {
      console.error("[TR-016] Multi-model clash detection error:", clashErr);
      throw new APIError(UserErrors.CLASH_DETECTION_FAILED, 500);
    }
  }

  // ── Single-model mode (backward compatible) ──
  let ifcBuffer: Uint8Array | null = null;

  if (inputData?.fileData && typeof inputData.fileData === "string") {
    try {
      const binaryStr = atob(inputData.fileData as string);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      ifcBuffer = bytes;
    } catch (e) {
      console.error("[TR-016] Failed to decode base64 fileData:", e);
    }
  }

  if (!ifcBuffer && inputData?.ifcUrl && typeof inputData.ifcUrl === "string") {
    try {
      const resp = await fetch(inputData.ifcUrl as string);
      if (!resp.ok) throw new Error(`R2 fetch failed: ${resp.status}`);
      ifcBuffer = new Uint8Array(await resp.arrayBuffer());
    } catch (fetchErr) {
      console.error("[TR-016] Failed to fetch IFC from R2:", fetchErr);
    }
  }

  if (!ifcBuffer && inputData?.ifcData && typeof inputData.ifcData === "object") {
    const ifcDataObj = inputData.ifcData as Record<string, unknown>;
    if (ifcDataObj.buffer) {
      ifcBuffer = new Uint8Array(ifcDataObj.buffer as ArrayLike<number>);
    }
  }

  if (!ifcBuffer && inputData?.ifcParsed && typeof inputData.ifcParsed === "object") {
    const parsed = inputData.ifcParsed as Record<string, unknown>;
    if (parsed.ifcUrl && typeof parsed.ifcUrl === "string") {
      try {
        const resp = await fetch(parsed.ifcUrl as string);
        if (!resp.ok) throw new Error(`R2 fetch failed: ${resp.status}`);
        ifcBuffer = new Uint8Array(await resp.arrayBuffer());
      } catch (fetchErr) {
        console.error("[TR-016] Failed to fetch from ifcParsed.ifcUrl:", fetchErr);
      }
    }
  }

  if (!ifcBuffer) {
    throw new APIError(UserErrors.NO_GEOMETRY_FOR_CLASHES, 400);
  }

  try {
    const { detectClashesFromBuffer } = await import("@/features/3d-render/services/clash-detector");
    const result = await detectClashesFromBuffer(ifcBuffer, {
      tolerance: 0.025,
      maxClashes: 5000,
    });

    const { meta, clashes } = result;

    const tableRows = clashes.map((c, i) => [
      String(i + 1),
      c.severity.toUpperCase(),
      `${c.elementA.type} "${c.elementA.name}"`,
      `#${c.elementA.expressID}`,
      `${c.elementB.type} "${c.elementB.name}"`,
      `#${c.elementB.expressID}`,
      c.elementA.storey || c.elementB.storey || "—",
      c.overlapVolume.toFixed(4),
    ]);

    const summaryParts = [];
    if (meta.hardClashes > 0) summaryParts.push(`${meta.hardClashes} hard`);
    if (meta.softClashes > 0) summaryParts.push(`${meta.softClashes} soft`);
    if (meta.clearanceClashes > 0) summaryParts.push(`${meta.clearanceClashes} clearance`);
    const summaryStr = summaryParts.length > 0
      ? `Found ${meta.clashesFound} clashes (${summaryParts.join(", ")}) across ${meta.totalElements} elements in ${(meta.processingTimeMs / 1000).toFixed(1)}s`
      : `No clashes detected among ${meta.totalElements} elements (processed in ${(meta.processingTimeMs / 1000).toFixed(1)}s)`;

    return {
      id: generateId(),
      executionId: executionId ?? "local",
      tileInstanceId,
      type: "table",
      data: {
        label: "Clash Detection Report",
        headers: ["#", "Severity", "Element A", "ID A", "Element B", "ID B", "Storey", "Overlap (m³)"],
        rows: tableRows,
        content: summaryStr,
        _clashes: clashes,
        _meta: meta,
      },
      metadata: {
        real: true,
        processingTimeMs: meta.processingTimeMs,
        totalElements: meta.totalElements,
        clashesFound: meta.clashesFound,
      },
      createdAt: new Date(),
    };
  } catch (clashErr) {
    console.error("[TR-016] Clash detection error:", clashErr);
    throw new APIError(UserErrors.CLASH_DETECTION_FAILED, 500);
  }
};
