import {
  generateBuildingDescription,
  generateId,
  formatBuildingDescription,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * TR-003 — Design Brief Analyzer (GPT-4o-mini)
 * Pure copy from execute-node/route.ts (lines 295-345 of the pre-decomposition file).
 */
export const handleTR003: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
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

  return {
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
};
