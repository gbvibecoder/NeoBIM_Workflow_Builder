"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { WorkflowNode, WorkflowEdge, NodeStatus } from "@/types/nodes";
import type { Workflow, WorkflowTemplate, CreationMode } from "@/types/workflow";
import { generateId } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { awardXP } from "@/lib/award-xp";
import { toast } from "sonner";
import { useUIStore } from "@/shared/stores/ui-store";

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
  // saveWorkflow returns the workflow id on success, or null on failure.
  // When `name` is omitted, it's an automatic save (Run-button auto-save,
  // dirty-debounce, etc.) and the backend is allowed to auto-suffix " (N)"
  // to keep names unique. When `name` is provided, the user explicitly
  // named the workflow and a duplicate is rejected (toast prompts retry).
  saveWorkflow: (name?: string) => Promise<string | null>;
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
        // Use the clean template name; the backend will auto-suffix " (N)" on
        // first save if the user already has a workflow with the same name.
        name: template.name,
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

      // userExplicit = the caller passed a name (e.g. user typed it in the
      // Save modal). When true, the backend rejects duplicate names with 409
      // instead of auto-suffixing.
      const userExplicit = typeof name === "string" && name.trim().length > 0;
      try {
        // Use snapshot from single get() call above to avoid mutation between reads
        const tileGraph = { nodes, edges };
        const workflowId = currentWorkflow?.id;

        if (isPersistedId(workflowId)) {
          // Has a real DB id (Prisma cuid) — update existing workflow
          const { workflow } = await api.workflows.update(workflowId!, {
            name: name ?? currentWorkflow!.name,
            tileGraph,
          });
          set((s) => ({
            isDirty: false,
            currentWorkflow: s.currentWorkflow
              ? { ...s.currentWorkflow, name: workflow.name }
              : null,
          }));
          return workflowId!;
        } else {
          // No persisted ID — create new workflow in DB
          const { workflow } = await api.workflows.create({
            name: name ?? currentWorkflow?.name ?? "Untitled Workflow",
            description: currentWorkflow?.description ?? undefined,
            tags: currentWorkflow?.tags ?? [],
            tileGraph,
            // Auto-suffix only when the user did NOT type a name explicitly.
            autoSuffix: !userExplicit,
          });
          set((s) => ({
            isDirty: false,
            currentWorkflow: s.currentWorkflow
              ? { ...s.currentWorkflow, id: workflow.id, name: workflow.name }
              : null,
          }));
          // Award XP for first workflow created (fire-and-forget)
          awardXP("workflow-created");
          return workflow.id;
        }
      } catch (err) {
        console.error("Save failed:", err);
        // Workflow limit reached
        if (err instanceof ApiError && err.status === 403) {
          toast("🐙 You've hit your workflow limit!", {
            description: "Upgrade your plan for unlimited workflows and more power.",
            action: {
              label: "Upgrade Plan",
              onClick: () => { window.location.href = "/dashboard/billing"; },
            },
            duration: 6000,
          });
        }
        // Duplicate name (user explicitly typed an existing name)
        else if (err instanceof ApiError && err.status === 409) {
          toast.error("Name already in use", {
            description: `A workflow named "${name}" already exists. Please choose a different name.`,
            duration: 5000,
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
// State selectors (reactive — trigger re-render only when their specific slice changes)
export const selectNodes = (s: WorkflowState) => s.nodes;
export const selectEdges = (s: WorkflowState) => s.edges;
export const selectCurrentWorkflow = (s: WorkflowState) => s.currentWorkflow;
export const selectIsDirty = (s: WorkflowState) => s.isDirty;
export const selectIsSaving = (s: WorkflowState) => s.isSaving;
export const selectCanUndo = (s: WorkflowState) => s._historyIndex > 0;
export const selectCanRedo = (s: WorkflowState) => s._historyIndex < s._history.length - 1;
export const selectCreationMode = (s: WorkflowState) => s.creationMode;
export const selectIsSaveModalOpen = (s: WorkflowState) => s.isSaveModalOpen;

// Action selectors (stable references — never cause re-renders)
export const selectAddNode = (s: WorkflowState) => s.addNode;
export const selectRemoveNode = (s: WorkflowState) => s.removeNode;
export const selectRemoveEdge = (s: WorkflowState) => s.removeEdge;
export const selectUpdateNode = (s: WorkflowState) => s.updateNode;
export const selectAddEdge = (s: WorkflowState) => s.addEdge;
export const selectResetCanvas = (s: WorkflowState) => s.resetCanvas;
export const selectSetEdgeFlowing = (s: WorkflowState) => s.setEdgeFlowing;
export const selectMarkDirty = (s: WorkflowState) => s.markDirty;
export const selectSetCreationMode = (s: WorkflowState) => s.setCreationMode;
export const selectSaveWorkflow = (s: WorkflowState) => s.saveWorkflow;
export const selectLoadWorkflow = (s: WorkflowState) => s.loadWorkflow;
export const selectUndo = (s: WorkflowState) => s.undo;
export const selectRedo = (s: WorkflowState) => s.redo;
export const selectOpenSaveModal = (s: WorkflowState) => s.openSaveModal;
export const selectCloseSaveModal = (s: WorkflowState) => s.closeSaveModal;
export const selectLoadFromTemplate = (s: WorkflowState) => s.loadFromTemplate;
