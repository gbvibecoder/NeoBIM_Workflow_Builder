"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { WorkflowNode, WorkflowEdge, NodeStatus } from "@/types/nodes";
import type { Workflow, WorkflowTemplate, CreationMode } from "@/types/workflow";
import { generateId } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { awardXP } from "@/lib/award-xp";
import { toast } from "sonner";
import { useUIStore } from "@/stores/ui-store";

/** Returns true if the workflow name is empty, whitespace, or the default "Untitled Workflow" */
export function isUntitledWorkflow(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  return trimmed === "" || trimmed === "Untitled Workflow";
}

/** Prisma cuid() IDs are 25 chars starting with 'c'. Client generateId() produces 7-char random strings. */
function isPersistedId(id: string | undefined | null): boolean {
  if (!id) return false;
  // Prisma cuid: 25 chars, starts with 'c'. Client IDs are 7 chars.
  return id.length >= 20 && id.startsWith("c");
}

interface HistoryEntry {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

const MAX_HISTORY = 50;

interface WorkflowState {
  // Current workflow
  currentWorkflow: Workflow | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isDirty: boolean;
  isSaving: boolean;

  // Save modal
  isSaveModalOpen: boolean;
  pendingSaveName: string;

  // Undo/Redo history
  _history: HistoryEntry[];
  _historyIndex: number;
  _pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Creation mode
  creationMode: CreationMode;

  // Actions
  setCurrentWorkflow: (workflow: Workflow | null) => void;
  loadFromTemplate: (template: WorkflowTemplate) => void;
  setCreationMode: (mode: CreationMode) => void;

  // Node operations
  addNode: (node: WorkflowNode) => void;
  removeNode: (nodeId: string) => void;
  updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  updateNodeStatus: (nodeId: string, status: NodeStatus) => void;
  setNodes: (nodes: WorkflowNode[]) => void;

  // Edge operations
  addEdge: (edge: WorkflowEdge) => void;
  removeEdge: (edgeId: string) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  setEdgeFlowing: (sourceNodeId: string, flowing: boolean) => void;

  // Save modal actions
  openSaveModal: () => void;
  closeSaveModal: () => void;
  setPendingSaveName: (name: string) => void;

  // Persistence
  markDirty: () => void;
  markClean: () => void;
  setSaving: (isSaving: boolean) => void;

  // Async DB persistence
  saveWorkflow: (name?: string) => Promise<string | null>; // returns workflow id
  loadWorkflow: (id: string) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;

