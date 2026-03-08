"use client";

import React, { useCallback, useRef, useState } from "react";
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
import { Layers3, Sparkles, BookOpen } from "lucide-react";
import {
  shareExecutionToTwitter,
} from "@/lib/share";
import { ExecutionCompleteModal } from "./modals/ExecutionCompleteModal";

import dynamic from "next/dynamic";
import { BaseNode } from "./nodes/BaseNode";
import { AnimatedEdge } from "./edges/AnimatedEdge";
import { NodeLibraryPanel } from "./panels/NodeLibraryPanel";
import { CanvasToolbar } from "./toolbar/CanvasToolbar";

import { ExecutionLog } from "./ExecutionLog";
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

// Three.js scene — must be client-only
const PostExecutionScene = dynamic(
  () => import("./PostExecutionScene"),
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
  { label: "PDF Upload",  color: "#3B82F6" },
  { label: "Doc Parser",  color: "#8B5CF6" },
  { label: "Massing Gen", color: "#10B981" },
  { label: "IFC Export",  color: "#F59E0B" },
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
              <div style={{ width: 14, height: 1, background: "rgba(79,138,255,0.3)" }} />
              <div style={{
                width: 0, height: 0,
                borderLeft: "4px solid rgba(79,138,255,0.3)",
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
          borderRadius: 12,
          background: "rgba(18, 18, 26, 0.7)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          marginBottom: 24,
        }}>
          <MiniWorkflowDiagram />
          <div style={{ fontSize: 9, color: "#3A3A50", textAlign: "center", marginTop: 4 }}>
            {t('canvas.examplePipeline')}
          </div>
        </div>

        {/* Icon */}
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: "rgba(79,138,255,0.08)",
          border: "1px solid rgba(79,138,255,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 16,
        }}>
          <Layers3 size={22} style={{ color: "#4F8AFF" }} strokeWidth={1.5} />
        </div>

        {/* Headline */}
        <h2 style={{
          fontSize: 20, fontWeight: 600,
          color: "#F0F0F5", marginBottom: 8, lineHeight: 1.3,
        }}>
          {t('canvas.emptyTitle')}
        </h2>

        {/* Subtitle */}
        <p style={{
          fontSize: 14, color: "#5C5C78",
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
              padding: "9px 18px", borderRadius: 8,
              border: "1px solid rgba(79,138,255,0.35)",
              background: "rgba(79,138,255,0.06)",
              fontSize: 13, fontWeight: 500, color: "#4F8AFF",
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.12)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(79,138,255,0.6)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(79,138,255,0.06)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(79,138,255,0.35)";
            }}
          >
            <BookOpen size={14} />
            {t('canvas.browseTemplates')}
          </Link>
          <button
            onClick={onPromptMode}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "9px 18px", borderRadius: 8,
              background: "#4F8AFF",
              border: "none",
              fontSize: 13, fontWeight: 600, color: "#fff",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#3D7AFF"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#4F8AFF"; }}
          >
            <Sparkles size={14} />
            {t('canvas.tryAiPrompt')}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Inner Canvas ──────────────────────────────────────────────────────────

interface WorkflowCanvasInnerProps {
  workflowId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WorkflowCanvasInner({ workflowId: _workflowId }: WorkflowCanvasInnerProps) {
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
    undo,
    redo,
    isSaveModalOpen,
    openSaveModal,
    closeSaveModal,
  } = useWorkflowStore();

  const { artifacts, executionProgress, clearArtifacts } = useExecutionStore();
  const { isNodeLibraryOpen, setPromptModeActive, isPromptModeActive, toggleNodeLibrary, isDemoMode, setShowExecutionCompleteModal } = useUIStore();

  // Execution timing for celebration modal
  const executionStartRef = useRef<number | null>(null);

