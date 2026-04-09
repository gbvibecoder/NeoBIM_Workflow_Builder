"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useExecutionStore } from "@/stores/execution-store";
import { useUIStore } from "@/stores/ui-store";
import { executeNode as mockExecuteNode } from "@/services/mock-executor";
import { inputFileStore, inputMultiFileStore, supplementaryIFCStore } from "@/components/canvas/nodes/InputNode";
import { generateId } from "@/lib/utils";
import { awardXP } from "@/lib/award-xp";
import { trackWorkflowExecuted, trackNodeUsed, trackRegenerationUsed } from "@/lib/track";
import type { Execution, ExecutionArtifact } from "@/types/execution";
import type { WorkflowNode } from "@/types/nodes";
import type { LogEntry } from "@/features/canvas/components/ExecutionLog";

// All node IDs that have real API implementations on the server
const REAL_NODE_IDS = new Set(["TR-001", "TR-003", "TR-004", "TR-005", "TR-012", "TR-015", "TR-016", "GN-001", "GN-003", "GN-004", "GN-009", "GN-010", "GN-011", "GN-012", "TR-007", "TR-008", "EX-001", "EX-002", "EX-003"]);

// Live nodes — ALWAYS use real API execution regardless of NEXT_PUBLIC_ENABLE_MOCK_EXECUTION.
// These are production-ready and should never fall through to mock when authenticated.
const LIVE_NODE_IDS = new Set([
  "TR-001",  // Brief Parser — MUST be live to extract actual PDF text (mock returns hardcoded data)
  "TR-003",  // Design Brief Analyzer (GPT-4o-mini)
  "TR-007",  // Quantity Extractor (web-ifc, no API key)
  "TR-008",  // BOQ / Cost Mapper (cost database, no API key)
  "TR-015",  // Market Intelligence Agent (Anthropic Claude + web search)
  "GN-001",  // Massing Generator (pure computation, no API key)
  "GN-003",  // Concept Render Generator (DALL-E 3)
  "GN-009",  // Video Walkthrough Generator (Kling 2.1 via fal.ai)
  "GN-010",  // Hi-Fi 3D Reconstructor (Meshy v4)
  "TR-016",  // Clash Detector (web-ifc AABB analysis, no API key)
  "GN-012",  // Floor Plan Editor (pure computation — adapts upstream geometry, no API key)
  "EX-001",  // IFC Exporter (pure computation, no API key)
  "EX-002",  // BOQ Spreadsheet Exporter (xlsx, no API key)
]);

interface APIErrorResponse {
  error: {
    title: string;
    message: string;
    code: string;
    action?: string;
    actionUrl?: string;
  };
  details?: string;
}

// Input node IDs whose user-supplied value should pass through directly
const INPUT_NODE_IDS = new Set(["IN-001", "IN-002", "IN-003", "IN-004", "IN-005", "IN-006", "IN-008"]);

// Demo-allowed node IDs (routed to /api/demo/execute)
const DEMO_NODE_IDS = new Set(["TR-003", "GN-003"]);

