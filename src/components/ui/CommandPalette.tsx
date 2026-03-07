"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Search, Zap, BookOpen, Workflow, ArrowRight,
  LayoutDashboard, Settings, Play, RotateCcw, Plus, Terminal,
} from "lucide-react";
import type { ComponentType } from "react";
import * as LucideIcons from "lucide-react";
import { NODE_CATALOGUE } from "@/constants/node-catalogue";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useExecution } from "@/hooks/useExecution";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  keywords?: string;
  action: () => void;
}

interface CommandSection {
  id: string;
  label: string;
  items: CommandItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  input:     "#3B82F6",
  transform: "#8B5CF6",
  generate:  "#10B981",
  export:    "#F59E0B",
};

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

function matches(item: CommandItem, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  return (
    item.label.toLowerCase().includes(lq) ||
    (item.description?.toLowerCase().includes(lq) ?? false) ||
    (item.keywords?.toLowerCase().includes(lq) ?? false) ||
    (item.badge?.toLowerCase().includes(lq) ?? false)
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const [selected, setSelected] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  const router = useRouter();
  const { resetCanvas, loadFromTemplate } = useWorkflowStore();
  const { runWorkflow } = useExecution();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  // ── Global Cmd/Ctrl+K listener ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(v => !v);
        setSelected(0);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── Focus input when opened ────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ── Build sections ─────────────────────────────────────────────────────────
  const sections = useMemo<CommandSection[]>(() => {
    const q = query.trim();

    const navItems: CommandItem[] = [
      { id: "nav-dashboard",  label: "Dashboard",    description: "Go to dashboard home",        icon: <LayoutDashboard size={14} />, action: () => { router.push("/dashboard");              close(); } },
      { id: "nav-canvas",     label: "Canvas",       description: "Open workflow canvas",        icon: <Zap size={14} />,             action: () => { router.push("/dashboard/canvas");       close(); } },
      { id: "nav-workflows",  label: "My Workflows", description: "View all your workflows",     icon: <Workflow size={14} />,        action: () => { router.push("/dashboard/workflows");    close(); } },
      { id: "nav-templates",  label: "Templates",    description: "Browse prebuilt templates",   icon: <BookOpen size={14} />,        action: () => { router.push("/dashboard/templates");    close(); } },
      { id: "nav-settings",   label: "Settings",     description: "Account and plan settings",   icon: <Settings size={14} />,        action: () => { router.push("/dashboard/settings");     close(); } },
    ];

    const actionItems: CommandItem[] = [
      {
        id: "act-new",   label: "New Workflow",  description: "Create a new workflow",
        icon: <Plus size={14} />, badge: "⌘N",
        action: () => { router.push("/dashboard/workflows/new"); close(); },
      },
      {
        id: "act-run",   label: "Run Workflow",  description: "Execute the current workflow",
        icon: <Play size={14} />, badge: "⌘↵",
        action: () => { runWorkflow(); close(); },
      },
      {
        id: "act-reset", label: "Clear Canvas",  description: "Remove all nodes and edges",
        icon: <RotateCcw size={14} />,
        action: () => { resetCanvas(); router.push("/dashboard/canvas"); close(); },
      },
    ];

    const nodeItems: CommandItem[] = NODE_CATALOGUE.map(n => {
      const IconComp = (LucideIcons as unknown as Record<string, ComponentType<{ size?: number; color?: string }>>)[n.icon];
      const color    = CATEGORY_COLOR[n.category] ?? "#4F8AFF";
      return {
        id:          `node-${n.id}`,
        label:       n.name,
        description: n.description,
        icon:        IconComp ? <IconComp size={14} color={color} /> : <Zap size={14} />,
        badge:       n.category,
        badgeColor:  color,
        keywords:    n.tags?.join(" "),
        action:      () => { router.push("/dashboard/canvas"); close(); },
      };
    });

    const templateItems: CommandItem[] = PREBUILT_WORKFLOWS.map(t => ({
      id:          `tpl-${t.id}`,
      label:       t.name,
      description: t.description,
      icon:        <BookOpen size={14} color="#8B5CF6" />,
      badge:       t.complexity,
      badgeColor:  "#8B5CF6",
      keywords:    t.tags?.join(" "),
      action:      () => { loadFromTemplate(t); router.push("/dashboard/canvas"); close(); },
    }));

    const result: CommandSection[] = [];

    if (!q) {
      result.push({ id: "navigate", label: "Navigate", items: navItems });
      result.push({ id: "actions",  label: "Actions",  items: actionItems });
    } else {
      const fn  = navItems.filter(i => matches(i, q));
      const fa  = actionItems.filter(i => matches(i, q));
      const fnd = nodeItems.filter(i => matches(i, q)).slice(0, 6);
      const ft  = templateItems.filter(i => matches(i, q)).slice(0, 4);
      if (fn.length)  result.push({ id: "navigate",  label: "Navigate",  items: fn });
      if (fa.length)  result.push({ id: "actions",   label: "Actions",   items: fa });
      if (fnd.length) result.push({ id: "nodes",     label: "Nodes",     items: fnd });
      if (ft.length)  result.push({ id: "templates", label: "Templates", items: ft });
    }

    return result;
  }, [query, router, close, resetCanvas, loadFromTemplate, runWorkflow]);

  // ── Flat item list for keyboard nav ───────────────────────────────────────
  const flatItems = useMemo(() => sections.flatMap(s => s.items), [sections]);

  // Build id→index map (avoids globalIndex counter in JSX)
  const indexMap = useMemo(() => {
    const m = new Map<string, number>();
    flatItems.forEach((item, i) => m.set(item.id, i));
    return m;
  }, [flatItems]);

  // Clamp selection when results shrink (derived, no effect needed)
  const safeSelected = Math.min(selected, Math.max(0, flatItems.length - 1));

  // ── Keyboard handler ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected(i => Math.min(i + 1, flatItems.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected(i => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        flatItems[safeSelected]?.action();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, flatItems, safeSelected, close]);

  // ── Scroll selected item into view ────────────────────────────────────────
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector("[data-selected='true']") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={close}
            style={{
              position: "fixed", inset: 0, zIndex: 9998,
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(4px)",
            }}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0,   scale: 1 }}
            exit={{   opacity: 0, y: -10,  scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            style={{
              position: "fixed",
              top: "14vh",
              left: "50%",
              transform: "translateX(-50%)",
              width: "min(560px, calc(100vw - 32px))",
              zIndex: 9999,
              background: "#12121A",
              borderRadius: 14,
              border: "1px solid #1E1E2E",
              boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Search bar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 16px",
              borderBottom: "1px solid #1A1A26",
            }}>
              <Search size={15} style={{ color: "#4A4A60", flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setSelected(0); }}
                placeholder="Search nodes, templates, commands…"
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  fontSize: 14, color: "#E0E0EA", fontFamily: "inherit",
                  caretColor: "#4F8AFF",
                }}
              />
              <kbd style={{
                fontSize: 10, padding: "2px 6px", borderRadius: 5,
                background: "#1A1A26", border: "1px solid #2A2A3E",
                color: "#3A3A50", fontFamily: "inherit", flexShrink: 0,
              }}>
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div
              ref={listRef}
              style={{ overflowY: "auto", maxHeight: 400, padding: "6px 0" }}
            >
              {flatItems.length === 0 ? (
                <div style={{
                  padding: "36px 16px", textAlign: "center",
                  fontSize: 13, color: "#3A3A50",
                }}>
                  No results for &ldquo;{query}&rdquo;
                </div>
              ) : (
                sections.map(section => (
                  <div key={section.id}>
                    {/* Section label */}
                    <div style={{
                      padding: "7px 16px 3px",
                      fontSize: 10, fontWeight: 700,
                      color: "#2E2E44", textTransform: "uppercase", letterSpacing: "0.7px",
                    }}>
                      {section.label}
                    </div>

                    {section.items.map(item => {
                      const idx = indexMap.get(item.id) ?? 0;
                      return (
                        <CommandRow
                          key={item.id}
                          item={item}
                          isSelected={idx === safeSelected}
                          onClick={item.action}
                          onHover={() => setSelected(idx)}
                        />
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "7px 16px",
              borderTop: "1px solid #1A1A26",
              fontSize: 10, color: "#2E2E44",
            }}>
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{
                  width: 15, height: 15, borderRadius: 3,
                  background: "#1A1A26", border: "1px solid #222236",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Terminal size={8} color="#3A3A50" />
                </div>
                <span>⌘K</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── CommandRow ───────────────────────────────────────────────────────────────

interface CommandRowProps {
  item: CommandItem;
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}

function CommandRow({ item, isSelected, onClick, onHover }: CommandRowProps) {
  return (
    <button
      data-selected={isSelected}
      onClick={onClick}
      onMouseEnter={onHover}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "7px 16px",
        background: isSelected ? "rgba(79,138,255,0.07)" : "transparent",
        border: "none",
        borderLeft: isSelected ? "2px solid #4F8AFF" : "2px solid transparent",
        cursor: "pointer", textAlign: "left",
        transition: "background 0.08s, border-color 0.08s",
      }}
    >
      {/* Icon circle */}
      <span style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: isSelected ? "rgba(79,138,255,0.1)" : "rgba(255,255,255,0.04)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: isSelected ? "#4F8AFF" : "#55556A",
        transition: "background 0.08s, color 0.08s",
      }}>
        {item.icon}
      </span>

      {/* Text */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: "block", fontSize: 13, fontWeight: 500,
          color: isSelected ? "#F0F0F5" : "#C0C0D0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {item.label}
        </span>
        {item.description && (
          <span style={{
            display: "block", fontSize: 11, marginTop: 1,
            color: "#3A3A50",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {item.description}
          </span>
        )}
      </span>

      {/* Badge */}
      {item.badge && (
        <span style={{
          fontSize: 9, padding: "2px 6px", borderRadius: 5, flexShrink: 0,
          background: item.badgeColor
            ? `rgba(${hexToRgb(item.badgeColor)}, 0.1)`
            : "#1A1A26",
          border: `1px solid ${item.badgeColor
            ? `rgba(${hexToRgb(item.badgeColor)}, 0.2)`
            : "#2A2A3E"}`,
          color: item.badgeColor ?? "#55556A",
          fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.4px",
        }}>
          {item.badge}
        </span>
      )}

      {/* Arrow indicator */}
      {isSelected && (
        <ArrowRight size={12} style={{ color: "#4F8AFF", flexShrink: 0 }} />
      )}
    </button>
  );
}