  // Spacebar opens command palette (only when not typing in an input)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (e.code === "Space" && !isInput && !isNodeLibraryOpen && !isPromptModeActive) {
        e.preventDefault();
        toggleNodeLibrary();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isNodeLibraryOpen, isPromptModeActive, toggleNodeLibrary]);

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
  const [showPostExecution, setShowPostExecution] = useState(false);
  const prevExecutingRef = useRef(false);

  const addLogEntry = useCallback((entry: LogEntry) => {
    setLogEntries(prev => [...prev, entry]);
    setShowLog(true);
  }, []);

  const { runWorkflow, isExecuting } = useExecution({ onLog: addLogEntry });

  // Post-execution scene: edge wave → nodes slide left → 3D scene
  React.useEffect(() => {
    if (prevExecutingRef.current && !isExecuting && artifacts.size > 0) {
      toast.success("Workflow Complete", { duration: 2000 });

      // Step 1: Edge completion wave (0.5s)
      const edgeDelay = 500 / Math.max(storeNodes.length, 1);
      storeNodes.forEach((node, i) => {
        setTimeout(() => setEdgeFlowing(node.id, true), i * edgeDelay);
        setTimeout(() => setEdgeFlowing(node.id, false), i * edgeDelay + 300);
      });

      // Step 2: Show post-execution scene (triggers CSS node slide)
      const timer = setTimeout(() => setShowPostExecution(true), 700);
      return () => clearTimeout(timer);
    }
    prevExecutingRef.current = isExecuting;
  }, [isExecuting, artifacts, storeNodes, setEdgeFlowing]);
  const { t: tLocale } = useLocale();

  // Extract data from artifacts for 3D scene
  const postExecData = React.useMemo(() => {
    if (!showPostExecution) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rooms: any[] = [];
    const kpis: { floors?: number; gfa?: number; height?: number; footprint?: number } = {};
    let description = "";

    for (const artifact of artifacts.values()) {
      if (artifact.type === "3d" || artifact.type === "svg") {
        const d = artifact.data as Record<string, unknown>;
        rooms = (d?.roomList as typeof rooms) ?? [];
      }
      if (artifact.type === "kpi") {
        const d = artifact.data as Record<string, unknown>;
        const metrics = (d?.metrics as Array<{ label: string; value: string | number }>) ?? [];
        for (const m of metrics) {
          const lab = m.label.toLowerCase();
          if (lab.includes("floor")) kpis.floors = Number(m.value);
          if (lab.includes("gfa") || lab.includes("gross")) kpis.gfa = Number(m.value);
          if (lab.includes("height")) kpis.height = Number(m.value);
          if (lab.includes("footprint")) kpis.footprint = Number(m.value);
        }
      }
      if (artifact.type === "text") {
        const d = artifact.data as Record<string, unknown>;
        description = (d?.content as string) ?? "";
      }
    }

    return {
      rooms,
      kpis,
      description,
      buildingName: currentWorkflow?.name ?? "Building Design",
    };
  }, [showPostExecution, artifacts, currentWorkflow?.name]);

  const handleClosePostExecution = useCallback(() => {
    setShowPostExecution(false);
    setTimeout(() => fitView({ padding: 0.3, duration: 800 }), 1100);
  }, [fitView]);

  const handleGeneratePDF = useCallback(async () => {
    const { generatePDFReport } = await import("@/services/pdf-report");
    const labels = new Map<string, string>();
    storeNodes.forEach(n => labels.set(n.id, n.data.label));
    await generatePDFReport({
      workflowName: currentWorkflow?.name ?? "Workflow Results",
      artifacts,
      nodeLabels: labels,
    });
  }, [storeNodes, currentWorkflow?.name, artifacts]);

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
    const node = storeNodes.find(n => n.id === nodeId);
    removeNode(nodeId);
    toast.success(`${tLocale('toast.deleted')}: ${node?.data.label ?? tLocale('toast.node')}`, { duration: 2000 });
  }, [storeNodes, removeNode, tLocale]);

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
        input: "#3B82F6", transform: "#8B5CF6", generate: "#10B981", export: "#F59E0B",
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
      onNodesChange(changes);
      markDirty();
      // Sync keyboard/backspace deletions to Zustand store
      changes.forEach(change => {
        if (change.type === "remove") removeNode(change.id);
      });
    },
    [onNodesChange, markDirty, removeNode]
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
    executionStartRef.current = Date.now();
    await runWorkflow();
    // Show celebration modal on completion
    const elapsed = executionStartRef.current ? Date.now() - executionStartRef.current : 0;
    executionStartRef.current = null;
    if (elapsed > 0) {
      setShowExecutionCompleteModal(true);
    }
  }, [runWorkflow, nodes, tLocale, setShowExecutionCompleteModal]);
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

      {/* Node Command Palette (floating overlay) */}
      <AnimatePresence>
        {isNodeLibraryOpen && <NodeLibraryPanel />}
      </AnimatePresence>

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
                  background: "linear-gradient(90deg, #4F8AFF 0%, #8B5CF6 100%)",
                  boxShadow: "0 0 8px rgba(79,138,255,0.6)",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* React Flow — slides left when post-execution scene is active */}
        <div
          className="absolute inset-0"
          style={{
            transition: "transform 1s cubic-bezier(0.32, 0.72, 0, 1), opacity 1s ease, filter 1s ease",
            transform: showPostExecution ? "scale(0.45)" : "none",
            transformOrigin: "15% 50%",
            opacity: showPostExecution ? 0.4 : 1,
            filter: showPostExecution ? "blur(1px) brightness(0.6)" : "none",
            pointerEvents: showPostExecution ? "none" : "auto",
          }}
        >
          {/* Atmospheric blue center glow — intensifies during execution */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 0,
              background: isExecuting
                ? 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(79,138,255,0.10) 0%, transparent 70%)'
                : 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(79,138,255,0.04) 0%, transparent 70%)',
              transition: 'background 1s ease',
            }}
          />
          {/* Edge vignette — darkens corners for cinematic depth */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 0,
              background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.5) 100%)',
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
              style: { stroke: "#4F8AFF", strokeWidth: 2 },
            }}
            minZoom={0.15}
            maxZoom={2.5}
            snapToGrid
            snapGrid={[16, 16]}
            connectionLineStyle={{
              stroke: "#4F8AFF",
              strokeWidth: 2,
              strokeDasharray: "6 4",
              opacity: 0.7,
            }}
            style={{
              background: [
                'linear-gradient(rgba(79,138,255,0.03) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(79,138,255,0.03) 1px, transparent 1px)',
                'linear-gradient(rgba(79,138,255,0.015) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(79,138,255,0.015) 1px, transparent 1px)',
                '#07070e',
              ].join(', '),
              backgroundSize: '100px 100px, 100px 100px, 20px 20px, 20px 20px',
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
              maskColor="rgba(10,10,15,0.7)"
              className="canvas-minimap"
              style={{
                width: 120,
                height: 80,
                backgroundColor: "rgba(18,18,26,0.85)",
                border: "1px solid rgba(255,255,255,0.04)",
                borderRadius: 8,
                marginBottom: 16,
                marginLeft: 16,
                opacity: 0.4,
                transition: "opacity 0.3s ease",
              }}
            />
          </ReactFlow>

          {/* Atmospheric blue glow — enhanced */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 1,
              background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(79,138,255,0.05) 0%, transparent 70%)',
            }}
          />

          {/* Vignette overlay — deeper */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 1,
              background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 100%)',
            }}
          />

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

          {/* Empty state (outside ReactFlow for proper centering + AnimatePresence) */}
          <AnimatePresence>
            {nodes.length === 0 && (
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

        </div>

        {/* Post-execution 3D scene — overlays right 70% of canvas */}
        <AnimatePresence>
          {showPostExecution && !isExecuting && postExecData && (
            <motion.div
              key="post-exec-scene"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.5 } }}
              transition={{ duration: 0.8, delay: 1.0 }}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: "70%",
                zIndex: 15,
              }}
            >
              <PostExecutionScene
                rooms={postExecData.rooms}
                kpis={postExecData.kpis}
                buildingDescription={postExecData.description}
                buildingName={postExecData.buildingName}
                onClose={handleClosePostExecution}
                onGeneratePDF={handleGeneratePDF}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* AI Chat Panel — floats on right edge */}
        <AIChatPanel
          messages={chatMessages}
          onAddMessage={(msg) => setChatMessages(prev => [...prev, msg])}
          onClear={() => setChatMessages([])}
          isOpen={isChatOpen}
          onToggle={() => setIsChatOpen(o => !o)}
        />

        {/* Artifact results panel removed — replaced by PostExecutionScene */}

        {/* Execution complete celebration modal */}
        <ExecutionCompleteModal
          workflowName={workflowName}
          nodeCount={storeNodes.length}
          artifactCount={artifacts.size}
          durationText={durationText}
          onViewResults={() => {
            /* PostExecutionScene handles results display */
          }}
        />
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
