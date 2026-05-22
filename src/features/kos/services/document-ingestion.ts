/**
 * KOS document ingestion pipeline.
 *
 * `ingestDocument(documentId)` is the worker entry point:
 *
 *   PARSING   → fetch PDF from S3, extract text per page
 *   CHUNKING  → split into ~800-token chunks with 150-token overlap
 *   EMBEDDING → batched OpenAI calls (text-embedding-3-large, 3072 dim)
 *   READY     → chunks inserted via $executeRaw (halfvec literal),
 *               KosDocument.status flipped + indexedAt set
 *
 * pgvector binding note: Prisma 7 has no native binding for the
 * `vector` / `halfvec` types. We render the array as a Postgres
 * vector literal (`[0.1,0.2,...]`) and cast it inline via
 * `::halfvec(3072)`. The literal MUST use square brackets — comma-
 * separated numbers in parens are a tuple, not a vector, and would
 * silently fail at index time.
 *
 * Tenant scope: not enforced here. The worker is invoked by QStash
 * with a documentId that was minted server-side under a tenant-scoped
 * request, so the row's `tenantId` is already trustworthy. Every
 * read in here is `where: { id: documentId }` — no cross-tenant
 * pathway.
 *
 * 50 MB ceiling: PDFs are buffered fully into memory for parsing.
 * That's fine at the current upload cap. Streaming parse is a Week
 * 3+ optimisation TODO if the cap rises.
 */

// Server-only by construction (Prisma, S3, embeddings); we don't
// `import "server-only"` because that package isn't in deps.

import { prisma } from "@/lib/db";
import { KosError } from "@/features/kos/lib/kos-errors";
import { extractTextFromPdf } from "@/lib/pdf-text-extractor";
import { fetchKosObjectAsBuffer } from "@/features/kos/services/s3-client";
import {
  embedTexts,
  KOS_EMBEDDING_DIMENSIONS,
} from "@/features/kos/services/embeddings";

const CHUNK_TARGET_TOKENS = 800;
const CHUNK_OVERLAP_TOKENS = 150;
const MIN_CHUNK_CHARS = 50;
// 1 token ≈ 0.75 words. We keep the heuristic word-based so we don't
// pull in tiktoken just to chunk text.
const WORDS_PER_TOKEN = 0.75;
const CHUNK_TARGET_WORDS = Math.floor(CHUNK_TARGET_TOKENS * WORDS_PER_TOKEN);
const CHUNK_OVERLAP_WORDS = Math.floor(CHUNK_OVERLAP_TOKENS * WORDS_PER_TOKEN);

// Prisma 7 mints cuids inside the QueryEngine; with `$executeRaw` we
// have to generate the id ourselves. `crypto.randomUUID()` is a valid
// TEXT id (Prisma's @default(cuid()) is a presentation contract, not
// a storage one — the column is just TEXT).
function newChunkId(): string {
  return globalThis.crypto.randomUUID();
}

export interface IngestDocumentResult {
  chunkCount: number;
  totalTokens: number;
}

/**
 * Worker-entry wrapper around `ingestDocument`. Pure: no
 * Request/Response handling, no logging side-effects beyond the
 * ingestion pipeline's own. The caller (QStash worker route OR the
 * dev inline-worker branch in confirm-upload) decides what to do
 * with the resolved promise.
 *
 * Adds a single defensive cross-tenant assertion: the caller's
 * asserted `tenantId` must match `KosDocument.tenantId`. This catches
 * the class of bugs where a documentId is plumbed under the wrong
 * tenant scope (e.g. a future refactor that drops the WHERE clause
 * upstream). On mismatch we throw KOS_INGEST_008 (403) — the document
 * row is NOT flipped to FAILED, because the doc actually belongs to
 * someone else and is fine.
 *
 * Returns `void` per Stage-A contract. Telemetry (chunkCount /
 * totalTokens) still lands in the `[kos-embeddings]` console log
 * trail produced by `embedTexts`.
 */
