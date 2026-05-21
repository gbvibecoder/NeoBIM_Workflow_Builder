/**
 * Phase ε.3 — server-to-server bridge for the Railway render-previews
 * endpoint.
 *
 * Reuses the existing `POST /api/v3/generator/render-previews` Railway
 * route (the same endpoint that powers `tr-032` + the Next.js
 * `/api/brief-to-ifc/v3/render-previews` proxy). That endpoint takes
 * an IFC URL, streams the IFC from R2, renders top + iso PNGs via
 * `ifcopenshell.geom` + `matplotlib`, and returns base64 strings.
 *
 * Why a dedicated helper instead of re-using the Next.js route:
 * the agent-job worker calls this from its server runtime — going
 * through the Next.js route would add an extra HTTP hop, force a
 * second auth check, and double-handle the base64 payload. Direct
 * server-to-server call is the cleanest path AND keeps R2 credentials
 * out of the worker (the worker doesn't upload the PNGs anywhere —
 * it just feeds them to `inspectIFC` and discards them).
 *
 * Used by `runIterationAndVerify` (agent-job/route.ts) to obtain the
 * top+iso PNGs for `inspectIFC` after the IFC is finalized; the
 * resulting `VisionReport` becomes the `vision_quality` sub-signal in
 * `computeQualityScore` (replaces the δ.2-era `null` placeholder).
 *
 * Never throws — every failure becomes a typed result so the caller
 * can degrade gracefully (the composite metric already drops the
 * vision sub-signal when null, so a render failure does not crash
 * the build).
 */

const RENDER_PREVIEW_TIMEOUT_MS = 60_000;

export interface RenderPreviewsResult {
  ok: boolean;
  topPngB64?: string;
  isoPngB64?: string;
  /** Render wall-clock from Railway (informational, used in telemetry). */
  renderMs?: number;
  /** When `ok: false`, a short human-readable reason. */
  error?: string;
}

/**
 * Render top + iso previews of a finalized IFC by URL.
 *
 * On any failure (sandbox unconfigured, network error, HTTP non-2xx,
 * sandbox returning no images) returns `{ ok: false, error }` — never
 * throws. The caller (`runIterationAndVerify`) skips the vision step
 * and lets `computeQualityScore` drop the vision sub-signal.
 */
export async function renderFinalizedIfcPreviews(
  ifcUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<RenderPreviewsResult> {
  const sandboxUrl = process.env.IFC_SERVICE_URL;
  const sandboxKey = process.env.IFC_SERVICE_API_KEY;

  if (!sandboxUrl) {
    return {
      ok: false,
      error: "IFC_SERVICE_URL not configured — render-previews unreachable.",
    };
  }
  if (!ifcUrl || typeof ifcUrl !== "string") {
    return { ok: false, error: "invalid ifcUrl" };
  }

  const startedAt = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sandboxKey) headers["Authorization"] = `Bearer ${sandboxKey}`;

  let res: Response;
  try {
    res = await fetch(`${sandboxUrl}/api/v3/generator/render-previews`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ifc_url: ifcUrl }),
      signal: AbortSignal.timeout(options.timeoutMs ?? RENDER_PREVIEW_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      error: `render-previews fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: `render-previews HTTP ${res.status}: ${detail.slice(0, 200)}`,
    };
  }

  let body: {
    ok?: boolean;
    top_png_b64?: string;
    iso_png_b64?: string;
    duration_ms?: number;
    error?: string;
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (err) {
    return {
      ok: false,
      error: `render-previews JSON parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (!body.ok || !body.top_png_b64 || !body.iso_png_b64) {
    return {
      ok: false,
      error: body.error ?? "render-previews returned no images",
    };
  }

  return {
    ok: true,
    topPngB64: body.top_png_b64,
    isoPngB64: body.iso_png_b64,
    renderMs: body.duration_ms ?? Date.now() - startedAt,
  };
}
