"use client";

import { create } from "zustand";

type PanelId = "nodeLibrary" | "executionHistory" | "workflowMeta" | "none";

interface UIState {
  // Panel visibility
  activePanel: PanelId;
  isNodeLibraryOpen: boolean;
  isExecutionPanelOpen: boolean;
  isMetaPanelOpen: boolean;

  // Selected nodes
  selectedNodeIds: string[];

  // Canvas state
  canvasZoom: number;

  // Modal states
  isRequestDialogOpen: boolean;
  isNewWorkflowDialogOpen: boolean;
  isPromptModeActive: boolean;

  // Prompt input
  promptValue: string;
  isGeneratingWorkflow: boolean;

  // Demo mode
  isDemoMode: boolean;

  // Pending node add — sidebar click-to-add, consumed by WorkflowCanvas
  pendingNodeAdd: string | null;
  requestAddNode: (catalogueId: string) => void;
  clearPendingNodeAdd: () => void;

  // Fullscreen artifact viewer (node id whose 3D artifact to show)
  artifactViewerNodeId: string | null;
  setArtifactViewerNodeId: (id: string | null) => void;

  // Fullscreen video player (node id whose video artifact to show)
  videoPlayerNodeId: string | null;
  setVideoPlayerNodeId: (id: string | null) => void;

  // Actions
  setActivePanel: (panel: PanelId) => void;
  toggleNodeLibrary: () => void;
  toggleExecutionPanel: () => void;
  toggleMetaPanel: () => void;

  setSelectedNodeIds: (ids: string[]) => void;
  setCanvasZoom: (zoom: number) => void;

  setRequestDialogOpen: (open: boolean) => void;
  setNewWorkflowDialogOpen: (open: boolean) => void;
  setPromptModeActive: (active: boolean) => void;

  setPromptValue: (value: string) => void;
  setGeneratingWorkflow: (generating: boolean) => void;

  setDemoMode: (demo: boolean) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  activePanel: "none",
  isNodeLibraryOpen: false,
  isExecutionPanelOpen: false,
  isMetaPanelOpen: false,

  selectedNodeIds: [],
  canvasZoom: 1,

  isRequestDialogOpen: false,
  isNewWorkflowDialogOpen: false,
  isPromptModeActive: false,

  promptValue: "",
  isGeneratingWorkflow: false,

  isDemoMode: false,

  pendingNodeAdd: null,
  requestAddNode: (catalogueId) => set({ pendingNodeAdd: catalogueId }),
  clearPendingNodeAdd: () => set({ pendingNodeAdd: null }),

  artifactViewerNodeId: null,
  setArtifactViewerNodeId: (id) => set({ artifactViewerNodeId: id }),

  videoPlayerNodeId: null,
  setVideoPlayerNodeId: (id) => set({ videoPlayerNodeId: id }),

  setActivePanel: (panel) =>
    set({
      activePanel: panel,
      isNodeLibraryOpen: panel === "nodeLibrary",
      isExecutionPanelOpen: panel === "executionHistory",
      isMetaPanelOpen: panel === "workflowMeta",
    }),

  toggleNodeLibrary: () =>
    set((state) => ({
      isNodeLibraryOpen: !state.isNodeLibraryOpen,
      activePanel: state.isNodeLibraryOpen ? "none" : "nodeLibrary",
    })),

  toggleExecutionPanel: () =>
    set((state) => ({
      isExecutionPanelOpen: !state.isExecutionPanelOpen,
      activePanel: state.isExecutionPanelOpen ? "none" : "executionHistory",
    })),

  toggleMetaPanel: () =>
    set((state) => ({
      isMetaPanelOpen: !state.isMetaPanelOpen,
      activePanel: state.isMetaPanelOpen ? "none" : "workflowMeta",
    })),

  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
  setCanvasZoom: (zoom) => set({ canvasZoom: zoom }),

  setRequestDialogOpen: (open) => set({ isRequestDialogOpen: open }),
  setNewWorkflowDialogOpen: (open) => set({ isNewWorkflowDialogOpen: open }),
  setPromptModeActive: (active) => set({ isPromptModeActive: active }),

  setPromptValue: (value) => set({ promptValue: value }),
  setGeneratingWorkflow: (generating) => set({ isGeneratingWorkflow: generating }),

  setDemoMode: (demo) => set({ isDemoMode: demo }),
}));

// ─── Optimized selectors — prevent unnecessary re-renders (#45) ──────────────
export const selectIsDemoMode = (s: UIState) => s.isDemoMode;
export const selectActivePanel = (s: UIState) => s.activePanel;
export const selectSelectedNodeIds = (s: UIState) => s.selectedNodeIds;
export const selectIsNodeLibraryOpen = (s: UIState) => s.isNodeLibraryOpen;