// Route execution to real API, demo API, or mock
async function executeNode(
  node: WorkflowNode,
  executionId: string,
  previousArtifact?: ExecutionArtifact | null,
  useRealExecution = false,
  demoMode = false
): Promise<ExecutionArtifact> {
  const { catalogueId, inputValue } = node.data as { catalogueId: string; inputValue?: string };

  // For input nodes, pass through the user's actual typed/selected value
  // instead of using the mock executor (which returns hardcoded placeholder text)
  if (INPUT_NODE_IDS.has(catalogueId)) {
    await new Promise(r => setTimeout(r, 150)); // brief delay for UX
    const nodeData = node.data as Record<string, unknown>;

    // ── IN-008: Multi-Image Upload — pass all user images as base64 array ──
    if (catalogueId === "IN-008") {
      const multiFiles = inputMultiFileStore.get(node.id);
      // Prefer live File objects from the store; fall back to nodeData.fileData (base64 array)
      let fileDataArr = nodeData.fileData as string[] | undefined;
      let fileNames = (nodeData.fileNames as string[]) ?? [];
      let mimeTypes = (nodeData.mimeTypes as string[]) ?? [];

      if (multiFiles && multiFiles.length > 0) {
        // Convert live File objects to base64
        fileDataArr = await Promise.all(multiFiles.map(async (f) => {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return btoa(binary);
        }));
        fileNames = multiFiles.map(f => f.name);
        mimeTypes = multiFiles.map(f => f.type || "image/jpeg");
      }

      const count = fileDataArr?.length ?? 0;
      // Pass the FIRST image as `fileData` (string) for downstream nodes that expect a single image,
      // and ALL images in `fileDataArray` for nodes that can use multiple.
      return {
        id: generateId(),
        executionId,
        tileInstanceId: node.id,
        type: "image",
        data: {
          content: inputValue ?? `${count} image${count !== 1 ? "s" : ""} uploaded`,
          label: `${count} Building Photo${count !== 1 ? "s" : ""} Uploaded`,
          imageCount: count,
          fileNames,
          mimeTypes,
          isMultiImage: true,
          // Single-image compat: first image as fileData + mimeType
          ...(fileDataArr?.[0] && { fileData: fileDataArr[0] }),
          ...(mimeTypes[0] && { mimeType: mimeTypes[0] }),
          // Full array for nodes that handle multiple images
          ...(fileDataArr && { fileDataArray: fileDataArr }),
        },
        metadata: { source: "user-input" },
        createdAt: new Date(),
      };
    }

    // ── IFC files with pre-parsed data: pass parsed result, NOT raw file ──
    const ifcParsed = nodeData.ifcParsed as Record<string, unknown> | undefined;
    if (catalogueId === "IN-004" && ifcParsed) {
      // Include supplementary IFC data if uploaded (structural, MEP)
      const structuralIFCParsed = nodeData.structuralIFCParsed as Record<string, unknown> | undefined;
      const mepIFCParsed = nodeData.mepIFCParsed as Record<string, unknown> | undefined;
      return {
        id: generateId(),
        executionId,
        tileInstanceId: node.id,
        type: "text",
        data: {
          content: inputValue ?? "",
          prompt: inputValue ?? "",
          label: "IFC Model (parsed)",
          fileName: nodeData.fileName as string ?? inputValue ?? "model.ifc",
          ifcParsed, // Pre-parsed result — TR-007 uses this directly
          ...(structuralIFCParsed ? { structuralIFCParsed } : {}),
          ...(mepIFCParsed ? { mepIFCParsed } : {}),
          // Do NOT include fileData — it would be 28MB and break Vercel
        },
        metadata: { source: "user-input", parser: "ifc-text-parser" },
        createdAt: new Date(),
      };
    }

    // ── Single-file input nodes (IN-001..IN-007) ──
    let fileData = nodeData.fileData as string | undefined;
    let fileName = nodeData.fileName as string | undefined;
    let mimeType = nodeData.mimeType as string | undefined;

    // Read from inputFileStore (where FileUploadInput stores the actual File object)
    // and convert to base64 so it can be sent to the server API.
    // For IFC files, skip base64 conversion — they should be parsed client-side
    const fileObj = inputFileStore.get(node.id);
    if (fileObj && !(catalogueId === "IN-004" && fileObj.name.toLowerCase().endsWith(".ifc"))) {
      const arrayBuffer = await fileObj.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      fileData = btoa(binary);
      fileName = fileObj.name;
      mimeType = fileObj.type || "application/pdf";
    } else if (fileObj && catalogueId === "IN-004") {
      // IFC file in inputFileStore but no ifcParsed — parse now
      try {
        const text = await fileObj.text();
        const { parseIFCText } = await import("@/features/ifc/services/ifc-text-parser");
        const result = parseIFCText(text);
        return {
          id: generateId(),
          executionId,
          tileInstanceId: node.id,
          type: "text",
          data: {
            content: inputValue ?? "",
            prompt: inputValue ?? "",
            label: "IFC Model (parsed)",
            fileName: fileObj.name,
            ifcParsed: result,
            ...(nodeData.structuralIFCParsed ? { structuralIFCParsed: nodeData.structuralIFCParsed } : {}),
            ...(nodeData.mepIFCParsed ? { mepIFCParsed: nodeData.mepIFCParsed } : {}),
          },
          metadata: { source: "user-input", parser: "ifc-text-parser" },
          createdAt: new Date(),
        };
      } catch (parseErr) {
        console.error("[IN-004] Failed to parse IFC:", parseErr);
        // Fall through to fileData path
        fileName = fileObj.name;
      }
    }

    // ── IN-005 (Parameter Input): parse JSON params and spread as top-level fields
    // so downstream nodes (GN-001) can access floors, gfa, height, style directly
    if (catalogueId === "IN-005" && inputValue) {
      try {
        const params = JSON.parse(inputValue) as Record<string, unknown>;
        return {
          id: generateId(),
          executionId,
          tileInstanceId: node.id,
          type: "text",
          data: {
            content: inputValue,
            prompt: inputValue,
            label: "User Input",
            ...params, // floors, gfa, height, style etc. as top-level properties
          },
          metadata: { source: "user-input" },
          createdAt: new Date(),
        };
      } catch {
        // Not valid JSON — fall through to default handling
      }
    }

    return {
      id: generateId(),
      executionId,
      tileInstanceId: node.id,
      type: "text",
      data: {
        content: inputValue ?? "",
        prompt: inputValue ?? "",
        label: "User Input",
        ...(fileData && { fileData }),
        ...(fileName && { fileName }),
        ...(mimeType && { mimeType }),
      },
      metadata: { source: "user-input" },
      createdAt: new Date(),
    };
  }

  // Demo mode: route allowed nodes to unauthenticated demo endpoint
  if (demoMode && DEMO_NODE_IDS.has(catalogueId)) {
    const res = await fetch("/api/demo/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogueId,
        executionId,
        tileInstanceId: node.id,
        inputData: previousArtifact?.data ?? { prompt: inputValue ?? "" },
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: { message: "Demo request failed" } }));
      throw new Error(errData.error?.message ?? "Demo execution failed");
    }

    const { artifact } = await res.json() as { artifact: ExecutionArtifact };
    return { ...artifact, createdAt: new Date() };
  }

  // Determine if this node should use real API execution:
  // - LIVE_NODE_IDS: always real (ignore mock flag) — these are production-ready
  // - Other REAL_NODE_IDS: only real when mock flag is off
  const isLive = LIVE_NODE_IDS.has(catalogueId);
  const shouldUseRealAPI = isLive || (useRealExecution && REAL_NODE_IDS.has(catalogueId));

  if (shouldUseRealAPI) {
    // Merge node-level config (e.g. viewType for GN-003/TR-005) into inputData
    const nodeConfig: Record<string, unknown> = {};
    const nd = node.data as Record<string, unknown>;
    if (nd.viewType != null) nodeConfig.viewType = nd.viewType;

    // Generous timeout for all nodes — AI generation (DALL-E, Claude QA, Kling, Meshy) can take minutes
    const timeoutMs = 600_000; // 10 min
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      const inputData = {
        ...(previousArtifact?.data as Record<string, unknown> ?? { prompt: inputValue ?? "" }),
        ...nodeConfig,
      };

      // Apply user quantity overrides from TR-007 → TR-008 flow
      // If the user edited quantities in the TR-007 result table, apply those
      // corrections to the _elements array before sending to TR-008
      if (catalogueId === "TR-008" && inputData._elements && Array.isArray(inputData._elements)) {
        const upstreamTileId = previousArtifact?.tileInstanceId;
        if (upstreamTileId) {
          const overrides = useExecutionStore.getState().getQuantityOverrides(upstreamTileId);
          if (overrides.size > 0) {
            const elements = [...inputData._elements] as Array<Record<string, unknown>>;
            for (const [rowIdx, newQty] of overrides) {
              if (rowIdx >= 0 && rowIdx < elements.length) {
                const elem = { ...elements[rowIdx] };
                elem.quantity = newQty;
                // Also update grossArea if quantity was area-based
                if (elem.unit === "m²" && elem.grossArea) {
                  elem.grossArea = newQty;
                } else if (elem.unit === "m³" && elem.totalVolume) {
                  elem.totalVolume = newQty;
                }
                elements[rowIdx] = elem;
              }
            }
            inputData._elements = elements;
          }
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // TR-007 SPECIAL HANDLING: Large IFC files CANNOT go through execute-node
      // because Vercel's 4.5MB body limit will reject the ~28MB base64 payload.
      //
      // Solution: Handle TR-007 entirely client-side for large IFC files:
      //   1. Upload to /api/parse-ifc (FormData, no body limit)
      //   2. Get parsed result back
      //   3. Construct the TR-007 artifact directly (skip execute-node)
      //   4. Send the lightweight artifact to downstream nodes
      // ══════════════════════════════════════════════════════════════════════
      if (catalogueId === "TR-007") {
        const fileData = inputData.fileData as string | undefined;
        const fileName = (inputData.fileName ?? inputData.inputValue ?? "model.ifc") as string;
        const hasLargeFile = fileData && typeof fileData === "string" && fileData.length > 1_500_000; // >1.5MB base64 ≈ >1MB binary
        const hasPreparsed = inputData.ifcParsed && typeof inputData.ifcParsed === "object";

        if (hasLargeFile || hasPreparsed) {

          let parseResult: Record<string, unknown> | null = hasPreparsed ? inputData.ifcParsed as Record<string, unknown> : null;

          // If no pre-parsed data, upload and parse now via FormData
          if (!parseResult && fileData) {
            try {
              const binaryStr = atob(fileData);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
              const blob = new Blob([bytes], { type: "application/octet-stream" });
              const ifcFile = new File([blob], fileName.endsWith(".ifc") ? fileName : `${fileName}.ifc`);

              const formData = new FormData();
              formData.append("file", ifcFile);

              const uploadRes = await fetch("/api/parse-ifc", {
                method: "POST",
                body: formData,
                signal: AbortSignal.timeout(180_000), // 3 min timeout for large files
              });

              if (!uploadRes.ok) {
                const errBody = await uploadRes.json().catch(() => ({ error: { message: `Server returned ${uploadRes.status}` } }));
                throw new Error(errBody.error?.message || `Upload failed with status ${uploadRes.status}`);
              }

              const uploadData = await uploadRes.json();
              parseResult = uploadData.result ?? null;
            } catch (uploadErr) {
              clearTimeout(timeoutId);
              const msg = uploadErr instanceof Error ? uploadErr.message : "IFC upload/parse failed";
              console.error("[TR-007] Client-side IFC processing failed:", msg);
              throw new Error(`IFC file processing failed: ${msg}. The file may be too large or corrupted. Try a smaller IFC file (<100MB).`);
            }
          }

          if (!parseResult) {
            clearTimeout(timeoutId);
            throw new Error("No IFC data available. Please re-upload the IFC file.");
          }

          // Construct TR-007 artifact directly — skip execute-node entirely
          clearTimeout(timeoutId);

          const divisions = (parseResult as Record<string, unknown>).divisions as Array<Record<string, unknown>> ?? [];
          const summary = (parseResult as Record<string, unknown>).summary as Record<string, unknown> ?? {};
          const meta = (parseResult as Record<string, unknown>).meta as Record<string, unknown> ?? {};

          // Normalize storey names from IFC (fixes "Grond floor" → "Ground Floor" etc.)
          const normStorey = (s: string): string => {
            if (!s) return s;
            return s.replace(/\bGrond\b/gi, "Ground").replace(/\bGroung\b/gi, "Ground")
              .replace(/\b(\w)/g, (_, c: string) => c.toUpperCase());
          };

          // ── Aggregate elements by type + storey (QS-standard grouping) ──
          // A QS wants "Walls — Ground Floor: 245 m²", not 69 individual wall rows
          const typeAggregates = new Map<string, {
            count: number; grossArea: number; netArea: number; openingArea: number; volume: number;
            divisionName: string; storey: string; elementType: string;
            materialLayers?: Array<{ name: string; thickness: number }>;
          }>();

          for (const division of divisions) {
            const categories = (division.categories ?? []) as Array<Record<string, unknown>>;
            for (const category of categories) {
              const elems = (category.elements ?? []) as Array<Record<string, unknown>>;
              for (const element of elems) {
                const type = (element.type as string) ?? "Unknown";
                const quantities = (element.quantities ?? {}) as Record<string, unknown>;
                const area = quantities.area as Record<string, unknown> | undefined;
                const volume = quantities.volume as Record<string, unknown> | undefined;
                const storey = normStorey((element.storey as string) ?? "Unassigned");

                const key = `${type}|${storey}`;
                const existing = typeAggregates.get(key) || {
                  count: 0, grossArea: 0, netArea: 0, openingArea: 0, volume: 0,
                  divisionName: (division.name as string) ?? "", storey, elementType: type,
                };
                existing.count += Number(quantities.count ?? 1);
                existing.grossArea += Number(area?.gross ?? 0);
                existing.netArea += Number(area?.net ?? 0);
                existing.openingArea += Number(quantities.openingArea ?? 0);
                existing.volume += Number(volume?.base ?? 0);
                if (!existing.materialLayers && element.materialLayers) {
                  existing.materialLayers = element.materialLayers as Array<{ name: string; thickness: number }>;
                }
                typeAggregates.set(key, existing);
              }
            }
          }

          const rows: string[][] = [];
          const elements: Array<Record<string, unknown>> = [];

          for (const [, agg] of typeAggregates) {
            const typeName = agg.elementType.replace("Ifc", "").replace("StandardCase", "").replace("BuildingElementProxy", "Proxy Element");
            // Include storey and count in description for QS clarity
            const storeyLabel = agg.storey && agg.storey !== "Unassigned" ? ` — ${agg.storey}` : "";
            const description = `${typeName}${storeyLabel}`;
            const primaryQty = agg.grossArea > 0 ? agg.grossArea : agg.volume > 0 ? agg.volume : agg.count;
            const unit = agg.grossArea > 0 ? "m²" : agg.volume > 0 ? "m³" : "EA";

            rows.push([
              agg.divisionName, `${description} (${agg.count} nr)`,
              agg.grossArea.toFixed(2), agg.openingArea.toFixed(2),
              agg.netArea.toFixed(2), agg.volume.toFixed(2),
              primaryQty.toFixed(2), unit,
            ]);

            elements.push({
              description: `${description} (${agg.count} nr)`, category: agg.divisionName,
              ifcType: agg.elementType, // Raw IFC type for rate mapping (e.g. "IfcWall", "IfcMember")
              quantity: primaryQty, unit,
              grossArea: agg.grossArea || undefined, netArea: agg.netArea || undefined,
              openingArea: agg.openingArea || undefined, totalVolume: agg.volume || undefined,
              storey: agg.storey, elementCount: agg.count,
              materialLayers: agg.materialLayers,
            });
          }

          const parseSummary = `Parsed ${summary.processedElements ?? "?"} of ${summary.totalElements ?? "?"} elements from ${summary.buildingStoreys ?? "?"} storeys (${meta.ifcSchema ?? "IFC"})`;

          return {
            id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            executionId,
            tileInstanceId: node.id,
            type: "table" as const,
            data: {
              label: "Extracted Quantities (IFC)",
              headers: ["Category", "Element", "Gross Area (m²)", "Opening Area (m²)", "Net Area (m²)", "Volume (m³)", "Qty", "Unit"],
              rows,
              _elements: elements,
              content: parseSummary,
            },
            metadata: { model: "ifc-parser-v2-client", real: true },
            createdAt: new Date(),
          };
        }
      }
      // ══════════════════════════════════════════════════════════════════════
      // END TR-007 special handling — all other nodes use normal execute-node
      // ══════════════════════════════════════════════════════════════════════

      // ══════════════════════════════════════════════════════════════════════
      // TR-016 SPECIAL HANDLING: Clash Detector needs raw IFC geometry
      // IN-004 strips raw file data (too large for JSON) and only passes
      // ifcParsed (text-parsed quantities). TR-016 needs the binary buffer
      // for mesh streaming. Solution: find the raw File in inputFileStore,
      // upload to R2 via /api/upload-ifc, and pass the ifcUrl to the server.
      // Also checks supplementaryIFCStore for multi-model federation.
      // ══════════════════════════════════════════════════════════════════════
      if (catalogueId === "TR-016" && !inputData.fileData && !inputData.ifcUrl && !inputData.ifcData && !inputData.ifcModels) {

        // Helper: upload a single IFC file to R2 and return URL
        const uploadToR2 = async (file: File): Promise<string> => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/upload-ifc", {
            method: "POST",
            body: fd,
            signal: AbortSignal.timeout(120_000),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: { message: `Server returned ${res.status}` } }));
            throw new Error(errBody.error?.message || `Upload failed with status ${res.status}`);
          }
          const data = await res.json();
          if (!data.ifcUrl) throw new Error("R2 upload did not return ifcUrl");
          return data.ifcUrl as string;
        };

        // Find the primary IFC file and its source node
        let primaryFile: File | null = null;
        let primaryFileName = (inputData.fileName as string) ?? "model.ifc";
        let sourceNodeId = "";

        for (const [storeNodeId, fileObj] of inputFileStore.entries()) {
          if (fileObj.name.toLowerCase().endsWith(".ifc")) {
            primaryFile = fileObj;
            primaryFileName = fileObj.name;
            sourceNodeId = storeNodeId;
            break;
          }
        }

        if (!primaryFile) {
          throw new Error("No IFC file found. Please connect an IFC Upload (IN-004) node and upload a .ifc file.");
        }

        // Check for supplementary IFC files (structural, MEP)
        const structEntry = supplementaryIFCStore.get(`${sourceNodeId}:structural`);
        const mepEntry = supplementaryIFCStore.get(`${sourceNodeId}:mep`);
        const hasSupplementary = !!structEntry || !!mepEntry;

        if (hasSupplementary) {
          // Multi-model federation: upload all files to R2 and build ifcModels array
          try {
            const uploadPromises: Array<Promise<{ ifcUrl: string; discipline: string; fileName: string }>> = [];

            // Primary (Architecture)
            uploadPromises.push(
              uploadToR2(primaryFile).then(url => ({ ifcUrl: url, discipline: "Architecture", fileName: primaryFileName }))
            );

            // Structural
            if (structEntry) {
              uploadPromises.push(
                uploadToR2(structEntry.file).then(url => ({ ifcUrl: url, discipline: "Structural", fileName: structEntry.file.name }))
              );
            }

            // MEP
            if (mepEntry) {
              uploadPromises.push(
                uploadToR2(mepEntry.file).then(url => ({ ifcUrl: url, discipline: "MEP", fileName: mepEntry.file.name }))
              );
            }

            const ifcModels = await Promise.all(uploadPromises);
            inputData.ifcModels = ifcModels;
            inputData.fileName = primaryFileName;
          } catch (uploadErr) {
            const msg = uploadErr instanceof Error ? uploadErr.message : "Multi-model upload failed";
            console.error("[TR-016] Multi-model upload failed:", msg);
            throw new Error(`Failed to upload IFC files for clash detection. ${msg}`);
          }
        } else {
          // Single-model: upload primary file only
          try {
            const r2Url = await uploadToR2(primaryFile);
            inputData.ifcUrl = r2Url;
            inputData.fileName = primaryFileName;
          } catch (uploadErr) {
            const msg = uploadErr instanceof Error ? uploadErr.message : "IFC upload failed";
            console.error("[TR-016] Failed to upload IFC to R2:", msg);
            throw new Error(`Clash detection requires the raw IFC file to be uploaded. ${msg}`);
          }
        }
      }
      // ══════════════════════════════════════════════════════════════════════
      // END TR-016 special handling
      // ══════════════════════════════════════════════════════════════════════

      // For non-IFC nodes with large images: upload to temp-image first, pass URL instead
      // This prevents Vercel's 4.5MB body limit from rejecting the request.
      const IMAGE_ANALYSIS_NODES = new Set(["TR-004", "TR-005", "GN-003", "GN-007", "GN-008", "GN-009"]);
      if (inputData.fileData && typeof inputData.fileData === "string" && (inputData.fileData as string).length > 3_000_000) {
        if (IMAGE_ANALYSIS_NODES.has(catalogueId)) {
          // Upload large image to temp storage, replace fileData with URL
          try {
            const mimeType = (inputData.mimeType as string) ?? "image/jpeg";
            const uploadRes = await fetch("/api/temp-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ base64: inputData.fileData, contentType: mimeType }),
            });
            if (uploadRes.ok) {
              const { url } = await uploadRes.json();
              // Replace inline base64 with URL reference — TR-004 accepts both
              inputData.url = url;
              inputData.imageUrl = url;
              delete inputData.fileData;
              // Also upload additional images if present (multi-image IN-008 flow)
              if (inputData.fileDataArray && Array.isArray(inputData.fileDataArray)) {
                const arr = inputData.fileDataArray as string[];
                const mimeTypes = (inputData.mimeTypes as string[]) ?? [];
                const uploadedUrls: string[] = [url]; // first image already uploaded
                for (let fi = 1; fi < arr.length; fi++) {
                  if (arr[fi] && arr[fi].length > 0) {
                    try {
                      const fiRes = await fetch("/api/temp-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ base64: arr[fi], contentType: mimeTypes[fi] ?? "image/jpeg" }),
                      });
                      if (fiRes.ok) {
                        const { url: fiUrl } = await fiRes.json();
                        uploadedUrls.push(fiUrl);
                      }
                    } catch { /* continue with remaining images */ }
                  }
                }
                inputData.imageUrls = uploadedUrls;
                delete inputData.fileDataArray;
              }
            } else {
              console.warn("[exec] Temp image upload failed, stripping fileData");
              delete inputData.fileData;
            }
          } catch (err) {
            console.warn("[exec] Temp image upload error:", err);
            delete inputData.fileData;
          }
        } else {
          console.warn("[exec] Stripping large fileData to prevent Vercel 413 error");
          delete inputData.fileData;
        }
      }

      res = await fetch("/api/execute-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          catalogueId,
          executionId,
          tileInstanceId: node.id,
          inputData,
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({
        error: {
          title: "Request failed",
          message: "Unable to complete request",
          code: "UNKNOWN"
        }
      })) as APIErrorResponse;

      // Extract user-friendly error info
      const error = errorData.error;

      // Special handling for 429 Rate Limit errors. The code field is also
      // attached so callers can distinguish specific 429 reasons (RATE_001
      // monthly limit vs REGEN_001 regen cap reached vs node-type limits).
      if (res.status === 429) {
        const rateLimitError = new Error(error.message);
        (rateLimitError as unknown as Record<string, unknown>).status = 429;
        (rateLimitError as unknown as Record<string, unknown>).code = error.code;
        (rateLimitError as unknown as Record<string, unknown>).title = error.title;
        (rateLimitError as unknown as Record<string, unknown>).action = error.action;
        (rateLimitError as unknown as Record<string, unknown>).actionUrl = error.actionUrl;
        throw rateLimitError;
      }

      // Throw error with user-friendly message
      const err = new Error(error.message);
      (err as unknown as Record<string, unknown>).title = error.title;
      (err as unknown as Record<string, unknown>).code = error.code;
      (err as unknown as Record<string, unknown>).action = error.action;
      (err as unknown as Record<string, unknown>).actionUrl = error.actionUrl;
      throw err;
    }

    // Check rate limit remaining — warn user when running low
    const rlRemaining = res.headers.get("X-RateLimit-Remaining");
    const rlLimit = res.headers.get("X-RateLimit-Limit");
    if (rlRemaining !== null && rlLimit !== null) {
      const rem = parseInt(rlRemaining, 10);
      const lim = parseInt(rlLimit, 10);
      if (!isNaN(rem) && !isNaN(lim) && rem <= 2 && rem > 0) {
        toast.warning(`${rem} execution${rem === 1 ? "" : "s"} remaining this month (${lim} total)`, {
          description: "Upgrade your plan for more executions",
          action: { label: "Upgrade", onClick: () => { window.location.href = "/dashboard/billing"; } },
          duration: 8000,
        });
      }
    }

    const { artifact } = await res.json() as { artifact: ExecutionArtifact };
    return { ...artifact, createdAt: new Date() };
  }

  // SAFETY: LIVE nodes must NEVER use mock data — throw if we somehow got here
  if (LIVE_NODE_IDS.has(catalogueId)) {
    console.error(`[${catalogueId}] BUG: Live node reached mock fallback! This should never happen.`);
    throw new Error(`${catalogueId} requires real API execution but no API path was available. Check server configuration.`);
  }

  // Fall back to mock — pass upstream data so mocks can reflect user input
  console.info(`[${catalogueId}] Using demo/sample data (no real API for this node)`);
  return mockExecuteNode(
    catalogueId,
    executionId,
    node.id,
    (previousArtifact?.data ?? {}) as Record<string, unknown>
  );
}

