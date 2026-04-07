import {
  enhanceArchitecturalPrompt,
  generateId,
  NextResponse,
  type BuildingDescription,
  type ExecutionArtifact,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * TR-005 — Visualization Style Composer (GPT-4o-mini enhanced DALL-E 3 prompt)
 * Pure copy from execute-node/route.ts (lines 1062-1115 of the pre-decomposition file).
 *
 * NOTE: this handler returns NextResponse directly because the original
 * implementation did. We preserve that behaviour exactly.
 */
export const handleTR005: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
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

  const artifact: ExecutionArtifact = {
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
};
