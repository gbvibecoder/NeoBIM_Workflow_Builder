"use client";

import React from "react";
import { motion } from "framer-motion";
import type { FloorPlanProject, Room } from "@/types/floor-plan-cad";

// ── Types ────────────────────────────────────────────────────────────────

export interface FloorPlanOption {
  index: number;
  project: FloorPlanProject;
  score: number;
  grade: string;
  efficiency: number;
  doorCoverage: number;
  orphanCount: number;
  voidArea: number;
  roomCount: number;
}

interface OptionPickerProps {
  options: FloorPlanOption[];
  prompt: string;
  onSelect: (option: FloorPlanOption) => void;
  onRegenerate: () => void;
  onSkip: () => void;
}

// ── Room colors (soft pastels on white) ──────────────────────────────────

function roomFill(room: Room): string {
  const t = room.type;
  if (t === "bedroom" || t === "master_bedroom" || t === "guest_bedroom") return "#DBEAFE";
  if (t === "living_room" || t === "dining_room") return "#D1FAE5";
  if (t === "kitchen" || t === "pantry" || t === "store_room") return "#FEF3C7";
  if (t === "bathroom" || t === "toilet" || t === "wc") return "#FCE7F3";
  if (t === "corridor" || t === "lobby" || t === "foyer") return "#F3F4F6";
  if (t === "puja_room") return "#FDE68A";
  if (t === "verandah" || t === "balcony" || t === "terrace") return "#CCFBF1";
  if (t === "utility" || t === "laundry") return "#E5E7EB";
  if (t === "walk_in_closet" || t === "dressing_room" || t === "study") return "#EDE9FE";
  if (t === "servant_quarter") return "#E5E7EB";
  return "#F3F4F6";
}

// ── SVG Thumbnail ────────────────────────────────────────────────────────

function FloorPlanThumbnail({ project, height = 180 }: { project: FloorPlanProject; height?: number }) {
  const floor = project.floors[0];
  if (!floor || floor.rooms.length === 0) {
    return <div style={{ height, background: "#F9FAFB", borderRadius: 8 }} />;
  }

  const allPoints = floor.rooms.flatMap(r => r.boundary.points);
  if (allPoints.length === 0) return <div style={{ height, background: "#F9FAFB", borderRadius: 8 }} />;

  const minX = Math.min(...allPoints.map(p => p.x));
  const minY = Math.min(...allPoints.map(p => p.y));
  const maxX = Math.max(...allPoints.map(p => p.x));
  const maxY = Math.max(...allPoints.map(p => p.y));
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = Math.max(w, h) * 0.04;

  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      style={{ width: "100%", height, display: "block", borderRadius: 8, background: "#FAFAFA" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <g transform={`translate(0, ${minY + maxY}) scale(1, -1)`}>
        {floor.rooms.map(room => {
          const pts = room.boundary.points;
          if (pts.length < 3) return null;
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
          return <path key={room.id} d={d} fill={roomFill(room)} stroke="#D1D5DB" strokeWidth={Math.max(w, h) * 0.003} />;
        })}
        {floor.walls.map(wall => (
          <line key={wall.id}
            x1={wall.centerline.start.x} y1={wall.centerline.start.y}
            x2={wall.centerline.end.x} y2={wall.centerline.end.y}
            stroke={wall.type === "exterior" ? "#374151" : "#9CA3AF"}
            strokeWidth={wall.thickness_mm * 0.6} strokeLinecap="round"
          />
        ))}
      </g>
    </svg>
  );
}

// ── Circular Score Badge ─────────────────────────────────────────────────

function ScoreBadge({ score, size = 56 }: { score: number; size?: number }) {
  const color = score >= 80 ? "#10B981" : score >= 60 ? "#3B82F6" : "#F59E0B";
  const r = 16;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg viewBox="0 0 36 36" style={{ width: size, height: size, transform: "rotate(-90deg)" }}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="#E5E7EB" strokeWidth="2.5" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="2.5"
          strokeDasharray={`${circ}`} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <span style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.32, fontWeight: 800,
        color: "#111827", letterSpacing: "-0.03em",
      }}>
        {score}
      </span>
    </div>
  );
}

// ── Quality Bullets ──────────────────────────────────────────────────────