  // Reset
  resetCanvas: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(
  subscribeWithSelector((set, get) => ({
    currentWorkflow: null,
    nodes: [],
    edges: [],
    isDirty: false,
    isSaving: false,
    isSaveModalOpen: false,
    pendingSaveName: "",
    creationMode: "manual",

    // Undo/Redo
    _history: [],
    _historyIndex: -1,

    _pushHistory: () => {
      const { nodes, edges, _history, _historyIndex } = get();
      const truncated = _history.slice(0, _historyIndex + 1);
      const entry: HistoryEntry = {
        nodes: structuredClone(nodes),
        edges: structuredClone(edges),
      };
      const next = [...truncated, entry];
      if (next.length > MAX_HISTORY) next.shift();
      set({ _history: next, _historyIndex: next.length - 1 });
    },

    undo: () => {
      const { nodes, edges, _history, _historyIndex } = get();
      if (_historyIndex <= 0) return;
      // If at the tip (last entry), snapshot current live state so redo can restore it
      if (_historyIndex === _history.length - 1) {
        const snapshot: HistoryEntry = { nodes: structuredClone(nodes), edges: structuredClone(edges) };
        const updated = [..._history, snapshot];
        const prev = _history[_historyIndex - 1];
        set({
          nodes: prev.nodes,
          edges: prev.edges,
          _history: updated,
          _historyIndex: _historyIndex - 1,
          isDirty: true,
        });
      } else {
        const prev = _history[_historyIndex - 1];
        set({
          nodes: prev.nodes,
          edges: prev.edges,
          _historyIndex: _historyIndex - 1,
          isDirty: true,
        });
      }
    },

    redo: () => {
      const { _history, _historyIndex } = get();
      if (_historyIndex >= _history.length - 1) return;
      const next = _history[_historyIndex + 1];
      set({
        nodes: next.nodes,
        edges: next.edges,
        _historyIndex: _historyIndex + 1,
        isDirty: true,
      });
    },

    canUndo: () => get()._historyIndex > 0,
    canRedo: () => get()._historyIndex < get()._history.length - 1,

    setCurrentWorkflow: (workflow) => {
      if (workflow) {
        set({
          currentWorkflow: workflow,
          nodes: workflow.tileGraph.nodes,
          edges: workflow.tileGraph.edges,
          isDirty: false,
        });
      } else {
        set({ currentWorkflow: null, nodes: [], edges: [], isDirty: false });
      }
    },

    loadFromTemplate: (template) => {
      const newWorkflow: Workflow = {
        id: generateId(),
        ownerId: "",
        name: `Copy of ${template.name}`,
        description: template.description,
        tags: [...template.tags],
        tileGraph: {
          nodes: template.tileGraph.nodes.map((n) => ({
            ...n,
            id: `${n.id}-${generateId()}`,
            data: { ...n.data, status: "idle" as NodeStatus },
          })),
          edges: template.tileGraph.edges.map((e) => ({
            ...e,
            id: `${e.id}-${generateId()}`,
          })),
        },
        version: 1,
        isPublished: false,
        isTemplate: false,
        category: template.category,
        complexity: template.complexity,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Remap edge source/target to new node ids
      const idMap = new Map<string, string>();
      template.tileGraph.nodes.forEach((origNode, i) => {
        idMap.set(origNode.id, newWorkflow.tileGraph.nodes[i].id);
      });

      newWorkflow.tileGraph.edges = newWorkflow.tileGraph.edges.map((e, i) => ({
        ...e,
        source: idMap.get(template.tileGraph.edges[i]?.source ?? "") ?? e.source,
        target: idMap.get(template.tileGraph.edges[i]?.target ?? "") ?? e.target,
      }));

      set({
        currentWorkflow: newWorkflow,
        nodes: newWorkflow.tileGraph.nodes,
        edges: newWorkflow.tileGraph.edges,
        isDirty: true,
      });
    },

    setCreationMode: (mode) => set({ creationMode: mode }),

    addNode: (node) => {
      get()._pushHistory();
      set((state) => ({
        nodes: [...state.nodes, node],
        isDirty: true,
      }));
    },

    removeNode: (nodeId) => {
      get()._pushHistory();
      set((state) => ({
        nodes: state.nodes.filter((n) => n.id !== nodeId),
        edges: state.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId
        ),
        isDirty: true,
      }));
    },

    updateNode: (nodeId, updates) => {
      get()._pushHistory();
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, ...updates } : n
        ),
        isDirty: true,
      }));
    },