const FLOW_DURATION_MS = 1600;

/** Simple string hash for cache comparison (not cryptographic) */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return hash.toString(36);
}

/** Fire-and-forget: download video from Kling and persist to R2 */
async function persistVideoToR2(
  videoUrl: string,
  filename: string,
  nodeId: string,
  addArtifactFn: (nodeId: string, artifact: ExecutionArtifact) => void,
  currentArtifact: ExecutionArtifact,
) {
  try {
    const res = await fetch("/api/persist-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoUrl, filename }),
    });
    if (!res.ok) {
      console.warn("[persist-video] Failed:", res.status);
      return;
    }
    const { persistedUrl } = await res.json();
    if (persistedUrl) {
      // Update artifact with persisted URL
      const data = { ...(currentArtifact.data as Record<string, unknown>), persistedUrl };
      addArtifactFn(nodeId, { ...currentArtifact, data });
    }
  } catch (err) {
    console.warn("[persist-video] Error (non-fatal):", err);
  }
}
const VIDEO_POLL_INTERVAL_MS = 6_000; // Poll every 6 seconds
const VIDEO_POLL_TIMEOUT_MS = 600_000; // 10 minute timeout

/** Abortable sleep — rejects with AbortError when signal is aborted */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

/** Poll /api/video-status for a SINGLE video task (floor plans) */
async function pollSingleVideoGeneration(
  nodeId: string,
  taskId: string,
  addArtifactFn: (nodeId: string, artifact: ExecutionArtifact) => void,
  setVideoProgressFn: (nodeId: string, state: { progress: number; status: "submitting" | "processing" | "complete" | "failed"; taskId?: string; failureMessage?: string }) => void,
  clearVideoProgressFn: (nodeId: string) => void,
  currentArtifactData: Record<string, unknown>,
  executionId: string,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;

  setVideoProgressFn(nodeId, { progress: 5, status: "processing", taskId });
  let warnedTimeout = false;

  while (Date.now() < deadline) {
    await abortableSleep(VIDEO_POLL_INTERVAL_MS, signal);

    // Warn user when 2 minutes remain
    if (!warnedTimeout && deadline - Date.now() < 120_000) {
      warnedTimeout = true;
      toast.warning("Video generation is taking longer than expected — 2 minutes remaining", { duration: 10000 });
    }

    try {
      const res = await fetch(`/api/video-status?taskId=${encodeURIComponent(taskId)}`, { signal });

      if (!res.ok) {
        console.error("[POLL] HTTP error:", res.status);
        continue;
      }

      const status = await res.json();

      setVideoProgressFn(nodeId, {
        progress: status.progress,
        status: status.isComplete ? "complete" : status.hasFailed ? "failed" : "processing",
        taskId,
        failureMessage: status.failureMessage ?? undefined,
      });

      if (status.hasFailed) {
        console.error("[POLL] Single video failed:", status.failureMessage);
        toast.error("Video generation failed", {
          description: status.failureMessage ?? "Unknown error",
          duration: 6000,
        });
        return;
      }

      if (status.isComplete && status.videoUrl) {
        const durationSec = (currentArtifactData.durationSeconds as number) || 10;
        const isOmni = currentArtifactData.usedOmni === true;
        const labelPrefix = isOmni ? "Kling 3.0 Walkthrough" : "Cinematic Walkthrough";

        const finalArtifact: ExecutionArtifact = {
          id: `video-${nodeId}`,
          executionId,
          tileInstanceId: nodeId,
          type: "video",
          data: {
            ...currentArtifactData,
            videoUrl: status.videoUrl,
            downloadUrl: status.videoUrl,
            label: `${labelPrefix} — ${durationSec}s · 1 shot`,
            videoGenerationStatus: "complete",
            generationProgress: 100,
            durationSeconds: durationSec,
            shotCount: 1,
          },
          metadata: { engine: "kling-official", real: true, usedOmni: isOmni },
          createdAt: new Date(),
        };

        addArtifactFn(nodeId, finalArtifact);
        clearVideoProgressFn(nodeId);

        toast.success("Video walkthrough ready!", {
          description: `${durationSec}s ${isOmni ? "Kling 3.0" : "cinematic"} walkthrough generated successfully`,
          duration: 5000,
        });
        return;
      }
    } catch (err) {
      console.error("[POLL] Error:", err);
    }
  }

  // Timeout
  setVideoProgressFn(nodeId, {
    progress: 0,
    status: "failed",
    failureMessage: "Video generation timed out after 10 minutes",
  });
  toast.error("Video generation timed out", { duration: 6000 });
}