function QualityBullets({ option }: { option: FloorPlanOption }) {
  const items: { ok: boolean; text: string }[] = [
    { ok: option.orphanCount === 0, text: option.orphanCount === 0 ? "All rooms connected" : `${option.orphanCount} room${option.orphanCount > 1 ? "s" : ""} unreachable` },
    { ok: option.doorCoverage >= 100, text: option.doorCoverage >= 100 ? "100% door coverage" : `${Math.round(option.doorCoverage)}% door coverage` },
    { ok: option.efficiency >= 80, text: option.efficiency >= 80 ? "Compact layout" : `${Math.round(option.efficiency)}% plot usage` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: item.ok ? "#059669" : "#D97706" }}>
          <span style={{ fontSize: 14 }}>{item.ok ? "\u2705" : "\u26A0\uFE0F"}</span>
          <span style={{ fontWeight: 500 }}>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

// ── Hero Card (best option) ──────────────────────────────────────────────

function HeroCard({ option, onSelect }: { option: FloorPlanOption; onSelect: () => void }) {
  return (
    <motion.div
      initial={{ scale: 0.96, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 0.15, type: "spring", stiffness: 200, damping: 20 }}
      style={{
        background: "#FFFFFF",
        border: "2px solid #10B981",
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 10px 40px rgba(16,185,129,0.1), 0 2px 8px rgba(0,0,0,0.06)",
        cursor: "pointer",
      }}
      whileHover={{ boxShadow: "0 14px 50px rgba(16,185,129,0.15), 0 4px 12px rgba(0,0,0,0.08)" }}
      onClick={onSelect}
    >
      {/* Best match badge */}
      <div style={{
        background: "linear-gradient(135deg, #ECFDF5, #D1FAE5)",
        padding: "8px 20px",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>&#11088;</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#065F46", letterSpacing: "0.03em", textTransform: "uppercase" }}>
          Best Match
        </span>
      </div>

      {/* Content: thumbnail + stats side-by-side */}
      <div style={{ display: "flex", gap: 24, padding: "20px 24px", flexWrap: "wrap" }}>
        {/* Thumbnail */}
        <div style={{ flex: "1 1 280px", minWidth: 240 }}>
          <FloorPlanThumbnail project={option.project} height={220} />
        </div>

        {/* Stats */}
        <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ScoreBadge score={option.score} size={64} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>
                Grade {option.grade}
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                {option.roomCount} rooms &middot; {Math.round(option.efficiency)}% efficiency
              </div>
            </div>
          </div>

          <QualityBullets option={option} />

          <button
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            style={{
              padding: "12px 24px", borderRadius: 12,
              background: "linear-gradient(135deg, #10B981, #059669)",
              color: "#FFFFFF", fontSize: 14, fontWeight: 700,
              border: "none", cursor: "pointer",
              boxShadow: "0 4px 14px rgba(16,185,129,0.3)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            Select This Layout
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Secondary Card ───────────────────────────────────────────────────────

function SecondaryCard({ option, label, onSelect, index }: {
  option: FloorPlanOption;
  label: string;
  onSelect: () => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3 + index * 0.1, type: "spring", stiffness: 200, damping: 22 }}
      style={{
        background: "#FFFFFF",
        border: "1px solid #E5E7EB",
        borderRadius: 16,
        overflow: "hidden",
        cursor: "pointer",
        flex: "1 1 0",
        minWidth: 220,
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        transition: "box-shadow 0.2s, border-color 0.2s",
      }}
      whileHover={{ boxShadow: "0 8px 24px rgba(0,0,0,0.08)", borderColor: "#D1D5DB" }}
      onClick={onSelect}
    >
      {/* Thumbnail */}
      <div style={{ padding: "12px 12px 0" }}>
        <FloorPlanThumbnail project={option.project} height={140} />
      </div>

      {/* Stats */}
      <div style={{ padding: "12px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <ScoreBadge score={option.score} size={44} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{label}</div>
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>Grade {option.grade}</div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 12 }}>
          {option.roomCount} rooms &middot; {Math.round(option.doorCoverage)}% doors
          {option.orphanCount > 0 && <span style={{ color: "#D97706" }}> &middot; {option.orphanCount} orphan</span>}
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          style={{
            width: "100%", padding: "9px 16px", borderRadius: 10,
            background: "#F9FAFB", color: "#374151",
            fontSize: 13, fontWeight: 600,
            border: "1px solid #E5E7EB", cursor: "pointer",
            transition: "background 0.15s",
          }}
        >
          Select
        </button>
      </div>
    </motion.div>
  );
}

// ── Main OptionPicker ────────────────────────────────────────────────────

export function OptionPicker({ options, prompt, onSelect, onRegenerate, onSkip }: OptionPickerProps) {
  if (options.length === 0) return null;

  const best = options[0]; // Already sorted by score with tiebreakers
  const rest = options.slice(1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(12px)",
        padding: 20,
        overflowY: "auto",
      }}
    >
      <div style={{ maxWidth: 800, width: "100%" }}>
        {/* Header */}
        <motion.div
          initial={{ y: -15, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.05 }}
          style={{ textAlign: "center", marginBottom: 24 }}
        >
          <h2 style={{
            fontSize: 24, fontWeight: 800, color: "#FFFFFF",
            letterSpacing: "-0.03em", margin: "0 0 6px",
          }}>
            Your AI Architect Created {options.length} Layout Options
          </h2>
          <p style={{ fontSize: 14, color: "#A0A0B8", margin: "0 0 8px" }}>
            Pick your favorite &mdash; or regenerate for fresh ideas
          </p>
          {prompt && (
            <p style={{
              fontSize: 12, color: "#6B6B88", fontStyle: "italic",
              maxWidth: 500, margin: "0 auto",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              &ldquo;{prompt}&rdquo;
            </p>
          )}
        </motion.div>

        {/* Hero card (best option) */}
        <HeroCard option={best} onSelect={() => onSelect(best)} />

        {/* Secondary cards */}
        {rest.length > 0 && (
          <div style={{ display: "flex", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
            {rest.map((opt, i) => (
              <SecondaryCard
                key={opt.index}
                option={opt}
                label={`Option ${String.fromCharCode(66 + i)}`}
                onSelect={() => onSelect(opt)}
                index={i}
              />
            ))}
          </div>
        )}

        {/* Footer actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          style={{
            display: "flex", justifyContent: "center",
            alignItems: "center", gap: 24,
            marginTop: 24,
          }}
        >
          <button
            onClick={onRegenerate}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 22px", borderRadius: 12,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#C0C0D8", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6M23 20v-6h-6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Regenerate All
          </button>
          <button
            onClick={onSkip}
            style={{
              padding: "10px 16px", borderRadius: 12,
              background: "transparent", border: "none",
              color: "#7878A0", fontSize: 12, fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Skip &rarr; use best automatically
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}
