"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useFloorPlanStore } from "@/features/floor-plan/stores/floor-plan-store";
import {
  getActiveProjectId,
  loadProject,
} from "@/features/floor-plan/lib/project-persistence";

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

  const urlProjectId = searchParams.get("projectId") ?? undefined;
  const source = searchParams.get("source"); // "pipeline" | "saved"

  // Refresh-time restore: when there are no URL params, the user either
  // navigated in fresh (sidebar → welcome screen expected) or hard-refreshed
  // while working on a floor plan (editor expected). We disambiguate using
  // a dedicated `buildflow-fp-active` pointer written whenever a project is
  // loaded into the store and cleared when the user explicitly goes back
  // to the welcome screen.
  const [restoredProjectId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const url = new URL(window.location.href);
    if (url.searchParams.get("source") || url.searchParams.get("projectId")) {
      return undefined;
    }
    const activeId = getActiveProjectId();
    if (!activeId) return undefined;
    // Make sure the project actually exists in localStorage — otherwise we'd
    // ask FloorPlanViewer to load a ghost id, and it would silently fall
    // back to the welcome screen anyway.
    return loadProject(activeId) ? activeId : undefined;
  });

  const initialProjectId = urlProjectId ?? restoredProjectId;

  // When there's genuinely nothing to restore and the URL has no hint, clear
  // the store so the welcome screen renders cleanly (the store may still
  // hold stale in-memory state from a previous navigation).
  useEffect(() => {
    if (!source && !urlProjectId && !restoredProjectId) {
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
