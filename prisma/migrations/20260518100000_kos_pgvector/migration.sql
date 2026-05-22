-- ============================================================
-- KOS pgvector — install extension + convert embedding column
-- ============================================================
-- Runs immediately after `kos_foundation_week1`. The chunks table
-- is empty at this point so the BYTEA → vector(1536) conversion
-- is data-loss-free. The HNSW index uses cosine ops because the
-- canonical embedding model (OpenAI `text-embedding-3-small`) is
-- L2-normalised — cosine and dot-product rank identically and
-- HNSW handles cosine natively.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Prisma emits `Unsupported("vector(1536)")` as BYTEA NOT NULL.
-- The triple-step here is the safe way to flip a NOT NULL column's
-- type even when there are no rows:
--   1. drop NOT NULL  → cast can never fail on a hypothetical row
--   2. convert type   → BYTEA → vector(1536) (USING NULL is a no-op
--                       on an empty table; if any row did exist it
--                       would land as NULL, which step 3 catches)
--   3. set NOT NULL   → reinstates the original constraint so the
--                       Prisma client's typing keeps matching the DB
-- Net effect on the empty Week 1 table: column is `vector(1536) NOT NULL`.
ALTER TABLE "kos_document_chunks"
  ALTER COLUMN "embedding" DROP NOT NULL;

ALTER TABLE "kos_document_chunks"
  ALTER COLUMN "embedding" TYPE vector(1536) USING NULL;

ALTER TABLE "kos_document_chunks"
  ALTER COLUMN "embedding" SET NOT NULL;

-- HNSW index for approximate-nearest-neighbour cosine search. Default
-- HNSW params (`m=16`, `ef_construction=64`) are fine through ~50k
-- chunks; re-tune in a follow-up migration once we have real latency
-- numbers from the pilot.
CREATE INDEX IF NOT EXISTS "kos_document_chunks_embedding_idx"
  ON "kos_document_chunks"
  USING hnsw ("embedding" vector_cosine_ops);
