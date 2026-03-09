"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, X, MessageSquare, Trash2, Zap } from "lucide-react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { NODE_CATALOGUE_MAP } from "@/constants/node-catalogue";
import type { WorkflowNodeData, NodeCategory } from "@/types/nodes";
import type { WorkflowNode } from "@/types/nodes";
import { generateId } from "@/lib/utils";
import { toast } from "sonner";
import { processWorkflowChat } from "@/services/ai-chat-service";
import type { ChatAction } from "@/services/ai-chat-service";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: Date;
}

import { CATEGORY_COLORS } from "@/lib/ui-constants";

// ─── Constants ───────────────────────────────────────────────────────────────

const COLORS = CATEGORY_COLORS;

// ─── Node catalogue helpers (keyword fallback) ───────────────────────────────

function fuzzyFindNode(text: string) {
  const lower = text.toLowerCase();
  for (const [, node] of NODE_CATALOGUE_MAP) {
    if (lower.includes(node.name.toLowerCase()) || lower.includes(node.id.toLowerCase())) {
      return node;
    }
  }
  for (const [, node] of NODE_CATALOGUE_MAP) {
    const words = node.name.toLowerCase().split(" ");
    if (words.some(w => w.length > 3 && lower.includes(w))) {
      return node;
    }
  }
  return null;
}

function keywordFallback(
  message: string,
  nodes: WorkflowNode[],
  addNode: (n: WorkflowNode) => void,
  addEdge: ReturnType<typeof useWorkflowStore.getState>["addEdge"],
  removeNode: (id: string) => void,
  t: (key: TranslationKey) => string,
): string {
  const lower = message.toLowerCase();

  if (/\b(add|include|insert|append|put)\b/.test(lower)) {
    const found = fuzzyFindNode(message);
    if (!found) return t('aiChat.nodeNotFound');
    const lastNode = nodes[nodes.length - 1];
    const x = lastNode ? lastNode.position.x + 260 : 300;
    const y = lastNode ? lastNode.position.y : 200;
    const newNode: WorkflowNode = {
      id: `${found.id}-${generateId()}`, type: "workflowNode",
      position: { x, y },
      data: {
        catalogueId: found.id, label: found.name, category: found.category as NodeCategory,
        status: "idle", inputs: found.inputs, outputs: found.outputs,
        icon: found.icon, executionTime: found.executionTime,
      } satisfies WorkflowNodeData,
    };
    addNode(newNode);
    if (lastNode) {
      addEdge({
        id: `e${lastNode.id}-${newNode.id}`, source: lastNode.id,
        sourceHandle: lastNode.data.outputs[0]?.id ?? "output",
        target: newNode.id, targetHandle: newNode.data.inputs[0]?.id ?? "input",
        type: "animatedEdge",
        data: { sourceColor: COLORS[lastNode.data.category as NodeCategory] ?? "#00F5FF", targetColor: COLORS[found.category as NodeCategory] ?? "#00F5FF" },
      });
    }
    return `Added **${found.name}** to your workflow.`;
  }

  if (/\b(remove|delete|drop|take out)\b/.test(lower)) {
    const found = fuzzyFindNode(message);
    if (!found) return t('aiChat.nodeNotFoundRemove');
    const nodeToRemove = nodes.find(n => n.data.catalogueId === found.id);
    if (!nodeToRemove) return `**${found.name}** is not on the canvas.`;
    removeNode(nodeToRemove.id);
    return `Removed **${found.name}** from your workflow.`;
  }

  if (/\b(explain|what does|how|describe)\b/.test(lower)) {
    if (nodes.length === 0) return t('aiChat.canvasEmpty');
    const lines = nodes.map(n => `• **${n.data.label}** — ${n.data.inputs.length > 0 ? n.data.inputs.map(i => i.label).join(", ") : "no input"} → ${n.data.outputs.length > 0 ? n.data.outputs.map(o => o.label).join(", ") : "no output"}`);
    return `Your workflow has ${nodes.length} nodes:\n${lines.join("\n")}`;
  }

  return "";
}

// ─── Apply AI actions to canvas ──────────────────────────────────────────────

