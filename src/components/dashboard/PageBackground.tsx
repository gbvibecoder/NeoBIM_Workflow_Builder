"use client";

import React from "react";

// Isometric grid creates architectural depth — pure CSS, zero JS
function IsometricGrid() {
  return (
    <div
      className="dp-grid"
      style={{
        backgroundImage: `
          linear-gradient(rgba(79,138,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(79,138,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "64px 64px",
      }}
    />
  );
}

// Static dots that replace the expensive canvas particle system
// Uses CSS opacity animations (GPU-composited) instead of requestAnimationFrame canvas redraws
function StaticParticles() {
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      {[
        { x: "12%", y: "18%", color: "79,138,255", size: 2, delay: "0s" },
        { x: "85%", y: "25%", color: "139,92,246", size: 1.5, delay: "1.5s" },
        { x: "45%", y: "72%", color: "16,185,129", size: 1.8, delay: "3s" },
        { x: "72%", y: "55%", color: "79,138,255", size: 1.2, delay: "2s" },
        { x: "28%", y: "42%", color: "139,92,246", size: 1.6, delay: "4s" },
        { x: "92%", y: "78%", color: "16,185,129", size: 1.4, delay: "1s" },
        { x: "58%", y: "12%", color: "79,138,255", size: 1.3, delay: "2.5s" },
        { x: "18%", y: "65%", color: "139,92,246", size: 1.7, delay: "3.5s" },
      ].map((p, i) => (
        <div
          key={i}
          className="dp-static-particle"
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            width: p.size * 2,
            height: p.size * 2,
            borderRadius: "50%",
            background: `rgba(${p.color}, 0.2)`,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
}

export function PageBackground() {
  return (
    <>
      {/* Deep radial gradient orbs — CSS only, will-change: transform for GPU compositing */}
      <div className="dp-orb1" />
      <div className="dp-orb2" />

      {/* Architectural grid — pure CSS */}
      <IsometricGrid />

      {/* Static particles replace expensive canvas RAF loop */}
      <StaticParticles />

      {/* SVG topology — static nodes, no animations */}
      <svg
        style={{
          position: "fixed", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none", zIndex: 0,
        }}
      >
        {/* Static topology edges — no dash animation */}
        {[
          [0, 5], [0, 4], [4, 1], [1, 6], [6, 2], [2, 7], [7, 3], [3, 5],
        ].map(([a, b], i) => {
          const nodes = [
            { x: 6, y: 12 }, { x: 94, y: 8 }, { x: 88, y: 85 }, { x: 12, y: 88 },
            { x: 50, y: 5 }, { x: 4, y: 50 }, { x: 96, y: 45 }, { x: 35, y: 92 },
          ];
          const na = nodes[a];
          const nb = nodes[b];
          return (
            <line
              key={`edge-${i}`}
              x1={`${na.x}%`} y1={`${na.y}%`}
              x2={`${nb.x}%`} y2={`${nb.y}%`}
              stroke="url(#topoGrad)"
              strokeWidth={0.5}
              strokeDasharray="4 8"
              opacity={0.08}
            />
          );
        })}

        {/* Topology nodes — static, no animation */}
        {[
          { x: 6, y: 12, r: 3, color: "#1B4FFF" },
          { x: 94, y: 8, r: 2.5, color: "#8B5CF6" },
          { x: 88, y: 85, r: 3, color: "#10B981" },
          { x: 12, y: 88, r: 2.5, color: "#F59E0B" },
          { x: 50, y: 5, r: 2, color: "#1B4FFF" },
          { x: 4, y: 50, r: 2, color: "#8B5CF6" },
          { x: 96, y: 45, r: 2, color: "#10B981" },
          { x: 35, y: 92, r: 2, color: "#1B4FFF" },
        ].map((n, i) => (
          <circle
            key={`node-${i}`}
            cx={`${n.x}%`} cy={`${n.y}%`}
            r={n.r}
            fill={n.color}
            opacity={0.12}
          />
        ))}

        <defs>
          <linearGradient id="topoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1B4FFF" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#8B5CF6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0.1" />
          </linearGradient>
        </defs>
      </svg>
    </>
  );
}
