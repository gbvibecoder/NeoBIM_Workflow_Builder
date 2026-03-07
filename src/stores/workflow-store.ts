"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { WorkflowNode, WorkflowEdge, NodeStatus } from "@/types/nodes";
import type { Workflow, WorkflowTemplate, CreationMode } from "@/types/workflow";
import { generateId } from "@/lib/utils";
import { api } from "@/lib/api";
import { awardXP } from "@/lib/award-xp";

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
    creationMode: "manual",

    // Undo/Redo
    _history: [],
    _historyIndex: -1,

    _pushHistory: () => {
      const { nodes, edges, _history, _historyIndex } = get();
      const truncated = _history.slice(0, _historyIndex + 1);
      const entry: HistoryEntry = {
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      };
      const next = [...truncated, entry];
      if (next.length > MAX_HISTORY) next.shift();
      set({ _history: next, _historyIndex: next.length - 1 });
    },

    undo: () => {
      const { _history, _historyIndex } = get();
      if (_historyIndex <= 0) return;
      const prev = _history[_historyIndex - 1];
      set({
        nodes: prev.nodes,
        edges: prev.edges,
        _historyIndex: _historyIndex - 1,
        isDirty: true,
      });
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

    markDirty: () => set({ isDirty: true }),
    markClean: () => set({ isDirty: false }),
    setSaving: (isSaving) => set({ isSaving }),

    saveWorkflow: async (name) => {
      const state = get();
      if (state.isSaving) return null; // Prevent double-click race condition
      set({ isSaving: true });
      try {
        const tileGraph = { nodes: state.nodes, edges: state.edges };
        if (state.currentWorkflow?.id && !state.currentWorkflow.id.includes("-")) {
          // Has a real DB id — update
          await api.workflows.update(state.currentWorkflow.id, {
            name: name ?? state.currentWorkflow.name,
            tileGraph,
          });
          set({ isDirty: false });
          return state.currentWorkflow.id;
        } else {
          // Create new
          const { workflow } = await api.workflows.create({
            name: name ?? state.currentWorkflow?.name ?? "Untitled Workflow",
            description: state.currentWorkflow?.description ?? undefined,
            tags: state.currentWorkflow?.tags ?? [],
            tileGraph,
          });
          set((s) => ({
            isDirty: false,
            currentWorkflow: s.currentWorkflow
              ? { ...s.currentWorkflow, id: workflow.id }
              : null,
          }));
          // Award XP for first workflow created (fire-and-forget)
          awardXP("workflow-created");
          return workflow.id;
        }
      } catch (err) {
        console.error("Save failed:", err);
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
        console.error("Load failed:", err);
      }
    },

    deleteWorkflow: async (id) => {
      await api.workflows.delete(id);
    },

    resetCanvas: () =>
      set({
        nodes: [],
        edges: [],
        isDirty: false,
        currentWorkflow: null,
      }),
  }))
);