function applyActions(
  actions: ChatAction[],
  nodes: WorkflowNode[],
  addNode: (n: WorkflowNode) => void,
  addEdge: ReturnType<typeof useWorkflowStore.getState>["addEdge"],
  removeNode: (id: string) => void,
) {
  let changeCount = 0;

  for (const action of actions) {
    if (action.type === "add" && action.nodeId) {
      const catalogueNode = NODE_CATALOGUE_MAP.get(action.nodeId);
      if (!catalogueNode) continue;

      // Find connection source
      const connectFrom = action.connectFrom
        ? nodes.find(n => n.data.catalogueId === action.connectFrom)
        : nodes[nodes.length - 1];

      const x = connectFrom ? connectFrom.position.x + 260 : 300;
      const y = connectFrom ? connectFrom.position.y : 200;

      const newNode: WorkflowNode = {
        id: `${catalogueNode.id}-${generateId()}`, type: "workflowNode",
        position: { x, y },
        data: {
          catalogueId: catalogueNode.id, label: catalogueNode.name,
          category: catalogueNode.category as NodeCategory, status: "idle",
          inputs: catalogueNode.inputs, outputs: catalogueNode.outputs,
          icon: catalogueNode.icon, executionTime: catalogueNode.executionTime,
        } satisfies WorkflowNodeData,
      };
      addNode(newNode);

      if (connectFrom) {
        addEdge({
          id: `e${connectFrom.id}-${newNode.id}`, source: connectFrom.id,
          sourceHandle: connectFrom.data.outputs[0]?.id ?? "output",
          target: newNode.id, targetHandle: newNode.data.inputs[0]?.id ?? "input",
          type: "animatedEdge",
          data: {
            sourceColor: COLORS[connectFrom.data.category as NodeCategory] ?? "#00F5FF",
            targetColor: COLORS[catalogueNode.category as NodeCategory] ?? "#00F5FF",
          },
        });
      }
      // Track new node so subsequent actions can reference it
      nodes = [...nodes, newNode];
      changeCount++;
    }

    if (action.type === "remove" && action.nodeId) {
      const target = nodes.find(n => n.data.catalogueId === action.nodeId);
      if (target) {
        removeNode(target.id);
        nodes = nodes.filter(n => n.id !== target.id);
        changeCount++;
      }
    }

    if (action.type === "replace" && action.oldNodeId && action.newNodeId) {
      const oldNode = nodes.find(n => n.data.catalogueId === action.oldNodeId);
      const newCat = NODE_CATALOGUE_MAP.get(action.newNodeId);
      if (oldNode && newCat) {
        // Add replacement at same position
        const replacement: WorkflowNode = {
          id: `${newCat.id}-${generateId()}`, type: "workflowNode",
          position: { ...oldNode.position },
          data: {
            catalogueId: newCat.id, label: newCat.name,
            category: newCat.category as NodeCategory, status: "idle",
            inputs: newCat.inputs, outputs: newCat.outputs,
            icon: newCat.icon, executionTime: newCat.executionTime,
          } satisfies WorkflowNodeData,
        };
        addNode(replacement);
        removeNode(oldNode.id);
        nodes = [...nodes.filter(n => n.id !== oldNode.id), replacement];
        changeCount++;
      }
    }
  }

  return changeCount;
}

// ─── Markdown-ish renderer ───────────────────────────────────────────────────

function renderMessage(text: string) {
  return text.split("\n").map((line, i) => (
    <React.Fragment key={i}>
      {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={j} style={{ color: "#F0F0F5" }}>{part.slice(2, -2)}</strong>
          : part
      )}
      {i < text.split("\n").length - 1 && <br />}
    </React.Fragment>
  ));
}

// ─── Panel ───────────────────────────────────────────────────────────────────

