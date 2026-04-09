"use client";

import { create } from "zustand";
import { useWorkflowStore } from "@/stores/workflow-store";
import type {
  Execution,
  ExecutionArtifact,
  ExecutionStatus,
  TileExecutionResult,
} from "@/types/execution";

export interface VideoGenerationState {
  progress: number; // 0-100
  status: "submitting" | "processing" | "rendering" | "complete" | "failed";
  phase?: string; // Current rendering phase label (e.g., "Exterior Pull-in")
  exteriorTaskId?: string;
  interiorTaskId?: string;
  failureMessage?: string;
}

interface ExecutionState {
  // Current execution
  currentExecution: Execution | null;
  isExecuting: boolean;
  executionProgress: number; // 0-100

  // Rate limit state — set true on 429, cleared on new execution
  isRateLimited: boolean;
  setRateLimited: (value: boolean) => void;

  // Artifacts by tile instance ID
  artifacts: Map<string, ExecutionArtifact>;

  // Previous execution artifacts — for cache-hit detection on re-run
  previousArtifacts: Map<string, ExecutionArtifact>;

  // Video generation progress per node (for background video generation)
  videoGenProgress: Map<string, VideoGenerationState>;

  // Regeneration tracking: nodeId → count (max 3)
  regenerationCounts: Map<string, number>;
  regeneratingNodeId: string | null;

  // Execution history
  history: Execution[];

  // Actions
  startExecution: (execution: Execution) => void;
  updateExecutionStatus: (status: ExecutionStatus) => void;
  addTileResult: (result: TileExecutionResult) => void;
  addArtifact: (tileInstanceId: string, artifact: ExecutionArtifact) => void;
  completeExecution: (status: ExecutionStatus) => void;
  clearCurrentExecution: () => void;
  setProgress: (progress: number) => void;

  // Video generation progress
  setVideoGenProgress: (nodeId: string, state: VideoGenerationState) => void;
  clearVideoGenProgress: (nodeId: string) => void;

  // Regeneration
  incrementRegenCount: (tileInstanceId: string) => boolean; // returns false if at max
  getRegenRemaining: (tileInstanceId: string) => number;
  setRegeneratingNode: (nodeId: string | null) => void;

  // History
  addToHistory: (execution: Execution) => void;
  clearHistory: () => void;

  // Artifacts
  getArtifactForTile: (tileInstanceId: string) => ExecutionArtifact | undefined;
  removeArtifact: (tileInstanceId: string) => void;
  clearArtifacts: () => void;

  // Quantity overrides: tileInstanceId → Map<rowIndex, overrideValue>
  // Allows users to correct TR-007 quantities before passing to TR-008.
  // Persisted to Execution.metadata.quantityOverrides via debounced PATCH
  // (see schedulePersist below) so edits survive page reloads.
  quantityOverrides: Map<string, Map<number, number>>;
  setQuantityOverride: (tileInstanceId: string, rowIndex: number, value: number) => void;
  clearQuantityOverrides: (tileInstanceId: string) => void;
  getQuantityOverrides: (tileInstanceId: string) => Map<number, number>;
  /** Replace the in-memory quantityOverrides Map with the contents of an
   *  ExecutionMetadata.quantityOverrides object loaded from the server.
   *  Called once on result-showcase mount after the execution metadata
   *  is fetched. Pure local-state update — does NOT trigger a persist
   *  (would create a no-op round-trip back to the server). */
  hydrateQuantityOverrides: (overrides: Record<string, Record<string, number>>) => void;

  // Restore artifacts from DB (after loading a workflow)
  restoreArtifactsFromDB: (dbArtifacts: Array<{
    tileInstanceId: string;
    nodeId: string;
    type: string;
    data: Record<string, unknown>;
    nodeLabel?: string | null;
    title?: string;
    createdAt?: string;
  }>, executionMeta?: {
    id: string;
    status: string;
    startedAt: string;
    completedAt?: string | null;
  }) => void;
}

const MAX_REGENERATIONS = 3;

// ─── Quantity-overrides persistence (debounced PATCH) ───────────────────────
// User edits to the BOQ quantity table are pushed to
// Execution.metadata.quantityOverrides via the new
// PATCH /api/executions/[id]/metadata endpoint, debounced 500ms so a rapid
// edit burst (typing through several cells) batches into a single
// network round-trip. The full snapshot of the current quantityOverrides
// Map is sent each time — last-write-wins on the server side.
//
// Best-effort: failures are swallowed because the in-memory Map is the
// source of truth during the editing session. The next edit will retry
// with a fresh snapshot. The previous fire-and-forget pattern is
// preserved here for the same reason.