export async function runDocumentIngestion(
  documentId: string,
  tenantId: string,
): Promise<void> {
  if (!documentId || !tenantId) {
    throw new KosError(
      "KOS_INGEST_009",
      `runDocumentIngestion requires both documentId and tenantId (got documentId="${documentId}", tenantId="${tenantId}").`,
      400,
    );
  }
  const doc = await prisma.kosDocument.findUnique({
    where: { id: documentId },
    select: { id: true, tenantId: true },
  });
  if (!doc) {
    throw new KosError(
      "KOS_INGEST_001",
      `Document ${documentId} not found.`,
      404,
    );
  }
  if (doc.tenantId !== tenantId) {
    throw new KosError(
      "KOS_INGEST_008",
      `Tenant mismatch — document ${documentId} belongs to tenant ${doc.tenantId}, caller asserted ${tenantId}.`,
      403,
    );
  }
  await ingestDocument(documentId);
}

/**
 * Ingest a single KosDocument by id. On any error, the function
 * flips the row to FAILED, writes an audit log entry, and re-throws
 * so the worker can also log and decide whether QStash should retry.
 */
export async function ingestDocument(
  documentId: string,
): Promise<IngestDocumentResult> {
  const doc = await prisma.kosDocument.findUnique({
    where: { id: documentId },
  });
  if (!doc) {
    throw new KosError(
      "KOS_INGEST_001",
      `Document ${documentId} not found.`,
      404,
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: doc.tenantId },
  });
  if (!tenant) {
    throw new KosError(
      "KOS_INGEST_002",
      `Tenant ${doc.tenantId} not found for document ${documentId}.`,
      500,
    );
  }

  try {
    await prisma.kosDocument.update({
      where: { id: documentId },
      data: { status: "PARSING" },
    });

    // ── Fetch source PDF from S3 ─────────────────────────────────
    const { buffer } = await fetchKosObjectAsBuffer(tenant, doc.s3Key);

    // ── Extract text (multi-layer fallback) ──────────────────────
    const extracted = await extractTextFromPdf(buffer, {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      enableVisionFallback: true,
    });

    if (extracted.source === "failed" || !extracted.text) {
      const errors = JSON.stringify(extracted.errors);
      throw new KosError(
        "KOS_INGEST_003",
        `PDF text extraction failed for document ${documentId}: ${errors}`,
        422,
      );
    }

    const pageCount = extracted.pageCount ?? null;

    // ── Chunk ────────────────────────────────────────────────────
    await prisma.kosDocument.update({
      where: { id: documentId },
      data: { status: "CHUNKING", pageCount },
    });

    const chunks = chunkText(extracted.text);
    if (chunks.length === 0) {
      throw new KosError(
        "KOS_INGEST_004",
        `No usable chunks produced from document ${documentId} (text length=${extracted.text.length}).`,
        422,
      );
    }

    // ── Embed ────────────────────────────────────────────────────
    await prisma.kosDocument.update({
      where: { id: documentId },
      data: { status: "EMBEDDING" },
    });

    const vectors = await embedTexts(chunks.map((c) => c.content));
    if (vectors.length !== chunks.length) {
      throw new KosError(
        "KOS_INGEST_005",
        `Embedding count mismatch — got ${vectors.length} for ${chunks.length} chunks.`,
        502,
      );
    }

    // ── Persist via $executeRaw (vector literal cast) ────────────
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vec = vectors[i];
      if (vec.length !== KOS_EMBEDDING_DIMENSIONS) {
        throw new KosError(
          "KOS_INGEST_006",
          `Chunk ${i} vector has ${vec.length} dims, expected ${KOS_EMBEDDING_DIMENSIONS}.`,
          500,
        );
      }
      const literal = vectorToPgLiteral(vec);
      assertSafeVectorLiteral(literal);
      // Postgres rejects parameterised type modifiers ("type modifiers
      // must be simple constants or identifiers", SQLSTATE 42601), so
      // the halfvec dimension MUST appear as literal SQL text — it
      // cannot be a bound parameter. We use $executeRawUnsafe and
      // embed BOTH the vector literal AND the dimension inline in the
      // SQL string. The vector literal is regex-validated above so
      // there's no injection surface. Every OTHER value stays
      // properly parameterised ($1…$6).
      const escapedLiteral = literal.replace(/'/g, "''");
      const insertSql = `
        INSERT INTO "kos_document_chunks"
          ("id", "documentId", "content", "pageNum", "chunkIndex", "embedding", "metadata", "createdAt")
        VALUES ($1, $2, $3, $4, $5, '${escapedLiteral}'::halfvec(${KOS_EMBEDDING_DIMENSIONS}), $6::jsonb, NOW())
      `;
      await prisma.$executeRawUnsafe(
        insertSql,
        newChunkId(),
        doc.id,
        chunk.content,
        chunk.pageNum,
        i,
        JSON.stringify({ wordCount: chunk.wordCount }),
      );
    }

    // ── Finalise ─────────────────────────────────────────────────
    await prisma.kosDocument.update({
      where: { id: documentId },
      data: {
        status: "READY",
        indexedAt: new Date(),
        pageCount: pageCount ?? doc.pageCount,
      },
    });

    return {
      chunkCount: chunks.length,
      totalTokens: chunks.reduce((sum, c) => sum + estimateTokens(c.wordCount), 0),
    };
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await prisma.kosDocument
      .update({
        where: { id: documentId },
        data: { status: "FAILED" },
      })
      .catch(() => {});
    await prisma.kosAuditLog
      .create({
        data: {
          tenantId: doc.tenantId,
          actorType: "SYSTEM",
          actorId: "ingestion-worker",
          action: "DOC_INGEST_FAILED",
          details: { documentId, error: message.slice(0, 2000) },
        },
      })
      .catch(() => {});
    throw err;
  }
}

