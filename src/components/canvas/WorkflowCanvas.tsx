"use client";

import React, { useCallback, useRef, useState } from "react";
import { useExecution } from "@/hooks/useExecution";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
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
import { Layers3, Sparkles, BookOpen, X, FileDown } from "lucide-react";

import dynamic from "next/dynamic";
import { BaseNode } from "./nodes/BaseNode";
import { AnimatedEdge } from "./edges/AnimatedEdge";
import { NodeLibraryPanel } from "./panels/NodeLibraryPanel";
import { CanvasToolbar } from "./toolbar/CanvasToolbar";
import { ArtifactCard } from "./artifacts/ArtifactCard";
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

import { useWorkflowStore } from "@/stores/workflow-store";
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
            Example AEC Pipeline
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
    updateNode,
    addEdge: addStoreEdge,
    resetCanvas,
    isDirty,
    isSaving,
    markDirty,
    setCreationMode,
    saveWorkflow,
    undo,
    redo,
  } = useWorkflowStore();

  const { artifacts, executionProgress, removeArtifact, clearArtifacts } = useExecutionStore();
  const { isNodeLibraryOpen, setPromptModeActive, isPromptModeActive, toggleNodeLibrary, isDemoMode } = useUIStore();

  // Chat / execution log state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const addLogEntry = useCallback((entry: LogEntry) => {
    setLogEntries(prev => [...prev, entry]);
    setShowLog(true);
  }, []);

  const { runWorkflow, isExecuting } = useExecution({ onLog: addLogEntry });

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes as unknown as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges as Edge[]);

  React.useEffect(() => { setNodes(storeNodes as unknown as Node[]); }, [storeNodes, setNodes]);
  React.useEffect(() => { setEdges(storeEdges as Edge[]); }, [storeEdges, setEdges]);

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
    toast.success(`Duplicated: ${node.data.label}`, { duration: 2000 });
  }, [storeNodes, addNode]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    const node = storeNodes.find(n => n.id === nodeId);
    removeNode(nodeId);
    toast.success(`Deleted: ${node?.data.label ?? "Node"}`, { duration: 2000 });
  }, [storeNodes, removeNode]);

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
    (changes: Parameters<typeof onEdgesChange>[0]) => { onEdgesChange(changes); markDirty(); },
    [onEdgesChange, markDirty]
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
      toast.error("Please provide input for all input nodes before running the workflow.", { duration: 4000 });
      return;
    }
    if (nodes.length === 0) {
      toast.error("Add nodes to your workflow first.", { duration: 3000 });
      return;
    }
    await runWorkflow();
  }, [runWorkflow, nodes]);
  const handleSave = useCallback(async () => {
    if (isDemoMode) {
      toast.info("Create a free account to save workflows", { duration: 3000 });
      return;
    }
    const id = await saveWorkflow();
    if (id) {
      toast.success("Workflow saved", { duration: 2000 });
    } else {
      toast.error("Save failed — check your connection");
    }
  }, [saveWorkflow, isDemoMode]);
  const handleShare = useCallback(() => { toast.info("Share feature coming soon", { duration: 2000 }); }, []);

  const { t: tLocale } = useLocale();
  const workflowName = currentWorkflow?.name ?? tLocale('canvas.untitledWorkflow');

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

      {/* Node Library Panel */}
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
              currentWorkflow.name = newName;
              markDirty();
              await saveWorkflow(newName);
              toast.success(`Workflow renamed to "${newName}"`, { duration: 2000 });
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
                position: "absolute", top: 52, left: 0, right: 0, height: 2, zIndex: 11,
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

        {/* React Flow */}
        <div className="absolute inset-0 pt-13">
          {/* Atmospheric blue center glow — rendered before ReactFlow for depth */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 0,
              background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(79,138,255,0.04) 0%, transparent 70%)',
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
            fitViewOptions={{ padding: 0.2 }}
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
            style={{ background: "#07070D" }}
          >
            {/* Dot grid — refined spacing and brightness */}
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="rgba(255,255,255,0.035)"
            />

            {/* Styled controls — bottom-right, above minimap */}
            <Controls
              position="bottom-right"
              style={{ marginBottom: 124, marginRight: 16 }}
            />

            {/* Styled minimap */}
            <MiniMap
              position="bottom-right"
              nodeStrokeWidth={0}
              nodeColor={(n) => {
                const d = n.data as WorkflowNodeData;
                const cfg = CATEGORY_CONFIG[d?.category as NodeCategory];
                return cfg?.color ?? "rgba(255,255,255,0.08)";
              }}
              maskColor="rgba(10,10,15,0.65)"
              style={{
                width: 160,
                height: 100,
                backgroundColor: "rgba(18,18,26,0.92)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 8,
                marginBottom: 16,
                marginRight: 16,
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

          {/* Execution log — slides up from bottom */}
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

        {/* AI Chat Panel — floats on right edge */}
        <AIChatPanel
          messages={chatMessages}
          onAddMessage={(msg) => setChatMessages(prev => [...prev, msg])}
          onClear={() => setChatMessages([])}
          isOpen={isChatOpen}
          onToggle={() => setIsChatOpen(o => !o)}
        />

        {/* Artifact results panel */}
        <AnimatePresence>
          {artifacts.size > 0 && (
            <motion.div
              key="artifact-panel"
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              style={{
                position: "absolute", bottom: 16, right: 16, zIndex: 20,
                width: 320,
                maxHeight: "calc(100vh - 100px)",
                display: "flex", flexDirection: "column",
                background: "rgba(8, 8, 16, 0.92)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
                overflow: "hidden",
                backdropFilter: "blur(32px) saturate(1.3)",
                WebkitBackdropFilter: "blur(32px) saturate(1.3)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              {/* Panel header */}
              <div style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "10px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#F0F0F5", flex: 1 }}>
                  Execution Results
                </span>
                <span style={{
                  padding: "1px 6px", borderRadius: 10,
                  background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
                  fontSize: 10, fontWeight: 600, color: "#10B981",
                }}>
                  {artifacts.size}
                </span>
                <button
                  onClick={async () => {
                    const { generatePDFReport } = await import("@/services/pdf-report");
                    const labels = new Map<string, string>();
                    storeNodes.forEach(n => labels.set(n.id, n.data.label));
                    await generatePDFReport({
                      workflowName: workflowName,
                      artifacts,
                      nodeLabels: labels,
                    });
                    toast.success("PDF report downloaded", { duration: 2000 });
                  }}
                  title="Download PDF report"
                  style={{
                    width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                    background: "transparent", border: "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#3A3A50", cursor: "pointer",
                    transition: "color 0.1s ease",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#4F8AFF"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
                >
                  <FileDown size={12} />
                </button>
                <button
                  onClick={clearArtifacts}
                  title="Clear all results"
                  style={{
                    width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                    background: "transparent", border: "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#3A3A50", cursor: "pointer",
                    transition: "color 0.1s ease",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#EF4444"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
                >
                  <X size={12} />
                </button>
              </div>

              {/* Scrollable card list */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                <AnimatePresence initial={false}>
                  {Array.from(artifacts.entries()).map(([tileId, artifact]) => {
                    const node = storeNodes.find(n => n.id === tileId);
                    return (
                      <ArtifactCard
                        key={tileId}
                        artifact={artifact}
                        nodeLabel={node?.data.label}
                        nodeCategory={node?.data.category}
                        onDismiss={() => removeArtifact(tileId)}
                      />
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
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
