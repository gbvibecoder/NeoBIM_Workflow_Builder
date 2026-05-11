import {
  generateId,
  uploadBase64ToR2,
  generateMassingGeometry,
  extractBuildingTypeFromText,
  logger,
  type ExecutionArtifact,
} from "./deps";
import type { NodeHandler } from "./types";
import { resolveRichMode, richModeToFlags } from "@/features/ifc/lib/rich-mode";
import { floorPlanToMassingGeometry } from "@/features/ifc/services/floor-plan-to-massing";
import type { FloorPlanSchema } from "@/features/ifc/types/floor-plan-schema";

/**
 * EX-001 — IFC Exporter (multi-discipline IFC generation + R2 upload)
 * Pure copy from execute-node/route.ts (lines 5634-5874 of the pre-decomposition file).
 *
 * NOTE: the original Path 0 (`if (upstreamIfcUrl ...) { artifact = ... }`) sets
 * an artifact then falls through and the later branches always overwrite it.
 * That overwrite behaviour is preserved verbatim — no logic changes.
 *
 * Phase 1 Track A added the pre-flight /ready probe + Rich/Lean metadata.
 * Phase 1 Track B adds rich-mode plumbing (env IFC_RICH_MODE + per-run
 * override) through to the TS exporter's four gate flags. Default "off"
 * preserves pre-Track-B production behaviour.
 */
