"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, X, MessageSquare, Trash2 } from "lucide-react";
import { useWorkflowStore } from "@/stores/workflow-store";
import { NODE_CATALOGUE_MAP } from "@/constants/node-catalogue";
import type { WorkflowNodeData, NodeCategory } from "@/types/nodes";
import type { WorkflowNode } from "@/types/nodes";
import { generateId } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: Date;
}

// ─── Node catalogue helpers ───────────────────────────────────────────────────

function fuzzyFindNode(text: string) {
  const lower = text.toLowerCase();
  for (const [, node] of NODE_CATALOGUE_MAP) {
    if (lower.includes(node.name.toLowerCase()) || lower.includes(node.id.toLowerCase())) {
      return node;
    }
  }
  // Partial match
  for (const [, node] of NODE_CATALOGUE_MAP) {
    const words = node.name.toLowerCase().split(" ");
    if (words.some(w => w.length > 3 && lower.includes(w))) {
      return node;
    }
  }
  return null;
}

// ─── Message parsing ──────────────────────────────────────────────────────────

function parseAndExecute(
  message: string,
  nodes: WorkflowNode[],
  addNode: (n: WorkflowNode) => void,
  addEdge: ReturnType<typeof useWorkflowStore.getState>["addEdge"],
  removeNode: (id: string) => void,
): string {
  const lower = message.toLowerCase();

  // ADD
  if (/\b(add|include|insert|append|put)\b/.test(lower)) {
    const found = fuzzyFindNode(message);
    if (!found) return "I couldn't find that node. Try something like: \"Add IFC Exporter at the end\".";

    const lastNode = nodes[nodes.length - 1];
    const x = lastNode ? lastNode.position.x + 260 : 300;
    const y = lastNode ? lastNode.position.y : 200;

    const COLORS: Record<NodeCategory, string> = {
      input: "#3B82F6", transform: "#8B5CF6", generate: "#10B981", export: "#F59E0B",
    };

    const newNode: WorkflowNode = {
      id: `${found.id}-${generateId()}`,
      type: "workflowNode",
      position: { x, y },
      data: {
        catalogueId: found.id,
        label: found.name,
        category: found.category as NodeCategory,
        status: "idle",
        inputs: found.inputs,
        outputs: found.outputs,
        icon: found.icon,
        executionTime: found.executionTime,
      } satisfies WorkflowNodeData,
    };
    addNode(newNode);

    if (lastNode) {
      addEdge({
        id: `e${lastNode.id}-${newNode.id}`,
        source: lastNode.id,
        sourceHandle: lastNode.data.outputs[0]?.id ?? "output",
        target: newNode.id,
        targetHandle: newNode.data.inputs[0]?.id ?? "input",
        type: "animatedEdge",
        data: {
          sourceColor: COLORS[lastNode.data.category as NodeCategory] ?? "#4F8AFF",
          targetColor: COLORS[found.category as NodeCategory] ?? "#4F8AFF",
        },
      });
    }

    return `Added **${found.name}** to your workflow. It ${
      found.inputs.length > 0 ? `takes ${found.inputs.map(i => i.label).join(", ")} as input` : "starts a new chain"
    } and produces ${found.outputs.map(o => o.label).join(", ")}.`;
  }

  // REMOVE
  if (/\b(remove|delete|drop|take out)\b/.test(lower)) {
    const found = fuzzyFindNode(message);
    if (!found) return "I couldn't find that node to remove. Try: \"Remove the Image Generator\".";
    const nodeToRemove = nodes.find(n => n.data.catalogueId === found.id);
    if (!nodeToRemove) return `I don't see **${found.name}** on the canvas right now.`;
    removeNode(nodeToRemove.id);
    return `Removed **${found.name}** from your workflow.`;
  }

  // EXPLAIN
  if (/\b(explain|what does|how|describe)\b/.test(lower)) {
    if (nodes.length === 0) return "Your canvas is empty. Add some nodes first!";
    const lines = nodes.map(n => `• **${n.data.label}** — processes ${
      n.data.inputs.length > 0 ? n.data.inputs.map(i => i.label).join(", ") : "no input"
    } → produces ${
      n.data.outputs.length > 0 ? n.data.outputs.map(o => o.label).join(", ") : "no output"
    }`);
    return `Your current workflow has ${nodes.length} nodes:\n${lines.join("\n")}`;
  }

  // FALLBACK
  return `I can **add**, **remove**, or **explain** nodes. Try:\n• "Add IFC Exporter at the end"\n• "Remove the Image Generator"\n• "Explain my workflow"`;
}

// ─── Markdown-ish renderer ────────────────────────────────────────────────────

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

// ─── Panel ────────────────────────────────────────────────────────────────────

