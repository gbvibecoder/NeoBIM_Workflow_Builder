"use client";

import React, { useCallback, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useExecution } from "@/hooks/useExecution";
import {
  ReactFlow,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type OnConnect,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Layers3, Sparkles, BookOpen, X } from "lucide-react";
import {
  shareExecutionToTwitter,
} from "@/lib/share";

import dynamic from "next/dynamic";
import { BaseNode } from "./nodes/BaseNode";
import { AnimatedEdge } from "./edges/AnimatedEdge";
import { RightNodePanel } from "./panels/RightNodePanel";
import { CanvasToolbar } from "./toolbar/CanvasToolbar";

import { ExecutionLog } from "./ExecutionLog";
import { ResultShowcase } from "./ResultShowcase";
import { OnboardingTour } from "./OnboardingTour";
import { AIChatPanel } from "./panels/AIChatPanel";
import type { ChatMessage } from "./panels/AIChatPanel";
import type { LogEntry } from "./ExecutionLog";
import type { ContextMenuState } from "./ContextMenu";
import { PromptInput } from "@/components/ai/PromptInput";

// ContextMenu is right-click only — load lazily
const ContextMenu = dynamic(
  () => import("./ContextMenu").then((m) => m.ContextMenu),
  { ssr: false }
);

// Architectural 3D walkthrough viewer — client-only
const ArchitecturalViewer = dynamic(
  () => import("./artifacts/architectural-viewer/ArchitecturalViewer"),
  { ssr: false }
);

// Fullscreen video player — client-only
const FullscreenVideoPlayer = dynamic(
  () => import("./artifacts/FullscreenVideoPlayer").then(m => ({ default: m.FullscreenVideoPlayer })),
  { ssr: false }
);

import { useWorkflowStore, isUntitledWorkflow } from "@/stores/workflow-store";
import { SaveWorkflowModal } from "./modals/SaveWorkflowModal";
import { useExecutionStore } from "@/stores/execution-store";
import { useUIStore } from "@/stores/ui-store";
import { NODE_CATALOGUE_MAP, CATEGORY_CONFIG } from "@/constants/node-catalogue";
import type { WorkflowNodeData, NodeCategory } from "@/types/nodes";
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";
import { generateId } from "@/lib/utils";
import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";

// Register custom node and edge types (stable references outside component)
const nodeTypes = { workflowNode: BaseNode };
const edgeTypes = { animatedEdge: AnimatedEdge };

// ─── Mini workflow diagram for empty state ─────────────────────────────────

const DEMO_NODES = [
  { label: "PDF Upload",  color: "#00F5FF" },
  { label: "Doc Parser",  color: "#B87333" },
  { label: "Massing Gen", color: "#FFBF00" },
  { label: "IFC Export",  color: "#4FC3F7" },
];

