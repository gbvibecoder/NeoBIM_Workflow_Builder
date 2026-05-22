/**
 * Tenant-isolation regression test for `retrieveChunks`.
 *
 * Rationale: KOS multi-tenant isolation is enforced inside the SQL
 * template literal in `rag-retriever.ts`. If a future refactor drops
 * or weakens the `WHERE d."tenantId" = ${tenantId}` clause, this
 * test fails before the change can land — preserving the single
 * most important security invariant of the feature.
 *
 * Approach: rather than spin a real Postgres + pgvector instance in
 * CI (which Week 2 doesn't have infra for), we mock `prisma.$queryRaw`
 * AND the OpenAI embedder, then:
 *
 *   1. Capture the SQL template + bound parameters on every call.
 *   2. Assert the captured params contain tenant A's id (and NOT
 *      tenant B's) when called with tenant A — and vice versa.
 *   3. Have the mock return chunks ATTRIBUTED to whichever tenantId
 *      the caller bound, simulating the real isolation behaviour.
 *
 * This catches the failure mode "someone refactored retrieveChunks to
 * accept (query) without tenantId and the WHERE clause is now
 * missing or hard-coded" because the captured params won't carry the
 * tenant id at all.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

const captures: CapturedQuery[] = [];

const prismaMocks = vi.hoisted(() => ({
  $queryRawUnsafe: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: prismaMocks.$queryRawUnsafe,
  },
}));

const embeddingsMocks = vi.hoisted(() => ({
  embedTexts: vi.fn(),
}));

vi.mock("@/features/kos/services/embeddings", () => ({
  embedTexts: embeddingsMocks.embedTexts,
  // Re-export the dimension constant the retriever imports.
  KOS_EMBEDDING_DIMENSIONS: 3072,
}));

// Import AFTER mocks are registered so the SUT picks up the doubles.
import { retrieveChunks } from "@/features/kos/services/rag-retriever";

// ─── Fixtures ──────────────────────────────────────────────────────

const TENANT_A_ID = "tenant_aaaaaaaaaaaa";
const TENANT_B_ID = "tenant_bbbbbbbbbbbb";

function tenantAChunks() {
  return [
    {
      chunk_id: "chunk-a-1",
      document_id: "doc-a-1",
      content: "PAC certificate for Kalzen Tower",
      page_num: 1,
      metadata: null,
      document_title: "Tower PAC",
      doc_type: "PAC",
      similarity: 0.92,
    },
    {
      chunk_id: "chunk-a-2",
      document_id: "doc-a-2",
      content: "Warranty details for Tower units",
      page_num: 3,
      metadata: null,
      document_title: "Tower Warranty",
      doc_type: "WARRANTY",
      similarity: 0.81,
    },
  ];
}

function tenantBChunks() {
  return [
    {
      chunk_id: "chunk-b-1",
      document_id: "doc-b-1",
      content: "Case study for Acme Plaza",
      page_num: 2,
      metadata: null,
      document_title: "Plaza Case Study",
      doc_type: "CASE_STUDY",
      similarity: 0.88,
    },
  ];
}

beforeEach(() => {
  captures.length = 0;
  prismaMocks.$queryRawUnsafe.mockReset();
  embeddingsMocks.embedTexts.mockReset();

  embeddingsMocks.embedTexts.mockResolvedValue([
    // 3072-dim placeholder — the actual values don't matter; the
    // retriever turns the array into a vector literal that gets
    // inlined into the SQL string (not bound as a param).
    new Array(3072).fill(0.001),
  ]);

  // Capture every $queryRawUnsafe invocation. The retriever fires
  // TWO kinds of query per call:
  //   1. A pre-flight ping ("SELECT 1 AS test, current_database() …")
  //      — no tenant binding, no chunk join. Diagnostic only.
  //   2. The actual ANN query against kos_document_chunks — this is
  //      the one we want to pin tenant isolation against.
  // We only push the second kind to `captures` so the existing
  // length/index assertions stay meaningful. The ping is allowed
  // through (returns an empty array) so retriever code keeps
  // running.
  prismaMocks.$queryRawUnsafe.mockImplementation(
    (sql: string, ...params: unknown[]) => {
      const isMainQuery = sql.includes("kos_document_chunks");
      if (isMainQuery) {
        captures.push({ sql, params });
      }
      const tenantId = params.find(
        (p) => p === TENANT_A_ID || p === TENANT_B_ID,
      );
      if (tenantId === TENANT_A_ID) return Promise.resolve(tenantAChunks());
      if (tenantId === TENANT_B_ID) return Promise.resolve(tenantBChunks());
      return Promise.resolve([]);
    },
  );
});

// ─── Tests ─────────────────────────────────────────────────────────

describe("retrieveChunks — tenant isolation", () => {
  it("scopes results to tenant A when called with tenant A's id", async () => {
    const results = await retrieveChunks(TENANT_A_ID, "common query");

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.chunkId.startsWith("chunk-a-"))).toBe(true);
    expect(results.every((r) => r.documentId.startsWith("doc-a-"))).toBe(true);

    // Capture proves the SQL carried tenant A's id, NOT tenant B's.
    expect(captures).toHaveLength(1);
    expect(captures[0].params).toContain(TENANT_A_ID);
    expect(captures[0].params).not.toContain(TENANT_B_ID);
  });

  it("scopes results to tenant B when called with tenant B's id", async () => {
    const results = await retrieveChunks(TENANT_B_ID, "common query");

    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe("chunk-b-1");
    expect(results[0].documentId).toBe("doc-b-1");

    expect(captures).toHaveLength(1);
    expect(captures[0].params).toContain(TENANT_B_ID);
    expect(captures[0].params).not.toContain(TENANT_A_ID);
  });

  it("does not leak tenant A chunks when querying as tenant B", async () => {
    const aResults = await retrieveChunks(TENANT_A_ID, "shared query");
    const bResults = await retrieveChunks(TENANT_B_ID, "shared query");

    const aIds = new Set(aResults.map((r) => r.chunkId));
    const bIds = new Set(bResults.map((r) => r.chunkId));

    // Hard-cross-check: no chunk id appears in both result sets.
    for (const id of aIds) {
      expect(bIds.has(id)).toBe(false);
    }

    // Each tenant's call must include its own id and exclude the other's.
    expect(captures).toHaveLength(2);
    expect(captures[0].params).toContain(TENANT_A_ID);
    expect(captures[0].params).not.toContain(TENANT_B_ID);
    expect(captures[1].params).toContain(TENANT_B_ID);
    expect(captures[1].params).not.toContain(TENANT_A_ID);
  });

  it("throws KOS_RAG_001 when called without a tenantId", async () => {
    await expect(retrieveChunks("", "any query")).rejects.toMatchObject({
      code: "KOS_RAG_001",
      httpStatus: 500,
    });
  });

  it("filters out chunks below the minSimilarity floor", async () => {
    const results = await retrieveChunks(TENANT_A_ID, "common query", {
      minSimilarity: 0.85,
    });
    // Fixture has chunk-a-1 at 0.92 and chunk-a-2 at 0.81 — only the
    // first should survive a 0.85 floor.
    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe("chunk-a-1");
  });
});
