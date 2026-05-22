/**
 * POST /api/kos/bd/dev/test-retrieval-direct — diagnostic twin of
 * /api/kos/bd/dev/test-retrieval, used to isolate whether the
 * retrieval failure is specific to the standalone tsx script or
 * generic to the Prisma client wherever it's invoked.
 *
 * Key differences from /test-retrieval:
 *   • Returns the FULL chunk objects (no content slicing) — caller
 *     can inspect anything that landed.
 *   • On caught error, surfaces every available property of the
 *     thrown object — `message`, `code`, `meta`, `cause`, the full
 *     keys list, and `JSON.stringify(err)` — so an opaque
 *     ErrorEvent from the Neon adapter still gives us something to
 *     work with.
 *   • Same auth + tenant + dev gating as the sibling route.
 *
 * Why a separate route: the existing `test-retrieval` slims its
 * response (cheaper for the usual smoke test) and swallows the
 * error into the standard KosError envelope. For the Neon-adapter
 * mystery we want raw output on BOTH paths, so this route is the
 * raw twin and the sibling stays untouched.
 *
 * 404s in production unless `KOS_DEV_ENDPOINTS_ENABLED=true`.
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

function dumpError(err: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err instanceof Error) {
    out.name = err.name;
    out.message = err.message;
    out.stack = err.stack;
  }
  const obj = err as Record<string, unknown> | null;
  if (obj) {
    out.keys = Object.keys(obj);
    if (obj.code !== undefined) out.code = obj.code;
    if (obj.clientVersion !== undefined) out.clientVersion = obj.clientVersion;
    if (obj.meta !== undefined) out.meta = obj.meta;
    if (obj.cause !== undefined) {
      const cause = obj.cause;
      out.cause =
        cause instanceof Error
          ? { name: cause.name, message: cause.message, stack: cause.stack }
          : cause;
    }
  }
  try {
    out.stringified = JSON.stringify(
      err,
      Object.getOwnPropertyNames(err as object),
    );
  } catch {
    out.stringified = String(err);
  }
  return out;
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
    let chunks;
    try {
      chunks = await retrieveChunks(tenant.id, body.query, {
        topK: body.topK,
      });
    } catch (innerErr) {
      // Surface the raw error properties to the caller — bypasses
      // the usual KosError envelope. This is the whole point of the
      // route: get observable failure modes out of Neon's opaque
      // ErrorEvent path.
      return NextResponse.json(
        {
          ok: false,
          tenantSlug: tenant.slug,
          query: body.query,
          error: dumpError(innerErr),
        },
        { status: 500 },
      );
    }
    const latencyMs = Date.now() - startedAt;

    return NextResponse.json({
      ok: true,
      tenantSlug: tenant.slug,
      query: body.query,
      latencyMs,
      chunkCount: chunks.length,
      // Full chunks — no slicing. Caller asked for raw output.
      chunks,
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
