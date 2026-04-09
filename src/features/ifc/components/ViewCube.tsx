"use client";

import React, { useRef, useEffect } from "react";
import { UI } from "@/features/ifc/components/constants";
import type { PresetView, ViewportHandle } from "@/types/ifc-viewer";

interface ViewCubeProps {
  viewportRef: React.RefObject<ViewportHandle | null>;
  cameraMatrixCSS: string; // CSS transform from Three.js camera
}

const FACE_SIZE = 66;
const HALF = FACE_SIZE / 2;
const CONTAINER = 110;

const faces: { label: string; view: PresetView; transform: string }[] = [
  { label: "Front", view: "front", transform: `translateZ(${HALF}px)` },
  { label: "Back", view: "back", transform: `rotateY(180deg) translateZ(${HALF}px)` },
  { label: "Right", view: "right", transform: `rotateY(90deg) translateZ(${HALF}px)` },
  { label: "Left", view: "left", transform: `rotateY(-90deg) translateZ(${HALF}px)` },
  { label: "Top", view: "top", transform: `rotateX(90deg) translateZ(${HALF}px)` },
  { label: "Bottom", view: "bottom", transform: `rotateX(-90deg) translateZ(${HALF}px)` },
];

const faceStyle: React.CSSProperties = {
  position: "absolute",
  width: FACE_SIZE,
  height: FACE_SIZE,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  cursor: "pointer",
  backfaceVisibility: "hidden",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  userSelect: "none",
  transition: "background 0.12s, color 0.12s, border-color 0.12s",
};

export function ViewCube({ viewportRef, cameraMatrixCSS }: ViewCubeProps) {
  const cubeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cubeRef.current) {
      cubeRef.current.style.transform = cameraMatrixCSS;
    }
  }, [cameraMatrixCSS]);

  const handleFaceClick = (view: PresetView) => {
    viewportRef.current?.setPresetView(view);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: CONTAINER,
        height: CONTAINER,
        perspective: 240,
        zIndex: 15,
        pointerEvents: "auto",
      }}
    >
      {/* Background disc plate */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "rgba(12,14,24,0.6)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(8px)",
        }}
      />
      <div
        ref={cubeRef}
        style={{
          width: FACE_SIZE,
          height: FACE_SIZE,
          position: "relative",
          transformStyle: "preserve-3d",
          margin: `${(CONTAINER - FACE_SIZE) / 2}px auto`,
          transition: "transform 0.05s linear",
        }}
      >
        {faces.map((face) => (
          <div
            key={face.view}
            onClick={() => handleFaceClick(face.view)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(79,138,255,0.35)";
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.borderColor = "rgba(79,138,255,0.6)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(18,20,35,0.92)";
              e.currentTarget.style.color = "rgba(255,255,255,0.7)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
            }}
            style={{
              ...faceStyle,
              transform: face.transform,
              background: "rgba(18,20,35,0.92)",
              color: "rgba(255,255,255,0.7)",
            }}
          >
            {face.label}
          </div>
        ))}
      </div>
      {/* Axis indicator with colored lines */}
      <div style={{
        position: "absolute",
        bottom: 2,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.5px",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <span style={{ width: 10, height: 2, background: "#ef4444", borderRadius: 1, display: "inline-block" }} />
          <span style={{ color: "#ef4444" }}>X</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <span style={{ width: 10, height: 2, background: "#22c55e", borderRadius: 1, display: "inline-block" }} />
          <span style={{ color: "#22c55e" }}>Y</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <span style={{ width: 10, height: 2, background: "#3b82f6", borderRadius: 1, display: "inline-block" }} />
          <span style={{ color: "#3b82f6" }}>Z</span>
        </span>
      </div>
    </div>
  );
}
