/**
 * KOS RAG retriever.
 *
 * `retrieveChunks(tenantId, query, opts)` — embeds the query, runs a
 * pgvector ANN search joined against KosDocument, and returns the
 * top-K chunks above a cosine-similarity floor.
 *
 * Tenant isolation is enforced INSIDE the SQL by joining on
 * KosDocument.tenantId — the caller cannot drop the filter without
 * touching this file. The tenant-isolation integration test pins
 * that behaviour.
 *
 * Not exposed via any HTTP route in Week 2. Week 3 (bot orchestrator)
 * will be the first consumer.
 */

// Server-only by construction (Prisma + embeddings call); we don't
// `import "server-only"` because that package isn't in deps.

import type { KosDocType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import {
  embedTexts,
  KOS_EMBEDDING_DIMENSIONS,
} from "@/features/kos/services/embeddings";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  docType: KosDocType;
  pageNum: number | null;
  content: string;
  similarity: number;
  metadata: unknown;
}

export interface RetrieveChunksOptions {
  topK?: number;
  minSimilarity?: number;
  docTypes?: KosDocType[];
}

const DEFAULT_TOP_K = 6;
const DEFAULT_MIN_SIMILARITY = 0.5;
const MAX_TOP_K = 50;

interface RawRow {
  chunk_id: string;
  document_id: string;
  content: string;
  page_num: number | null;
  metadata: unknown;
  document_title: string;
  doc_type: KosDocType;
  similarity: number;
}