/** Poll /api/video-status until video generation completes or fails (DUAL mode) */
async function pollVideoGeneration(
  nodeId: string,
  exteriorTaskId: string,
  interiorTaskId: string,
  addArtifactFn: (nodeId: string, artifact: ExecutionArtifact) => void,
  setVideoProgressFn: (nodeId: string, state: { progress: number; status: "submitting" | "processing" | "complete" | "failed"; exteriorTaskId?: string; interiorTaskId?: string; failureMessage?: string }) => void,
  clearVideoProgressFn: (nodeId: string) => void,
  currentArtifactData: Record<string, unknown>,
  executionId: string,
  videoPipeline: "image2video" | "text2video" = "image2video",
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;

  setVideoProgressFn(nodeId, {
    progress: 5,
    status: "processing",
    exteriorTaskId,
    interiorTaskId,
  });
  let warnedTimeout = false;

  while (Date.now() < deadline) {
    await abortableSleep(VIDEO_POLL_INTERVAL_MS, signal);

    // Warn user when 2 minutes remain
    if (!warnedTimeout && deadline - Date.now() < 120_000) {
      warnedTimeout = true;
      toast.warning("Video generation is taking longer than expected — 2 minutes remaining", { duration: 10000 });
    }

    try {
      const res = await fetch(
        `/api/video-status?exteriorTaskId=${encodeURIComponent(exteriorTaskId)}&interiorTaskId=${encodeURIComponent(interiorTaskId)}&pipeline=${videoPipeline}`,
        { signal },
      );

      if (!res.ok) {
        console.error("[POLL] HTTP error:", res.status);
        continue; // Retry on server errors
      }

      const status = await res.json();

      // Update progress in store
      setVideoProgressFn(nodeId, {
        progress: status.progress,
        status: status.isComplete ? "complete" : status.hasFailed ? "failed" : "processing",
        exteriorTaskId,
        interiorTaskId,
        failureMessage: status.failureMessage ?? undefined,
      });

      if (status.hasFailed) {
        console.error("[Video Poll] Generation failed:", status.failureMessage);
        toast.error("Video generation failed", {
          description: status.failureMessage ?? "Unknown error",
          duration: 6000,
        });
        // Keep the "failed" state visible — don't clear it
        return;
      }

      if (status.isComplete) {
        // Both clips ready — stitch into one 15s video via ffmpeg
        setVideoProgressFn(nodeId, {
          progress: 90,
          status: "processing",
          exteriorTaskId,
          interiorTaskId,
          failureMessage: undefined,
        });

        // Build segments array for sequential playback (no server-side concat needed)
        const isRenovation = !!(currentArtifactData?.isRenovation);
        const exteriorDuration = isRenovation ? 10 : 5;
        const segments: { videoUrl: string; downloadUrl: string; durationSeconds: number; label: string }[] = [];
        if (status.exteriorVideoUrl) {
          segments.push({ videoUrl: status.exteriorVideoUrl, downloadUrl: status.exteriorVideoUrl, durationSeconds: exteriorDuration, label: `Exterior — ${exteriorDuration}s` });
        }
        if (status.interiorVideoUrl) {
          segments.push({ videoUrl: status.interiorVideoUrl, downloadUrl: status.interiorVideoUrl, durationSeconds: 10, label: "Interior — 10s" });
        }

        // Use exterior as primary videoUrl for backward compat, but segments drive playback
        const finalVideoUrl = status.exteriorVideoUrl ?? "";

        const finalArtifact: ExecutionArtifact = {
          id: `video-${nodeId}`,
          executionId,
          tileInstanceId: nodeId,
          type: "video",
          data: {
            ...currentArtifactData,
            videoUrl: finalVideoUrl,
            downloadUrl: finalVideoUrl,
            interiorVideoUrl: status.interiorVideoUrl ?? "",
            segments,
            label: "Cinematic Walkthrough — 15s · 2 shots",
            videoGenerationStatus: "complete",
            generationProgress: 100,
            durationSeconds: 15,
            shotCount: 2,
          },
          metadata: { engine: "kling-official", real: true },
          createdAt: new Date(),
        };

        addArtifactFn(nodeId, finalArtifact);
        clearVideoProgressFn(nodeId);

        toast.success("Video walkthrough ready!", {
          description: "15s cinematic walkthrough generated successfully",
          duration: 5000,
        });
        return;
      }
    } catch (err) {
      console.error("[Video Poll] Error:", err);
      // Continue polling on network errors
    }
  }

  // Timeout
  setVideoProgressFn(nodeId, {
    progress: 0,
    status: "failed",
    failureMessage: "Video generation timed out after 10 minutes",
  });
  toast.error("Video generation timed out", { duration: 6000 });
  // Keep the "failed" state visible — don't clear it
}

