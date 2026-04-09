/**
 * AI Material Palette Service
 * Generates a concept render via DALL-E, then uses GPT-4o vision
 * to extract a color/material palette that maps to BIM element types.
 *
 * This creates the bridge between AI visual quality and BIM structure:
 * the procedural BIM model provides geometry + metadata,
 * and the AI palette provides photorealistic material assignments.
 */

import type { PBRMaterialDef } from "@/features/3d-render/services/material-mapping";

export interface AIMaterialPalette {
  /** Hex colors per element type */
  wallExterior: number;
  wallInterior: number;
  window: number;
  windowOpacity: number;
  mullion: number;
  spandrel: number;
  slab: number;
  roof: number;
  column: number;
  door: number;
  ground: number;
  /** Style metadata */
  style: "modern" | "classical" | "industrial" | "futuristic" | "organic";
  /** Glass tint */
  glassTint: "clear" | "blue" | "bronze" | "green" | "dark";
  /** Overall facade feel */
  facadeMaterial: "glass" | "concrete" | "metal" | "brick" | "wood" | "stone";
}

const DEFAULT_PALETTE: AIMaterialPalette = {
  wallExterior: 0xE0DDD5,
  wallInterior: 0xF5F0EB,
  window: 0x88CCEE,
  windowOpacity: 0.2,
  mullion: 0xC0C0C8,
  spandrel: 0x1A1A22,
  slab: 0xD0CCC4,
  roof: 0x404040,
  column: 0xBBBBBB,
  door: 0x8B7340,
  ground: 0x2D5A16,
  style: "modern",
  glassTint: "blue",
  facadeMaterial: "glass",
};

/**
 * Generate a concept image using DALL-E and extract a material palette using GPT-4o vision.
 * Returns both the image URL (for thumbnail) and the extracted color palette.
 */
export async function generateAIMaterialPalette(
  description: string,
  buildingType: string,
  apiKey?: string,
): Promise<{ palette: AIMaterialPalette; imageUrl: string | null }> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) {
    return { palette: DEFAULT_PALETTE, imageUrl: null };
  }

  // Step 1: Generate concept render via DALL-E
  let imageUrl: string | null = null;
  try {
    const { generateConceptImage } = await import("@/features/ai/services/openai");
    const prompt = `Professional architectural exterior rendering of: ${description.slice(0, 300)}.
Show the building in warm golden hour lighting, 3/4 view angle.
Photorealistic materials — visible glass reflections, concrete texture, metal finishes.
Clean background with subtle landscape context.`;

    const result = await generateConceptImage(prompt, "photorealistic architectural render", key);
    imageUrl = result.url;
  } catch (err) {
    console.warn("[AI-Palette] DALL-E concept render failed:", err instanceof Error ? err.message : err);
  }

  // Step 2: Extract material palette via GPT-4o vision (or fallback to text analysis)
  let palette = DEFAULT_PALETTE;
  try {
    const analysisPrompt = `Analyze this building description and suggest a material color palette.
Building: ${description.slice(0, 500)}
Type: ${buildingType}

Respond with ONLY a JSON object (no markdown, no explanation) with these exact keys:
{
  "style": "modern"|"classical"|"industrial"|"futuristic"|"organic",
  "glassTint": "clear"|"blue"|"bronze"|"green"|"dark",
  "facadeMaterial": "glass"|"concrete"|"metal"|"brick"|"wood"|"stone",
  "wallExteriorHex": "#RRGGBB",
  "mullionHex": "#RRGGBB",
  "spandrelHex": "#RRGGBB",
  "roofHex": "#RRGGBB",
  "columnHex": "#RRGGBB"
}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are an architectural material consultant. Respond ONLY with valid JSON." },
          ...(imageUrl
            ? [{ role: "user", content: [
                { type: "text", text: analysisPrompt },
                { type: "image_url", image_url: { url: imageUrl } },
              ] }]
            : [{ role: "user", content: analysisPrompt }]
          ),
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      // Extract JSON from response (may be wrapped in markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const hexToNum = (hex: string): number => {
          if (!hex || !hex.startsWith("#")) return 0;
          return parseInt(hex.slice(1), 16);
        };

        palette = {
          ...DEFAULT_PALETTE,
          style: parsed.style ?? DEFAULT_PALETTE.style,
          glassTint: parsed.glassTint ?? DEFAULT_PALETTE.glassTint,
          facadeMaterial: parsed.facadeMaterial ?? DEFAULT_PALETTE.facadeMaterial,
          wallExterior: hexToNum(parsed.wallExteriorHex) || DEFAULT_PALETTE.wallExterior,
          mullion: hexToNum(parsed.mullionHex) || DEFAULT_PALETTE.mullion,
          spandrel: hexToNum(parsed.spandrelHex) || DEFAULT_PALETTE.spandrel,
          roof: hexToNum(parsed.roofHex) || DEFAULT_PALETTE.roof,
          column: hexToNum(parsed.columnHex) || DEFAULT_PALETTE.column,
          windowOpacity: parsed.glassTint === "dark" ? 0.35 : parsed.glassTint === "bronze" ? 0.3 : 0.2,
          window: parsed.glassTint === "bronze" ? 0x998866
            : parsed.glassTint === "green" ? 0x88BBAA
            : parsed.glassTint === "dark" ? 0x334455
            : parsed.glassTint === "clear" ? 0xCCEEFF
            : 0x88CCEE,
        };
      }
    }
  } catch (err) {
    console.warn("[AI-Palette] GPT-4o palette extraction failed:", err instanceof Error ? err.message : err);
  }

  return { palette, imageUrl };
}

/**
 * Convert an AIMaterialPalette into PBR material overrides for the GLB generator.
 * These override the default material-mapping.ts colors.
 */
export function paletteToMaterialOverrides(palette: AIMaterialPalette): Record<string, Partial<PBRMaterialDef>> {
  return {
    wall: { color: palette.wallExterior, roughness: palette.facadeMaterial === "concrete" ? 0.85 : 0.75 },
    window: {
      color: palette.window,
      opacity: palette.windowOpacity,
      transmission: palette.glassTint === "dark" ? 0.6 : 0.85,
    },
    mullion: { color: palette.mullion, roughness: 0.25, metalness: 0.9 },
    spandrel: { color: palette.spandrel, roughness: 0.3, metalness: 0.8 },
    slab: { color: palette.slab },
    roof: { color: palette.roof },
    column: { color: palette.column },
    door: { color: palette.door },
  };
}
