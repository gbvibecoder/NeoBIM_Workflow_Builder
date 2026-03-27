"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

const FloorPlanViewer = dynamic(
  () => import("@/components/floor-plan/FloorPlanViewer").then((m) => m.FloorPlanViewer),
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

  // Geometry can be passed via sessionStorage (too large for URL params)
  const initialGeometry = useMemo(() => {
    if (source === "pipeline" && typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem("fp-editor-geometry");
        if (raw) {
          sessionStorage.removeItem("fp-editor-geometry");
          const parsed = JSON.parse(raw);
          // Basic validation: must have footprint and rooms array
          if (parsed && parsed.footprint && Array.isArray(parsed.rooms)) {
            return parsed;
          }
        }
      } catch { /* ignore malformed data */ }
    }
    return undefined;
  }, [source]);

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
    <FloorPlanViewer
      initialGeometry={initialGeometry}
      initialPrompt={initialPrompt}
      initialProjectId={initialProjectId}
    />
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
