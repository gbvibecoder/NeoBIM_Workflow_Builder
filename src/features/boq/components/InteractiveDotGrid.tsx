"use client";

import { useRef, useEffect, useCallback } from "react";
import { useReducedMotion } from "framer-motion";

interface InteractiveDotGridProps {
  dotColor?: string;
  activeColor?: string;
  dotSize?: number;
  activeDotSize?: number;
  spacing?: number;
  glowRadius?: number;
}

export function InteractiveDotGrid({
  dotColor = "rgba(0,0,0,0.15)",
  activeColor = "rgba(13,148,136,0.5)",
  dotSize = 1.3,
  activeDotSize = 3,
  spacing = 24,
  glowRadius = 90,
}: InteractiveDotGridProps) {
  const prefersReduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef<number>(0);

  // Don't render the animated grid if user prefers reduced motion
  if (prefersReduced) return null;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;
    const { x: mx, y: my } = mouseRef.current;
    const glowR2 = glowRadius * glowRadius;

    ctx.clearRect(0, 0, width, height);

    // Parse active color components once (teal rgb)
    const ar = 13, ag = 148, ab = 136;

    for (let x = spacing / 2; x < width; x += spacing) {
      for (let y = spacing / 2; y < height; y += spacing) {
        const dx = x - mx;
        const dy = y - my;
        const dist2 = dx * dx + dy * dy;

        // Skip glow math for dots far from cursor
        if (dist2 > glowR2 * 1.5) {
          ctx.beginPath();
          ctx.arc(x, y, dotSize, 0, Math.PI * 2);
          ctx.fillStyle = dotColor;
          ctx.fill();
          continue;
        }

        const dist = Math.sqrt(dist2);
        const influence = Math.max(0, 1 - dist / glowRadius);
        // Smoothstep easing
        const eased = influence * influence * (3 - 2 * influence);

        const radius = dotSize + (activeDotSize - dotSize) * eased;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);

        if (eased > 0.01) {
          const alpha = 0.35 * eased;
          ctx.fillStyle = `rgba(${ar},${ag},${ab},${alpha})`;
        } else {
          ctx.fillStyle = dotColor;
        }
        ctx.fill();
      }
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [dotColor, activeColor, dotSize, activeDotSize, spacing, glowRadius]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const handleMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handleMouse);
    document.addEventListener("mouseleave", handleLeave);

    // Pause RAF when tab is hidden to save battery
    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
      } else {
        rafRef.current = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouse);
      document.removeEventListener("mouseleave", handleLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
