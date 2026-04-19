"use client";

import React from "react";
import { motion } from "framer-motion";
import type { FloorPlanProject, Room } from "@/types/floor-plan-cad";
import { ROOM_COLORS } from "@/types/floor-plan-cad";

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

// ── Grade color ──────────────────────────────────────────────────────────

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#10B981";
    case "B": return "#3B82F6";
    case "C": return "#F59E0B";
    case "D": return "#F97316";
    default:  return "#EF4444";
  }
}

// ── SVG Thumbnail ────────────────────────────────────────────────────────

function roomFill(room: Room): string {
  const colors = ROOM_COLORS[room.type];
  if (colors) return colors.fill;
  return "#E5E7EB";
}

function FloorPlanThumbnail({ project }: { project: FloorPlanProject }) {
  const floor = project.floors[0];
  if (!floor || floor.rooms.length === 0) {
    return <div style={{ height: 160, background: "#1A1A2E", borderRadius: 8 }} />;
  }

  // Find bounding box from room boundaries
  const allPoints = floor.rooms.flatMap(r => r.boundary.points);
  if (allPoints.length === 0) {
    return <div style={{ height: 160, background: "#1A1A2E", borderRadius: 8 }} />;
  }

  const minX = Math.min(...allPoints.map(p => p.x));
  const minY = Math.min(...allPoints.map(p => p.y));
  const maxX = Math.max(...allPoints.map(p => p.x));
  const maxY = Math.max(...allPoints.map(p => p.y));
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;

  // Pad by 5%
  const pad = Math.max(w, h) * 0.05;

  // SVG uses Y-down, our coordinates are Y-up.
  // Flip by using a negative scaleY in the transform.
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = w + pad * 2;
  const vbH = h + pad * 2;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      style={{ width: "100%", height: 160, display: "block" }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Flip Y axis: transform the whole drawing */}
      <g transform={`translate(0, ${minY + maxY}) scale(1, -1)`}>
        {/* Room fills */}
        {floor.rooms.map((room) => {
          const pts = room.boundary.points;
          if (pts.length < 3) return null;
          const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
          return (
            <path
              key={room.id}
              d={pathD}
              fill={roomFill(room)}
              stroke="rgba(100,116,139,0.4)"
              strokeWidth={Math.max(w, h) * 0.004}
            />
          );
        })}
        {/* Walls */}
        {floor.walls.map((wall) => (
          <line
            key={wall.id}
            x1={wall.centerline.start.x}
            y1={wall.centerline.start.y}
            x2={wall.centerline.end.x}
            y2={wall.centerline.end.y}
            stroke={wall.type === "exterior" ? "#64748B" : "#94A3B8"}
            strokeWidth={wall.thickness_mm * 0.7}
            strokeLinecap="round"
          />
        ))}
        {/* Doors — small arcs */}
        {floor.doors.map((door) => {
          const wall = floor.walls.find(w => w.id === door.wall_id);
          if (!wall) return null;
          const wStart = wall.centerline.start;
          const wEnd = wall.centerline.end;
          const wLen = Math.hypot(wEnd.x - wStart.x, wEnd.y - wStart.y);
          if (wLen < 1) return null;
          const t = (door.position_along_wall_mm + door.width_mm / 2) / wLen;
          const cx = wStart.x + (wEnd.x - wStart.x) * t;
          const cy = wStart.y + (wEnd.y - wStart.y) * t;
          const r = door.width_mm * 0.4;
          return (
            <circle
              key={door.id}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="#F59E0B"
              strokeWidth={Math.max(w, h) * 0.003}
              opacity={0.6}
            />
          );
        })}
      </g>
    </svg>
  );
}

// ── Stat pill ────────────────────────────────────────────────────────────

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "4px 0",
      fontSize: 11.5, color: warn ? "#F59E0B" : "#A0A0C0",
    }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600, color: warn ? "#F59E0B" : "#D0D0E8" }}>{value}</span>
    </div>
  );
}

// ── Option Card ──────────────────────────────────────────────────────────