    updateNodeStatus: (nodeId, status) =>
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, status } }
            : n
        ),
      })),

    setNodes: (nodes) => {
      get()._pushHistory();
      set({ nodes, isDirty: true });
    },

    addEdge: (edge) => {
      get()._pushHistory();
      set((state) => ({
        edges: [...state.edges, edge],
        isDirty: true,
      }));
    },

    removeEdge: (edgeId) => {
      get()._pushHistory();
      set((state) => ({
        edges: state.edges.filter((e) => e.id !== edgeId),
        isDirty: true,
      }));
    },

    setEdges: (edges) => {
      get()._pushHistory();
      set({ edges, isDirty: true });
    },

    setEdgeFlowing: (sourceNodeId, flowing) =>
      set((state) => ({
        edges: state.edges.map((e) =>
          e.source === sourceNodeId
            ? { ...e, data: { ...e.data, isFlowing: flowing } }
            : e
        ),
      })),

    openSaveModal: () => set({ isSaveModalOpen: true }),
    closeSaveModal: () => set({ isSaveModalOpen: false, pendingSaveName: "" }),
    setPendingSaveName: (name) => set({ pendingSaveName: name }),

    markDirty: () => set({ isDirty: true }),
    markClean: () => set({ isDirty: false }),
    setSaving: (isSaving) => set({ isSaving }),

    saveWorkflow: async (name) => {
      // Atomic check-and-set: read isSaving and set it in one operation to avoid race
      const { isSaving, nodes, edges, currentWorkflow } = get();
      if (isSaving) return null;
      set({ isSaving: true });
      try {
        // Use snapshot from single get() call above to avoid mutation between reads
        const tileGraph = { nodes, edges };
        const workflowId = currentWorkflow?.id;

        if (isPersistedId(workflowId)) {
          // Has a real DB id (Prisma cuid) — update existing workflow
          await api.workflows.update(workflowId!, {
            name: name ?? currentWorkflow!.name,
            tileGraph,
          });
          // Update name in store if changed
          if (name && name !== currentWorkflow!.name) {
            set((s) => ({
              isDirty: false,
              currentWorkflow: s.currentWorkflow
                ? { ...s.currentWorkflow, name }
                : null,
            }));
          } else {
            set({ isDirty: false });
          }
          return workflowId!;
        } else {
          // No persisted ID — create new workflow in DB
          const { workflow } = await api.workflows.create({
            name: name ?? currentWorkflow?.name ?? "Untitled Workflow",
            description: currentWorkflow?.description ?? undefined,
            tags: currentWorkflow?.tags ?? [],
            tileGraph,
          });
          set((s) => ({
            isDirty: false,
            currentWorkflow: s.currentWorkflow
              ? { ...s.currentWorkflow, id: workflow.id, name: name ?? s.currentWorkflow.name }
              : null,
          }));
          // Award XP for first workflow created (fire-and-forget)
          awardXP("workflow-created");
          return workflow.id;
        }
      } catch (err) {
        console.error("Save failed:", err);
        // Detect workflow limit error (403) and show upgrade prompt
        if (err instanceof ApiError && err.status === 403) {
          toast.error("Workflow limit reached — upgrade to Pro for unlimited workflows.", {
            action: {
              label: "Upgrade",
              onClick: () => { window.location.href = "/dashboard/billing"; },
            },
            duration: 6000,
          });
        }
        return null;
      } finally {
        set({ isSaving: false });
      }
    },

    loadWorkflow: async (id) => {
      try {
        const { workflow } = await api.workflows.get(id);
        const tileGraph = workflow.tileGraph as { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
        set({
          currentWorkflow: {
            id: workflow.id,
            ownerId: "",
            name: workflow.name,
            description: workflow.description ?? undefined,
            tags: workflow.tags,
            tileGraph,
            version: workflow.version,
            isPublished: workflow.isPublished,
            isTemplate: false,
            complexity: "simple",
            createdAt: new Date(workflow.createdAt),
            updatedAt: new Date(workflow.updatedAt),
          },
          nodes: tileGraph.nodes,
          edges: tileGraph.edges,
          isDirty: false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.warn("[loadWorkflow] Failed to load workflow:", message);
      }
    },

    deleteWorkflow: async (id) => {
      await api.workflows.delete(id);
    },

    resetCanvas: () => {
      set({
        nodes: [],
        edges: [],
        isDirty: false,
        currentWorkflow: null,
      });
      // Clear stale selection IDs from UI store
      useUIStore.getState().setSelectedNodeIds([]);
    },
  }))
);

// ─── Optimized selectors — prevent unnecessary re-renders (#45) ──────────────
export const selectNodes = (s: WorkflowState) => s.nodes;
export const selectEdges = (s: WorkflowState) => s.edges;
export const selectCurrentWorkflow = (s: WorkflowState) => s.currentWorkflow;
export const selectIsDirty = (s: WorkflowState) => s.isDirty;
export const selectIsSaving = (s: WorkflowState) => s.isSaving;
export const selectCanUndo = (s: WorkflowState) => s._historyIndex > 0;
export const selectCanRedo = (s: WorkflowState) => s._historyIndex < s._history.length - 1;
