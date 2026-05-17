/**
 * EX-007 — IFC Export + Preview
 *
 * Canvas-visible export stage. Calls `/api/brief-to-ifc/v3/render-previews`
 * to produce top + iso PNG renders (via the Railway sandbox), uploads
 * them to R2, and surfaces them as inline image artifacts on canvas
 * along with the IFC download link + viewer deep link.
 *
 * Inputs (from TR-027 upstream):
 *   • `ifcUrl: string`  — required
 *   • `runId: string`   — optional, used to construct the deep link
 */

import { headers } from "next/headers";

import type { NodeHandler } from "./types";

interface RenderResponse {
  runId: string;
  ifcUrl: string;
  topPngUrl: string;
  isoPngUrl: string;
  meshCount: number;
  durationMs: number;
}

async function getOriginAndCookie(): Promise<{ origin: string; cookie: string }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    new URL(process.env.NEXTAUTH_URL ?? "https://trybuildflow.in").host;
  return { origin: `${proto}://${host}`, cookie: h.get("cookie") ?? "" };
}

export const handleEX007: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const ifcUrl =
    typeof inputData?.ifcUrl === "string" && inputData.ifcUrl.length > 8
      ? inputData.ifcUrl
      : null;

  if (!ifcUrl) {
    throw new Error(
      "EX-007 (IFC Export + Preview) requires an `ifcUrl` from upstream TR-027.",
    );
  }

  const { origin, cookie } = await getOriginAndCookie();
  const res = await fetch(`${origin}/api/brief-to-ifc/v3/render-previews`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ ifcUrl }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new Error(
      `Preview rendering failed (HTTP ${res.status}): ${payload.error?.message ?? "unknown"} (${payload.error?.code ?? "?"})`,
    );
  }
  const result = (await res.json()) as RenderResponse;

  const ifcViewerUrl = `/dashboard/ifc-viewer?url=${encodeURIComponent(ifcUrl)}`;

  const summary =
    `IFC ready — top + iso previews rendered ` +
    `(${result.meshCount} meshes, ${(result.durationMs / 1000).toFixed(1)} s).`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "image",
    dataUri: result.topPngUrl,
    data: {
      ifcUrl,
      runId: result.runId,
      topPngUrl: result.topPngUrl,
      isoPngUrl: result.isoPngUrl,
      ifcViewerUrl,
      runUrl: typeof inputData?.runId === "string"
        ? `/dashboard/brief-to-ifc/v3/runs/${inputData.runId}`
        : null,
      meshCount: result.meshCount,
      durationMs: result.durationMs,
      summary,
      // Conventionally `images` is read by canvas artifact cards that
      // render multiple thumbnails.
      images: [
        { label: "Top view", url: result.topPngUrl },
        { label: "Isometric view", url: result.isoPngUrl },
      ],
    },
    metadata: {
      stage: "ifc-export-preview",
      filename: `ai-ifc-${tileInstanceId}.ifc`,
      mimeType: "application/x-step",
      ifcUrl,
      topPngUrl: result.topPngUrl,
      isoPngUrl: result.isoPngUrl,
      meshCount: result.meshCount,
    },
    createdAt: new Date(),
  };
};