interface AIChatPanelProps {
  messages: ChatMessage[];
  onAddMessage: (msg: ChatMessage) => void;
  onClear: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function AIChatPanel({ messages, onAddMessage, onClear, isOpen, onToggle }: AIChatPanelProps) {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [aiMode, setAiMode] = useState<"gpt" | "keyword">("gpt");

  // Draggable state
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const onDragHeaderDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, ox: dragOffset.x, oy: dragOffset.y };
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      setDragOffset({
        x: dragStart.current.ox + (ev.clientX - dragStart.current.x),
        y: dragStart.current.oy + (ev.clientY - dragStart.current.y),
      });
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [dragOffset]);

  const { nodes, edges, addNode, addEdge, removeNode } = useWorkflowStore();

  useEffect(() => {
    if (isOpen && !minimized) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen, minimized]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMsg: ChatMessage = {
      id: generateId(), role: "user", content: text, timestamp: new Date(),
    };
    onAddMessage(userMsg);
    setInput("");
    setIsTyping(true);

    let replyText = "";

    if (aiMode === "gpt") {
      try {
        // Build node/edge summaries for the AI
        const nodeSummaries = nodes.map(n => ({
          instanceId: n.id,
          catalogueId: n.data.catalogueId,
          label: n.data.label,
        }));
        const edgeSummaries = edges.map(e => ({
          source: e.source,
          target: e.target,
        }));

        const response = await processWorkflowChat(text, nodeSummaries, edgeSummaries);
        replyText = response.message;

        // Apply actions if any
        if (response.actions.length > 0) {
          const count = applyActions(response.actions, [...nodes], addNode, addEdge, removeNode);
          if (count > 0) {
            toast.success(`Workflow updated (${count} change${count > 1 ? "s" : ""})`, { duration: 2000 });
          }
        }
      } catch {
        // Fallback to keyword matching
        replyText = keywordFallback(text, nodes, addNode, addEdge, removeNode, t);
        if (!replyText) {
          replyText = t('aiChat.connectionError');
        }
      }
    } else {
      // Keyword mode
      replyText = keywordFallback(text, nodes, addNode, addEdge, removeNode, t);
      if (!replyText) {
        replyText = t('aiChat.helpText');
      }
    }

    const aiMsg: ChatMessage = {
      id: generateId(), role: "ai", content: replyText, timestamp: new Date(),
    };
    onAddMessage(aiMsg);
    setIsTyping(false);
  }, [input, isTyping, nodes, edges, addNode, addEdge, removeNode, onAddMessage, aiMode, t]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <>
      {/* Floating pill when closed */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={onToggle}
            style={{
              position: "absolute", right: 20, bottom: 20,
              zIndex: 25, padding: "10px 16px",
              background: "rgba(7,8,9,0.92)", border: "1px solid rgba(0,245,255,0.2)",
              borderRadius: 4,
              cursor: "pointer", color: "#00F5FF",
              display: "flex", alignItems: "center", gap: 8,
              boxShadow: "0 4px 20px rgba(0,0,0,0.4), 0 0 15px rgba(0,245,255,0.08)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,245,255,0.4)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.5), 0 0 25px rgba(0,245,255,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(0,245,255,0.2)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4), 0 0 15px rgba(0,245,255,0.08)"; }}
          >
            <Sparkles size={14} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('aiChat.title')}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Floating chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            style={{
              position: "fixed",
              bottom: 20,
              right: 20,
              width: 380,
              height: minimized ? "auto" : 500,
              zIndex: 55,
              background: "rgba(7,8,9,0.95)",
              backdropFilter: "blur(12px) saturate(1.1)",
              WebkitBackdropFilter: "blur(12px) saturate(1.1)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4,
              display: "flex", flexDirection: "column",
              boxShadow: "0 16px 48px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.04) inset",
              overflow: "hidden",
              transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
            }}
          >
            {/* Draggable header */}
            <div
              onMouseDown={onDragHeaderDown}
              style={{
                height: 44, padding: "0 14px",
                borderBottom: minimized ? "none" : "1px solid rgba(255,255,255,0.06)",
                display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
                cursor: "grab", userSelect: "none",
              }}
            >
              <Sparkles size={13} style={{ color: "#00F5FF" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", flex: 1 }}>
                {t('aiChat.aiAssistant')}
              </span>
              <button
                onClick={() => setAiMode(m => m === "gpt" ? "keyword" : "gpt")}
                title={aiMode === "gpt" ? t('aiChat.usingGpt') : t('aiChat.usingKeyword')}
                style={{
                  background: aiMode === "gpt" ? "rgba(0,245,255,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${aiMode === "gpt" ? "rgba(0,245,255,0.3)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: 5, padding: "2px 6px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 3,
                  color: aiMode === "gpt" ? "#00F5FF" : "#5C5C78",
                  fontSize: 10, fontWeight: 600,
                }}
                onMouseDown={e => e.stopPropagation()}
              >
                <Zap size={10} />
                {aiMode === "gpt" ? t('aiChat.gpt') : t('aiChat.basic')}
              </button>
              <button onClick={onClear} title={t('aiChat.clearChat')} style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#3A3A50", padding: 4, borderRadius: 4,
              }} onMouseDown={e => e.stopPropagation()}
                onMouseEnter={e => { e.currentTarget.style.color = "#5C5C78"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
              >
                <Trash2 size={11} />
              </button>
              <button onClick={() => setMinimized(m => !m)} style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#3A3A50", padding: 4, borderRadius: 4,
                fontSize: 14, lineHeight: 1,
              }} onMouseDown={e => e.stopPropagation()}
                onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
              >
                {minimized ? "+" : "−"}
              </button>
              <button onClick={onToggle} style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#3A3A50", padding: 4, borderRadius: 4,
              }} onMouseDown={e => e.stopPropagation()}
                onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
              >
                <X size={12} />
              </button>
            </div>

            {/* Collapsible body */}
            {!minimized && (
              <>
                {/* Messages */}
                <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {messages.length === 0 && (
                    <div style={{
                      textAlign: "center", padding: "28px 14px",
                      color: "#3A3A50", fontSize: 11,
                    }}>
                      <MessageSquare size={24} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
                      <div style={{ fontWeight: 600, color: "#5C5C78", marginBottom: 6 }}>
                        {aiMode === "gpt" ? t('aiChat.gptPowered') : t('aiChat.workflowAssistant')}
                      </div>
                      <div style={{ lineHeight: 1.5 }}>
                        {aiMode === "gpt" ? (
                          <>
                            {t('aiChat.askAnything')}<br />
                            • &ldquo;{t('aiChat.suggestAddCost')}&rdquo;<br />
                            • &ldquo;{t('aiChat.suggestExplain')}&rdquo;<br />
                            • &ldquo;{t('aiChat.suggestReplace')}&rdquo;
                          </>
                        ) : (
                          <>
                            {t('aiChat.tellMeWhatToChange')}<br />
                            • &ldquo;{t('aiChat.suggestAddIfc')}&rdquo;<br />
                            • &ldquo;{t('aiChat.suggestRemoveImg')}&rdquo;
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {messages.map(msg => (
                    <div key={msg.id} style={{
                      display: "flex", flexDirection: "column",
                      alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 2,
                    }}>
                      <div style={{
                        maxWidth: "85%", padding: "10px 14px",
                        borderRadius: 4,
                        ...(msg.role === "user"
                          ? { borderBottomRightRadius: 2, background: "rgba(0,245,255,0.12)", border: "1px solid rgba(0,245,255,0.1)" }
                          : { borderBottomLeftRadius: 2, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }
                        ),
                        fontSize: 12, color: msg.role === "user" ? "#F0F0F5" : "#9898B0", lineHeight: 1.6,
                      }}>
                        {renderMessage(msg.content)}
                      </div>
                      <span style={{ fontSize: 9, color: "#3A3A50" }}>
                        {msg.timestamp.toTimeString().slice(0, 5)}
                      </span>
                    </div>
                  ))}

                  {isTyping && (
                    <div style={{
                      display: "flex", gap: 4, padding: "8px 11px",
                      background: "rgba(255,255,255,0.03)", borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.04)",
                      width: "fit-content",
                    }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{
                          width: 4, height: 4, borderRadius: "50%", background: "#5C5C78",
                          animation: `dotPulse 1s ease-in-out ${i * 0.2}s infinite`,
                        }} />
                      ))}
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Input */}
                <div style={{
                  padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
                  display: "flex", gap: 8, alignItems: "flex-end",
                }}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => { setInput(e.target.value); e.stopPropagation(); }}
                    onKeyDown={onKeyDown}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => e.stopPropagation()}
                    placeholder={t('aiChat.placeholder')}
                    rows={2}
                    style={{
                      flex: 1, resize: "none", padding: "10px 14px",
                      borderRadius: 4, border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.03)", color: "#F0F0F5",
                      fontSize: 13, fontFamily: "inherit", outline: "none",
                      lineHeight: 1.5, maxHeight: 80, overflowY: "auto",
                      transition: "all 150ms ease",
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isTyping}
                    style={{
                      width: 32, height: 32, borderRadius: 8, border: "none",
                      background: input.trim() && !isTyping ? "#00F5FF" : "rgba(255,255,255,0.06)",
                      color: input.trim() && !isTyping ? "#fff" : "#3A3A50",
                      cursor: input.trim() && !isTyping ? "pointer" : "default",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, transition: "all 0.15s",
                    }}
                  >
                    <Send size={13} />
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}

export type { ChatMessage };
