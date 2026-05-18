/**
 * EX-007 — IFC Export + Preview
 *
 * Canvas-visible export stage. Calls `/api/brief-to-ifc/v3/render-previews`
 * to produce top + iso PNG renders (via the Railway sandbox), uploads
 * them to R2, and emits a `file` artifact whose `data` carries the
 * IFC download link + viewer deep link + both preview PNGs.
 *
 * Why `type: "file"` (not `"image"`)? The result page categorises
 * artifacts by type when picking the workflow badge ("IFC Export" vs
 * "Concept Renders") and the hero kind. Before this change, EX-007
 * emitted `image`, so the page reported the workflow as a render and
 * hid the IFC file entirely. The PNG previews are surfaced through
 * `data.topPngUrl` / `data.isoPngUrl` and lifted into the image grid
 * by `useResultPageData` — they remain visible as thumbnails, but
 * the IFC file is now the primary artifact.
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

  // Deep-link into the in-app IFC viewer. `?executionId=` is the
  // ownership-checked path the existing viewer route already handles —
  // it reads the execution, finds the IFC artifact, and hydrates the
  // bytes into IndexedDB before mounting IFCViewerPage. `?url=` is
  // available too (added in the same canvas-IFC-overhaul) as a direct
  // fallback when an executionId isn't on hand.
  const ifcViewerUrl = `/dashboard/ifc-viewer?url=${encodeURIComponent(ifcUrl)}`;
  const fileName = `ai-ifc-${tileInstanceId}.ifc`;

  const summary =
    `IFC ready — top + iso previews rendered ` +
    `(${result.meshCount} meshes, ${(result.durationMs / 1000).toFixed(1)} s).`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "file",
    dataUri: ifcUrl,
    data: {
      // Canonical FileDownload fields read by `useResultPageData` so
      // this artifact lands in `data.fileDownloads`, which in turn
      // makes the WorkflowTypeBadge say "IFC Export" and the hero
      // card become the IFC download/viewer CTA pair.
      url: ifcUrl,
      downloadUrl: ifcUrl,
      fileName,
      name: fileName,
      type: "application/x-step",
      // Carry the originating IFC URL + viewer link so the hero card
      // can wire both CTAs without re-deriving them.
      ifcUrl,
      ifcViewerUrl,
      runId: result.runId,
      runUrl: typeof inputData?.runId === "string"
        ? `/dashboard/brief-to-ifc/v3/runs/${inputData.runId}`
        : null,
      // Preview images — `useResultPageData` lifts these into
      // `allImageUrls` so the existing GeneratedAssetsSection renders
      // them as thumbnails below the hero.
      topPngUrl: result.topPngUrl,
      isoPngUrl: result.isoPngUrl,
      meshCount: result.meshCount,
      durationMs: result.durationMs,
      summary,
      images: [
        { label: "Top view", url: result.topPngUrl },
        { label: "Isometric view", url: result.isoPngUrl },
      ],
    },
    metadata: {
      stage: "ifc-export-preview",
      filename: fileName,
      mimeType: "application/x-step",
      engine: "ifcopenshell",
      ifcUrl,
      topPngUrl: result.topPngUrl,
      isoPngUrl: result.isoPngUrl,
      meshCount: result.meshCount,
    },
    createdAt: new Date(),
  };
};