export async function retrieveChunks(
  tenantId: string,
  query: string,
  options: RetrieveChunksOptions = {},
): Promise<RetrievedChunk[]> {
  if (!tenantId) {
    throw new KosError(
      "KOS_RAG_001",
      "retrieveChunks called without tenantId — refusing to run an unscoped query.",
      500,
    );
  }
  if (!query || query.trim().length === 0) {
    throw new KosError(
      "KOS_RAG_002",
      "retrieveChunks called with empty query.",
      400,
    );
  }

  const topK = clamp(options.topK ?? DEFAULT_TOP_K, 1, MAX_TOP_K);
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const docTypes = options.docTypes && options.docTypes.length > 0
    ? options.docTypes
    : null;

  // ── Pre-flight diagnostics (dev-only) ──────────────────────────
  // We've been chasing an opaque `prisma:error undefined` failure
  // where `Object.keys(err) === ['clientVersion']` and no underlying
  // message surfaces. To isolate what part of the stack is broken,
  // log the Prisma class + the DB host + run a trivial ping BEFORE
  // any vector machinery touches Postgres. If the ping fails the
  // connection itself is broken (and the vector query never had a
  // chance); if it succeeds we know Prisma + Neon + auth all work
  // and the failure is specifically in the pgvector path.
  if (process.env.NODE_ENV !== "production") {
    console.log("[kos-rag-debug] prisma constructor:", prisma.constructor.name);
    const dbHost =
      (process.env.DATABASE_URL ?? "").split("@")[1]?.split("/")[0] ??
      "(DATABASE_URL unset)";
    console.log("[kos-rag-debug] db host:", dbHost);
    try {
      const ping = await prisma.$queryRawUnsafe(
        `SELECT 1 AS test, current_database() AS db, version() AS pg_version`,
      );
      console.log("[kos-rag-debug] ping result:", JSON.stringify(ping));
    } catch (pingErr) {
      console.error(
        "[kos-rag-debug] PING FAILED — the underlying connection is broken, vector query will also fail:",
        pingErr,
      );
      // Don't throw here — let the actual vector query also fail so
      // the caller sees its native error path. The ping log above
      // already gives us the diagnostic signal.
    }
  }

  // ── KOS_RAG_DIAG_NO_VECTOR — diagnostic early branch ───────────
  // Returns chunks scoped by tenantId + status='READY' WITHOUT any
  // pgvector / halfvec / embedding involvement. Hard-codes
  // similarity=0.5 so the downstream filter doesn't drop them.
  //
  //   If this branch returns rows  → vector binding is the problem.
  //   If this branch also fails    → connection/auth/schema, not vector.
  //
  // Gated by NODE_ENV !== "production" via the env flag — never
  // affects production behaviour.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.KOS_RAG_DIAG_NO_VECTOR === "true"
  ) {
    console.log(
      "[kos-rag-debug] DIAG_NO_VECTOR branch active — skipping embed + vector cast",
    );
    const diagSql = `
      SELECT
        c.id AS chunk_id,
        c."documentId" AS document_id,
        c.content,
        c."pageNum" AS page_num,
        c.metadata,
        d.title AS document_title,
        d."docType" AS doc_type,
        0.5::float8 AS similarity
      FROM "kos_document_chunks" c
      JOIN "kos_documents" d ON d.id = c."documentId"
      WHERE d."tenantId" = $1
        AND d."status" = 'READY'
      LIMIT $2
    `;
    const diagRows = await prisma.$queryRawUnsafe<RawRow[]>(
      diagSql,
      tenantId,
      topK,
    );
    console.log(
      `[kos-rag-debug] DIAG_NO_VECTOR returned ${diagRows.length} row(s)`,
    );
    return diagRows.map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      docType: r.doc_type,
      pageNum: r.page_num,
      content: r.content,
      similarity: typeof r.similarity === "number" ? r.similarity : 0.5,
      metadata: r.metadata ?? null,
    }));
  }

  // ── Embed the query ─────────────────────────────────────────────
  const [queryEmbedding] = await embedTexts([query]);
  if (!queryEmbedding || queryEmbedding.length !== KOS_EMBEDDING_DIMENSIONS) {
    throw new KosError(
      "KOS_RAG_003",
      `Query embedding had ${queryEmbedding?.length ?? 0} dims, expected ${KOS_EMBEDDING_DIMENSIONS}.`,
      502,
    );
  }
  const queryLiteral = vectorToPgLiteral(queryEmbedding);
  // Sanity-check the literal shape even though we no longer inline
  // it into SQL text — this catches a future bug in vectorToPgLiteral
  // earlier than pgvector's server-side parse error would.
  assertSafeVectorLiteral(queryLiteral);

  // ── pgvector ANN search ─────────────────────────────────────────
  // The `<=>` operator returns cosine *distance* (0 = identical, 2 =
  // opposite). similarity = 1 - distance.
  //
  // Why parameterised cast (vs. inline literal):
  //   The 3072-dim halfvec serialises to ~55 KB of text. Inlining
  //   it twice (similarity calc + ORDER BY) ships ~110 KB of SQL on
  //   every query. Neon's WebSocket adapter rejects payloads of
  //   that size before Postgres ever parses them — the failure
  //   surfaces as an opaque `prisma:error undefined` ErrorEvent
  //   with `Object.keys(err) === ['clientVersion']` and no actual
  //   message. The fix is to pass the literal as a regular SQL
  //   PARAMETER (cheap protocol field) and let Postgres cast the
  //   parameter's value at evaluation time.
  //
  //   `$3::halfvec(3072)` IS valid Postgres — the `3072` is a
  //   literal in the type-modifier position, the `$3` is the value
  //   being cast. The earlier error ("type modifiers must be simple
  //   constants") was triggered by `$3::halfvec($N)` where the
  //   dimension itself was a parameter — illegal. With the
  //   dimension hard-coded as `3072`, the cast is clean.
  //
  //   Postgres deduplicates `$3` references within a single
  //   prepared plan, so the vector is bound exactly once even
  //   though it appears in both the similarity expression and the
  //   ORDER BY clause.
  //
  // ─── Fix (B) — params hygiene ──────────────────────────────────
  // `docTypes` is typed as `KosDocType[]` (a Prisma string-literal
  // union), so at runtime each element is already a plain string.
  // We `.map(String)` anyway as belt-and-braces — if a caller ever
  // sneaks in something exotic (a wrapped enum object from a
  // future Prisma version, a Buffer, etc.), Neon's serverless
  // driver chokes opaquely without surfacing the type error.
  // Coercing here keeps the failure visible at the call site.
  const docTypesParams = docTypes ? docTypes.map(String) : null;

  // ── Fix (C) — empty-docTypes guard ─────────────────────────────
  // `IN ()` is invalid Postgres syntax. The `if (docTypes)` branch
  // is already only taken when `options.docTypes` is non-empty (see
  // the `length > 0` check above), but assert defensively so a
  // future refactor that flattens the branch can't slip through
  // without a fail-fast.
  if (docTypesParams !== null && docTypesParams.length === 0) {
    throw new KosError(
      "KOS_RAG_005",
      "Internal: docTypesParams reached the SQL builder as an empty array. This should be impossible — drop to the no-filter branch instead.",
      500,
    );
  }

  // ── Diagnostic fallback path (env-gated, dev-only) ─────────────
  // When KOS_RAG_FALLBACK_SCAN is set we drop the halfvec operator
  // path entirely and route through `c.embedding::vector <=>
  // $3::vector`. Postgres still computes cosine distance, but the
  // planner cannot use the halfvec HNSW index — it falls back to a
  // sequential scan with explicit vector arithmetic. Useful for
  // isolating "is this a halfvec/operator-class issue or something
  // else?" without redeploying.
  //
  // Production-only safeguard: the env flag is ignored when
  // NODE_ENV === "production". The fast path always wins in prod.
  const useFallbackScan =
    process.env.NODE_ENV !== "production" &&
    process.env.KOS_RAG_FALLBACK_SCAN === "true";
  const castType = useFallbackScan
    ? "vector"
    : `halfvec(${KOS_EMBEDDING_DIMENSIONS})`;
  // Fast path: `c.embedding` is already halfvec(3072) — no column
  // cast needed. Fallback path: cast halfvec → vector at query
  // time, accepting the sequential-scan cost.
  const embeddingCol = useFallbackScan
    ? `c.embedding::vector`
    : `c.embedding`;

  // ── KOS_RAG_PARAM_MODE — vary the $3 binding shape ─────────────
  // Diagnostic only — controls how the vector literal is sent
  // across the Neon WebSocket protocol. Three modes:
  //   "text"   (default) — JS string, cast with ::halfvec(3072).
  //                        Should Just Work. If it doesn't, the
  //                        adapter is mishandling the protocol.
  //   "buffer"           — Buffer.from(literal, "utf8"). Sends the
  //                        same bytes but as a binary-shape param.
  //                        Useful if the adapter's text codec
  //                        chokes on the size.
  //   "array"            — the raw number[] (3072 floats). Sent as
  //                        a Postgres float8[] which Postgres will
  //                        try to cast to halfvec(3072). Most
  //                        likely fails (pgvector wants text input
  //                        or float4[]) but rules out the codec.
  // Gated by NODE_ENV — production always uses "text".
  const paramMode = (
    process.env.NODE_ENV !== "production"
      ? (process.env.KOS_RAG_PARAM_MODE ?? "text").toLowerCase()
      : "text"
  );
  let vectorParam: unknown;
  if (paramMode === "buffer") {
    vectorParam = Buffer.from(queryLiteral, "utf8");
  } else if (paramMode === "array") {
    vectorParam = queryEmbedding;
  } else {
    vectorParam = queryLiteral;
  }

  // ── Assemble SQL + positional params ───────────────────────────
  // Param layout:
  //   $1 = tenantId
  //   $2 = topK (LIMIT)
  //   $3 = vector value (text | Buffer | number[] per PARAM_MODE),
  //        cast on the server via ::${castType}
  //   $4…$N = docType filter values (when docTypesParams is non-null)
  let sql: string;
  let paramsArray: unknown[];
  if (docTypesParams) {
    const docTypePlaceholders = docTypesParams
      .map((_, i) => `$${i + 4}`)
      .join(", ");
    sql = `
      SELECT
        c.id AS chunk_id,
        c."documentId" AS document_id,
        c.content,
        c."pageNum" AS page_num,
        c.metadata,
        d.title AS document_title,
        d."docType" AS doc_type,
        1 - (${embeddingCol} <=> $3::${castType}) AS similarity
      FROM "kos_document_chunks" c
      JOIN "kos_documents" d ON d.id = c."documentId"
      WHERE d."tenantId" = $1
        AND d."status" = 'READY'
        AND d."docType"::text IN (${docTypePlaceholders})
      ORDER BY ${embeddingCol} <=> $3::${castType}
      LIMIT $2
    `;
    paramsArray = [tenantId, topK, vectorParam, ...docTypesParams];
  } else {
    sql = `
      SELECT
        c.id AS chunk_id,
        c."documentId" AS document_id,
        c.content,
        c."pageNum" AS page_num,
        c.metadata,
        d.title AS document_title,
        d."docType" AS doc_type,
        1 - (${embeddingCol} <=> $3::${castType}) AS similarity
      FROM "kos_document_chunks" c
      JOIN "kos_documents" d ON d.id = c."documentId"
      WHERE d."tenantId" = $1
        AND d."status" = 'READY'
      ORDER BY ${embeddingCol} <=> $3::${castType}
      LIMIT $2
    `;
    paramsArray = [tenantId, topK, vectorParam];
  }

  // ── Diagnostic logging (dev-only) ──────────────────────────────
  // The Neon driver-adapter sometimes returns `prisma:error
  // undefined` + a bare ErrorEvent that hides the actual Postgres
  // message. These logs make the failing call observable from the
  // Next dev server output. Gated by NODE_ENV so production never
  // sees them.
  if (process.env.NODE_ENV !== "production") {
    console.log("[kos-rag-debug] tenantId:", tenantId);
    console.log("[kos-rag-debug] topK:", topK);
    console.log("[kos-rag-debug] docTypes:", docTypesParams);
    console.log("[kos-rag-debug] embedding length:", queryEmbedding.length);
    console.log(
      "[kos-rag-debug] literal preview:",
      queryLiteral.slice(0, 80),
      "...",
      queryLiteral.slice(-40),
    );
    console.log("[kos-rag-debug] literal length:", queryLiteral.length);
    console.log("[kos-rag-debug] cast type:", castType);
    console.log("[kos-rag-debug] fallback scan:", useFallbackScan);
    console.log("[kos-rag-debug] param mode:", paramMode);
    // Slim the params dump — $3 is the vector (25 KB string OR
    // 3072-element array OR equivalent Buffer) and dumping it whole
    // drowns the console. Show its shape + length instead, and let
    // the other params print verbatim.
    const slimParams = paramsArray.map((p, i) => {
      if (i !== 2) return p;
      if (typeof p === "string") return `<vector text, ${p.length} chars>`;
      if (Buffer.isBuffer(p)) return `<vector buffer, ${p.length} bytes>`;
      if (Array.isArray(p)) return `<vector array, ${p.length} numbers>`;
      return `<vector ${typeof p}>`;
    });
    console.log("[kos-rag-debug] params:", slimParams);
    console.log("[kos-rag-debug] SQL:");
    console.log(sql);
  }

  let rows: RawRow[];
  try {
    rows = await prisma.$queryRawUnsafe<RawRow[]>(sql, ...paramsArray);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      const e = err as Record<string, unknown> | null;
      console.error("[kos-rag-debug] FULL ERROR:", err);
      console.error("[kos-rag-debug] err.message:", e?.message);
      console.error("[kos-rag-debug] err.code:", e?.code);
      console.error(
        "[kos-rag-debug] err.meta:",
        e?.meta ? JSON.stringify(e.meta, null, 2) : "(none)",
      );
      console.error("[kos-rag-debug] err.cause:", e?.cause);
      console.error(
        "[kos-rag-debug] Object.keys(err):",
        e ? Object.keys(e) : "(err is null/undefined)",
      );
    }
    throw err;
  }

  return rows
    .filter((r) => r.similarity >= minSimilarity)
    .map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      docType: r.doc_type,
      pageNum: r.page_num,
      content: r.content,
      similarity: typeof r.similarity === "number" ? r.similarity : Number(r.similarity),
      metadata: r.metadata ?? null,
    }));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Encode a number[] as a pgvector / halfvec input literal:
 *   `[0.123,0.456,...]`
 *
 * Kept locally rather than reused from document-ingestion.ts so this
 * module has no inbound coupling — the retriever can ship without the
 * ingestion service being loaded.
 */
function vectorToPgLiteral(vec: number[]): string {
  const parts = new Array<string>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    parts[i] = vec[i].toString();
  }
  return `[${parts.join(",")}]`;
}

/**
 * Belt-and-braces guard for the unsafe SQL interpolation path. See
 * the identical helper in document-ingestion.ts for the reasoning —
 * both files maintain their own copy to keep the retriever free of
 * an inbound import from the ingestion service.
 */
function assertSafeVectorLiteral(s: string): void {
  if (!/^\[[-+0-9.,eE\s]+\]$/.test(s)) {
    throw new KosError(
      "KOS_RAG_004",
      "Unsafe vector literal — refusing to inline-interpolate into SQL.",
      500,
    );
  }
}
