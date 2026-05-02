/**
 * Stable hash of a string → non-negative integer.
 * Used for picking deterministic preview variants per workflow.
 */
export function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h) + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export type FloorplanVariant = "single" | "double" | "studio" | "open";
export type ThreeDVariant = "stack" | "tower" | "wide";
export type RenderVariant = "sunset" | "morning" | "cool";

const FLOOR_VARIANTS: FloorplanVariant[] = ["single", "double", "studio", "open"];
const THREE_D_VARIANTS: ThreeDVariant[] = ["stack", "tower", "wide"];
const RENDER_VARIANTS: RenderVariant[] = ["sunset", "morning", "cool"];

export function pickFloorplanVariant(id: string): FloorplanVariant {
  return FLOOR_VARIANTS[hash(id) % FLOOR_VARIANTS.length];
}

export function pickThreeDVariant(id: string): ThreeDVariant {
  return THREE_D_VARIANTS[hash(id) % THREE_D_VARIANTS.length];
}

export function pickRenderVariant(id: string): RenderVariant {
  return RENDER_VARIANTS[hash(id) % RENDER_VARIANTS.length];
}

export function pickPipelineNodeCount(id: string): number {
  return 3 + (hash(id) % 3); // 3, 4, or 5
}
