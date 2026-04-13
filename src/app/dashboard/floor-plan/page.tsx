"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";

const FloorPlanViewer = dynamic(
  () => import("@/features/floor-plan/components/FloorPlanViewer").then((m) => m.FloorPlanViewer),
  { ssr: false, loading: () => (
    <div className="flex h-screen items-center justify-center bg-white">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
        <p className="text-sm text-gray-500">Loading Floor Plan Editor...</p>
      </div>
    </div>
  )}
);

function FloorPlanPageInner() {
  const searchParams = useSearchParams();

  const initialProjectId = searchParams.get("projectId") ?? undefined;
  const source = searchParams.get("source"); // "pipeline" | "saved"

  // When navigating from sidebar (no source param, no projectId), reset store
  // so the welcome screen always shows instead of stale data
  useEffect(() => {
    if (!source && !initialProjectId) {
      useFloorPlanStore.getState().resetToWelcome();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FloorPlanProject can be passed via sessionStorage (from "Open Full Editor" button)
  const initialProject = useMemo(() => {
    if (source === "pipeline" && typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem("floorPlanProject");
        if (raw) {
          sessionStorage.removeItem("floorPlanProject");
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.floors) && parsed.floors.length > 0 && parsed.settings) {
            return parsed;
          }
        }
      } catch { /* ignore malformed data */ }
    }
    return undefined;
  }, [source]);

  // Geometry can be passed via sessionStorage (too large for URL params)
  const initialGeometry = useMemo(() => {
    if (source === "pipeline" && !initialProject && typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem("fp-editor-geometry");
        if (raw) {
          sessionStorage.removeItem("fp-editor-geometry");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.footprint && Array.isArray(parsed.rooms)) {
            return parsed;
          }
        }
      } catch { /* ignore malformed data */ }
    }
    return undefined;
  }, [source, initialProject]);

  const initialPrompt = useMemo(() => {
    if (typeof window !== "undefined") {
      try {
        const p = sessionStorage.getItem("fp-editor-prompt");
        if (p) {
          sessionStorage.removeItem("fp-editor-prompt");
          return p;
        }
      } catch { /* ignore */ }
    }
    return searchParams.get("prompt") ?? undefined;
  }, [searchParams]);

  return (
    <div
      style={{
        height: "100%",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
      }}
    >
      <FloorPlanViewer
        initialProject={initialProject}
        initialGeometry={initialGeometry}
        initialPrompt={initialPrompt}
        initialProjectId={initialProjectId}
      />
    </div>
  );
}

export default function FloorPlanPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          <p className="text-sm text-gray-500">Loading Floor Plan Editor...</p>
        </div>
      </div>
    }>
      <FloorPlanPageInner />
    </Suspense>
  );
}