function MiniWorkflowDiagram() {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-0 mb-2">
      {DEMO_NODES.map((node, i) => (
        <React.Fragment key={node.label}>
          <div
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: `${node.color}18`,
              border: `1px solid ${node.color}40`,
              fontSize: 10,
              color: node.color,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {node.label}
          </div>
          {i < DEMO_NODES.length - 1 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 0,
              margin: "0 3px",
            }}>
              <div style={{ width: 14, height: 1, background: "rgba(184,115,51,0.3)" }} />
              <div style={{
                width: 0, height: 0,
                borderLeft: "4px solid rgba(184,115,51,0.3)",
                borderTop: "3px solid transparent",
                borderBottom: "3px solid transparent",
              }} />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Canvas Empty State ────────────────────────────────────────────────────

interface EmptyStateProps {
  onPromptMode: () => void;
}

function CanvasEmptyState({ onPromptMode }: EmptyStateProps) {
  const { t } = useLocale();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.25 } }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ zIndex: 5 }}
    >
      <div
        className="pointer-events-auto flex flex-col items-center text-center"
        style={{ maxWidth: 440 }}
      >
        {/* Mini diagram preview */}
        <div style={{
          padding: "16px 20px",
          borderRadius: 4,
          background: "rgba(10, 12, 14, 0.7)",
          border: "1px solid rgba(184,115,51,0.15)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          marginBottom: 24,
        }}>
          <MiniWorkflowDiagram />
          <div style={{ fontSize: 9, color: "rgba(184,115,51,0.4)", textAlign: "center", marginTop: 4, fontFamily: "'Space Mono', monospace", textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>
            {t('canvas.examplePipeline')}
          </div>
        </div>

        {/* Icon */}
        <div style={{
          width: 52, height: 52, borderRadius: 4,
          background: "rgba(184,115,51,0.08)",
          border: "1px solid rgba(184,115,51,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 16,
        }}>
          <Layers3 size={22} style={{ color: "#B87333" }} strokeWidth={1.5} />
        </div>

        {/* Headline */}
        <h2 style={{
          fontSize: 22, fontWeight: 400,
          fontFamily: "'Playfair Display', serif",
          fontStyle: "italic",
          color: "#FFBF00", marginBottom: 8, lineHeight: 1.3,
          letterSpacing: "0.05em",
        }}>
          {t('canvas.emptyTitle')}
        </h2>

        {/* Subtitle */}
        <p style={{
          fontSize: 12, color: "rgba(255,255,255,0.4)",
          fontFamily: "'Space Mono', monospace",
          lineHeight: 1.6, marginBottom: 24, maxWidth: 320,
        }}>
          {t('canvas.emptyDesc')}
        </p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: 10 }}>
          <Link
            href="/dashboard/templates"
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "9px 18px", borderRadius: 4,
              border: "1px solid rgba(184,115,51,0.4)",
              background: "rgba(184,115,51,0.05)",
              fontSize: 10, fontWeight: 400, color: "#B87333",
              fontFamily: "'Space Mono', monospace",
              textTransform: "uppercase" as const,
              letterSpacing: "0.15em",
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(184,115,51,0.12)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(184,115,51,0.6)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(184,115,51,0.05)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(184,115,51,0.4)";
            }}
          >
            <BookOpen size={14} />
            {t('canvas.browseTemplates')}
          </Link>
          <button
            onClick={onPromptMode}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "9px 18px", borderRadius: 4,
              background: "transparent",
              border: "1px solid rgba(0,245,255,0.4)",
              fontSize: 10, fontWeight: 400, color: "#00F5FF",
              fontFamily: "'Space Mono', monospace",
              textTransform: "uppercase" as const,
              letterSpacing: "0.15em",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(0,245,255,0.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Sparkles size={14} />
            {t('canvas.tryAiPrompt')}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Fullscreen 3D Artifact Viewer ─────────────────────────────────────────

function FullscreenArtifactViewer() {
  const nodeId = useUIStore(s => s.artifactViewerNodeId);
  const close = useUIStore(s => s.setArtifactViewerNodeId);
  const artifact = useExecutionStore(s => nodeId ? s.artifacts.get(nodeId) : undefined);

  if (!nodeId || !artifact) return null;

  const d = artifact.data as Record<string, unknown>;
  const floors = (d?.floors as number) ?? 5;
  const height = (d?.height as number) ?? 21;
  const footprint = (d?.footprint as number) ?? 500;
  const gfa = (d?.gfa as number) ?? floors * footprint;
  const buildingType = (d?.buildingType as string) ?? "Mixed-Use";
  const style = d?.style as Record<string, unknown> | undefined;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "absolute", inset: 0, zIndex: 60,
        background: "rgba(4,4,8,0.98)",
        display: "flex", flexDirection: "column",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#F0F0F5" }}>
          3D Architectural Walkthrough
        </span>
        <button
          onClick={() => close(null)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8,
            background: "rgba(255,255,255,0.06)", border: "none",
            color: "#8888A0", fontSize: 12, fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <X size={12} /> Close
        </button>
      </div>
      <div style={{ flex: 1 }}>
        <ArchitecturalViewer
          floors={floors}
          height={height}
          footprint={footprint}
          gfa={gfa}
          buildingType={buildingType}
          style={style ? {
            glassHeavy: !!style.glassHeavy,
            hasRiver: !!style.hasRiver,
            hasLake: !!style.hasLake,
            isModern: !!style.isModern,
            isTower: !!style.isTower,
            exteriorMaterial: (style.exteriorMaterial as string) ?? "mixed",
            environment: (style.environment as string) ?? "suburban",
            usage: (style.usage as string) ?? "mixed",
            promptText: (style.promptText as string) ?? "",
            typology: (style.typology as string) ?? "generic",
            facadePattern: (style.facadePattern as string) ?? "none",
            floorHeightOverride: style.floorHeightOverride ? Number(style.floorHeightOverride) : undefined,
            maxFloorCap: Number(style.maxFloorCap ?? 30),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any : undefined}
        />
      </div>
    </motion.div>
  );
}

// ─── Inner Canvas ──────────────────────────────────────────────────────────

interface WorkflowCanvasInnerProps {
  workflowId?: string;
}

function WorkflowCanvasInner({ workflowId: urlWorkflowId }: WorkflowCanvasInnerProps) {
  const { fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const {
    nodes: storeNodes,
    edges: storeEdges,
    currentWorkflow,
    creationMode,
    addNode,
    removeNode,
    removeEdge: removeStoreEdge,
    updateNode,
    addEdge: addStoreEdge,
    resetCanvas,
    setEdgeFlowing,
    isDirty,
    isSaving,
    markDirty,
    setCreationMode,
    saveWorkflow,
    loadWorkflow,
    undo,
    redo,
    isSaveModalOpen,
    openSaveModal,
    closeSaveModal,
  } = useWorkflowStore();

  const { artifacts, executionProgress, clearArtifacts, clearCurrentExecution, restoreArtifactsFromDB } = useExecutionStore();

  // ─── Loading state: prevent empty-canvas flash while workflow loads from DB ──
  const [isLoadingWorkflow, setIsLoadingWorkflow] = useState(!!urlWorkflowId);

  // ─── Auto-save debounce for persisted workflows ────────────────────
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    // Only auto-save if: dirty, has a persisted DB id, not currently saving, not executing, not demo
    const wfId = currentWorkflow?.id;
    const isPersisted = wfId && wfId.length >= 20 && wfId.startsWith("c");
    if (!isDirty || !isPersisted || isSaving) return;

    // Clear previous timer
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(() => {
      saveWorkflow().then((id) => {
        if (id) {
          console.info("[auto-save] Workflow saved:", id);
          // Update URL with ?id= so page refresh can restore this workflow
          if (!urlWorkflowId && typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("id", id);
            window.history.replaceState({}, "", url.toString());
          }
        }
      });
    }, 3000); // 3-second debounce

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [isDirty, currentWorkflow?.id, isSaving, saveWorkflow]);

  // ─── Restore execution artifacts from DB ─────────────────────────
  const restoreExecutionArtifacts = useCallback((wfId: string) => {
    // Small delay to ensure workflow nodes are populated in Zustand before we set statuses
    setTimeout(() => {
      fetch(`/api/executions?workflowId=${wfId}&limit=1`)
        .then(res => res.ok ? res.json() : null)
        .then((data: { executions?: Array<{
          id: string; status: string; startedAt: string; completedAt?: string | null;
          artifacts?: Array<{
            tileInstanceId: string; nodeId: string; type: string;
            data: Record<string, unknown>; nodeLabel?: string | null;
            title?: string; createdAt?: string;
          }>;
        }> } | null) => {
          if (!data?.executions?.length) return;
          const latest = data.executions[0];
          if (latest.artifacts && latest.artifacts.length > 0) {
            restoreArtifactsFromDB(latest.artifacts, {
              id: latest.id,
              status: latest.status,
              startedAt: latest.startedAt,
              completedAt: latest.completedAt,
            });
          }
        })
        .catch(() => { /* Non-fatal — execution restore is best-effort */ });
    }, 100);
  }, [restoreArtifactsFromDB]);

  // ─── Load workflow from URL ?id= param ────────────────────────────
  const loadedUrlIdRef = useRef<string | null>(null);
  const artifactsRestoredRef = useRef(false);
  React.useEffect(() => {
    if (!urlWorkflowId) {
      // New/empty canvas — clear any stale execution results from a previous workflow
      clearArtifacts();
      clearCurrentExecution();
      setIsLoadingWorkflow(false);
      return;
    }
    // Don't re-load if already loaded this ID
    if (loadedUrlIdRef.current === urlWorkflowId) return;
    if (currentWorkflow?.id === urlWorkflowId) {
      loadedUrlIdRef.current = urlWorkflowId;
      setIsLoadingWorkflow(false);
      // Workflow already in Zustand but artifacts may be lost on refresh — restore once
      if (!artifactsRestoredRef.current) {
        artifactsRestoredRef.current = true;
        restoreExecutionArtifacts(urlWorkflowId);
      }
      return;
    }
    // Switching to a different workflow — clear old execution results first
    clearArtifacts();
    clearCurrentExecution();
    setIsLoadingWorkflow(true);
    loadedUrlIdRef.current = urlWorkflowId;
    loadWorkflow(urlWorkflowId).then(() => {
      setIsLoadingWorkflow(false);
      // Fit view after workflow loads
      setTimeout(() => fitView({ padding: 0.3, duration: 600 }), 300);

      // Restore latest execution results from DB for THIS workflow
      artifactsRestoredRef.current = true;
      restoreExecutionArtifacts(urlWorkflowId);
    }).catch(() => {
      setIsLoadingWorkflow(false);
    });
  }, [urlWorkflowId, currentWorkflow?.id, loadWorkflow, fitView, restoreExecutionArtifacts, clearArtifacts, clearCurrentExecution]);
  const { isNodeLibraryOpen, setPromptModeActive, isPromptModeActive, toggleNodeLibrary, isDemoMode, setShowExecutionCompleteModal, pendingNodeAdd, clearPendingNodeAdd } = useUIStore();

  // Execution timing for celebration modal
  const executionStartRef = useRef<number | null>(null);

  // Consume pendingNodeAdd from sidebar click-to-add — place at canvas center
  React.useEffect(() => {
    if (!pendingNodeAdd) return;
    const catalogueItem = NODE_CATALOGUE_MAP.get(pendingNodeAdd);
    clearPendingNodeAdd();
    if (!catalogueItem) return;

    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const position = screenToFlowPosition({ x: cx, y: cy });
    const newNode = {
      id: `${catalogueItem.id}-${Math.random().toString(36).slice(2, 9)}`,
      type: "workflowNode" as const,
      position,
      data: {
        catalogueId: catalogueItem.id,
        label: catalogueItem.name,
        category: catalogueItem.category,
        status: "idle" as const,
        inputs: catalogueItem.inputs,
        outputs: catalogueItem.outputs,
        icon: catalogueItem.icon,
        executionTime: catalogueItem.executionTime,
      },
    };
    addNode(newNode);
  }, [pendingNodeAdd, clearPendingNodeAdd, screenToFlowPosition, addNode]);

  // Existing workflow names for duplicate detection in save modal
  const [existingNames, setExistingNames] = useState<string[]>([]);
  React.useEffect(() => {
    if (isSaveModalOpen) {
      import("@/lib/api").then(({ api }) =>
        api.workflows.list().then(({ workflows }) =>
          setExistingNames(workflows.map((w) => w.name))
        ).catch(() => {})
      );
    }
  }, [isSaveModalOpen]);

  // Chat / execution log state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showShowcase, setShowShowcase] = useState(false);
  const prevExecutingRef = useRef(false);

  const addLogEntry = useCallback((entry: LogEntry) => {
    setLogEntries(prev => [...prev, entry]);
    setShowLog(true);
  }, []);

  const { runWorkflow, isExecuting } = useExecution({ onLog: addLogEntry });

  // Show showcase when execution finishes + post-execution scene
  React.useEffect(() => {
    if (prevExecutingRef.current && !isExecuting && artifacts.size > 0) {
      toast.success("Workflow Complete", { duration: 2000 });

      // Edge completion wave
      const edgeDelay = 500 / Math.max(storeNodes.length, 1);
      storeNodes.forEach((node, i) => {
        setTimeout(() => setEdgeFlowing(node.id, true), i * edgeDelay);
        setTimeout(() => setEdgeFlowing(node.id, false), i * edgeDelay + 300);
      });

      // Show grand reveal showcase after a short delay
      const timer = setTimeout(() => setShowShowcase(true), 500);
      return () => { clearTimeout(timer); };
    }
    prevExecutingRef.current = isExecuting;
  }, [isExecuting, artifacts, storeNodes, setEdgeFlowing]);
  const { t: tLocale } = useLocale();

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes as unknown as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges as Edge[]);

  React.useEffect(() => { setNodes(storeNodes as unknown as Node[]); }, [storeNodes, setNodes]);
  React.useEffect(() => { setEdges(storeEdges as Edge[]); }, [storeEdges, setEdges]);

  // Fit view when nodes are loaded from template (batch node change)
  const prevNodeCountRef = useRef(storeNodes.length);
  React.useEffect(() => {
    const prev = prevNodeCountRef.current;
    const curr = storeNodes.length;
    prevNodeCountRef.current = curr;
    // Template load: many nodes appear at once (from 0 or very different count)
    if (curr > 0 && Math.abs(curr - prev) >= 3) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.3, duration: 800 });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [storeNodes.length, fitView]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, type: "node", nodeId: node.id });
  }, []);

  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    const evt = e as React.MouseEvent;
    setContextMenu({ x: evt.clientX, y: evt.clientY, type: "canvas" });
  }, []);

  const handleDuplicateNode = useCallback((nodeId: string) => {
    const node = storeNodes.find(n => n.id === nodeId);
    if (!node) return;
    const newNode: WorkflowNode = {
      ...node,
      id: `${node.data.catalogueId}-${generateId()}`,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
    };
    addNode(newNode);
    toast.success(`${tLocale('toast.duplicated')}: ${node.data.label}`, { duration: 2000 });
  }, [storeNodes, addNode, tLocale]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    if (isExecuting) {
      toast.error("Cannot modify workflow while executing", { duration: 3000 });
      return;
    }
    const node = storeNodes.find(n => n.id === nodeId);
    removeNode(nodeId);
    toast.success(`${tLocale('toast.deleted')}: ${node?.data.label ?? tLocale('toast.node')}`, { duration: 2000 });
  }, [storeNodes, removeNode, tLocale, isExecuting]);

  const handleFitToNode = useCallback((nodeId: string) => {
    fitView({ nodes: [{ id: nodeId }], padding: 0.5, duration: 400 });
  }, [fitView]);

  // Sync drag positions back to Zustand so store→ReactFlow effect doesn't reset them
  const onNodeDragStop = useCallback((_: React.MouseEvent, _node: Node, draggedNodes: Node[]) => {
    draggedNodes.forEach((n) => updateNode(n.id, { position: n.position }));
  }, [updateNode]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      // Derive gradient colors from source/target node categories
      const CAT_COLORS: Record<string, string> = {
        input: "#00F5FF", transform: "#B87333", generate: "#FFBF00", export: "#4FC3F7",
      };
      const srcNode = nodes.find(n => n.id === connection.source);
      const tgtNode = nodes.find(n => n.id === connection.target);
      const sourceColor = CAT_COLORS[(srcNode?.data as WorkflowNodeData)?.category ?? ""] ?? "#4F8AFF";
      const targetColor = CAT_COLORS[(tgtNode?.data as WorkflowNodeData)?.category ?? ""] ?? "#4F8AFF";
      const edgeData = { sourceColor, targetColor };

      const newEdge: WorkflowEdge = {
        id: `e${connection.source}-${connection.target}-${generateId()}`,
        source: connection.source ?? "",
        sourceHandle: connection.sourceHandle ?? "",
        target: connection.target ?? "",
        targetHandle: connection.targetHandle ?? "",
        type: "animatedEdge",
        data: edgeData,
      };
      setEdges((eds) => addEdge({ ...connection, type: "animatedEdge", data: edgeData }, eds));
      addStoreEdge(newEdge);
    },
    [nodes, setEdges, addStoreEdge]
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      // Block deletions during execution
      if (isExecuting && changes.some(c => c.type === "remove")) {
        toast.error("Cannot modify workflow while executing", { duration: 3000 });
        return;
      }
      onNodesChange(changes);
      markDirty();
      // Sync keyboard/backspace deletions to Zustand store
      changes.forEach(change => {
        if (change.type === "remove") removeNode(change.id);
      });
    },
    [onNodesChange, markDirty, removeNode, isExecuting]
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      markDirty();
      // Sync keyboard/backspace edge deletions to Zustand store
      changes.forEach(change => {
        if (change.type === "remove") removeStoreEdge(change.id);
      });
    },
    [onEdgesChange, markDirty, removeStoreEdge]
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nodeId = event.dataTransfer.getData("application/reactflow-nodeid");
      if (!nodeId) return;
      const catalogueItem = NODE_CATALOGUE_MAP.get(nodeId);
      if (!catalogueItem) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      const newNode: WorkflowNode = {
        id: `${nodeId}-${generateId()}`,
        type: "workflowNode",
        position,
        data: {
          catalogueId: catalogueItem.id,
          label: catalogueItem.name,
          category: catalogueItem.category as NodeCategory,
          status: "idle",
          inputs: catalogueItem.inputs,
          outputs: catalogueItem.outputs,
          icon: catalogueItem.icon,
          executionTime: catalogueItem.executionTime,
        } satisfies WorkflowNodeData,
      };
      addNode(newNode);
      toast.success(`Added: ${catalogueItem.name}`, { duration: 2000 });
    },
    [screenToFlowPosition, addNode]
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleRun  = useCallback(async () => {
    // #1: Validate that input nodes have content before running
    const inputNodes = nodes.filter((n) => {
      const data = n.data as Record<string, unknown>;
      const catId = data.catalogueId as string;
      return catId?.startsWith("IN-");
    });
    const hasEmptyInput = inputNodes.some((n) => {
      const data = n.data as Record<string, unknown>;
      const val = (data.inputValue as string) ?? "";
      return val.trim() === "";
    });
    if (inputNodes.length > 0 && hasEmptyInput) {
      toast.error(tLocale('toast.emptyInputError'), { duration: 4000 });
      return;
    }
    if (nodes.length === 0) {
      toast.error(tLocale('toast.noNodesError'), { duration: 3000 });
      return;
    }

    // #2: Auto-save unsaved workflow before execution (so execution can persist to DB)
    const wfId = currentWorkflow?.id;
    const isPersisted = wfId && wfId.length >= 20 && wfId.startsWith("c");
    if (!isPersisted && !isDemoMode) {
      const savedId = await saveWorkflow();
      if (savedId) {
        toast.success(tLocale('toast.workflowSaved'), { duration: 2000 });
      }
    }

    executionStartRef.current = Date.now();
    await runWorkflow();
    executionStartRef.current = null;
  }, [runWorkflow, nodes, tLocale, currentWorkflow?.id, isDemoMode, saveWorkflow]);
  const handleSave = useCallback(async () => {
    if (isDemoMode) {
      toast.info(tLocale('toast.demoSaveHint'), { duration: 3000 });
      return;
    }
    if (isUntitledWorkflow(currentWorkflow?.name)) {
      openSaveModal();
      return;
    }
    const id = await saveWorkflow();
    if (id) {
      toast.success(tLocale('toast.workflowSaved'), { duration: 2000 });
    } else {
      toast.error(tLocale('toast.saveFailed'));
    }
  }, [saveWorkflow, isDemoMode, currentWorkflow?.name, openSaveModal, tLocale]);

  const handleSaveWithName = useCallback(async (newName: string) => {
    closeSaveModal();
    const id = await saveWorkflow(newName);
    if (id) {
      toast.success(`${tLocale('toast.workflowSaved')}: "${newName}"`, { duration: 2000 });
    } else {
      toast.error(tLocale('toast.saveFailed'));
    }
  }, [saveWorkflow, closeSaveModal, tLocale]);
  const workflowName = currentWorkflow?.name ?? tLocale('canvas.untitledWorkflow');

  const handleShare = useCallback(() => {
    shareExecutionToTwitter(workflowName, storeNodes.length);
  }, [workflowName, storeNodes.length]);

  // Compute duration text for celebration modal
  const durationText = (() => {
    if (!executionStartRef.current) return "a few seconds";
    const ms = Date.now() - executionStartRef.current;
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  })();

  return (
    <div className="relative flex h-full w-full">
      {/* Onboarding tour (fixed overlay, renders once) */}
      <OnboardingTour />

      {/* AI Prompt overlay */}
      <AnimatePresence>
        {isPromptModeActive && (
          <PromptInput onClose={() => setPromptModeActive(false)} />
        )}
      </AnimatePresence>

      {/* Right-side Node Library panel — canvas only */}
      <RightNodePanel />

      {/* Canvas area */}
      <div
        ref={reactFlowWrapper}
        className="flex-1 relative"
        onDrop={onDrop}
        onDragOver={onDragOver}
      >
        <CanvasToolbar
          workflowName={workflowName}
          creationMode={creationMode}
          isExecuting={isExecuting}
          isDirty={isDirty}
          isSaving={isSaving}
          isNodeLibraryOpen={isNodeLibraryOpen}
          onRun={handleRun}
          onStop={() => {}}
          onSave={handleSave}
          onUndo={undo}
          onRedo={redo}
          onZoomIn={() => zoomIn({ duration: 250 })}
          onZoomOut={() => zoomOut({ duration: 250 })}
          onFitView={() => fitView({ padding: 0.15, duration: 400 })}
          onShare={handleShare}
          onModeChange={setCreationMode}
          onPromptMode={() => setPromptModeActive(true)}
          onToggleLibrary={toggleNodeLibrary}
          onNameChange={async (newName: string) => {
            if (currentWorkflow) {
              markDirty();
              const id = await saveWorkflow(newName);
              if (id) {
                toast.success(`${tLocale('toast.renamedTo')} "${newName}"`, { duration: 2000 });
              } else {
                toast.error(tLocale('toast.saveFailed'));
              }
            }
          }}
        />

        {/* Execution progress bar */}
        <AnimatePresence>
          {isExecuting && (
            <motion.div
              key="progress-bar"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { delay: 0.5 } }}
              style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 11,
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <motion.div
                animate={{ width: `${executionProgress}%` }}
                transition={{ ease: "linear", duration: 0.4 }}
                style={{
                  height: "100%",
                  background: "linear-gradient(90deg, #00F5FF 0%, #B87333 50%, #FFBF00 100%)",
                  boxShadow: "0 0 8px rgba(0,245,255,0.6)",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* React Flow canvas */}
        <div
          className="absolute inset-0"
        >
          {/* Architectural grid — major lines every 100px, minor every 20px */}
          <div
            style={{
              position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
              backgroundImage: `
                linear-gradient(rgba(184,115,51,0.10) 1px, transparent 1px),
                linear-gradient(90deg, rgba(184,115,51,0.10) 1px, transparent 1px),
                linear-gradient(rgba(184,115,51,0.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(184,115,51,0.05) 1px, transparent 1px)
              `,
              backgroundSize: '100px 100px, 100px 100px, 20px 20px, 20px 20px',
            }}
          />
          {/* Copper dot grid */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 0, opacity: 0.22,
              backgroundImage: 'radial-gradient(circle, #B87333 0.7px, transparent 0.7px)',
              backgroundSize: '60px 60px',
            }}
          />
          {/* Warm atmospheric glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 0,
              background: isExecuting
                ? 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(184,115,51,0.14) 0%, transparent 70%)'
                : 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(184,115,51,0.08) 0%, transparent 70%)',
              animation: 'atelier-glow-pulse 8s ease-in-out infinite',
              transition: 'background 1s ease',
            }}
          />
          {/* Cyan accent glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 0,
              background: 'radial-gradient(circle at 15% 80%, rgba(0,245,255,0.05) 0%, transparent 40%)',
            }}
          />
          {/* Edge vignette — darkens corners for cinematic depth */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 0,
              background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)',
            }}
          />

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodeContextMenu={onNodeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            defaultEdgeOptions={{
              type: "animatedEdge",
              style: { stroke: "#B87333", strokeWidth: 1.5 },
            }}
            minZoom={0.15}
            maxZoom={2.5}
            snapToGrid
            snapGrid={[16, 16]}
            connectionLineStyle={{
              stroke: "#B87333",
              strokeWidth: 1,
              strokeDasharray: "20 8",
              opacity: 0.4,
            }}
            style={{
              background: '#070809',
            }}
          >

            {/* Minimap — bottom-left, compact, low opacity */}
            <MiniMap
              position="bottom-left"
              nodeStrokeWidth={0}
              nodeColor={(n) => {
                const d = n.data as WorkflowNodeData;
                const cfg = CATEGORY_CONFIG[d?.category as NodeCategory];
                return cfg?.color ?? "rgba(255,255,255,0.08)";
              }}
              maskColor="rgba(7,8,9,0.7)"
              className="canvas-minimap"
              style={{
                width: 120,
                height: 80,
                backgroundColor: "rgba(10,12,14,0.85)",
                border: "1px solid rgba(184,115,51,0.1)",
                borderRadius: 8,
                marginBottom: 16,
                marginLeft: 16,
                opacity: 0.5,
                transition: "opacity 0.3s ease",
              }}
            />
          </ReactFlow>

          {/* Context menu */}
          <AnimatePresence>
            {contextMenu && (
              <ContextMenu
                menu={contextMenu}
                onClose={() => setContextMenu(null)}
                onFitView={() => fitView({ padding: 0.15, duration: 400 })}
                onClearCanvas={() => { resetCanvas(); clearArtifacts(); }}
                onDuplicateNode={handleDuplicateNode}
                onDeleteNode={handleDeleteNode}
                onFitToNode={handleFitToNode}
              />
            )}
          </AnimatePresence>

          {/* Loading state — show while workflow is being restored from DB */}
          <AnimatePresence>
            {isLoadingWorkflow && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ zIndex: 5 }}
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#B87333]/20 border-t-[#B87333]" />
                  <span style={{ fontSize: 11, color: "rgba(184,115,51,0.5)", fontFamily: "'Space Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase" as const }}>
                    Restoring workflow...
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Empty state — only show if not loading a workflow from DB */}
          <AnimatePresence>
            {nodes.length === 0 && !isLoadingWorkflow && (
              <CanvasEmptyState onPromptMode={() => setPromptModeActive(true)} />
            )}
          </AnimatePresence>

          {/* Execution log — minimal pill at bottom-left */}
          <AnimatePresence>
            {showLog && (
              <ExecutionLog
                entries={logEntries}
                isRunning={isExecuting}
                onClose={() => { setShowLog(false); setLogEntries([]); }}
              />
            )}
          </AnimatePresence>

          {/* Post-execution grand reveal showcase */}
          <AnimatePresence>
            {showShowcase && !isExecuting && artifacts.size > 0 && (
              <ResultShowcase onClose={() => setShowShowcase(false)} />
            )}
          </AnimatePresence>

          {/* "View Results" floating button — visible when showcase is closed but artifacts exist */}
          <AnimatePresence>
            {!showShowcase && !isExecuting && artifacts.size > 0 && (
              <motion.button
                key="view-results-fab"
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                onClick={() => setShowShowcase(true)}
                style={{
                  position: "absolute",
                  bottom: 20,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  borderRadius: 12,
                  background: "linear-gradient(135deg, rgba(0,245,255,0.12), rgba(184,115,51,0.08))",
                  border: "1px solid rgba(0,245,255,0.25)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  color: "#00F5FF",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 4px 24px rgba(0,0,0,0.4), 0 0 20px rgba(0,245,255,0.08)",
                }}
                whileHover={{ scale: 1.03, boxShadow: "0 4px 30px rgba(0,0,0,0.5), 0 0 30px rgba(0,245,255,0.15)" }}
                whileTap={{ scale: 0.97 }}
              >
                <Sparkles size={14} />
                {tLocale('showcase.viewResults') ?? "View Results"}
                <span style={{
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: "rgba(0,245,255,0.12)",
                  fontSize: 10,
                  fontWeight: 700,
                }}>
                  {artifacts.size}
                </span>
              </motion.button>
            )}
          </AnimatePresence>

          {/* Fullscreen 3D Architectural Viewer (opened from node "View 3D Model" button) */}
          <FullscreenArtifactViewer />

          {/* Fullscreen Video Player (opened from node video thumbnail or expand button) */}
          <ErrorBoundary fallback={null} showHomeButton={false}>
            <FullscreenVideoPlayer />
          </ErrorBoundary>

          {/* ── Architectural title block — bottom right ── */}
          <div style={{
            position: 'absolute',
            bottom: 14,
            right: 14,
            zIndex: 2,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
          }}>
            {/* North arrow */}
            <svg width="16" height="24" viewBox="0 0 16 24" style={{ opacity: 0.25 }}>
              <text x="8" y="6" textAnchor="middle" fill="#B87333" fontSize="6" fontWeight="600"
                style={{ fontFamily: "'Space Mono', monospace" }}>N</text>
              <path d="M8 8 L11 16 L8 13.5 L5 16 Z" fill="#B8733340" />
              <line x1="8" y1="16" x2="8" y2="22" stroke="#B8733340" strokeWidth="0.5" />
            </svg>
            {/* Title block */}
            <div style={{
              padding: '3px 8px',
              border: '1px solid rgba(184,115,51,0.15)',
              borderRadius: 2,
              background: 'rgba(7,8,9,0.6)',
            }}>
              <div style={{
                fontSize: 7,
                color: 'rgba(184,115,51,0.4)',
                fontWeight: 500,
                letterSpacing: '0.12em',
                fontFamily: "'Space Mono', monospace",
                textTransform: 'uppercase' as const,
              }}>
                DIGITAL ATELIER &nbsp;|&nbsp; {workflowName}
              </div>
              <div style={{
                fontSize: 6,
                color: 'rgba(184,115,51,0.25)',
                letterSpacing: '0.08em',
                marginTop: 1,
                fontFamily: "'Space Mono', monospace",
              }}>
                SCALE: NTS
              </div>
            </div>
          </div>
        </div>

        {/* Post-execution 3D scene — overlays right 70% of canvas */}
        {/* AI Chat Panel — floats on right edge */}
        <AIChatPanel
          messages={chatMessages}
          onAddMessage={(msg) => setChatMessages(prev => [...prev, msg])}
          onClear={() => setChatMessages([])}
          isOpen={isChatOpen}
          onToggle={() => setIsChatOpen(o => !o)}
        />

        {/* Artifact results panel removed — results now display inside nodes */}

        {/* Execution complete modal removed — bottom status bar already shows completion */}
      </div>

      {/* Save workflow name modal */}
      <SaveWorkflowModal
        isOpen={isSaveModalOpen}
        existingNames={existingNames}
        onSave={handleSaveWithName}
        onClose={closeSaveModal}
      />
    </div>
  );
}

// ─── Public export ─────────────────────────────────────────────────────────

interface WorkflowCanvasProps {
  workflowId?: string;
}

export function WorkflowCanvas({ workflowId }: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}
