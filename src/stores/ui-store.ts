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
  isPublishDialogOpen: boolean;
  isNewWorkflowDialogOpen: boolean;
  isPromptModeActive: boolean;

  // Prompt input
  promptValue: string;
  isGeneratingWorkflow: boolean;

  // Demo mode
  isDemoMode: boolean;

  // Execution complete modal
  showExecutionCompleteModal: boolean;
  setShowExecutionCompleteModal: (show: boolean) => void;

  // Actions
  setActivePanel: (panel: PanelId) => void;
  toggleNodeLibrary: () => void;
  toggleExecutionPanel: () => void;
  toggleMetaPanel: () => void;

  setSelectedNodeIds: (ids: string[]) => void;
  setCanvasZoom: (zoom: number) => void;

  setPublishDialogOpen: (open: boolean) => void;
  setNewWorkflowDialogOpen: (open: boolean) => void;
  setPromptModeActive: (active: boolean) => void;

  setPromptValue: (value: string) => void;
  setGeneratingWorkflow: (generating: boolean) => void;

  setDemoMode: (demo: boolean) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  activePanel: "nodeLibrary",
  isNodeLibraryOpen: true,
  isExecutionPanelOpen: false,
  isMetaPanelOpen: false,

  selectedNodeIds: [],
  canvasZoom: 1,

  isPublishDialogOpen: false,
  isNewWorkflowDialogOpen: false,
  isPromptModeActive: false,

  promptValue: "",
  isGeneratingWorkflow: false,

  isDemoMode: false,

  showExecutionCompleteModal: false,
  setShowExecutionCompleteModal: (show) => set({ showExecutionCompleteModal: show }),

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

  setPublishDialogOpen: (open) => set({ isPublishDialogOpen: open }),
  setNewWorkflowDialogOpen: (open) => set({ isNewWorkflowDialogOpen: open }),
  setPromptModeActive: (active) => set({ isPromptModeActive: active }),

  setPromptValue: (value) => set({ promptValue: value }),
  setGeneratingWorkflow: (generating) => set({ isGeneratingWorkflow: generating }),

  setDemoMode: (demo) => set({ isDemoMode: demo }),
}));
