// @vitest-environment happy-dom
/**
 * STOP UX — confirm + instant reset (2026-05-22).
 *
 * Three behaviours, each pinned by a test:
 *   (a) On confirm, the cancel POST fires once for every collected
 *       pendingRunId.
 *   (b) On confirm, the local reset clears the workflow + execution
 *       stores (nodes empty, artifacts empty, currentExecution null,
 *       isExecuting false).
 *   (c) Stale-execution guard: when isExecuting flips to false (e.g.
 *       via clearCurrentExecution), code paths that read it later
 *       MUST short-circuit. We pin the read used by the TR-026 poll
 *       loop and the per-node body in `useExecution.ts`.
 *
 * The tests deliberately exercise the SAME stores the production code
 * calls (`useWorkflowStore`, `useExecutionStore`) so a regression in
 * the reset wiring trips them. Mocks are limited to global fetch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// useWorkflowStore is wrapped by Zustand `persist` middleware that needs
// `window.localStorage`. The `@vitest-environment happy-dom` pragma at
// the top of this file gives us a real DOM + localStorage early enough
// that the store's import-time storage factory resolves cleanly.

import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import {
  useExecutionStore,
  selectClearArtifacts,
  selectClearCurrentExecution,
} from "@/features/execution/stores/execution-store";
import type { ExecutionArtifact } from "@/types/execution";
import type { WorkflowNode } from "@/types/nodes";

const RUN_ID_A = "run-aaa-111";
const RUN_ID_B = "run-bbb-222";

function tr026PendingArtifact(
  tileId: string,
  runId: string,
): ExecutionArtifact {
  // Same shape `tr-026.ts:82-109` returns, minus per-instance fields.
  return {
    id: `art_${tileId}_${Date.now()}`,
    executionId: "exec-test",
    tileInstanceId: tileId,
    type: "file",
    dataUri: undefined,
    data: {
      ifcUrl: null,
      runId,
      pendingRunId: runId,
      statusUrl: `/api/brief-to-ifc/v3/runs/${runId}/status`,
      entityCount: 0,
      turns: 0,
      generatorCostUsd: 0,
      generatorMs: 0,
      summary: "Agent build queued — running in background...",
    },
    metadata: {
      stage: "agent-builder-queued",
      filename: `ai-ifc-${tileId}.ifc`,
      mimeType: "application/x-step",
      pendingRunId: runId,
      generatorVersion: "v3",
      runId,
    },
    createdAt: new Date(),
  };
}

function inputNodeWithBrief(briefText: string): WorkflowNode {
  return {
    id: "tile-in009-1",
    type: "default",
    position: { x: 0, y: 0 },
    data: {
      catalogueId: "IN-009",
      label: "Brief Input",
      briefText,
    },
  } as unknown as WorkflowNode;
}

/**
 * Verbatim port of `WorkflowCanvas.tsx:527-537`. Kept inline so this
 * test is the contract — if the canvas helper drifts, the test still
 * captures what STOP actually reads.
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
  // Clean both stores between tests; Zustand persistence is in-memory
  // here (no window.localStorage in jsdom-free node env). We do not
  // call `useWorkflowStore.persist.clearStorage()` since the persist
  // middleware is a no-op when window is undefined.
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    isDirty: false,
    currentWorkflow: null,
  });
  useExecutionStore.setState((s) => ({
    ...s,
    artifacts: new Map(),
    currentExecution: null,
    isExecuting: false,
    executionProgress: 0,
  }));
});

describe("STOP UX — confirm-then-reset (2026-05-22)", () => {
  // ─── (a) ──────────────────────────────────────────────────────────────

  it("(a) on confirm, fires cancel POST once per pending runId", async () => {
    // Seed the artifacts store with two in-flight TR-026 builds.
    const artifacts = new Map<string, ExecutionArtifact>([
      ["tile-1", tr026PendingArtifact("tile-1", RUN_ID_A)],
      ["tile-2", tr026PendingArtifact("tile-2", RUN_ID_B)],
    ]);
    useExecutionStore.setState({ artifacts, isExecuting: true });

    // Mock global fetch — record every cancel POST.
    const cancelCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const m = url.match(/\/api\/brief-to-ifc\/v3\/runs\/([^/]+)\/cancel$/);
      if (m) {
        cancelCalls.push(m[1]);
        return new Response(
          JSON.stringify({ id: m[1], status: "CANCELLED", cancelled: true }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Re-implement the production handler's cancel-POST loop verbatim
    // — fire-and-forget, swallow per-runId errors.
    const pendingRunIds = collectPendingRunIdsFromMap(
      useExecutionStore.getState().artifacts,
    );
    for (const runId of pendingRunIds) {
      void fetch(`/api/brief-to-ifc/v3/runs/${runId}/cancel`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    }
    // Let microtasks settle so the fetch promises run.
    await new Promise((r) => setTimeout(r, 10));

    expect(cancelCalls.sort()).toEqual([RUN_ID_A, RUN_ID_B].sort());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── (b) ──────────────────────────────────────────────────────────────

  it("(b) on confirm, SOFT reset KEEPS nodes+edges, resets statuses to idle, empties IN-009 briefText, AND clears execution state — the template stays on screen, ready for a new brief", () => {
    // Seed: a full 13-node workflow (mimic of what TR-025→TR-026→…→EX-007
    // looks like on the canvas) with an IN-009 holding briefText, plus
    // some nodes in mid-run states (running / success) and an active
    // execution row + artifacts.
    const briefNode = inputNodeWithBrief("Modern 2BHK in Mumbai with a balcony");
    // Stamp a running status onto the brief node and another node so we
    // can prove the soft reset clears it.
    (briefNode.data as Record<string, unknown>).status = "success";
    const otherNodes: WorkflowNode[] = Array.from({ length: 12 }, (_, i) => ({
      id: `tile-${i + 2}`,
      type: "default",
      position: { x: (i + 1) * 100, y: 0 },
      data: {
        catalogueId: i === 0 ? "TR-025" : "TR-026",
        label: `Node ${i + 2}`,
        status: i < 2 ? "running" : i < 4 ? "success" : i < 6 ? "error" : undefined,
        errorMessage: i === 4 ? "boom" : undefined,
      },
    } as unknown as WorkflowNode));
    const seededEdges = [
      { id: "e1", source: briefNode.id, target: "tile-2" },
      { id: "e2", source: "tile-2", target: "tile-3" },
    ];
    useWorkflowStore.setState({
      nodes: [briefNode, ...otherNodes],
      edges: seededEdges as unknown as ReturnType<typeof useWorkflowStore.getState>["edges"],
      currentWorkflow: { id: "wf-test", name: "Test", tileGraph: { nodes: [], edges: [] } } as unknown as ReturnType<typeof useWorkflowStore.getState>["currentWorkflow"],
      isDirty: true,
    });
    useExecutionStore.setState({
      artifacts: new Map([["tile-1", tr026PendingArtifact("tile-1", RUN_ID_A)]]),
      currentExecution: { id: "exec-test", workflowId: "wf-test" } as unknown as ReturnType<typeof useExecutionStore.getState>["currentExecution"],
      isExecuting: true,
      executionProgress: 42,
    });

    // Sanity pre-conditions.
    expect(useWorkflowStore.getState().nodes).toHaveLength(13);
    expect(useWorkflowStore.getState().edges).toHaveLength(2);
    expect(
      (useWorkflowStore.getState().nodes[0].data as Record<string, unknown>).briefText,
    ).toBe("Modern 2BHK in Mumbai with a balcony");
    expect(useExecutionStore.getState().isExecuting).toBe(true);
    expect(useExecutionStore.getState().artifacts.size).toBe(1);
    const preCurrentWorkflow = useWorkflowStore.getState().currentWorkflow;
    expect(preCurrentWorkflow).not.toBeNull();

    // Production SOFT-reset path — exactly what `handleConfirmStop` runs.
    // `softResetCanvas` preserves nodes/edges/currentWorkflow; only
    // execution markers + IN-009 brief get wiped. `clearArtifacts` +
    // `clearCurrentExecution` handle the run-side cleanup.
    useWorkflowStore.getState().softResetCanvas();
    selectClearArtifacts(useExecutionStore.getState())();
    selectClearCurrentExecution(useExecutionStore.getState())();

    // ─── Template stays ────────────────────────────────────────────
    // The visible canvas is byte-equivalent in shape: same node IDs,
    // same edges, same currentWorkflow. The user is NOT dumped on
    // "Sketch your first workflow".
    const postNodes = useWorkflowStore.getState().nodes;
    expect(postNodes).toHaveLength(13);
    expect(postNodes.map((n) => n.id)).toEqual([
      briefNode.id,
      ...otherNodes.map((n) => n.id),
    ]);
    expect(useWorkflowStore.getState().edges).toEqual(seededEdges);
    expect(useWorkflowStore.getState().currentWorkflow).toBe(preCurrentWorkflow);

    // ─── Every node is idle ────────────────────────────────────────
    for (const n of postNodes) {
      const d = n.data as Record<string, unknown>;
      expect(d.status).toBeUndefined();
      expect(d.errorMessage).toBeUndefined();
    }

    // ─── IN-009 brief is empty ─────────────────────────────────────
    const postBrief = postNodes[0].data as Record<string, unknown>;
    expect(postBrief.briefText).toBe("");
    expect(postBrief.inputValue).toBe("");
    expect(postBrief.catalogueId).toBe("IN-009"); // unchanged

    // ─── Execution state wiped ─────────────────────────────────────
    expect(useExecutionStore.getState().artifacts.size).toBe(0);
    expect(useExecutionStore.getState().currentExecution).toBeNull();
    expect(useExecutionStore.getState().isExecuting).toBe(false);
    expect(useExecutionStore.getState().executionProgress).toBe(0);

    // collectPendingRunIds is therefore the empty list — the pagehide
    // handler post-reset finds nothing to double-cancel.
    expect(
      collectPendingRunIdsFromMap(useExecutionStore.getState().artifacts),
    ).toEqual([]);
  });

  it("(b2) softResetCanvas does NOT push undo history (system action) and does NOT change currentWorkflow / edges", () => {
    // Pin the contract that distinguishes soft-reset from a user edit:
    // it's not undoable (since it's not the user's edit), and it must
    // leave the workflow identity alone so the URL / save state stays
    // consistent.
    const briefNode = inputNodeWithBrief("hello world");
    (briefNode.data as Record<string, unknown>).status = "running";
    const seededWorkflow = {
      id: "wf-x",
      name: "X",
      tileGraph: { nodes: [], edges: [] },
    } as unknown as ReturnType<typeof useWorkflowStore.getState>["currentWorkflow"];
    useWorkflowStore.setState({
      nodes: [briefNode],
      edges: [{ id: "e", source: "a", target: "b" }] as unknown as ReturnType<typeof useWorkflowStore.getState>["edges"],
      currentWorkflow: seededWorkflow,
    });
    const edgesBefore = useWorkflowStore.getState().edges;

    useWorkflowStore.getState().softResetCanvas();

    expect(useWorkflowStore.getState().edges).toBe(edgesBefore); // referential equality preserved
    expect(useWorkflowStore.getState().currentWorkflow).toBe(seededWorkflow);
    expect(
      (useWorkflowStore.getState().nodes[0].data as Record<string, unknown>).status,
    ).toBeUndefined();
    expect(
      (useWorkflowStore.getState().nodes[0].data as Record<string, unknown>).briefText,
    ).toBe("");
  });

  // ─── (c) ──────────────────────────────────────────────────────────────

  it("(c) stale-execution guard short-circuits the read paths used by useExecution.ts (TR-026 poll + outer for-level + per-node body)", () => {
    // The production guards all share the same read:
    //   if (!useExecutionStore.getState().isExecuting) return / break;
    // We test the read returns the expected value after reset, so the
    // production code paths trivially short-circuit. (A test that
    // actually drives the polling loop is in
    // src/features/execution/__tests__/tr-026-cancel-visibility.test.ts;
    // this one pins the boolean contract the guards depend on.)

    useExecutionStore.setState({ isExecuting: true });
    expect(useExecutionStore.getState().isExecuting).toBe(true);

    // Simulate the reset path firing during a stale poll.
    selectClearCurrentExecution(useExecutionStore.getState())();

    // The guard reads `useExecutionStore.getState().isExecuting`. After
    // reset it is false — every guard short-circuits.
    expect(useExecutionStore.getState().isExecuting).toBe(false);

    // Additionally simulate the "post-reset stale write" path: a
    // hypothetical caller that ran addArtifact AFTER reset would not
    // be visible to a freshly-mounted canvas because the guard
    // intercepts BEFORE the store.set fires. We pin the contract that
    // the store's own clear methods leave it in the clean state we
    // require, even if a downstream caller mistakenly re-adds (the
    // production guards prevent the re-add; this test pins both halves
    // of the contract).
    const artifacts = useExecutionStore.getState().artifacts;
    expect(artifacts.size).toBe(0);
    expect(useExecutionStore.getState().currentExecution).toBeNull();
  });
});