const PERSIST_DEBOUNCE_MS = 500;
let pendingPersistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (typeof window === "undefined") return; // SSR safety
  if (pendingPersistTimer) clearTimeout(pendingPersistTimer);
  pendingPersistTimer = setTimeout(() => {
    pendingPersistTimer = null;
    void persistQuantityOverrides();
  }, PERSIST_DEBOUNCE_MS);
}

async function persistQuantityOverrides() {
  // Read state at flush time (not schedule time) so we always send the
  // latest snapshot, even if more edits landed during the debounce window.
  const state = useExecutionStore.getState();
  const executionId = state.currentExecution?.id;
  if (!executionId) return; // No execution loaded → nothing to persist against

  // Serialize Map<string, Map<number, number>> to nested JSON record
  const serialized: Record<string, Record<string, number>> = {};
  for (const [tileId, rowMap] of state.quantityOverrides) {
    const inner: Record<string, number> = {};
    for (const [row, val] of rowMap) inner[String(row)] = val;
    serialized[tileId] = inner;
  }

  try {
    await fetch(`/api/executions/${executionId}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantityOverrides: serialized }),
    });
  } catch {
    // Best-effort: in-memory state is still correct, next edit retries
  }
}

export const useExecutionStore = create<ExecutionState>()((set, get) => ({
  currentExecution: null,
  isExecuting: false,
  executionProgress: 0,
  isRateLimited: false,
  artifacts: new Map(),
  previousArtifacts: new Map(),
  videoGenProgress: new Map(),
  regenerationCounts: new Map(),
  regeneratingNodeId: null,
  history: [],
  quantityOverrides: new Map(),

  setRateLimited: (value) => set({ isRateLimited: value }),

  startExecution: (execution) =>
    set((state) => ({
      currentExecution: execution,
      isExecuting: true,
      executionProgress: 0,
      isRateLimited: false, // reset on new execution
      // Snapshot current artifacts for cache-hit detection on re-run
      previousArtifacts: new Map(state.artifacts),
      artifacts: new Map(),
      videoGenProgress: new Map(),
      regenerationCounts: new Map(),
    })),

  updateExecutionStatus: (status) =>
    set((state) => ({
      currentExecution: state.currentExecution
        ? { ...state.currentExecution, status }
        : null,
    })),

  addTileResult: (result) =>
    set((state) => {
      if (!state.currentExecution) return state;
      const updatedResults = [
        ...state.currentExecution.tileResults,
        result,
      ];
      return {
        currentExecution: {
          ...state.currentExecution,
          tileResults: updatedResults,
        },
      };
    }),

  addArtifact: (tileInstanceId, artifact) =>
    set((state) => {
      const newArtifacts = new Map(state.artifacts);
      newArtifacts.set(tileInstanceId, artifact);
      return { artifacts: newArtifacts };
    }),

  completeExecution: (status) =>
    set((state) => {
      if (!state.currentExecution) return state;
      const completed: Execution = {
        ...state.currentExecution,
        status,
        completedAt: new Date(),
      };
      return {
        currentExecution: completed,
        isExecuting: false,
        executionProgress: 100,
        history: [completed, ...state.history.slice(0, 49)], // Keep last 50
      };
    }),

  clearCurrentExecution: () =>
    set({ currentExecution: null, isExecuting: false, executionProgress: 0 }),

  setProgress: (progress) => set({ executionProgress: progress }),

  setVideoGenProgress: (nodeId, state) =>
    set((s) => {
      const newMap = new Map(s.videoGenProgress);
      newMap.set(nodeId, state);
      return { videoGenProgress: newMap };
    }),

  clearVideoGenProgress: (nodeId) =>
    set((s) => {
      const newMap = new Map(s.videoGenProgress);
      newMap.delete(nodeId);
      return { videoGenProgress: newMap };
    }),

  addToHistory: (execution) =>
    set((state) => ({
      history: [execution, ...state.history.slice(0, 49)],
    })),

  clearHistory: () => set({ history: [] }),

  incrementRegenCount: (tileInstanceId) => {
    const current = get().regenerationCounts.get(tileInstanceId) ?? 0;
    if (current >= MAX_REGENERATIONS) return false;
    const newCounts = new Map(get().regenerationCounts);
    newCounts.set(tileInstanceId, current + 1);
    set({ regenerationCounts: newCounts });
    return true;
  },

  getRegenRemaining: (tileInstanceId) => {
    const used = get().regenerationCounts.get(tileInstanceId) ?? 0;
    return MAX_REGENERATIONS - used;
  },

  setRegeneratingNode: (nodeId) => set({ regeneratingNodeId: nodeId }),

  getArtifactForTile: (tileInstanceId) => {
    return get().artifacts.get(tileInstanceId);
  },

  removeArtifact: (tileInstanceId) =>
    set((state) => {
      const newArtifacts = new Map(state.artifacts);
      newArtifacts.delete(tileInstanceId);
      return { artifacts: newArtifacts };
    }),

  clearArtifacts: () => set({ artifacts: new Map() }),

  setQuantityOverride: (tileInstanceId, rowIndex, value) => {
    set((state) => {
      const newOverrides = new Map(state.quantityOverrides);
      const tileOverrides = new Map(newOverrides.get(tileInstanceId) ?? new Map());
      tileOverrides.set(rowIndex, value);
      newOverrides.set(tileInstanceId, tileOverrides);
      return { quantityOverrides: newOverrides };
    });
    schedulePersist();
  },

  clearQuantityOverrides: (tileInstanceId) => {
    set((state) => {
      const newOverrides = new Map(state.quantityOverrides);
      newOverrides.delete(tileInstanceId);
      return { quantityOverrides: newOverrides };
    });
    schedulePersist();
  },

  getQuantityOverrides: (tileInstanceId) => {
    return get().quantityOverrides.get(tileInstanceId) ?? new Map();
  },

  hydrateQuantityOverrides: (overrides) => {
    // Convert the serialized JSON form back to Map<string, Map<number, number>>.
    // Defensive: skip non-numeric row keys and non-finite values.
    const newOverrides = new Map<string, Map<number, number>>();
    for (const [tileId, rowRecord] of Object.entries(overrides)) {
      if (!rowRecord || typeof rowRecord !== "object") continue;
      const inner = new Map<number, number>();
      for (const [rowKey, val] of Object.entries(rowRecord)) {
        const rowIdx = Number(rowKey);
        if (Number.isInteger(rowIdx) && typeof val === "number" && Number.isFinite(val)) {
          inner.set(rowIdx, val);
        }
      }
      if (inner.size > 0) newOverrides.set(tileId, inner);
    }
    set({ quantityOverrides: newOverrides });
  },

  restoreArtifactsFromDB: (dbArtifacts, executionMeta) => {
    const newArtifacts = new Map<string, ExecutionArtifact>();
    const restoredNodeIds: string[] = [];
    for (const art of dbArtifacts) {
      const nodeId = art.tileInstanceId || art.nodeId;
      restoredNodeIds.push(nodeId);
      newArtifacts.set(nodeId, {
        id: `restored-${nodeId}`,
        executionId: executionMeta?.id ?? "restored",
        tileInstanceId: nodeId,
        type: art.type as ExecutionArtifact["type"],
        data: art.data,
        metadata: { restored: true },
        createdAt: art.createdAt ? new Date(art.createdAt) : new Date(),
      });
    }

    const updates: Partial<ExecutionState> = { artifacts: newArtifacts };

    // Restore execution metadata if provided
    if (executionMeta) {
      updates.currentExecution = {
        id: executionMeta.id,
        workflowId: "",
        userId: "",
        status: executionMeta.status === "SUCCESS" ? "success"
          : executionMeta.status === "PARTIAL" ? "partial"
          : executionMeta.status === "FAILED" ? "failed"
          : "success",
        startedAt: new Date(executionMeta.startedAt),
        completedAt: executionMeta.completedAt ? new Date(executionMeta.completedAt) : undefined,
        tileResults: [],
        createdAt: new Date(executionMeta.startedAt),
      };
      updates.isExecuting = false;
      updates.executionProgress = 100;
    }

    set(updates);

    // Also restore node statuses on the canvas so nodes show green checkmarks
    const { updateNodeStatus } = useWorkflowStore.getState();
    for (const nodeId of restoredNodeIds) {
      updateNodeStatus(nodeId, "success");
    }
  },
}));

// ─── Optimized selectors — prevent unnecessary re-renders (#45) ──────────────
export const selectIsExecuting = (s: ExecutionState) => s.isExecuting;
export const selectExecutionProgress = (s: ExecutionState) => s.executionProgress;
export const selectIsRateLimited = (s: ExecutionState) => s.isRateLimited;
export const selectArtifacts = (s: ExecutionState) => s.artifacts;
export const selectVideoGenProgress = (s: ExecutionState) => s.videoGenProgress;
export const selectCurrentExecution = (s: ExecutionState) => s.currentExecution;
export const selectRegeneratingNodeId = (s: ExecutionState) => s.regeneratingNodeId;