function OptionCard({
  option, isBest, onSelect, index,
}: {
  option: FloorPlanOption;
  isBest: boolean;
  onSelect: () => void;
  index: number;
}) {
  const gc = gradeColor(option.grade);

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.1, ease: "easeOut" }}
      style={{
        position: "relative",
        borderRadius: 20,
        overflow: "hidden",
        background: "linear-gradient(180deg, #16162A 0%, #0E0E1C 100%)",
        border: isBest
          ? "1.5px solid rgba(16,185,129,0.35)"
          : "1px solid rgba(255,255,255,0.08)",
        boxShadow: isBest
          ? "0 0 40px rgba(16,185,129,0.08)"
          : "0 8px 32px rgba(0,0,0,0.4)",
        cursor: "pointer",
        transition: "transform 0.2s, border-color 0.2s",
        flex: "1 1 0",
        minWidth: 220,
        maxWidth: 340,
      }}
      whileHover={{ scale: 1.02, borderColor: isBest ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.18)" }}
      onClick={onSelect}
    >
      {/* Best badge */}
      {isBest && (
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 2,
          display: "flex", alignItems: "center", gap: 4,
          padding: "3px 10px", borderRadius: 20,
          background: "rgba(16,185,129,0.15)",
          border: "1px solid rgba(16,185,129,0.3)",
          fontSize: 10, fontWeight: 700, color: "#10B981",
          letterSpacing: "0.5px", textTransform: "uppercase",
        }}>
          Recommended
        </div>
      )}

      {/* Thumbnail */}
      <div style={{
        padding: "12px 12px 0",
        background: "rgba(0,0,0,0.2)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <FloorPlanThumbnail project={option.project} />
      </div>

      {/* Score header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "14px 16px 6px",
      }}>
        <div style={{
          fontSize: 32, fontWeight: 800, color: "#F0F0FF",
          lineHeight: 1, letterSpacing: "-0.03em",
        }}>
          {option.score}
        </div>
        <div>
          <div style={{
            fontSize: 13, fontWeight: 700, color: gc,
            letterSpacing: "-0.01em",
          }}>
            Grade {option.grade}
          </div>
          <div style={{ fontSize: 10, color: "#6A6A8A", marginTop: 1 }}>
            out of 100
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: "4px 16px 10px" }}>
        <Stat label="Rooms" value={String(option.roomCount)} />
        <Stat label="Door coverage" value={`${Math.round(option.doorCoverage)}%`} warn={option.doorCoverage < 90} />
        <Stat label="Efficiency" value={`${Math.round(option.efficiency)}%`} warn={option.efficiency < 70} />
        {option.orphanCount > 0 && (
          <Stat label="Orphan rooms" value={String(option.orphanCount)} warn />
        )}
      </div>

      {/* Select button */}
      <div style={{ padding: "0 16px 16px" }}>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: 12,
            background: isBest
              ? "linear-gradient(135deg, #10B981, #059669)"
              : "rgba(255,255,255,0.06)",
            color: isBest ? "#fff" : "#C0C0D8",
            fontSize: 13,
            fontWeight: 700,
            border: isBest ? "none" : "1px solid rgba(255,255,255,0.1)",
            cursor: "pointer",
            letterSpacing: "-0.01em",
            transition: "background 0.15s",
          }}
        >
          {isBest ? "Select this layout" : "Select"}
        </button>
      </div>
    </motion.div>
  );
}

// ── Main OptionPicker ────────────────────────────────────────────────────

export function OptionPicker({ options, prompt, onSelect, onRegenerate, onSkip }: OptionPickerProps) {
  if (options.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(16px)",
        padding: 24,
        overflowY: "auto",
      }}
    >
      <div style={{ maxWidth: 1080, width: "100%" }}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          style={{ textAlign: "center", marginBottom: 28 }}
        >
          <h2 style={{
            fontSize: 26, fontWeight: 800, color: "#F0F2F8",
            letterSpacing: "-0.03em", margin: "0 0 6px",
          }}>
            We created {options.length} layout options for you
          </h2>
          <p style={{
            fontSize: 13, color: "#7878A0", maxWidth: 500,
            margin: "0 auto", lineHeight: 1.5,
          }}>
            Each option uses a different AI strategy. Pick the one you like best, or regenerate for new layouts.
          </p>
          {prompt && (
            <p style={{
              fontSize: 11, color: "#50506A", fontStyle: "italic",
              margin: "10px auto 0", maxWidth: 420,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              &ldquo;{prompt}&rdquo;
            </p>
          )}
        </motion.div>

        {/* Option cards */}
        <div style={{
          display: "flex", gap: 16,
          justifyContent: "center",
          flexWrap: "wrap",
        }}>
          {options.map((opt, i) => (
            <OptionCard
              key={opt.index}
              option={opt}
              isBest={i === 0}
              onSelect={() => onSelect(opt)}
              index={i}
            />
          ))}
        </div>

        {/* Footer actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.4 }}
          style={{
            display: "flex", justifyContent: "center",
            alignItems: "center", gap: 24,
            marginTop: 28,
          }}
        >
          <button
            onClick={onRegenerate}
            style={{
              padding: "10px 24px", borderRadius: 12,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#B0B0D0", fontSize: 13, fontWeight: 600,
              cursor: "pointer", transition: "background 0.15s",
            }}
          >
            Regenerate all
          </button>
          <button
            onClick={onSkip}
            style={{
              padding: "10px 16px", borderRadius: 12,
              background: "transparent", border: "none",
              color: "#5A5A80", fontSize: 12, fontWeight: 500,
              cursor: "pointer", textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Skip &mdash; use best automatically
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}