/** Client-side Three.js walkthrough rendering */
async function renderClientWalkthrough(
  nodeId: string,
  artifactData: Record<string, unknown>,
  executionId: string,
  addArtifactFn: (nodeId: string, artifact: ExecutionArtifact) => void,
  setVideoProgressFn: (nodeId: string, state: { progress: number; status: "submitting" | "processing" | "rendering" | "complete" | "failed"; phase?: string; failureMessage?: string }) => void,
  clearVideoProgressFn: (nodeId: string) => void,
): Promise<void> {
  setVideoProgressFn(nodeId, {
    progress: 0,
    status: "rendering",
    phase: "Initializing",
  });

  try {
    // Dynamic import for code splitting
    const { renderWalkthrough } = await import("@/features/3d-render/services/walkthrough-renderer");

    const buildingConfig = artifactData._buildingConfig as {
      floors?: number;
      floorHeight?: number;
      footprint?: number;
      buildingType?: string;
      style?: Record<string, unknown>;
    } | undefined;

    const result = await renderWalkthrough({
      floors: buildingConfig?.floors ?? 5,
      floorHeight: buildingConfig?.floorHeight ?? 3.6,
      footprint: buildingConfig?.footprint ?? 600,
      buildingType: buildingConfig?.buildingType,
      style: buildingConfig?.style,
      onProgress: (percent, phase) => {
        setVideoProgressFn(nodeId, {
          progress: percent,
          status: percent >= 100 ? "complete" : "rendering",
          phase,
        });
      },
    });

    // Build the final artifact with the rendered video blob URL
    const finalArtifact: ExecutionArtifact = {
      id: `video-${nodeId}`,
      executionId,
      tileInstanceId: nodeId,
      type: "video",
      data: {
        ...artifactData,
        videoUrl: result.blobUrl,
        downloadUrl: result.blobUrl,
        label: "AEC Cinematic Walkthrough — 15s Three.js Render",
        videoGenerationStatus: "complete",
        generationProgress: 100,
        durationSeconds: result.durationSeconds,
        pipeline: `Three.js client-side → WebM (${result.resolution.width}x${result.resolution.height}, ${result.fps}fps, ${(result.fileSizeBytes / 1024 / 1024).toFixed(1)}MB)`,
      },
      metadata: { engine: "threejs-client", real: false },
      createdAt: new Date(),
    };

    addArtifactFn(nodeId, finalArtifact);
    clearVideoProgressFn(nodeId);

    toast.success("Video walkthrough ready!", {
      description: `15s AEC walkthrough rendered (${(result.fileSizeBytes / 1024 / 1024).toFixed(1)}MB)`,
      duration: 5000,
    });
  } catch (err) {
    console.error("[Client Render] Failed:", err);
    setVideoProgressFn(nodeId, {
      progress: 0,
      status: "failed",
      phase: "Error",
      failureMessage: err instanceof Error ? err.message : "Rendering failed",
    });
    toast.error("Video rendering failed", {
      description: err instanceof Error ? err.message : "Unknown error",
      duration: 6000,
    });
    // Don't clear progress — keep the "failed" state visible so the user sees the error
  }
}

interface UseExecutionOptions {
  onLog?: (entry: LogEntry) => void;
}

