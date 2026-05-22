-- ============================================================
-- KOS Week 2 — promote embedding column 1536 → 3072
-- ============================================================
-- OpenAI `text-embedding-3-large` produces 3072-dim vectors. Week 1's
-- migration created `vector(1536)` (the small-model dimension); this
-- migration widens the column to fit the large model's output.
--
-- Dimension ceiling: pgvector's HNSW index supports a maximum of
--   • `vector`  — 2000 dimensions
--   • `halfvec` — 4000 dimensions (16-bit half-precision floats)
-- so the natural `vector(3072)` would have to drop the HNSW index
-- (sequential scan only). We use `halfvec(3072)` instead — same
-- 3072-dim coverage, indexable, half the storage, with sub-1%
-- ranking impact at retrieval time for cosine search on text
-- embeddings (well within retrieval noise).
--
-- Safe because `kos_document_chunks` is still empty at this point
-- (Week 1 was foundation-only — no ingestion ran against it). If
-- this migration is applied after rows exist, the `USING NULL`
-- cast would null them out — guard with a row count check in
-- production deploy procedure.
-- ============================================================

-- Drop the dimension-specific HNSW index before the type change.
-- The index name comes from Week 1's `kos_pgvector` migration.
DROP INDEX IF EXISTS "kos_document_chunks_embedding_idx";

-- Three-step type flip identical to Week 1's BYTEA → vector(1536)
-- approach. Required because the column is `NOT NULL` and Postgres
-- does not allow a type cast on a NOT NULL column when the cast
-- could theoretically produce NULLs.
ALTER TABLE "kos_document_chunks"
    ALTER COLUMN "embedding" DROP NOT NULL;

ALTER TABLE "kos_document_chunks"
    ALTER COLUMN "embedding" TYPE halfvec(3072) USING NULL;

ALTER TABLE "kos_document_chunks"
    ALTER COLUMN "embedding" SET NOT NULL;

-- Re-create the HNSW index for the new dimension/type. Default HNSW
-- params (`m=16`, `ef_construction=64`) are fine for the pilot's
-- ≤50k chunk target; revisit once we have real latency telemetry.
-- Note: the operator class is `halfvec_cosine_ops` for halfvec
-- columns, not `vector_cosine_ops`.
CREATE INDEX IF NOT EXISTS "kos_document_chunks_embedding_idx"
    ON "kos_document_chunks"
    USING hnsw ("embedding" halfvec_cosine_ops);
