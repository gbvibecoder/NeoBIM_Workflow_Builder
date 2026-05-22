-- ============================================================
-- KOS — defensive halfvec cosine HNSW index (Week 2 hotfix)
-- ============================================================
-- The Week-2 migration `20260518300000_kos_pgvector_dim_3072_week2`
-- already creates `kos_document_chunks_embedding_idx` with
-- `halfvec_cosine_ops` after promoting the column to halfvec(3072).
-- This migration is strictly ADDITIVE: it ensures a halfvec_cosine_ops
-- HNSW index exists under a DIFFERENT, distinguishable name, so that
-- if any prior environment drifted (e.g. an index recreated by hand
-- under the wrong operator class), `prisma migrate deploy` heals it
-- without touching the original.
--
-- Why "additive only":
--   • Dropping the existing index risks degrading query latency
--     during the (brief) window before the new one is built — and
--     we don't know for certain the old one is wrong.
--   • Two HNSW indexes on the same column + same opclass cost extra
--     storage + maintenance, but functionally one of them will be
--     chosen by the planner; the duplicate is benign.
--   • Once telemetry confirms `kos_document_chunks_embedding_idx`
--     and this one behave identically, a follow-up migration can
--     drop the redundant copy.
--
-- The op class for `<=>` (cosine distance) on a halfvec column is
-- `halfvec_cosine_ops`. pgvector supports HNSW up to 4000 dimensions
-- for halfvec, so 3072 fits comfortably.
-- ============================================================

CREATE INDEX IF NOT EXISTS "kos_document_chunks_embedding_cosine_idx"
    ON "kos_document_chunks"
    USING hnsw ("embedding" halfvec_cosine_ops);
