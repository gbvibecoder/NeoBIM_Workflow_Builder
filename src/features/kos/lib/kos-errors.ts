/**
 * KOS error class + JSON response formatter.
 *
 * Mirrors the `UserError` / `APIError` / `formatErrorResponse` shape from
 * `src/lib/user-errors.ts`, kept structurally identical so KOS errors are
 * indistinguishable from BuildFlow errors on the wire (same `error.code`
 * + `error.message` keys → existing client error handlers Just Work).
 *
 * KOS error codes live in the `KOS_*` namespace to keep them sortable
 * away from the BuildFlow AUTH/VAL/RATE/OPENAI/NODE/NET/FORM/BILL codes.
 * Sub-namespaces:
 *   KOS_TENANT_*  — tenant resolution / multi-tenant isolation
 *   KOS_AUTH_*    — KOS customer + BD auth (OTP, magic link, BD session)
 *   KOS_BD_*      — BD console (login, role-gating, account state)
 *   KOS_S3_*      — Kalzen S3 bucket access
 *   KOS_WEBHOOK_* — Meta / AiSensy webhook auth + idempotency
 *   KOS_DOC_*     — document upload + metadata (BD-facing)
 *   KOS_INGEST_*  — document ingestion pipeline (parse, chunk, embed)
 *   KOS_EMBED_*   — OpenAI embeddings API
 *   KOS_RAG_*     — RAG retrieval (pgvector similarity)
 *   KOS_VAL_*     — KOS-specific input validation
 *   KOS_APS_*     — Autodesk Platform Services BIM ingestion (Week 5A):
 *                   001 bad/missing credentials · 002 auth/transport ·
 *                   003 bucket (003_BUCKET_TAKEN = global name clash) ·
 *                   004 upload (004_TOO_LARGE = over size limit) ·
 *                   005 translation submit · 006 manifest/metadata
 *                   (006_TIMEOUT = translation exceeded the poll budget)
 *   KOS_BIM_*     — BIM ingestion orchestration (categorisation, derive)
 *
 * Throw a `KosError` anywhere inside KOS code, then catch at the API
 * route boundary with `formatKosErrorResponse(err)` which returns a
 * NextResponse with the right status code and JSON body.
 */

import { NextResponse } from "next/server";

export interface KosErrorBody {
  code: string;
  message: string;
}

/**
 * Throwable KOS error. Carries an HTTP status so the formatter can
 * map directly to a NextResponse without a status-code lookup table.
 *
 * Always pass a SPECIFIC message — "Tenant not resolved" beats
 * "Bad request". The project rule (memory: feedback_specific_errors)
 * is that every surfaced error must contain enough detail that the
 * message alone tells the reader what / why / where.
 */
export class KosError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 500) {
    super(message);
    this.name = "KosError";
    this.code = code;
    this.httpStatus = httpStatus;
  }

  toJSON(): KosErrorBody {
    return { code: this.code, message: this.message };
  }
}

/**
 * Convert any thrown value into a NextResponse with the KOS error
 * envelope shape: `{ error: { code, message } }`. Mirrors
 * `formatErrorResponse` from `src/lib/user-errors.ts` so client
 * code can use the same `await res.json().then(j => j.error.code)`
 * pattern across BuildFlow and KOS.
 *
 * - KosError → status from `httpStatus`, message + code preserved
 * - Anything else → 500 with code `KOS_INTERNAL_001` and the raw
 *   `err.message` (or `String(err)`) preserved verbatim. Generic
 *   wording is banned — if the underlying error has a message, we
 *   surface it so the reader can debug without grepping logs.
 */
export function formatKosErrorResponse(err: unknown): NextResponse {
  if (err instanceof KosError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.httpStatus },
    );
  }

  const message =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : `Unhandled non-Error thrown: ${JSON.stringify(err)}`;

  // Log the original error so the stack trace stays in server logs
  // even though only the message goes back to the client.
  console.error("[kos-errors] unhandled error:", err);

  return NextResponse.json(
    { error: { code: "KOS_INTERNAL_001", message } },
    { status: 500 },
  );
}
