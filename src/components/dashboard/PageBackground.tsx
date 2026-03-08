"use client";

import React, { useEffect, useRef } from "react";

// Topology nodes — positioned strategically to frame content, not clutter it
const TOPO_NODES = [
  { x: 6,  y: 12, r: 3, color: "#1B4FFF", phase: 0 },
  { x: 94, y: 8,  r: 2.5, color: "#8B5CF6", phase: 1.2 },
  { x: 88, y: 85, r: 3, color: "#10B981", phase: 2.4 },
  { x: 12, y: 88, r: 2.5, color: "#F59E0B", phase: 0.8 },
  { x: 50, y: 5,  r: 2, color: "#1B4FFF", phase: 3.0 },
  { x: 4,  y: 50, r: 2, color: "#8B5CF6", phase: 1.8 },
  { x: 96, y: 45, r: 2, color: "#10B981", phase: 2.0 },
  { x: 35, y: 92, r: 2, color: "#1B4FFF", phase: 0.4 },
];

// Topology edges — suggest the node-graph nature of the product
const TOPO_EDGES = [
  [0, 5], [0, 4], [4, 1], [1, 6], [6, 2], [2, 7], [7, 3], [3, 5],
];

// Isometric grid creates architectural depth
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

// Canvas-based particle system for subtle ambient motion
function AmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Particle pool
    const particles: Array<{
      x: number; y: number; vx: number; vy: number;
      size: number; alpha: number; color: string; life: number;
    }> = [];

    const colors = ["79,138,255", "139,92,246", "16,185,129"];

    function spawnParticle() {
      if (particles.length > 30) return;
      particles.push({
        x: Math.random() * canvas!.width,
        y: Math.random() * canvas!.height,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        size: Math.random() * 1.5 + 0.5,
        alpha: 0,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0,
      });
    }

    let frame = 0;
    function animate() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      frame++;
      if (frame % 20 === 0) spawnParticle();

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life += 0.003;

        // Fade in then fade out
        if (p.life < 0.1) p.alpha = p.life / 0.1;
        else if (p.life > 0.9) p.alpha = (1 - p.life) / 0.1;
        else p.alpha = 1;

        p.alpha *= 0.25; // Keep very subtle

        if (p.life >= 1) {
          particles.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed", inset: 0,
        pointerEvents: "none", zIndex: 0,
      }}
    />
  );
}

export function PageBackground() {
  return (
    <>
      {/* Deep radial gradient orbs */}
      <div className="dp-orb1" />
      <div className="dp-orb2" />

      {/* Architectural grid */}
      <IsometricGrid />

      {/* Canvas particle system */}
      <AmbientCanvas />

      {/* SVG topology layer */}
      <svg
        style={{
          position: "fixed", inset: 0, width: "100%", height: "100%",
          pointerEvents: "none", zIndex: 0,
        }}
      >
        {/* Topology edges — animated data flow lines */}
        {TOPO_EDGES.map(([a, b], i) => {
          const na = TOPO_NODES[a];
          const nb = TOPO_NODES[b];
          return (
            <line
              key={`edge-${i}`}
              x1={`${na.x}%`} y1={`${na.y}%`}
              x2={`${nb.x}%`} y2={`${nb.y}%`}
              stroke="url(#topoGrad)"
              strokeWidth={0.5}
              strokeDasharray="4 8"
              opacity={0.12}
              style={{
                animation: `dp-dash ${8 + i * 1.5}s linear infinite`,
              }}
            />
          );
        })}

        {/* Topology nodes */}
        {TOPO_NODES.map((n, i) => (
          <g key={`node-${i}`}>
            {/* Outer ring — breathing */}
            <circle
              cx={`${n.x}%`} cy={`${n.y}%`}
              r={n.r * 3}
              fill="none"
              stroke={n.color}
              strokeWidth={0.3}
              opacity={0.08}
              style={{
                animation: `dp-pulse ${4 + i * 0.5}s ease-in-out infinite`,
                animationDelay: `${n.phase}s`,
                transformOrigin: `${n.x}% ${n.y}%`,
              }}
            />
            {/* Core dot */}
            <circle
              cx={`${n.x}%`} cy={`${n.y}%`}
              r={n.r}
              fill={n.color}
              opacity={0.15}
            />
          </g>
        ))}

        {/* Gradient definition */}
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