interface RateLimitInfo {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

interface TopologicalSortResult {
  sorted: WorkflowNode[];
  hasCycle: boolean;
  cycleNodeLabels: string[];
  disconnectedNodes: WorkflowNode[];
}

// Topological sort using Kahn's algorithm — detects cycles and disconnected nodes
function topologicalSort(nodes: WorkflowNode[], edges: { source: string; target: string }[]): TopologicalSortResult {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    graph.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (graph.has(edge.source) && inDegree.has(edge.target)) {
      graph.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  // Start with nodes that have no incoming edges
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  const sorted: WorkflowNode[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = nodeMap.get(current);
    if (node) sorted.push(node);

    for (const neighbor of graph.get(current) || []) {
      inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1);
      if (inDegree.get(neighbor) === 0) queue.push(neighbor);
    }
  }

  const sortedIds = new Set(sorted.map(n => n.id));
  const unreached = nodes.filter(n => !sortedIds.has(n.id));

  // Determine which unreached nodes are in cycles vs truly disconnected
  // Nodes in a cycle have remaining inDegree > 0 after Kahn's
  // Truly disconnected (no edges at all) have inDegree 0 — but these are always processed
  // So all unreached after Kahn's = cycle participants
  const cycleNodes = unreached.filter(n => (inDegree.get(n.id) ?? 0) > 0);
  const disconnectedNodes = unreached.filter(n => (inDegree.get(n.id) ?? 0) === 0);

  // Append genuinely disconnected nodes (sorted by x-position) to execution order
  sorted.push(...disconnectedNodes.sort((a, b) => a.position.x - b.position.x));

  return {
    sorted,
    hasCycle: cycleNodes.length > 0,
    cycleNodeLabels: cycleNodes.map(n => n.data.label),
    disconnectedNodes,
  };
}

// Find upstream artifact for a node by looking at incoming edges
function getUpstreamArtifact(
  nodeId: string,
  edges: { source: string; target: string }[],
  artifactMap: Map<string, ExecutionArtifact>
): ExecutionArtifact | null {
  const incomingEdges = edges.filter(e => e.target === nodeId);

  if (incomingEdges.length === 0) return null;

  if (incomingEdges.length === 1) {
    return artifactMap.get(incomingEdges[0].source) ?? null;
  }

  // Multiple inputs — merge data from all upstream nodes
  const mergedData: Record<string, unknown> = {};
  let firstArtifact: ExecutionArtifact | null = null;

  for (const edge of incomingEdges) {
    const artifact = artifactMap.get(edge.source);
    if (artifact) {
      if (!firstArtifact) firstArtifact = artifact;
      if (artifact.data && typeof artifact.data === "object") {
        const dataKeys = Object.keys(artifact.data as Record<string, unknown>).filter(k => k.startsWith("_"));
        Object.assign(mergedData, artifact.data);
      }
    } else {
      console.warn(`[merge] Node ${nodeId} ← source ${edge.source}: NO ARTIFACT FOUND in map`);
    }
  }

  const mergedUnderscoreKeys = Object.keys(mergedData).filter(k => k.startsWith("_"));

  if (!firstArtifact) return null;

  return { ...firstArtifact, data: mergedData };
}

export function useExecution({ onLog }: UseExecutionOptions = {}) {
  const nodes = useWorkflowStore(s => s.nodes);
  const workflowEdges = useWorkflowStore(s => s.edges);
  const currentWorkflow = useWorkflowStore(s => s.currentWorkflow);
  const updateNodeStatus = useWorkflowStore(s => s.updateNodeStatus);
  const setEdgeFlowing = useWorkflowStore(s => s.setEdgeFlowing);
  const {
    startExecution,
    addTileResult,
    addArtifact,
    completeExecution,
    setProgress,
    isExecuting,
    isRateLimited,
    setRateLimited,
    incrementRegenCount,
    decrementRegenCount,
    getRegenRemaining,
    setRegeneratingNode,
    regeneratingNodeId,
    artifacts,
    setVideoGenProgress,
    clearVideoGenProgress,
  } = useExecutionStore();
  
  const isDemoMode = useUIStore(s => s.isDemoMode);
  const [rateLimitHit, setRateLimitHit] = useState<RateLimitInfo | null>(null);

  // AbortController for cancelling background polling on unmount
  const pollAbortRef = useRef<AbortController | null>(null);

  // Cleanup polling on unmount to prevent memory leaks (#20)
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
    };
  }, []);

  // Warn user before navigating away during execution
  useEffect(() => {
    if (!isExecuting) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Workflow is still running. Are you sure you want to leave?";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isExecuting]);

  const log = useCallback((type: LogEntry["type"], message: string, detail?: string) => {
    onLog?.({ timestamp: new Date(), type, message, detail });
  }, [onLog]);

  const runWorkflow = useCallback(async () => {
    if (isExecuting) return;

    // Guard: empty canvas
    if (nodes.length === 0) {
      toast.error("Add at least one node to run a workflow");
      return;
    }

    // Guard: cycle detection (run before expensive validation)
    const sortCheck = topologicalSort(nodes as WorkflowNode[], workflowEdges);
    if (sortCheck.hasCycle) {
      toast.error("Circular connection detected. Please remove the loop and try again.", {
        description: `Cycle involves: ${sortCheck.cycleNodeLabels.join(", ")}`,
        duration: 6000,
      });
      return;
    }

    // Guard: warn about disconnected nodes
    if (sortCheck.disconnectedNodes.length > 0) {
      for (const dn of sortCheck.disconnectedNodes) {
        console.warn(`[useExecution] Skipping disconnected node: ${dn.data.label}`);
      }
      toast.warning(
        `${sortCheck.disconnectedNodes.length} node${sortCheck.disconnectedNodes.length > 1 ? "s are" : " is"} not connected and will be skipped.`,
        { duration: 4000 }
      );
    }

    // Guard: validate input nodes before starting
    for (const node of nodes as WorkflowNode[]) {
      const catalogueId = node.data.catalogueId;
      // Text Prompt (IN-001): must have non-empty text
      if (catalogueId === "IN-001") {
        const val = (node.data.inputValue as string | undefined) ?? "";
        if (!val.trim()) {
          toast.error("Please enter text in the Text Prompt node before running");
          return;
        }
        if (val.length > 4000) {
          toast.error("Text is too long (maximum 4,000 characters). Try shortening your description.", {
            description: `Current length: ${val.length} characters`,
          });
          return;
        }
      }
      // File upload nodes: must have a file selected (check both node.data and inputFileStore)
      // IN-005 (Parameter Input) and IN-006 (Location Input) have built-in defaults — not file upload nodes
      if (["IN-002", "IN-003", "IN-004"].includes(catalogueId)) {
        const nd = node.data as Record<string, unknown>;
        if (!nd.fileData && !nd.inputValue && !inputFileStore.has(node.id)) {
          toast.error(`Please upload a file to the "${node.data.label}" node before running`);
          return;
        }
      }
      // IFC Upload (IN-004): validate file is actually an IFC file before running
      if (catalogueId === "IN-004") {
        const nd = node.data as Record<string, unknown>;
        // Get filename from node data OR inputFileStore (covers all upload paths)
        const fileObj = inputFileStore.get(node.id);
        const fileName = (
          (nd.inputValue as string) || (nd.fileName as string) || fileObj?.name || ""
        ).toLowerCase().trim();

        // Check 1: File extension must be .ifc
        if (fileName && !fileName.endsWith(".ifc")) {
          const displayName = nd.inputValue || nd.fileName || fileObj?.name || "Unknown file";
          toast.error("Invalid file type — please upload a valid IFC file (.ifc)", {
            description: `"${displayName}" is not an IFC file. The IFC → BOQ workflow requires a Building Information Model in IFC format (ISO 16739).`,
            duration: 8000,
          });
          return;
        }

        // Check 2: If no filename at all but a file exists, warn about missing extension
        if (!fileName && (nd.fileData || fileObj)) {
          toast.error("Cannot determine file type — please re-upload a valid .ifc file", {
            duration: 6000,
          });
          return;
        }

        // Check 3: Validate IFC header in base64 data (catches renamed non-IFC files)
        const fileData = nd.fileData as string | undefined;
        if (fileData && fileData.length >= 20) {
          try {
            // Align slice to 4-char base64 boundary for safe atob decode
            const sliceLen = Math.min(fileData.length, 40);
            const aligned = sliceLen - (sliceLen % 4);
            if (aligned >= 4) {
              const headerBytes = atob(fileData.slice(0, aligned));
              if (!headerBytes.startsWith("ISO-10303-21")) {
                toast.error("Invalid IFC file — this file does not contain valid IFC data", {
                  description: "The uploaded file does not have a valid IFC header (ISO-10303-21). It may have been renamed from another format. Please upload a genuine BIM model in IFC format.",
                  duration: 8000,
                });
                return;
              }
            }
          } catch {
            // base64 decode failed — likely corrupted data, let server handle
          }
        }
      }
    }

    const executionId = generateId();
    const execution: Execution = {
      id: executionId,
      workflowId: currentWorkflow?.id ?? "unsaved",
      userId: "demo",
      status: "running",
      startedAt: new Date(),
      tileResults: [],
      createdAt: new Date(),
    };

    startExecution(execution);
    log("start", "Workflow execution started", `${nodes.length} nodes queued`);

    // Determine if we should use real execution (OPENAI_API_KEY configured)
    const useReal = process.env.NEXT_PUBLIC_ENABLE_MOCK_EXECUTION !== "true";

    toast.success("Workflow running…", { duration: 2000 });

    // Auto-save workflow before execution so results can be persisted to DB
    let dbExecutionId: string | null = null;
    let workflowId = currentWorkflow?.id;
    const isPersisted = workflowId && workflowId.length >= 20 && workflowId.startsWith("c");

    if (!isDemoMode && !isPersisted) {
      // Workflow not yet saved — save it first so we have a DB ID for execution records
      try {
        const { saveWorkflow } = useWorkflowStore.getState();
        const savedId = await saveWorkflow();
        if (savedId) {
          workflowId = savedId;
          log("info", "Workflow auto-saved before execution", savedId);
          // Update URL so refresh can restore this workflow
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            if (!url.searchParams.has("id")) {
              url.searchParams.set("id", savedId);
              window.history.replaceState({}, "", url.toString());
            }
          }
        }
      } catch {
        // Non-fatal — continue with execution even if save fails
      }
    }

    // Persist execution to DB if workflow is saved (skip in demo mode)
    if (!isDemoMode && workflowId && workflowId.length >= 20 && workflowId.startsWith("c")) {
      try {
        const res = await fetch("/api/executions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId, triggerType: "manual" }),
        });
        if (res.ok) {
          const { execution: dbEx } = await res.json() as { execution: { id: string } };
          dbExecutionId = dbEx.id;
          log("info", "Execution record created", dbExecutionId);
        }
      } catch {
        // Non-fatal — DB save is best-effort
      }
    }

    // Reuse already-computed topological sort (cycle check already passed above)
    const orderedNodes = sortCheck.sorted;

    let hasError = false;
    // Map of nodeId → artifact for edge-based data routing
    const artifactMap = new Map<string, ExecutionArtifact>();

    for (let i = 0; i < orderedNodes.length; i++) {
      const node = orderedNodes[i] as WorkflowNode;
      setProgress(Math.round((i / orderedNodes.length) * 100));

      updateNodeStatus(node.id, "running");
      log("running", `Running: ${node.data.label}`, node.data.catalogueId);

      try {
        // Get upstream data from connected nodes (via edges), not just previous in array
        const upstreamArtifact = getUpstreamArtifact(node.id, workflowEdges, artifactMap);

        // ── Cache check for image nodes (GN-003) — reuse DALL-E render if upstream unchanged ──
        const nodeCatalogueId = (node.data as { catalogueId: string }).catalogueId;
        if (nodeCatalogueId === "GN-003") {
          const prevArtifacts = useExecutionStore.getState().previousArtifacts;
          const prevArtifact = prevArtifacts.get(node.id);
          if (prevArtifact && prevArtifact.type === "image") {
            const prevHash = (prevArtifact.metadata as Record<string, unknown>)?._upstreamHash as string | undefined;
            const curHash = simpleHash(
              JSON.stringify(upstreamArtifact?.data ?? {}) +
              String((node.data as Record<string, unknown>).viewType ?? "exterior"),
            );
            if (prevHash && prevHash === curHash) {
              log("info", `${node.data.label} — reusing cached render (same input)`, "cache-hit");
              toast.info(`${node.data.label}: reusing cached render`, { duration: 2000 });
              artifactMap.set(node.id, prevArtifact);
              addArtifact(node.id, prevArtifact);
              addTileResult({
                tileInstanceId: node.id,
                catalogueId: node.data.catalogueId,
                status: "success",
                startedAt: new Date(),
                completedAt: new Date(),
                artifact: prevArtifact,
              });
              updateNodeStatus(node.id, "success");
              setEdgeFlowing(node.id, true);
              setTimeout(() => setEdgeFlowing(node.id, false), FLOW_DURATION_MS);
              continue;
            }
          }
        }

        // For GN-009 (Video): ensure uploaded image data reaches the node
        // regardless of edge structure — search ALL artifacts for fileData/imageUrl
        if (nodeCatalogueId === "GN-009" && upstreamArtifact) {
          const upData = upstreamArtifact.data as Record<string, unknown>;
          if (!upData.fileData && !upData.url && !upData.imageUrl) {
            for (const [, art] of artifactMap) {
              const d = art.data as Record<string, unknown>;
              const artMime = (d?.mimeType as string) ?? "";
              // Only inject actual image files — skip PDFs/docs (they use text2video path)
              if (d?.fileData && typeof d.fileData === "string" && artMime.startsWith("image/")) {
                upData.fileData = d.fileData;
                if (d.mimeType) upData.mimeType = d.mimeType;
                if (d.fileName) upData.fileName = d.fileName;
                break;
              }
              if (d?.imageUrl && typeof d.imageUrl === "string") {
                upData.imageUrl = d.imageUrl;
                upData.url = d.imageUrl;
                break;
              }
            }
          }
        }

        const artifact = await executeNode(node, executionId, upstreamArtifact, useReal, isDemoMode);
        artifactMap.set(node.id, artifact);

        // Stamp upstream hash on image artifacts for future cache detection
        if (nodeCatalogueId === "GN-003" && artifact.type === "image") {
          const upHash = simpleHash(
            JSON.stringify(upstreamArtifact?.data ?? {}) +
            String((node.data as Record<string, unknown>).viewType ?? "exterior"),
          );
          artifact.metadata = { ...artifact.metadata, _upstreamHash: upHash };
        }

        addArtifact(node.id, artifact);
        addTileResult({
          tileInstanceId: node.id,
          catalogueId: node.data.catalogueId,
          status: "success",
          startedAt: new Date(),
          completedAt: new Date(),
          artifact,
        });

        updateNodeStatus(node.id, "success");
        log("success", `${node.data.label} completed`, String(artifact.type));
        trackNodeUsed(node.data.catalogueId, node.data.label);

        // If this is a video node with background generation, start polling or client rendering
        const artData = artifact.data as Record<string, unknown> | undefined;
        if (artifact.type === "video" && artData?.videoGenerationStatus) {
          if (
            artData.videoGenerationStatus === "processing" &&
            artData.taskId &&
            !artData.exteriorTaskId
          ) {
            // Single video path (floor plans): poll single task
            log("info", "Single video generation started — polling for progress");
            toast.info("Video generating in background...", {
              description: "10s AEC walkthrough — you'll be notified when it's ready",
              duration: 5000,
            });

            const taskIdStr = artData.taskId as string;
            // Create new AbortController for this poll (aborts previous if any)
            pollAbortRef.current?.abort();
            const pollCtrl = new AbortController();
            pollAbortRef.current = pollCtrl;
            pollSingleVideoGeneration(
              node.id,
              taskIdStr,
              addArtifact,
              setVideoGenProgress,
              clearVideoGenProgress,
              artData,
              executionId,
              pollCtrl.signal,
            ).catch(err => {
              if (err instanceof DOMException && err.name === "AbortError") return; // expected on unmount
              console.error("[Video Poll] Unhandled error:", err);
            });
          } else if (
            artData.videoGenerationStatus === "processing" &&
            artData.exteriorTaskId &&
            artData.interiorTaskId
          ) {
            // Dual video path (concept renders): poll both tasks via Kling API
            const pipeline = (artData.videoPipeline as string) === "text2video" ? "text2video" as const : "image2video" as const;
            log("info", `Dual video generation started in background (${pipeline}) — polling for progress`);
            toast.info("Video generating in background...", {
              description: pipeline === "text2video"
                ? "15s ultra-realistic walkthrough from PDF summary — you'll be notified when it's ready"
                : "15s AEC walkthrough — you'll be notified when it's ready",
              duration: 5000,
            });

            // Create new AbortController for this poll (aborts previous if any)
            pollAbortRef.current?.abort();
            const dualPollCtrl = new AbortController();
            pollAbortRef.current = dualPollCtrl;
            pollVideoGeneration(
              node.id,
              artData.exteriorTaskId as string,
              artData.interiorTaskId as string,
              addArtifact,
              setVideoGenProgress,
              clearVideoGenProgress,
              artData,
              executionId,
              pipeline,
              dualPollCtrl.signal,
            ).catch(err => {
              if (err instanceof DOMException && err.name === "AbortError") return; // expected on unmount
              console.error("[Video Poll] Unhandled error:", err);
            });
          } else if (artData.videoGenerationStatus === "client-rendering") {
            // Three.js client-side rendering path
            log("info", "Starting client-side Three.js walkthrough rendering");
            toast.info("Rendering 15s walkthrough...", {
              description: "Three.js AEC cinematic walkthrough — rendering in your browser",
              duration: 5000,
            });

            // Fire-and-forget: render in background
            renderClientWalkthrough(
              node.id,
              artData,
              executionId,
              addArtifact,
              setVideoGenProgress,
              clearVideoGenProgress,
            ).catch(err => {
              console.error("[Client Render] Unhandled error:", err);
              setVideoGenProgress(node.id, {
                progress: 0,
                status: "failed",
                phase: "Error",
                failureMessage: err instanceof Error ? err.message : "Rendering failed",
              });
            });
          }
        }

        // Show warnings if any
        if (artifact.metadata?.warnings && Array.isArray(artifact.metadata.warnings)) {
          for (const warning of artifact.metadata.warnings) {
            toast.warning(warning, { duration: 4000 });
          }
        }

        // Persist artifact to DB (stored in tileResults JSON on the Execution)
        if (dbExecutionId) {
          fetch(`/api/executions/${dbExecutionId}/artifacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeId: node.id,
              nodeLabel: node.data.label,
              type: artifact.type,
              title: String(artifact.type),
              data: artifact.data,
            }),
          }).catch((err) => { console.error("[useExecution] Failed to persist artifact:", err); });
        }

        // Animate outgoing edges as data flows to the next node
        setEdgeFlowing(node.id, true);
        setTimeout(() => setEdgeFlowing(node.id, false), FLOW_DURATION_MS);

      } catch (error) {
        const errRecord = error as unknown as Record<string, unknown>;
        const errTitle = (errRecord.title as string) || "Error";
        // Robust error message extraction — handles Error instances, plain objects, and strings
        let errMsg: string;
        if (error instanceof Error) {
          errMsg = error.message || error.name || String(error);
        } else if (typeof error === "string") {
          errMsg = error;
        } else if (error && typeof error === "object") {
          errMsg = (error as Record<string, unknown>).message as string
            || (error as Record<string, unknown>).error as string
            || JSON.stringify(error);
        } else {
          errMsg = "Unknown error";
        }
        // Catch fetch aborts (dev server timeout / connection reset)
        if (error instanceof TypeError && errMsg === "Failed to fetch") {
          errMsg = "Server connection lost — the request may have timed out. Check the terminal for server-side errors.";
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          errMsg = "Request was aborted — server may have timed out for long-running AI generation.";
        }
        const errAction = errRecord.action as string | undefined;
        const errActionUrl = errRecord.actionUrl as string | undefined;

        // Check if this is a rate limit error — must stop execution
        if (errRecord.status === 429) {
          hasError = true;
          updateNodeStatus(node.id, "error");
          log("error", "Rate limit exceeded", errMsg);
          setRateLimited(true); // persist in store for UI to react immediately
          setRateLimitHit({
            title: errTitle,
            message: errMsg,
            action: errAction,
            actionUrl: errActionUrl,
          });
          addTileResult({
            tileInstanceId: node.id,
            catalogueId: node.data.catalogueId,
            status: "error",
            startedAt: new Date(),
            completedAt: new Date(),
            errorMessage: errMsg,
          });
          break;
        }

        // LIVE nodes must NEVER fall back to mock — they hard-fail so the user
        // sees the real error instead of getting silent garbage data.
        // This covers GN-009 (Video Walkthrough / Kling), TR-001 (Brief Parser), and all other LIVE nodes.
        if (LIVE_NODE_IDS.has(node.data.catalogueId)) {
          hasError = true;
          updateNodeStatus(node.id, "error");
          console.error(`[${node.data.catalogueId} LIVE-FAIL] Real execution failed — NO mock fallback for live nodes. Error: ${errMsg}`, error);
          log("error", `${node.data.label} failed`, errMsg);
          toast.error(errTitle || `${node.data.label} failed`, {
            description: errMsg,
            duration: 8000,
          });
          addTileResult({
            tileInstanceId: node.id,
            catalogueId: node.data.catalogueId,
            status: "error",
            startedAt: new Date(),
            completedAt: new Date(),
            errorMessage: errMsg,
          });
          break;
        }

        // Non-fatal error for non-LIVE nodes — fall back to mock execution and continue
        console.error(`[${node.data.catalogueId} FALLBACK] Real execution failed, falling back to mock.`, {
          catalogueId: node.data.catalogueId,
          label: node.data.label,
          error: errMsg,
        });
        log("error", `${node.data.label} failed — falling back to mock`, errMsg);
        toast.error(`${node.data.label}: using mock data`, {
          description: errMsg,
          duration: 5000,
        });

        try {
          const upstreamArtifact = getUpstreamArtifact(node.id, workflowEdges, artifactMap);
          const mockArtifact = await mockExecuteNode(
            node.data.catalogueId,
            executionId,
            node.id,
            ((upstreamArtifact?.data ?? {}) as Record<string, unknown>)
          );
          artifactMap.set(node.id, mockArtifact);
          addArtifact(node.id, mockArtifact);
          addTileResult({
            tileInstanceId: node.id,
            catalogueId: node.data.catalogueId,
            status: "success",
            startedAt: new Date(),
            completedAt: new Date(),
            artifact: mockArtifact,
          });
          updateNodeStatus(node.id, "success");
          log("info", `${node.data.label} completed with mock fallback`);

          // Check if mock artifact requires background video generation (same as success path)
          const mockArtData = mockArtifact.data as Record<string, unknown> | undefined;
          if (mockArtifact.type === "video" && mockArtData?.videoGenerationStatus === "client-rendering") {
            log("info", "Starting client-side Three.js walkthrough rendering (mock fallback)");
            toast.info("Rendering 15s walkthrough...", {
              description: "Three.js AEC cinematic walkthrough — rendering in your browser",
              duration: 5000,
            });
            renderClientWalkthrough(
              node.id,
              mockArtData,
              executionId,
              addArtifact,
              setVideoGenProgress,
              clearVideoGenProgress,
            ).catch(err => {
              console.error("[Client Render] Unhandled error:", err);
              setVideoGenProgress(node.id, {
                progress: 0,
                status: "failed",
                phase: "Error",
                failureMessage: err instanceof Error ? err.message : "Rendering failed",
              });
            });
          }

          setEdgeFlowing(node.id, true);
          setTimeout(() => setEdgeFlowing(node.id, false), FLOW_DURATION_MS);
        } catch {
          // Mock also failed — mark error but continue pipeline
          hasError = true;
          updateNodeStatus(node.id, "error");
          addTileResult({
            tileInstanceId: node.id,
            catalogueId: node.data.catalogueId,
            status: "error",
            startedAt: new Date(),
            completedAt: new Date(),
            errorMessage: errMsg,
          });
        }
      }
    }

    setProgress(100);
    completeExecution(hasError ? "partial" : "success");
    log(hasError ? "error" : "success",
      hasError ? "Workflow completed with errors" : "Workflow completed successfully",
      `${orderedNodes.length} nodes executed`
    );

    // Update DB execution status
    if (dbExecutionId) {
      fetch(`/api/executions/${dbExecutionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: hasError ? "PARTIAL" : "SUCCESS" }),
      }).catch((err) => { console.error("[useExecution] Failed to update execution status:", err); });
    }

    // Track workflow execution analytics
    const catalogueIds = orderedNodes.map(n => (n.data as { catalogueId: string }).catalogueId);
    trackWorkflowExecuted(orderedNodes.length, catalogueIds);

    if (!hasError) {
      toast.success("Workflow completed", {
        description: `${orderedNodes.length} nodes executed`,
        duration: 4000,
      });

      // Award XP for workflow run (fire-and-forget)
      awardXP("workflow-run");
      awardXP("workflow-run-repeat");

      // Check for special node achievements
      const usedCatalogueIds = new Set(catalogueIds);
      if (usedCatalogueIds.has("GN-003")) {
        awardXP("render-generated");
      }
      if (usedCatalogueIds.has("TR-008") && usedCatalogueIds.has("EX-002")) {
        awardXP("boq-generated");
      }
    }
  }, [
    nodes,
    workflowEdges,
    currentWorkflow,
    isExecuting,
    isDemoMode,
    startExecution,
    updateNodeStatus,
    setEdgeFlowing,
    addArtifact,
    addTileResult,
    completeExecution,
    setProgress,
    setRateLimited,
    setVideoGenProgress,
    clearVideoGenProgress,
    log,
  ]);

  const regenerateNode = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId) as WorkflowNode | undefined;
    if (!node || isExecuting || regeneratingNodeId) return;

    const remaining = getRegenRemaining(nodeId);
    if (remaining <= 0) {
      toast.error("Maximum regeneration attempts reached", { description: "You can regenerate each node up to 3 times per execution." });
      return;
    }

    if (!incrementRegenCount(nodeId)) return;

    setRegeneratingNode(nodeId);
    updateNodeStatus(nodeId, "running");

    const useReal = process.env.NEXT_PUBLIC_ENABLE_MOCK_EXECUTION !== "true";
    const executionId = useExecutionStore.getState().currentExecution?.id ?? generateId();

    try {
      const upstreamArtifact = getUpstreamArtifact(nodeId, workflowEdges, artifacts);
      const artifact = await executeNode(node, executionId, upstreamArtifact, useReal, isDemoMode);
      addArtifact(nodeId, artifact);
      updateNodeStatus(nodeId, "success");
      trackRegenerationUsed(nodeId, node.data.catalogueId);
      toast.success(`${node.data.label} regenerated`, { duration: 2000 });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Regeneration failed";
      const errAny = error as Record<string, unknown> | null;
      const errStatus = typeof errAny?.status === "number" ? errAny.status : null;
      const errCode = typeof errAny?.code === "string" ? errAny.code : null;

      // Server-side regen cap reached (Phase 2 Task 4). The server returned
      // 429 / REGEN_001 BEFORE running the handler, so the optimistic local
      // increment must be rolled back to keep the "X regens left" UI in sync
      // with the server state. Status restores to "success" — for a regen
      // to even be attempted, the node had to have a prior successful run.
      if (errStatus === 429 && errCode === "REGEN_001") {
        decrementRegenCount(nodeId);
        updateNodeStatus(nodeId, "success");
        toast.error("Maximum regeneration attempts reached", {
          description: "You can regenerate each node up to 3 times per execution. Run the workflow again to start over.",
        });
      } else {
        updateNodeStatus(nodeId, "error");
        toast.error(`Regeneration failed: ${errMsg}`);
      }
    } finally {
      setRegeneratingNode(null);
    }
  }, [nodes, isExecuting, regeneratingNodeId, workflowEdges, isDemoMode, getRegenRemaining, incrementRegenCount, decrementRegenCount, setRegeneratingNode, updateNodeStatus, addArtifact, artifacts]);

  const resetExecution = useCallback(() => {
    nodes.forEach((node) => updateNodeStatus(node.id, "idle"));
  }, [nodes, updateNodeStatus]);

  const clearRateLimitError = useCallback(() => {
    setRateLimitHit(null);
    setRateLimited(false);
  }, [setRateLimited]);

  return {
    runWorkflow,
    regenerateNode,
    resetExecution,
    isExecuting,
    isRateLimited,
    regeneratingNodeId,
    rateLimitHit,
    setRateLimitHit,
    clearRateLimitError,
  };
}

// ─── Exported wrappers for retry from ResultShowcase ────────────────────────

export { pollVideoGeneration as retryPollVideoGeneration };
export { renderClientWalkthrough as retryRenderClientWalkthrough };