interface AIChatPanelProps {
  messages: ChatMessage[];
  onAddMessage: (msg: ChatMessage) => void;
  onClear: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function AIChatPanel({ messages, onAddMessage, onClear, isOpen, onToggle }: AIChatPanelProps) {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { nodes, addNode, addEdge, removeNode } = useWorkflowStore();

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: generateId(), role: "user", content: text, timestamp: new Date(),
    };
    onAddMessage(userMsg);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      const reply = parseAndExecute(text, nodes, addNode, addEdge, removeNode);
      const aiMsg: ChatMessage = {
        id: generateId(), role: "ai", content: reply, timestamp: new Date(),
      };
      onAddMessage(aiMsg);
      setIsTyping(false);
      toast.success("Workflow updated", { duration: 1500 });
    }, 400);
  }, [input, nodes, addNode, addEdge, removeNode, onAddMessage]);

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
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            onClick={onToggle}
            style={{
              position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
              zIndex: 25, padding: "10px 8px",
              background: "#12121E", border: "1px solid rgba(255,255,255,0.08)",
              borderRight: "none",
              borderRadius: "8px 0 0 8px",
              cursor: "pointer", color: "#8888A0",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              boxShadow: "-4px 0 16px rgba(0,0,0,0.3)",
            }}
            onMouseEnter={e => { (e.currentTarget).style.color = "#4F8AFF"; }}
            onMouseLeave={e => { (e.currentTarget).style.color = "#8888A0"; }}
          >
            <Sparkles size={14} />
            <span style={{
              fontSize: 9, fontWeight: 600, writingMode: "vertical-rl",
              textOrientation: "mixed", letterSpacing: 1,
            }}>AI CHAT</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: 380, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 380, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            style={{
              position: "absolute", right: 0, top: 0, bottom: 0, width: 360, zIndex: 25,
              background: "#12121E", borderLeft: "1px solid rgba(255,255,255,0.06)",
              display: "flex", flexDirection: "column",
              boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)",
              display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
            }}>
              <Sparkles size={14} style={{ color: "#4F8AFF" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F5", flex: 1 }}>
                AI Assistant
              </span>
              <button
                onClick={onClear}
                title="Clear chat"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#3A3A50", padding: 4, borderRadius: 4,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#5C5C78"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
              >
                <Trash2 size={12} />
              </button>
              <button
                onClick={onToggle}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#3A3A50", padding: 4, borderRadius: 4,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#3A3A50"; }}
              >
                <X size={13} />
              </button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.length === 0 && (
                <div style={{
                  textAlign: "center", padding: "32px 16px",
                  color: "#3A3A50", fontSize: 12,
                }}>
                  <MessageSquare size={28} style={{ margin: "0 auto 10px", opacity: 0.3 }} />
                  <div style={{ fontWeight: 600, color: "#5C5C78", marginBottom: 6 }}>AI Workflow Assistant</div>
                  <div style={{ lineHeight: 1.5 }}>
                    Tell me what to change:<br />
                    • &ldquo;Add an IFC Exporter&rdquo;<br />
                    • &ldquo;Remove the Image Generator&rdquo;<br />
                    • &ldquo;Explain my workflow&rdquo;
                  </div>
                </div>
              )}

              {messages.map(msg => (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                    gap: 2,
                  }}
                >
                  <div style={{
                    maxWidth: "85%", padding: "8px 11px", borderRadius: 10,
                    background: msg.role === "user"
                      ? "rgba(79,138,255,0.14)"
                      : "rgba(255,255,255,0.04)",
                    border: msg.role === "user"
                      ? "1px solid rgba(79,138,255,0.25)"
                      : "1px solid rgba(255,255,255,0.06)",
                    fontSize: 12, color: "#C0C0D0", lineHeight: 1.5,
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
                  background: "rgba(255,255,255,0.04)", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.06)",
                  width: "fit-content",
                }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 5, height: 5, borderRadius: "50%", background: "#5C5C78",
                      animation: `dotPulse 1s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
              display: "flex", gap: 8, alignItems: "flex-end",
            }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); e.stopPropagation(); }}
                onKeyDown={onKeyDown}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                placeholder="Modify your workflow…"
                rows={2}
                style={{
                  flex: 1, resize: "none", padding: "7px 9px",
                  borderRadius: 7, border: "1px solid rgba(255,255,255,0.06)",
                  background: "#0B0B13", color: "#C0C0D0",
                  fontSize: 12, fontFamily: "inherit", outline: "none",
                  lineHeight: 1.5, maxHeight: 80, overflowY: "auto",
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                style={{
                  width: 32, height: 32, borderRadius: 7, border: "none",
                  background: input.trim() ? "#4F8AFF" : "rgba(255,255,255,0.06)",
                  color: input.trim() ? "#fff" : "#3A3A50",
                  cursor: input.trim() ? "pointer" : "default",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "all 0.15s",
                }}
              >
                <Send size={13} />
              </button>
            </div>
            <div style={{ padding: "0 14px 8px", fontSize: 9, color: "rgba(255,255,255,0.08)" }}>
              Enter to send · Shift+Enter for new line
            </div>
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
