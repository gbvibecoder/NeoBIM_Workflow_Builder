/**
 * render_preview tool — Phase gamma.1 Direct Agent Mode.
 *
 * Lets the agent SEE its in-progress IFC during the build. Snapshots the
 * current sandbox IFC, sends it to the Railway render endpoint, and
 * returns a base64 PNG that the driver injects as an image content block
 * back to the Anthropic conversation.
 *
 * Budget: max RENDER_PREVIEW_BUDGET calls per build. After that, further
 * calls return a text-only message telling the agent to finalize.
 *
 * @module
 */

import { RENDER_PREVIEW_BUDGET } from "../constants";

// ─── Types ──────────────────────────────────────────────────────────

export type RenderPreviewView = "iso" | "top" | "front" | "side";

export interface RenderPreviewInput {
  view: RenderPreviewView;
  note?: string;
}

export interface RenderPreviewContext {
  sessionId: string | null;
  runId?: string;
  turn: number;
}

export interface RenderPreviewResult {
  ok: boolean;
  image_b64?: string;
  render_ms?: number;
  note?: string;
  error?: string;
}

// ─── Budget tracker ─────────────────────────────────────────────────

/** Tracks render_preview calls for a single agent build.
 *  Instantiate one per runGenerator() invocation. */
export class RenderPreviewBudget {
  private count = 0;

  get used(): number {
    return this.count;
  }

  get remaining(): number {
    return Math.max(0, RENDER_PREVIEW_BUDGET - this.count);
  }

  get exhausted(): boolean {
    return this.count >= RENDER_PREVIEW_BUDGET;
  }

  increment(): void {
    this.count++;
  }
}

// ─── Tool handler ───────────────────────────────────────────────────

export async function handleRenderPreviewTool(
  input: RenderPreviewInput,
  context: RenderPreviewContext,
  budget: RenderPreviewBudget,
): Promise<RenderPreviewResult> {
  const startMs = Date.now();

  // Budget check
  if (budget.exhausted) {
    return {
      ok: false,
      error:
        `render_preview budget exhausted (${RENDER_PREVIEW_BUDGET}/${RENDER_PREVIEW_BUDGET}). ` +
        `Finalize and let Vision Inspector handle final verification.`,
    };
  }

  // Session check
  if (!context.sessionId) {
    return {
      ok: false,
      error: "No active session — call run_python first to initialize the sandbox.",
    };
  }

  budget.increment();

  // Call the Railway render endpoint
  const serviceUrl = process.env.IFC_SERVICE_URL;
  const apiKey = process.env.IFC_SERVICE_API_KEY;

  if (!serviceUrl) {
    return {
      ok: false,
      error: "IFC_SERVICE_URL is not configured — render_preview is unavailable.",
      render_ms: Date.now() - startMs,
    };
  }

  try {
    const renderUrl = `${serviceUrl}/api/v3/generator/render-preview`;
    const res = await fetch(renderUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "bf-session-id": context.sessionId,
      },
      body: JSON.stringify({
        view: input.view,
        mode: "fast",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      // eslint-disable-next-line no-console
      console.warn(
        `[render_preview] Railway returned ${res.status}: ${errText.slice(0, 200)}`,
      );
      return {
        ok: false,
        error: `Render endpoint returned HTTP ${res.status}. The image could not be generated. Continue building.`,
        render_ms: Date.now() - startMs,
      };
    }

    const data = (await res.json()) as {
      image_b64?: string;
      png_base64?: string;
    };
    const image_b64 = data.image_b64 ?? data.png_base64;

    if (!image_b64) {
      return {
        ok: false,
        error: "Render endpoint returned no image data.",
        render_ms: Date.now() - startMs,
      };
    }

    const renderMs = Date.now() - startMs;

    // eslint-disable-next-line no-console
    console.info(
      `[render_preview] turn=${context.turn}, view=${input.view}, ` +
      `render_ms=${renderMs}, budget=${budget.used}/${RENDER_PREVIEW_BUDGET}` +
      (input.note ? `, note="${input.note}"` : ""),
    );

    return {
      ok: true,
      image_b64,
      render_ms: renderMs,
      note: input.note,
    };
  } catch (err) {
    const renderMs = Date.now() - startMs;
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[render_preview] Error: ${message} (${renderMs}ms)`);
    return {
      ok: false,
      error: `Render failed: ${message}. Continue building — you can try again later.`,
      render_ms: renderMs,
    };
  }
}
