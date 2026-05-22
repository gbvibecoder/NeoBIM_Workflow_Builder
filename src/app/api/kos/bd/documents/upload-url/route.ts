/**
 * POST /api/kos/bd/documents/upload-url
 *
 * Step 1 of the 2-step direct-to-S3 upload flow:
 *   1. (this route) BD client tells us "I want to upload an X-byte
 *      Y-typed file as a Z docType". We mint a fresh KosDocument row
 *      in `UPLOADED` state (no S3 object exists yet), generate a
 *      presigned PUT URL, and return both.
 *   2. (./confirm-upload) BD client PUTs the file straight to S3
 *      using the URL, then calls confirm-upload which HEADs the
 *      object, flips status to PARSING, and enqueues the worker.
 *
 * Splitting in two avoids the Vercel 4.5 MB body-cap that would
 * apply to a single "upload via the server" pattern, and keeps the
 * Node lambda short-lived (no proxying a 50 MB stream).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { KosError, formatKosErrorResponse } from "@/features/kos/lib/kos-errors";
import { requireTenantOrThrow } from "@/features/kos/lib/tenant-resolver";
import { requireKosBdUser } from "@/features/kos/lib/kos-bd-auth";
import {
  createKosPresignedUploadUrl,
  kosS3Key,
} from "@/features/kos/services/s3-client";

export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf"]);
const ALLOWED_DOC_TYPES = new Set([
  "PAC",
  "CERTIFICATE",
  "CASE_STUDY",
  "PRICING",
  "COMPARISON",
  "FAQ",
  "WARRANTY",
  "OTHER",
]);

const BODY_SCHEMA = z.object({
  filename: z.string().min(1).max(512),
  contentType: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive(),
  docType: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenantOrThrow(req);
    const bdUser = await requireKosBdUser(req);

    let body: z.infer<typeof BODY_SCHEMA>;
    try {
      body = BODY_SCHEMA.parse(await req.json());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid request body.";
      throw new KosError("KOS_VAL_001", msg, 400);
    }

    if (!ALLOWED_CONTENT_TYPES.has(body.contentType)) {
      throw new KosError(
        "KOS_DOC_001",
        `Unsupported contentType "${body.contentType}". Allowed: ${[...ALLOWED_CONTENT_TYPES].join(", ")}.`,
        400,
      );
    }

    if (body.sizeBytes > MAX_BYTES) {
      throw new KosError(
        "KOS_DOC_002",
        `File too large: ${body.sizeBytes} bytes > ${MAX_BYTES} bytes (50 MB cap).`,
        400,
      );
    }

    if (!ALLOWED_DOC_TYPES.has(body.docType)) {
      throw new KosError(
        "KOS_DOC_003",
        `Unknown docType "${body.docType}". Allowed: ${[...ALLOWED_DOC_TYPES].join(", ")}.`,
        400,
      );
    }

    // Create the KosDocument row up front. Status stays UPLOADED until
    // confirm-upload verifies the S3 object exists; the worker then
    // flips it to PARSING.
    const created = await prisma.kosDocument.create({
      data: {
        tenantId: tenant.id,
        title: body.filename,
        docType: body.docType as Parameters<
          typeof prisma.kosDocument.create
        >[0]["data"]["docType"],
        s3Key: "", // filled below once we know the docId
        mimeType: body.contentType,
        status: "UPLOADED",
        uploadedBy: bdUser.id,
        version: 1,
      },
      select: { id: true },
    });

    const s3Key = kosS3Key(tenant, "documents", created.id, "source.pdf");

    await prisma.kosDocument.update({
      where: { id: created.id },
      data: { s3Key },
    });

    const presigned = await createKosPresignedUploadUrl(
      tenant,
      s3Key,
      body.contentType,
      900, // 15 min — matches the existing presign default
    );

    const expiresAt = new Date(Date.now() + 900 * 1000);

    return NextResponse.json({
      documentId: created.id,
      uploadUrl: presigned.uploadUrl,
      s3Key,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return formatKosErrorResponse(err);
  }
}