// ─── Chunking ─────────────────────────────────────────────────────────

interface RawChunk {
  content: string;
  pageNum: number | null;
  wordCount: number;
}

/**
 * Split extracted text into ~800-token windows with 150-token
 * overlap. Page numbers are best-effort — Layer-1 (unpdf) and
 * Layer-2 (pdf-parse) merge pages, so we cannot reliably attribute a
 * chunk to a specific page without re-parsing. For now every chunk
 * gets `pageNum: 1` as a placeholder; the future Layer-1 per-page
 * splitter will populate this properly. The schema already supports
 * the field.
 */
function chunkText(text: string): RawChunk[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const words = normalized.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const chunks: RawChunk[] = [];
  const stride = Math.max(1, CHUNK_TARGET_WORDS - CHUNK_OVERLAP_WORDS);

  for (let start = 0; start < words.length; start += stride) {
    const end = Math.min(words.length, start + CHUNK_TARGET_WORDS);
    const slice = words.slice(start, end).join(" ").trim();
    if (slice.length < MIN_CHUNK_CHARS) continue;
    chunks.push({
      content: slice,
      pageNum: 1, // TODO(week3): per-page parsing for accurate pageNum
      wordCount: end - start,
    });
    if (end >= words.length) break;
  }

  return chunks;
}

function estimateTokens(wordCount: number): number {
  return Math.ceil(wordCount / WORDS_PER_TOKEN);
}

// ─── pgvector / halfvec literal encoding ──────────────────────────────

/**
 * Encode a number[] as a pgvector / halfvec input literal:
 *   `[0.123,0.456,...]`
 *
 * Square brackets are NOT optional — `(0.1,0.2)` is interpreted as a
 * tuple and silently corrupts the index. Numeric values use
 * `Number.toString()` which produces the shortest decimal round-trip
 * form Postgres will accept.
 */
function vectorToPgLiteral(vec: number[]): string {
  const parts = new Array<string>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (!Number.isFinite(v)) {
      throw new KosError(
        "KOS_INGEST_007",
        `Non-finite value at vector index ${i}: ${v}`,
        500,
      );
    }
    parts[i] = v.toString();
  }
  return `[${parts.join(",")}]`;
}

/**
 * Belt-and-braces guard for the unsafe SQL interpolation path.
 *
 * `Number.toString()` cannot produce quote characters or backslashes,
 * so by construction the output of `vectorToPgLiteral` already only
 * contains digits, dots, minus signs, commas, brackets, and (for
 * very small numbers near zero) the letter `e`. This regex pins that
 * invariant — if a future refactor of `vectorToPgLiteral` ever
 * smuggles in something else, the next ingest call throws loud
 * instead of opening a SQL-injection seam.
 *
 * Allowed alphabet: digits, dot, minus, plus, comma, `e`/`E`
 * (exponent), whitespace, brackets. Anything else → throw.
 */
function assertSafeVectorLiteral(s: string): void {
  if (!/^\[[-+0-9.,eE\s]+\]$/.test(s)) {
    throw new KosError(
      "KOS_INGEST_010",
      "Unsafe vector literal — refusing to inline-interpolate into SQL.",
      500,
    );
  }
}
