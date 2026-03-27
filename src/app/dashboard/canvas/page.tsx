"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// ─── Skeleton Canvas Loading Screen ──────────────────────────────
function CanvasSkeletonLoader() {
  const keyframes = `
    @keyframes pulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 0.7; }
    }
    @keyframes dashMove {
      to { stroke-dashoffset: -20; }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes progressSweep {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(250%); }
    }
    @keyframes nodeAppear {
      0% { opacity: 0; transform: scale(0.85); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes dotPulse {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }
  `;

  const nodes = [
    { x: 140, y: 100, w: 160, h: 72, delay: 0 },
    { x: 420, y: 60, w: 160, h: 72, delay: 0.15 },
    { x: 420, y: 220, w: 160, h: 72, delay: 0.25 },
    { x: 700, y: 140, w: 160, h: 72, delay: 0.35 },
  ];

  const connections = [
    { from: nodes[0], to: nodes[1], delay: 0.5 },
    { from: nodes[0], to: nodes[2], delay: 0.6 },
    { from: nodes[1], to: nodes[3], delay: 0.7 },
    { from: nodes[2], to: nodes[3], delay: 0.8 },
  ];

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "#07070D",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: keyframes }} />

      {/* Grid dots background */}
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      >
        <defs>
          <pattern id="grid-dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="1" fill="rgba(255,255,255,0.04)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-dots)" />
      </svg>

      {/* Canvas content area */}
      <div
        style={{
          position: "relative",
          width: "1000px",
          maxWidth: "90vw",
          height: "440px",
        }}
      >
        {/* SVG connections */}
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        >
          {connections.map((conn, i) => {
            const startX = conn.from.x + conn.from.w;
            const startY = conn.from.y + conn.from.h / 2;
            const endX = conn.to.x;
            const endY = conn.to.y + conn.to.h / 2;
            const midX = (startX + endX) / 2;

            return (
              <path
                key={i}
                d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                fill="none"
                stroke="rgba(99,102,241,0.25)"
                strokeWidth="2"
                strokeDasharray="6 4"
                style={{
                  animation: `dashMove 1s linear infinite, nodeAppear 0.6s ease-out ${conn.delay}s both`,
                }}
              />
            );
          })}
        </svg>

        {/* Placeholder nodes */}
        {nodes.map((node, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: node.x,
              top: node.y,
              width: node.w,
              height: node.h,
              borderRadius: "12px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(4px)",
              animation: `nodeAppear 0.5s ease-out ${node.delay}s both, pulse 2.5s ease-in-out ${node.delay}s infinite`,
              display: "flex",
              flexDirection: "column" as const,
              justifyContent: "center",
              padding: "12px 16px",
              gap: "8px",
            }}
          >
            {/* Node header bar */}
            <div
              style={{
                width: "40%",
                height: "8px",
                borderRadius: "4px",
                background: "rgba(99,102,241,0.2)",
              }}
            />
            {/* Node content lines */}
            <div
              style={{
                width: "75%",
                height: "6px",
                borderRadius: "3px",
                background: "rgba(255,255,255,0.06)",
              }}
            />
            <div
              style={{
                width: "55%",
                height: "6px",
                borderRadius: "3px",
                background: "rgba(255,255,255,0.04)",
              }}
            />
            {/* Connection port dots */}
            {i < 3 && (
              <div
                style={{
                  position: "absolute",
                  right: "-5px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: "rgba(99,102,241,0.3)",
                  border: "2px solid rgba(99,102,241,0.15)",
                  animation: `dotPulse 2s ease-in-out ${node.delay + 0.3}s infinite`,
                }}
              />
            )}
            {i > 0 && (
              <div
                style={{
                  position: "absolute",
                  left: "-5px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: "rgba(99,102,241,0.3)",
                  border: "2px solid rgba(99,102,241,0.15)",
                  animation: `dotPulse 2s ease-in-out ${node.delay + 0.3}s infinite`,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Bottom status area */}
      <div
        style={{
          position: "absolute",
          bottom: "48px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column" as const,
          alignItems: "center",
          gap: "16px",
          animation: "fadeInUp 0.8s ease-out 0.4s both",
        }}
      >
        {/* Progress bar */}
        <div
          style={{
            width: "200px",
            height: "3px",
            borderRadius: "2px",
            background: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "40%",
              height: "100%",
              borderRadius: "2px",
              background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.5), transparent)",
              animation: "progressSweep 1.8s ease-in-out infinite",
            }}
          />
        </div>

        {/* Loading text */}
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            fontWeight: 400,
            color: "rgba(255,255,255,0.4)",
            letterSpacing: "0.02em",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          Loading your workspace...
        </p>
      </div>
    </div>
  );
}

// ─── Lazy Load Heavy Canvas Component ─────────────────────────────
// @xyflow/react is 260KB - only load when user navigates to canvas
const WorkflowCanvas = dynamic(
  () => import("@/components/canvas/WorkflowCanvas").then((m) => ({ default: m.WorkflowCanvas })),
  {
    ssr: false,
    loading: () => <CanvasSkeletonLoader />,
  }
);

export default function CanvasPage() {
  const searchParams = useSearchParams();
  const workflowId = searchParams.get("id") ?? undefined;
  const templateId = searchParams.get("template") ?? undefined;

  return (
    <ErrorBoundary showHomeButton showSupportButton>
      <Suspense fallback={<CanvasSkeletonLoader />}>
        <WorkflowCanvas workflowId={workflowId} templateId={templateId} />
      </Suspense>
    </ErrorBoundary>
  );
}
