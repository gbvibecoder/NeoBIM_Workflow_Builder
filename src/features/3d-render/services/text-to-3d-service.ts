/**
 * Text-to-3D Pipeline Service
 * Chains: Text → DALL-E 3 Image → SAM 3D Model
 *
 * Generates a photorealistic architectural image from text,
 * then converts it to a realistic 3D model (GLB/PLY).
 */

import { generateConceptImage, enhanceArchitecturalPrompt } from "@/features/ai/services/openai";
import type { BuildingDescription } from "@/features/ai/services/openai";
import { convertImageTo3D } from "@/features/3d-render/services/sam3d-service";
import type { Sam3dConversionJob } from "@/types/sam3d";

export interface TextTo3DInput {
  prompt: string;
  buildingDescription?: BuildingDescription;
  viewType?: "exterior" | "floor_plan" | "site_plan" | "interior";
  style?: string;
  seed?: number;
  apiKey?: string;
}

export interface TextTo3DResult {
  /** Generated intermediate image URL from DALL-E 3 */
  imageUrl: string;
  /** DALL-E revised prompt */
  revisedPrompt: string;
  /** SAM 3D conversion job with GLB/PLY URLs */
  job: Sam3dConversionJob;
}

/**
 * Full text-to-3D pipeline:
 * 1. Generate a high-quality architectural image from text via DALL-E 3
 * 2. Feed that image into SAM 3D to create a realistic 3D model
 */
export async function textTo3D(input: TextTo3DInput): Promise<TextTo3DResult> {
  const {
    prompt,
    buildingDescription,
    viewType = "exterior",
    style = "photorealistic architectural render, clean white background, isolated building, no surrounding context, studio lighting",
    seed,
    apiKey,
  } = input;

  // Step 1: Generate architectural image via DALL-E 3
  // Use a prompt optimized for 3D conversion — isolated building, clean background
  let imageResult: { url: string; revisedPrompt: string };

  if (buildingDescription) {
    // Enhance prompt with GPT-4o-mini for best DALL-E 3 results
    const enhancedPrompt = await enhanceArchitecturalPrompt(
      buildingDescription,
      viewType,
      `${style}. IMPORTANT: Show the building isolated on a clean white/light gray background with no surrounding buildings or complex environment. Studio-lit, 3/4 angle view showing full building form clearly. This image will be used for 3D model generation.`,
      apiKey
    );

    imageResult = await generateConceptImage(
      enhancedPrompt,
      style,
      apiKey,
      undefined,
      undefined,
      undefined,
      viewType
    );
  } else {
    // Direct prompt — add 3D-optimized instructions
    const optimizedPrompt = `Professional architectural rendering of: ${prompt}.
Show the complete building isolated on a clean white/light gray background.
3/4 angle exterior view showing full building form, all facades visible.
Studio lighting, no surrounding buildings or complex environment.
Sharp, clean edges. Photorealistic materials and proportions.
This is an architectural model visualization — show the building as a standalone object.`;

    imageResult = await generateConceptImage(
      optimizedPrompt,
      style,
      apiKey,
      undefined,
      undefined,
      undefined,
      viewType
    );
  }

  // Step 2: Convert the generated image to 3D via SAM 3D
  const job = await convertImageTo3D(imageResult.url, {
    seed,
    textPrompt: prompt.slice(0, 200), // SAM 3D text hint
  });

  return {
    imageUrl: imageResult.url,
    revisedPrompt: imageResult.revisedPrompt,
    job,
  };
}
