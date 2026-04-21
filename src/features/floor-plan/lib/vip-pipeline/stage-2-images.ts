/**
 * Stage 2: Parallel Image Generation
 *
 * Fires 3 image models in parallel via Promise.allSettled.
 * Returns all successfully generated images (≥1 required).
 * Per-provider failures are logged as warnings, not stage errors.
 *
 * Planned implementation: Phase 1.4
 */

import type {
  Stage2Input,
  Stage2Output,
  GeneratedImage,
  ImageGenPrompt,
} from "./types";
import type { VIPLogger } from "./logger";
import { ImageGenError } from "./providers/types";
import * as gptImage from "./providers/gpt-image";
import * as imagen from "./providers/imagen";

// ─── Public Types ────────────────────────────────────────────────

export interface Stage2Metrics {
  totalCostUsd: number;
  perModel: Array<{
    model: string;
    success: boolean;
    durationMs: number;
    costUsd: number;
    error?: string;
    errorKind?: string;
  }>;
}

// ─── Provider Registry ───────────────────────────────────────────

const PROVIDERS: Record<
  string,
  {
    generate: (
      prompt: string,
      negativePrompt?: string,
    ) => Promise<GeneratedImage>;
    costPerImage: number;
  }
> = {
  "gpt-image-1.5": {
    generate: gptImage.generateImage,
    costPerImage: gptImage.COST_PER_IMAGE,
  },
  "imagen-4.0-generate-001": {
    generate: imagen.generateImage,
    costPerImage: imagen.COST_PER_IMAGE,
  },
};

// ─── Main Entry Point ────────────────────────────────────────────

export async function runStage2ParallelImageGen(
  input: Stage2Input,
  logger?: VIPLogger,
): Promise<{ output: Stage2Output; metrics: Stage2Metrics }> {
  const perModel: Stage2Metrics["perModel"] = [];
  const images: GeneratedImage[] = [];
  let totalCost = 0;

  // Fire all providers in parallel
  const tasks = input.imagePrompts.map(async (ip: ImageGenPrompt) => {
    const provider = PROVIDERS[ip.model];
    if (!provider) {
      return {
        model: ip.model,
        success: false as const,
        durationMs: 0,
        costUsd: 0,
        error: `Unknown model: ${ip.model}`,
        errorKind: "unknown" as const,
      };
    }

    const startMs = Date.now();
    try {
      const img = await provider.generate(ip.prompt, ip.negativePrompt);
      const costUsd = provider.costPerImage;
      return {
        model: ip.model,
        success: true as const,
        durationMs: Date.now() - startMs,
        costUsd,
        image: img,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const kind = err instanceof ImageGenError ? err.kind : "unknown";
      return {
        model: ip.model,
        success: false as const,
        durationMs: Date.now() - startMs,
        costUsd: 0,
        error: msg,
        errorKind: kind,
      };
    }
  });

  const results = await Promise.allSettled(tasks);

  for (const settled of results) {
    if (settled.status === "rejected") {
      // Should not happen (tasks catch internally), but defensive
      perModel.push({
        model: "unknown",
        success: false,
        durationMs: 0,
        costUsd: 0,
        error: String(settled.reason),
        errorKind: "unknown",
      });
      continue;
    }
    const r = settled.value;
    perModel.push({
      model: r.model,
      success: r.success,
      durationMs: r.durationMs,
      costUsd: r.costUsd,
      error: r.error,
      errorKind: r.errorKind,
    });
    if (r.success && "image" in r && r.image) {
      images.push(r.image);
      totalCost += r.costUsd;
    } else if (!r.success) {
      console.warn(
        `[VIP:Stage2] ${r.model} failed (${r.errorKind}): ${r.error}`,
      );
    }
  }

  if (logger) logger.logStageCost(2, totalCost);

  if (images.length === 0) {
    const reasons = perModel
      .filter((m) => !m.success)
      .map((m) => `${m.model}: ${m.error}`)
      .join("; ");
    throw new Error(
      `Stage 2: all ${input.imagePrompts.length} image generators failed: ${reasons}`,
    );
  }

  return {
    output: { images },
    metrics: { totalCostUsd: totalCost, perModel },
  };
}
