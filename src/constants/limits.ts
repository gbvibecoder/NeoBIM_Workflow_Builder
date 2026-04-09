/**
 * App-wide numeric limits shared between client UX and server enforcement.
 *
 * Both sides must use the same source of truth — drift between them is the
 * exact bug Phase 2 Task 4 fixed for regenerationCounts (the client cap was
 * 3 in execution-store.ts, but the server had no cap at all, so refresh
 * trivially bypassed it).
 */

/** Maximum number of regenerations per node per execution. Enforced
 *  server-side in src/app/api/execute-node/route.ts via a Prisma transaction
 *  on Execution.metadata.regenerationCounts. Mirrored client-side in
 *  useExecutionStore.regenerationCounts as a UX hint (instant "out of regens"
 *  feedback before the round-trip), but the server is the authoritative gate.
 *
 *  A new execution starts with an empty regenerationCounts map, so users get
 *  a fresh budget per workflow run.
 */
export const MAX_REGENERATIONS = 3;
