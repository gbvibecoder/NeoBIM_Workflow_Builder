import {
  generateConceptImage,
  validateRenderWithClaude,
  generateId,
  OPENAI_IMAGE_MODEL,
  type BuildingDescription,
  type RenderQAResult,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * GN-003 — Concept Render Generator (gpt-image-1.5) with Claude QA loop.
 */
export const handleGN003: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
  // Concept Render Generator — gpt-image-1.5 via generateConceptImage
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

  // Reference images extracted from a PDF brief upstream (TR-001 populates this
  // when the user uploaded a PDF with embedded photos / mood references). Path 0
  // of generateConceptImage feeds them to gpt-image-1.5 images.edit() so the
  // render is anchored to the user's actual visual brief.
  const referenceImageUrls = Array.isArray(descRaw?.referenceImageUrls)
    ? (descRaw.referenceImageUrls as string[]).filter((u) => typeof u === "string" && u.length > 0)
    : undefined;

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
      viewType,
      referenceImageUrls,
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
      viewType,
      referenceImageUrls,
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
      }
    } catch (qaErr) {
      console.warn("[GN-003] QA validation error (non-blocking):", qaErr);
    }
  }

  const viewLabel = viewType.replace("_", " ");

  return {
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
    metadata: { model: OPENAI_IMAGE_MODEL, real: true, qaValidated: !!qaResult?.passed },
    createdAt: new Date(),
  };
};
