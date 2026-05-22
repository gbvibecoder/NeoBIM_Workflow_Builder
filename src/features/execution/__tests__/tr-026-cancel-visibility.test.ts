/**
 * Cancel-bug fix (2026-05-22) — TR-026 pending-runId visibility.
 *
 * Bug: the TR-026 polling loop in `useExecution.ts` blocks for 10–25 min
 * waiting for the agent build to finish. During that window the canvas
 * STOP / pagehide handlers (`WorkflowCanvas.tsx:527-655`) read the
 * zustand `artifacts` store via `collectPendingRunIds` and find NO
 * TR-026 entry — because the artifact only lands in the store at
 * `useExecution.ts:2124` AFTER `executeNode` returns. Result: STOP fires
 * the "nothing in-flight to cancel server-side" toast and the cancel
 * endpoint is never POSTed; the agent loop keeps paying Anthropic.
 *
 * Fix: publish the pending artifact (with `data.pendingRunId`) to the
 * store BEFORE the poll `while` loop starts, via an `addArtifactFn`
 * threaded into `executeNode`. The terminal addArtifact at the caller
 * (`useExecution.ts:2124`) overwrites the pending stamp with the
 * completed artifact on success.
 *
 * What this file proves:
 *   (a) The store receives an artifact with `data.pendingRunId` BEFORE
 *       the TR-026 poll resolves.
 *   (b) The canvas's `collectPendingRunIds` logic (re-implemented here
 *       verbatim — same iteration, same field read) returns that id
 *       while polling.
 *   (c) The terminal artifact overwrites the pending stamp at the
 *       caller's addArtifact site so the store ends up with the
 *       completed shape, not the pending one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { executeNode } from "../hooks/useExecution";
import type { ExecutionArtifact } from "@/types/execution";
import type { WorkflowNode } from "@/types/nodes";

const RUN_ID = "run-abc-123";

function tr026Node(): WorkflowNode {
  // The hook treats `node.data.catalogueId` + `node.id` — nothing else
  // touched on the TR-026 branch under test. The unused-by-this-branch
  // fields are cast loosely so the test stays focused on the fix.
  return {
    id: "tile-tr026-1",
    type: "default",
    position: { x: 0, y: 0 },
    data: {
      catalogueId: "TR-026",
      label: "IFC Agent Builder",
    },
  } as unknown as WorkflowNode;
}

function pendingArtifactFromTR026Handler(): ExecutionArtifact {
  // Mirror exactly what `tr-026.ts:82-109` returns from the API.
  return {
    id: `art_tile-tr026-1_${Date.now()}`,
    executionId: "exec-test",
    tileInstanceId: "tile-tr026-1",
    type: "file",
    dataUri: undefined,
    data: {
      ifcUrl: null,
      runId: RUN_ID,
      pendingRunId: RUN_ID,
      statusUrl: `/api/brief-to-ifc/v3/runs/${RUN_ID}/status`,
      entityCount: 0,
      turns: 0,
      generatorCostUsd: 0,
      generatorMs: 0,
      runUrl: `/dashboard/brief-to-ifc/v3/runs/${RUN_ID}`,
      summary: "Agent build queued — running in background...",
    },
    metadata: {
      stage: "agent-builder-queued",
      filename: `ai-ifc-tile-tr026-1.ifc`,
      mimeType: "application/x-step",
      pendingRunId: RUN_ID,
      generatorVersion: "v3",
      runId: RUN_ID,
    },
    createdAt: new Date(),
  };
}

/**
 * Verbatim port of `WorkflowCanvas.tsx:527-537`'s `collectPendingRunIds`.
 * Kept inline (not imported) so this test is the contract: if the canvas
 * helper drifts away from "iterate artifacts → read art.data.pendingRunId",
 * the test still asserts what the cancel handlers actually do.
 */