export const handleEX001: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  // Phase 1 Track B.4 — structured-log start timer. Captured at the top
  // of the handler so totalMs below reflects the whole invocation, not
  // just generation time.
  const ex001Start = Date.now();

  // Phase 1 Track B — resolve rich mode once per invocation.
  // Source tracking (override/env/default) feeds logs + artifact metadata
  // so operators can verify which code path selected the current flags.
  let richMode = resolveRichMode(inputData);
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

  // ── Path A.5: Floor-plan brief from TR-001 (added 2026-05-06) ──────
  // When TR-001 detects a room-level floor-plan PDF (plot dims + rooms
  // with explicit width/length/quadrant), it populates
  // ParsedBrief.floorPlan in `_raw.floorPlan`. Convert that into a
  // MassingGeometry HERE so the existing Path A code below picks it up
  // unchanged. Existing massing-brief flows (where floorPlan is
  // undefined) skip this block entirely — zero impact.
  const upstreamRawForFloorPlan = (inputData?._raw ?? {}) as Record<string, unknown>;
  const floorPlan = upstreamRawForFloorPlan?.floorPlan as FloorPlanSchema | undefined;
  let upstreamGeometry = inputData?._geometry as Record<string, unknown> | undefined;
  let derivedFromFloorPlan = false;
  if (!upstreamGeometry && floorPlan && Array.isArray(floorPlan.floors) && floorPlan.floors.length > 0) {
    try {
      /* Defensive: drop floors that have NO rooms and aren't a roof
         stub. GPT-4o-mini sometimes extrapolates extra storeys from the
         brief's "upper floors" hint without populating the rooms array.
         Those phantom storeys produce stacked empty slab decks (the
         "parking deck" failure mode). The brief's literal floor count
         is the source of truth — anything else gets dropped. */
      const filteredFloors = floorPlan.floors.filter((f) => {
        if (f.isRoofStub) return true;
        const hasRooms = Array.isArray(f.rooms) && f.rooms.length > 0;
        if (!hasRooms) {
          logger.debug("[EX-001] dropping phantom floor:", f.name, "index", f.index);
        }
        return hasRooms;
      });
      /* Re-index so storeys are 0..N-1 + roof stub at N. */
      filteredFloors.forEach((f, i) => { f.index = i; });
      /* Ensure a roof stub exists for visual completion. */
      if (!filteredFloors.some((f) => f.isRoofStub)) {
        filteredFloors.push({
          name: "Roof",
          index: filteredFloors.length,
          rooms: [],
          isRoofStub: true,
        });
      }
      const sanitisedPlan = { ...floorPlan, floors: filteredFloors };
      const fromPlan = floorPlanToMassingGeometry(sanitisedPlan);
      upstreamGeometry = fromPlan as unknown as Record<string, unknown>;
      derivedFromFloorPlan = true;
      /* Floor-plan briefs emit furniture, finishes (IfcCovering), MEP
         (IfcSanitaryTerminal / IfcPipeSegment / IfcLightFixture), and
         pad footings — element types the Python `arch-only` filter
         drops (per `_ARCH_AND_STRUCT_TYPES`). Force "full" mode so
         every element survives the filter. The user's last-applied
         richMode env / per-run override is unaffected when
         `floorPlan` isn't present, so existing massing-brief
         workflows keep their resolved mode. */
      const previousMode = richMode.mode;
      /* RichModeSource is "override" | "env" | "default" — use "override"
         since this is effectively a per-run override driven by the brief
         shape (floorPlan presence). */
      richMode = {
        mode: "full",
        flags: richModeToFlags("full"),
        source: "override",
      };
      const elementCount = fromPlan.storeys.reduce((n, s) => n + s.elements.length, 0);
      // eslint-disable-next-line no-console
      console.log(
        `\n╔════════════════════════════════════════════════════════════════╗\n` +
        `║  [EX-001] FLOOR-PLAN PATH FIRED — converter ran successfully    ║\n` +
        `║  plot: ${String(floorPlan.plotWidthFt).padEnd(3)} × ${String(floorPlan.plotDepthFt).padEnd(3)} ft  ` +
        `floors: ${String(sanitisedPlan.floors.length).padEnd(2)}  ` +
        `rooms: ${String(sanitisedPlan.floors.reduce((n, f) => n + (f.rooms?.length ?? 0), 0)).padEnd(3)}  ` +
        `elements: ${String(elementCount).padEnd(4)}                  ║\n` +
        `║  richMode: ${(previousMode + " → full").padEnd(20)}                                ║\n` +
        `╚════════════════════════════════════════════════════════════════╝\n`,
      );
      logger.debug("[EX-001] Derived MassingGeometry from floor-plan brief:", {
        plotWidthFt: floorPlan.plotWidthFt,
        plotDepthFt: floorPlan.plotDepthFt,
        floorCount: floorPlan.floors.length,
        roomCount: floorPlan.floors.reduce((n, f) => n + (f.rooms?.length ?? 0), 0),
        sanitisedFloorCount: sanitisedPlan.floors.length,
        sanitisedRoomCount: sanitisedPlan.floors.reduce((n, f) => n + (f.rooms?.length ?? 0), 0),
        storeys: fromPlan.storeys.length,
        elements: elementCount,
        richModeOverride: `${previousMode} → full`,
      });
    } catch (err) {
      logger.debug("[EX-001] floorPlanToMassingGeometry failed; falling back to massing path:", err);
    }
  }

  let resolvedBuildingType = "Mixed-Use Building";
  let resolvedProjectName = "BuildFlow Export";
  let resolvedGeometry: import("@/types/geometry").MassingGeometry;

  // Hoisted for Path-A (design-agent) brief synthesis. The Path-B/C
  // block below assigns these; Path A (real upstream geometry) leaves
  // them empty and the synthesizer falls back to structured params.
  let outerTextContent = "";
  let outerRawData: Record<string, unknown> = {};
  let outerProgramme: Array<{ space?: string; area_m2?: number }> | undefined;

  if (upstreamGeometry?.storeys && upstreamGeometry?.footprint) {
    // ── Path A: Real geometry from GN-001 OR converted floor-plan brief ──
    const upstreamRaw = (inputData?._raw ?? {}) as Record<string, unknown>;
    resolvedProjectName = String(upstreamRaw?.projectName ?? upstreamRaw?.projectTitle ?? inputData?.buildingType ?? inputData?.content ?? "BuildFlow Export");
    resolvedBuildingType = derivedFromFloorPlan
      ? "Residential"
      : String(upstreamRaw?.projectName ?? inputData?.buildingType ?? "Generated Building");
    resolvedGeometry = upstreamGeometry as unknown as import("@/types/geometry").MassingGeometry;
  } else {
    // ── Path B/C: Extract building parameters from upstream data ──
    // This handles TR-001 (ParsedBrief), TR-003 (BuildingDescription),
    // or any node that passes numeric fields directly.
    const rawData = (inputData?._raw ?? {}) as Record<string, unknown>;
    const textContent = String(inputData?.content ?? inputData?.prompt ?? "");
    // Mirror to outer scope so Path-A (design-agent) brief synthesis can read them.
    outerRawData = rawData;
    outerTextContent = textContent;

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
    outerProgramme = programme;
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
  // Phase 1 Track A.2 — pre-flight /ready probe before committing to the
  // full 30 s export call. If the service is down, unreachable, or not
  // configured, skip the try block entirely and fall through to the TS
  // exporter without burning the export-ifc timeout. The probe result is
  // stamped into artifact.metadata so the UI can surface the "Lean (TS
  // fallback)" state with a concrete reason.
  let ifcServiceUsed = false;
  let files: Array<{
    name: string; type: string; size: number; downloadUrl: string;
    label: string; discipline: string; _ifcContent?: string;
  }> = [];

  // ── Design-agent observability fields (populated by Path A when on) ──
  // Always present in metadata so downstream UI / dashboards have a
  // stable schema regardless of which path ran.
  let designAgentUsed = false;
  let designAgentTemplate: string | null = null;
  let designAgentCostUsd: number | null = null;
  let designAgentLatencyMs: number | null = null;
  let designAgentIdsViolations: number | null = null;
  let designAgentRefusalReason: string | null = null;
  let designAgentBriefSource: "upstream-text" | "synthesized" | "fallback" | null = null;

  // ────────────────────────────────────────────────────────────────────
  // Path A — Design-agent pipeline (feature-flagged).
  //
  // When `USE_DESIGN_AGENT_PIPELINE=true`, route IFC generation through
  // `POST /api/v1/design/generate`. This is the RICH pipeline: brief →
  // template-matcher → adaptation → BuildingModel → IFC via the
  // parametric path (carries every P1.5 / P1.6 / 2B.2 / 2B.3 / P2
  // enrichment).
  //
  // On any failure mode (matcher-refusal / timeout / network), Path A
  // falls THROUGH to the existing legacy /export-ifc + TS fallback
  // chain. The user always gets a result — the flag is a graceful
  // upgrade path, not a foot-gun.
  // ────────────────────────────────────────────────────────────────────
  const USE_DESIGN_AGENT = process.env.USE_DESIGN_AGENT_PIPELINE === "true";

  if (USE_DESIGN_AGENT) {
    const { generateIFCViaDesignAgent, isDesignAgentRefusal, adaptDesignAgentToServiceResponse } =
      await import("@/features/ifc/services/ifc-service-client");
    const { synthesizeBrief } = await import(
      "@/features/ifc/services/brief-synthesizer"
    );

    // Plot dimensions — derive from MassingGeometry.boundingBox when the
    // upstream parser didn't extract them explicitly. This was the
    // primary cause of design-agent matcher refusals on PDF briefs that
    // don't say "30x60 ft plot" in plain text.
    let plotWidthM: number | undefined;
    let plotDepthM: number | undefined;
    const bbox = (resolvedGeometry as {
      boundingBox?: {
        xMin?: number; xMax?: number; yMin?: number; yMax?: number;
        minX?: number; maxX?: number; minY?: number; maxY?: number;
      };
    }).boundingBox;
    if (bbox) {
      const xMin = Number(bbox.xMin ?? bbox.minX ?? 0);
      const xMax = Number(bbox.xMax ?? bbox.maxX ?? 0);
      const yMin = Number(bbox.yMin ?? bbox.minY ?? 0);
      const yMax = Number(bbox.yMax ?? bbox.maxY ?? 0);
      const w = Math.abs(xMax - xMin);
      const d = Math.abs(yMax - yMin);
      if (w > 0.1 && d > 0.1) {
        plotWidthM = w;
        plotDepthM = d;
      }
    }

    // BHK heuristic — when not stated by upstream, infer from
    // per-floor footprint (typical Indian residential): <70 m² → 1BHK,
    // 70-110 → 2BHK, 110-200 → 3BHK. Footprints outside [40, 250] don't
    // get a guess (matcher will refuse anyway and that's correct).
    const explicitBhk = Number(
      (inputData as Record<string, unknown> | undefined)?.bhk_count ??
        (inputData as Record<string, unknown> | undefined)?.bhkCount ??
        outerRawData?.bhk_count ?? 0,
    );
    const footprintM2 = Number(
      (resolvedGeometry as { footprintArea?: number }).footprintArea ?? 0,
    );
    let inferredBhk: number | undefined =
      explicitBhk > 0 ? explicitBhk : undefined;
    if (!inferredBhk && footprintM2 >= 40 && footprintM2 <= 250) {
      inferredBhk =
        footprintM2 < 70 ? 1 : footprintM2 < 110 ? 2 : 3;
    }

    // Region default — templates ship for Pune only at the moment, so
    // explicitly defaulting reduces matcher refusal rate without
    // misleading the user (the matcher applies city heuristics for
    // seismic/wind zone enrichment; "Pune" is safe-default India zone III).
    const explicitRegion = String(
      outerRawData?.region ?? outerRawData?.location ?? "",
    ).trim();
    const region = explicitRegion.length > 0 ? explicitRegion : "Pune";

    const { briefText, source: briefSource } = synthesizeBrief({
      textContent: outerTextContent,
      buildingType: resolvedBuildingType,
      floors: Number.isFinite(Number(resolvedGeometry.floors))
        ? Number(resolvedGeometry.floors)
        : undefined,
      bhkCount: inferredBhk,
      footprintM2: footprintM2 || undefined,
      plotWidthM,
      plotDepthM,
      gfaM2: Number(resolvedGeometry.gfa ?? 0) || undefined,
      heightM: Number(resolvedGeometry.totalHeight ?? 0) || undefined,
      region,
      programme: outerProgramme,
    });
    designAgentBriefSource = briefSource;

    logger.info("[EX-001/Path-A] design-agent brief assembled", {
      briefSource,
      briefLength: briefText.length,
      briefPreview: briefText.slice(0, 200),
    });

    const designResult = await generateIFCViaDesignAgent(briefText, {
      buildId: executionId ?? `local-${Date.now()}`,
      targetFidelity: "design-development",
    });

    if (designResult && !isDesignAgentRefusal(designResult)) {
      designAgentUsed = true;
      ifcServiceUsed = true;
      designAgentTemplate = designResult.match_result?.template_id ?? null;
      designAgentCostUsd =
        designResult.metadata?.total_cost_usd_estimated ?? null;
      designAgentLatencyMs = designResult.elapsed_ms ?? null;
      designAgentIdsViolations =
        designResult.ids_validation?.violations_count ?? null;

      const serviceResult = adaptDesignAgentToServiceResponse(
        designResult,
        filePrefix,
      );
      files = serviceResult.files.map((f) => ({
        name: f.file_name,
        type: "IFC 4",
        size: f.size,
        downloadUrl: f.download_url,
        label: `${f.discipline.charAt(0).toUpperCase() + f.discipline.slice(1)} IFC`,
        discipline: f.discipline,
        _ifcContent: undefined as unknown as string,
      }));

      logger.info("[EX-001/Path-A] design-agent SUCCESS", {
        template: designAgentTemplate,
        costUsd: designAgentCostUsd,
        latencyMs: designAgentLatencyMs,
        idsViolations: designAgentIdsViolations,
        ifcSizeKb: Math.round(designResult.ifc_size_bytes / 1024),
        warningsCount: designResult.warnings?.length ?? 0,
      });
    } else if (designResult && isDesignAgentRefusal(designResult)) {
      designAgentRefusalReason = designResult.reason;
      logger.warn("[EX-001/Path-A] design-agent REFUSAL — falling through to legacy", {
        kind: designResult.refusalKind,
        reason: designResult.reason,
        httpStatus: designResult.httpStatus,
      });
    } else {
      logger.warn("[EX-001/Path-A] design-agent returned null (network/timeout/5xx) — falling through to legacy");
    }
  }

  const { isServiceReady, generateIFCViaService } = await import(
    "@/features/ifc/services/ifc-service-client"
  );
  // When design-agent already produced files, skip the legacy /export-ifc
  // call entirely. Synthesize a "ready" readiness so the metadata block
  // below stays consistent.
  const readiness = designAgentUsed
    ? { ready: true, reason: "ok" as const, latencyMs: 0, checkedAt: Date.now() }
    : await isServiceReady();

  if (!designAgentUsed && readiness.ready) {
    try {
      const serviceResult = await generateIFCViaService(
        resolvedGeometry,
        {
          projectName: resolvedProjectName,
          buildingName: resolvedBuildingType,
          // Phase 1 Track B — forward richMode. Python currently drops it
          // (extra='ignore'); Phase 2+ builders will consume it.
          richMode: richMode.mode,
        },
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
          probeMs: readiness.latencyMs,
        });

        // ── Phase 1 Slice 7 — BuildingModel write-through ────────────
        // When the Python service ran the parametric pipeline the
        // response carries the full BuildingModel as JSON. DB is
        // canonical; R2 is a cheap-hot-read replica. R2 failures don't
        // fail the build (we still ship the IFCs).
        const buildingModelJson = serviceResult.metadata.building_model_json;
        if (buildingModelJson && executionId && executionId !== "local") {
          try {
            const { prisma } = await import("@/lib/db");
            const { uploadToR2 } = await import("@/lib/r2");
            const projectMeta = (
              buildingModelJson as { project?: { metadata?: { provenance?: { model_version?: string } } } }
            ).project;
            const modelVersion = projectMeta?.metadata?.provenance?.model_version ?? "1.0.0";
            const bm = await prisma.buildingModel.create({
              data: {
                executionId,
                modelVersion,
                graph: buildingModelJson as unknown as object,
              },
            });
            try {
              const jsonBuffer = Buffer.from(JSON.stringify(buildingModelJson));
              const filename = `building-model-${bm.id}.json`;
              const result = await uploadToR2(jsonBuffer, filename, "application/json");
              if ("success" in result && result.success) {
                await prisma.buildingModel.update({
                  where: { id: bm.id },
                  data: { r2Key: result.url },
                });
                logger.debug("[EX-001] BuildingModel persisted", {
                  id: bm.id,
                  executionId,
                  r2Key: result.url,
                });
              } else {
                logger.warn("[EX-001] R2 write-through skipped (DB row kept)", {
                  id: bm.id,
                  reason: "error" in result ? result.error : "unknown",
                });
              }
            } catch (r2Err) {
              logger.warn("[EX-001] BuildingModel R2 write-through failed (DB row kept)", {
                id: bm.id,
                error: String(r2Err),
              });
            }
          } catch (dbErr) {
            // DB write failure is non-fatal — IFC files are already
            // emitted and the parametric BuildingModel can be
            // reconstructed from the same MassingGeometry on a re-run.
            logger.warn("[EX-001] BuildingModel DB write failed", {
              error: String(dbErr),
              error_type: dbErr instanceof Error ? dbErr.constructor.name : "unknown",
            });
          }
        }
      } else {
        logger.debug("[EX-001] service probe ready but export returned null — using TS fallback");
      }
    } catch (err) {
      logger.debug("[EX-001] IfcOpenShell service unavailable mid-export, using TS fallback", { error: String(err) });
    }
  } else {
    logger.debug("[EX-001] skipping Python path (probe failed)", {
      reason: readiness.reason,
      statusCode: readiness.statusCode,
      probeMs: readiness.latencyMs,
      error: readiness.error,
    });
  }

  // ── Fallback: TypeScript IFC exporter ──
  // Phase 1 Track B: pass the richMode-resolved flag bundle. Default
  // richMode="off" yields all-false flags, matching pre-Track-B behaviour
  // exactly. Only `IFC_RICH_MODE=<non-off>` or an explicit override flips
  // the TS exporter's emitter gates. See src/features/ifc/lib/rich-mode.ts.
  if (!ifcServiceUsed) {
    const { generateMultipleIFCFiles: genMulti } = await import("@/features/ifc/services/ifc-exporter");
    const ifcFiles = genMulti(resolvedGeometry, {
      projectName: resolvedProjectName,
      buildingName: resolvedBuildingType,
      ...richMode.flags,
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
      // Phase 1 Track A observability fields — feed the Rich/Lean badge
      // and any future admin dashboard.
      ifcServicePath: designAgentUsed
        ? "design-agent"
        : ifcServiceUsed
          ? "python"
          : "ts-fallback",
      ifcServiceProbeMs: readiness.latencyMs,
      ifcServiceSkipped: !readiness.ready,
      ifcServiceSkipReason: readiness.ready ? undefined : readiness.reason,
      // Path-A design-agent observability — populated only when
      // USE_DESIGN_AGENT_PIPELINE was on for this call. Stable schema
      // even when null so dashboards can left-join cleanly.
      designAgentUsed,
      designAgentTemplate,
      designAgentCostUsd,
      designAgentLatencyMs,
      designAgentIdsViolations,
      designAgentRefusalReason,
      designAgentBriefSource,
      // Phase 1 Track B — rich-mode plumbing. `richMode` is the resolved
      // literal, `richModeSource` tells operators where it came from
      // (override / env / default), `richFlags` is the four-flag bundle
      // actually passed to the TS exporter.
      richMode: richMode.mode,
      richModeSource: richMode.source,
      richFlags: richMode.flags,
    },
    createdAt: new Date(),
  };

  // Phase 1 Track B.4 — single structured log line per EX-001 invocation.
  // Gives operations + future admin dashboards a one-liner-per-run summary
  // with every observability field in a single JSON object. Parseable from
  // Vercel log explorer.
  logger.info("[ex-001] completed", {
    richMode: richMode.mode,
    richModeSource: richMode.source,
    richFlags: richMode.flags,
    path: ifcServiceUsed ? "python" : "ts-fallback",
    probeMs: readiness.latencyMs,
    probeReason: readiness.reason,
    totalMs: Date.now() - ex001Start,
    filesGenerated: files.length,
    totalBytes: files.reduce((s, f) => s + f.size, 0),
    skipped: !readiness.ready,
    skipReason: readiness.ready ? undefined : readiness.reason,
  });

  return artifact;
};
