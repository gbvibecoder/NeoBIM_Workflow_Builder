/**
 * POST /api/kos/bd/dev/test-retrieval — Dev-only smoke test for
 * ingest → retrieval.
 *
 * Lets the human poke the embedder + pgvector path without needing
 * the bot UI (which lands in Week 3). 404s in production unless
 * `KOS_DEV_ENDPOINTS_ENABLED=true` is explicitly set, so a leaked
 * deploy doesn't expose a free embeddings endpoint.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosBdUser } from "@/features/kos/lib/kos-bd-auth";
import { retrieveChunks } from "@/features/kos/services/rag-retriever";

export const dynamic = "force-dynamic";

const BODY_SCHEMA = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
});

function devEndpointEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.KOS_DEV_ENDPOINTS_ENABLED === "true";
}

export async function POST(req: NextRequest) {
  try {
    if (!devEndpointEnabled()) {
      // 404 (not 403) so the route is indistinguishable from a typo.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const tenant = await requireTenantOrThrow(req);
    await requireKosBdUser(req);

    let body: z.infer<typeof BODY_SCHEMA>;
    try {
      body = BODY_SCHEMA.parse(await req.json());
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Invalid request body.";
      throw new KosError("KOS_VAL_001", msg, 400);
    }

    const startedAt = Date.now();
    const chunks = await retrieveChunks(tenant.id, body.query, {
      topK: body.topK,
    });
    const latencyMs = Date.now() - startedAt;

    return NextResponse.json({
      ok: true,
      tenantSlug: tenant.slug,
      query: body.query,
      latencyMs,
      chunkCount: chunks.length,
      chunks: chunks.map((c) => ({
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        docType: c.docType,
        pageNum: c.pageNum,
        similarity: c.similarity,
        contentPreview: c.content.slice(0, 240),
      })),
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