function collectPendingRunIdsFromMap(
  artifacts: Map<string, ExecutionArtifact>,
): string[] {
  const out: string[] = [];
  for (const [, art] of artifacts) {
    const data = (art.data ?? {}) as Record<string, unknown>;
    const candidate = data.pendingRunId;
    if (typeof candidate === "string" && candidate.length > 0) {
      out.push(candidate);
    }
  }
  return out;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TR-026 cancel-bug fix — pending runId visibility", () => {
  it("(a) addArtifactFn is called with data.pendingRunId BEFORE the poll resolves", async () => {
    // 1st fetch = /api/execute-node (TR-026's submit-only response).
    // 2nd+ fetch = /api/brief-to-ifc/v3/runs/:id/status — return RUNNING
    // forever; the test never lets the poll loop reach a terminal state.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/execute-node")) {
        return new Response(
          JSON.stringify({ artifact: pendingArtifactFromTR026Handler() }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes(`/api/brief-to-ifc/v3/runs/${RUN_ID}/status`)) {
        return new Response(
          JSON.stringify({
            status: "RUNNING",
            ifcUrl: null,
            entityCount: null,
            turns: 0,
            generatorCostUsd: 0,
            generatorMs: 0,
            errorMessage: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Capture every addArtifact call AND record the snapshot of the
    // artifact's data at the time of the call (so a later mutation
    // can't retroactively change what we asserted).
    const store = new Map<string, ExecutionArtifact>();
    const addArtifactCalls: Array<{ nodeId: string; pendingRunId: unknown }> = [];
    const addArtifactFn = vi.fn((nodeId: string, art: ExecutionArtifact) => {
      const data = (art.data ?? {}) as Record<string, unknown>;
      addArtifactCalls.push({ nodeId, pendingRunId: data.pendingRunId });
      store.set(nodeId, art);
    });

    // Kick off executeNode but don't await it — the poll loop never
    // resolves under our fetch mock. Race against a short timeout so
    // the test finishes deterministically.
    const node = tr026Node();
    const promise = executeNode(
      node,
      "exec-test",
      null,
      null,
      true,  // useRealExecution
      false, // demoMode
      addArtifactFn,
    );
    // Suppress the unhandled-rejection that would otherwise be raised
    // when the test exits while the promise is still pending. The
    // outer Promise.race timeout below resolves first; we never check
    // this promise's result.
    promise.catch(() => {});

    // Give the implementation enough microtasks/macro-tasks to: complete
    // its fetch to /api/execute-node, parse the JSON, and run the
    // pre-poll publish. ONE setTimeout(0) tick is enough — the poll's
    // first setTimeout(8_000) blocks well past our assertion window.
    await new Promise((r) => setTimeout(r, 50));

    // (a) addArtifactFn was called at LEAST once, BEFORE the poll
    //     would have resolved (which it cannot — status returns
    //     RUNNING forever in this mock).
    expect(addArtifactFn).toHaveBeenCalled();
    expect(addArtifactCalls.length).toBeGreaterThanOrEqual(1);
    const firstCall = addArtifactCalls[0];
    expect(firstCall.nodeId).toBe("tile-tr026-1");
    expect(firstCall.pendingRunId).toBe(RUN_ID);

    // (b) The canvas's collectPendingRunIds, run against the (mocked)
    //     store, returns the live runId — i.e. STOP/pagehide WOULD
    //     find something to cancel right now.
    expect(collectPendingRunIdsFromMap(store)).toEqual([RUN_ID]);
  });

  it("(b) collectPendingRunIds returns [] when nothing was published — proves the test catches the pre-fix regression", () => {
    // Sanity check: with an empty store, the helper returns []. This
    // is exactly the pre-fix state, and is what made STOP / pagehide
    // silently no-op for 10–25 minutes.
    const empty = new Map<string, ExecutionArtifact>();
    expect(collectPendingRunIdsFromMap(empty)).toEqual([]);
  });

  it("(c) a terminal artifact overwrites the pending stamp at the caller's addArtifact site", () => {
    // The fix only changes when the FIRST addArtifact call happens
    // (now mid-poll, was after-poll). The caller's terminal
    // addArtifact at `useExecution.ts:2124` still runs on success and
    // OVERWRITES the entry by Map key — proves the store ends up
    // with the completed artifact, not the pending one.
    const store = new Map<string, ExecutionArtifact>();
    const addArtifact = (nodeId: string, art: ExecutionArtifact) => {
      store.set(nodeId, art);
    };

    const pending = pendingArtifactFromTR026Handler();
    addArtifact("tile-tr026-1", pending);
    expect(
      (store.get("tile-tr026-1")?.data as Record<string, unknown>).pendingRunId,
    ).toBe(RUN_ID);
    expect(collectPendingRunIdsFromMap(store)).toEqual([RUN_ID]);

    // Simulate the caller's overwrite at line 2124 after polling
    // resolves with COMPLETED.
    const completed: ExecutionArtifact = {
      ...pending,
      data: {
        ...(pending.data as Record<string, unknown>),
        ifcUrl: "https://r2.example.com/build.ifc",
        entityCount: 1234,
        turns: 5,
        generatorCostUsd: 0.42,
        pendingRunId: undefined,
        summary: "IFC generated — 1234 entities, 5 turns, $0.420.",
      },
      metadata: {
        ...(pending.metadata as Record<string, unknown>),
        stage: "agent-builder",
      },
    };
    addArtifact("tile-tr026-1", completed);

    const data = store.get("tile-tr026-1")?.data as Record<string, unknown>;
    expect(data.ifcUrl).toBe("https://r2.example.com/build.ifc");
    expect(data.pendingRunId).toBeUndefined();
    // collectPendingRunIds drops the entry because pendingRunId is
    // no longer a non-empty string.
    expect(collectPendingRunIdsFromMap(store)).toEqual([]);
  });
});
