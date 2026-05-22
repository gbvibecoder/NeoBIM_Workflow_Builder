/**
 * GET /api/kos/bd/documents — list KosDocument rows for the current
 * tenant. Supports optional status / docType filters and pagination.
 *
 * Returns uploader name resolution by joining KosBdUser server-side so
 * the BD table doesn't need a second round-trip per row.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosBdUser } from "@/features/kos/lib/kos-bd-auth";

export const dynamic = "force-dynamic";

const STATUS_VALUES = [
  "UPLOADED",
  "PARSING",
  "CHUNKING",
  "EMBEDDING",
  "READY",
  "FAILED",
] as const;
const DOC_TYPE_VALUES = [
  "PAC",
  "CERTIFICATE",
  "CASE_STUDY",
  "PRICING",
  "COMPARISON",
  "FAQ",
  "WARRANTY",
  "OTHER",
] as const;

const QUERY_SCHEMA = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  docType: z.enum(DOC_TYPE_VALUES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  try {
    const tenant = await requireTenantOrThrow(req);
    await requireKosBdUser(req);

    const url = new URL(req.url);
    let q: z.infer<typeof QUERY_SCHEMA>;
    try {
      q = QUERY_SCHEMA.parse({
        status: url.searchParams.get("status") ?? undefined,
        docType: url.searchParams.get("docType") ?? undefined,
        page: url.searchParams.get("page") ?? undefined,
        pageSize: url.searchParams.get("pageSize") ?? undefined,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Invalid query parameters.";
      throw new KosError("KOS_VAL_001", msg, 400);
    }

    const where = {
      tenantId: tenant.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.docType ? { docType: q.docType } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.kosDocument.count({ where }),
      prisma.kosDocument.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    // Bulk-resolve uploader names. `uploadedBy` is a free-form string
    // (BD user id or "system") so a Prisma include can't be used.
    const uploaderIds = Array.from(
      new Set(rows.map((r) => r.uploadedBy).filter((u) => u && u !== "system")),
    );
    const uploaderMap = new Map<string, { name: string; email: string }>();
    if (uploaderIds.length > 0) {
      const uploaders = await prisma.kosBdUser.findMany({
        where: { id: { in: uploaderIds }, tenantId: tenant.id },
        select: { id: true, name: true, email: true },
      });
      for (const u of uploaders) {
        uploaderMap.set(u.id, { name: u.name, email: u.email });
      }
    }

    return NextResponse.json({
      page: q.page,
      pageSize: q.pageSize,
      total,
      documents: rows.map((r) => ({
        id: r.id,
        title: r.title,
        docType: r.docType,
        status: r.status,
        pageCount: r.pageCount,
        version: r.version,
        mimeType: r.mimeType,
        indexedAt: r.indexedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        uploadedBy: {
          id: r.uploadedBy,
          name: uploaderMap.get(r.uploadedBy)?.name ?? null,
          email: uploaderMap.get(r.uploadedBy)?.email ?? null,
        },
      })),
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
