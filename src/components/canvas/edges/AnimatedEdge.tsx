"use client";

import React, { memo, useState } from "react";
import { getSmoothStepPath, type EdgeProps } from "@xyflow/react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EdgeData {
  sourceColor?: string;
  targetColor?: string;
  isFlowing?: boolean;
}

// ─── AnimatedEdge ────────────────────────────────────────────────────────────

export const AnimatedEdge = memo(function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [isHovered, setIsHovered] = useState(false);

  const edgeData = data as EdgeData | undefined;
  const sourceColor = edgeData?.sourceColor ?? "#4F8AFF";
  const targetColor = edgeData?.targetColor ?? "#4F8AFF";
  const isFlowing   = edgeData?.isFlowing   ?? false;

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 14,
  });

  // Unique IDs so multiple edges don't conflict
  const gradientId = `eg-${id}`;
  const glowId     = `ef-${id}`;
  const arrowId    = `ea-${id}`;
  const animGradId = `ag-${id}`;

  // Visual states
  const active     = selected || isHovered;
  const strokeW    = isFlowing ? 3 : active ? 2.5 : 1.8;
  const strokeOp   = isFlowing ? 1 : active ? 0.8 : 0.4;

  return (
    <>
      <defs>
        {/* Directional gradient: source color → target color */}
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX} y1={sourceY}
          x2={targetX} y2={targetY}
        >
          <stop offset="0%"   stopColor={sourceColor} stopOpacity={0.95} />
          <stop offset="50%"  stopColor={`color-mix(in srgb, ${sourceColor} 50%, ${targetColor})`} stopOpacity={0.95} />
          <stop offset="100%" stopColor={targetColor}  stopOpacity={0.95} />
        </linearGradient>

        {/* Animated gradient for flowing state */}
        <linearGradient id={animGradId}>
          <stop offset="0%" stopColor={sourceColor} stopOpacity={1}>
            <animate
              attributeName="stop-opacity"
              values="1;0.5;1"
              dur="2s"
              repeatCount="indefinite"
            />
          </stop>
          <stop offset="50%" stopColor={`color-mix(in srgb, ${sourceColor} 50%, ${targetColor})`} stopOpacity={0.95} />
          <stop offset="100%" stopColor={targetColor} stopOpacity={1}>
            <animate
              attributeName="stop-opacity"
              values="0.5;1;0.5"
              dur="2s"
              repeatCount="indefinite"
            />
          </stop>
        </linearGradient>

        {/* Glow filter — always applied for energy conduit effect */}
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={active ? "4" : "3"} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Arrowhead marker — glows in target color */}
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path
            d="M0,1 L9,5 L0,9 Z"
            fill={targetColor}
            opacity={active ? 0.9 : 0.7}
          />
        </marker>
      </defs>

      {/* Wide invisible hit area for easy hover/click */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      {/* Outer glow halo (always visible, intensifies on hover) */}
      <path
        d={edgePath}
        fill="none"
        stroke={targetColor}
        strokeWidth={strokeW + (active ? 6 : 4)}
        strokeOpacity={active ? 0.12 : 0.04}
        strokeLinecap="round"
        style={{
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />

      {/* Main edge with gradient stroke + glow filter */}
      <path
        d={edgePath}
        fill="none"
        stroke={isFlowing ? `url(#${animGradId})` : `url(#${gradientId})`}
        strokeWidth={strokeW}
        strokeOpacity={strokeOp}
        strokeLinecap="round"
        markerEnd={`url(#${arrowId})`}
        filter={`url(#${glowId})`}
        style={{
          transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      {/* Idle animated dashes — move along the edge */}
      {!isFlowing && (
        <path
          d={edgePath}
          fill="none"
          stroke={sourceColor}
          strokeWidth={1}
          strokeOpacity={active ? 0.4 : 0.15}
          strokeDasharray="8 12"
          strokeLinecap="round"
          style={{
            pointerEvents: "none",
            transition: "stroke-opacity 0.25s ease",
            animation: "edgeDashFlow 3s linear infinite",
          }}
        />
      )}

      {/* Flowing: energy particles travel the path */}
      {isFlowing && (
        <>
          {/* Bright pulsing track overlay */}
          <path
            d={edgePath}
            fill="none"
            stroke={`url(#${animGradId})`}
            strokeWidth={3}
            strokeOpacity={0.95}
            strokeLinecap="round"
            filter={`url(#${glowId})`}
            style={{ pointerEvents: "none" }}
          />
          {/* Multiple energy particles staggered along path */}
          {[0, 0.33, 0.66].map((offset, i) => (
            <g key={i}>
              {/* Trailing glow */}
              <circle r={2.5 - i * 0.3} fill={sourceColor} opacity={0.3}>
                <animateMotion
                  dur="1.6s"
                  repeatCount="indefinite"
                  calcMode="linear"
                  path={edgePath}
                  begin={`${offset + 0.1}s`}
                />
              </circle>
              {/* Main particle */}
              <circle r={3.5 - i * 0.4} fill="white" opacity={0.9 - i * 0.15} style={{
                filter: `drop-shadow(0 0 ${6 - i}px ${targetColor})`,
              }}>
                <animateMotion
                  dur="1.6s"
                  repeatCount="indefinite"
                  calcMode="linear"
                  path={edgePath}
                  begin={`${offset}s`}
                />
              </circle>
            </g>
          ))}
        </>
      )}

      <style>{`
        @keyframes edgeDashFlow {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -40; }
        }
      `}</style>
    </>
  );
});

AnimatedEdge.displayName = "AnimatedEdge";
