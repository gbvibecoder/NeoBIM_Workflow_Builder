"use client";

import { create } from "zustand";
import type {
  Execution,
  ExecutionArtifact,
  ExecutionStatus,
  TileExecutionResult,
} from "@/types/execution";

interface ExecutionState {
  // Current execution
  currentExecution: Execution | null;
  isExecuting: boolean;
  executionProgress: number; // 0-100

  // Artifacts by tile instance ID
  artifacts: Map<string, ExecutionArtifact>;

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
}

const MAX_REGENERATIONS = 3;

export const useExecutionStore = create<ExecutionState>()((set, get) => ({
  currentExecution: null,
  isExecuting: false,
  executionProgress: 0,
  artifacts: new Map(),
  regenerationCounts: new Map(),
  regeneratingNodeId: null,
  history: [],

  startExecution: (execution) =>
    set({
      currentExecution: execution,
      isExecuting: true,
      executionProgress: 0,
      artifacts: new Map(),
      regenerationCounts: new Map(),
    }),

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
}));
