/**
 * TR-032 — Vision Inspector (Phase Beta 2)
 *
 * Renders IFC to PNG, feeds to Opus 4.7 vision with the briefSpec.
 * Returns quality_score 0-100, issues[], pass boolean.
 * READ-ONLY — does not modify IFC. Auto-loop deferred to Beta 3.
 */

import { headers } from "next/headers";

import type { NodeHandler } from "./types";
import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";

async function getOriginAndCookie(): Promise<{ origin: string; cookie: string }> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    new URL(process.env.NEXTAUTH_URL ?? "https://trybuildflow.in").host;
  return { origin: `${proto}://${host}`, cookie: h.get("cookie") ?? "" };
}

export const handleTR032: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;

  const ifcUrl =
    typeof inputData?.ifcUrl === "string" && inputData.ifcUrl.length > 8
      ? inputData.ifcUrl
      : null;
  if (!ifcUrl) {
    throw new Error("TR-032 (Vision Inspector) requires an `ifcUrl` from upstream.");
  }

  // Extract briefSpec for the vision comparison
  const rawSpec = inputData?.briefSpec ?? inputData?.spec;
  const specParsed = rawSpec ? briefSpecSchema.safeParse(rawSpec) : null;

  // eslint-disable-next-line no-console
  console.info(`[tr-032] handler invoked, ifcUrl=${ifcUrl.slice(0, 60)}...`);

  // Step 1: Render PNGs via existing endpoint
  const { origin, cookie } = await getOriginAndCookie();
  let topPngBase64 = "";
  let isoPngBase64 = "";

  try {
    const renderRes = await fetch(`${origin}/api/brief-to-ifc/v3/render-previews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ ifcUrl }),
    });
    if (renderRes.ok) {
      const renderData = (await renderRes.json()) as {
        topPngUrl?: string; isoPngUrl?: string;
      };
      // Fetch PNGs as base64
      if (renderData.topPngUrl) {
        const pngRes = await fetch(renderData.topPngUrl);
        if (pngRes.ok) {
          const buf = Buffer.from(await pngRes.arrayBuffer());
          topPngBase64 = buf.toString("base64");
        }
      }
      if (renderData.isoPngUrl) {
        const pngRes = await fetch(renderData.isoPngUrl);
        if (pngRes.ok) {
          const buf = Buffer.from(await pngRes.arrayBuffer());
          isoPngBase64 = buf.toString("base64");
        }
      }
    }
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[tr-032] render-previews failed, proceeding with placeholder report");
  }

  // Step 2: Call vision inspector
  if (!topPngBase64 || !isoPngBase64) {
    // Can't inspect without renders — return placeholder
    return {
      id: `art_${tileInstanceId}_${Date.now()}`,
      executionId,
      tileInstanceId,
      type: "json",
      data: {
        ifcUrl,
        briefSpec: specParsed?.success ? specParsed.data : null,
        visionReport: {
          quality_score: 0,
          pass: false,
          issues: [{ severity: "high", type: "other", description: "Render failed — cannot inspect" }],
          summary: "Vision inspection skipped: render endpoint unavailable.",
          inspected_at: new Date().toISOString(),
        },
        summary: "Vision inspection skipped: render failed.",
      },
      metadata: { stage: "vision-inspector", durationMs: 0 },
      createdAt: new Date(),
    };
  }

  const { inspectIFC } = await import("@/features/brief-to-ifc/v3/vision-inspector");

  const result = await inspectIFC(
    specParsed?.success ? specParsed.data : null,
    topPngBase64,
    isoPngBase64,
  );

  const summary =
    `Quality: ${result.report.quality_score}/100 (${result.report.pass ? "PASS" : "FAIL"}) — ` +
    `${result.report.issues.length} issues. ` +
    `($${result.metrics.cost_usd.toFixed(4)}, ${result.metrics.wall_time_ms}ms)`;

  return {
    id: `art_${tileInstanceId}_${Date.now()}`,
    executionId,
    tileInstanceId,
    type: "json",
    data: {
      ifcUrl,
      briefSpec: specParsed?.success ? specParsed.data : null,
      visionReport: result.report,
      metrics: result.metrics,
      summary,
    },
    metadata: {
      stage: "vision-inspector",
      costUsd: result.metrics.cost_usd,
      durationMs: result.metrics.wall_time_ms,
      qualityScore: result.report.quality_score,
    },
    createdAt: new Date(),
  };
};
