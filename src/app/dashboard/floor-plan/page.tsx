"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
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

interface BlockInfo {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

function UpgradeOverlay({ block, onDismiss }: { block: BlockInfo; onDismiss: () => void }) {
  const isVerify = block.actionUrl?.includes("settings");
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}>
      <div style={{ maxWidth: 440, width: "100%", borderRadius: 24, overflow: "hidden", background: "linear-gradient(180deg, #0F0F2A, #080816)", border: "1px solid rgba(79,138,255,0.12)", boxShadow: "0 40px 120px rgba(0,0,0,0.8)", padding: "40px 32px 28px", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>{isVerify ? "\uD83D\uDCEC" : "\uD83D\uDE80"}</div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: "#F0F2F8", marginBottom: 8, letterSpacing: "-0.03em" }}>{block.title}</h2>
        <p style={{ fontSize: 13, color: "#9898B0", lineHeight: 1.65, marginBottom: 24, maxWidth: 360, margin: "0 auto 24px" }}>{block.message}</p>
        {block.action && block.actionUrl && (
          <a href={block.actionUrl} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 32px", borderRadius: 14, background: "linear-gradient(135deg, #4F8AFF, #A855F7)", color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none", boxShadow: "0 8px 32px rgba(79,138,255,0.3)" }}>
            {block.action} &rarr;
          </a>
        )}
        <div style={{ marginTop: 14 }}>
          <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#3A3A52", fontSize: 12, cursor: "pointer" }}>Go back to dashboard</button>
        </div>
      </div>
    </div>
  );
}

function FloorPlanPageInner() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [block, setBlock] = useState<BlockInfo | null>(null);

  const initialProjectId = searchParams.get("projectId") ?? undefined;
  const source = searchParams.get("source"); // "pipeline" | "saved"

  // Check execution eligibility on mount for FREE users
  useEffect(() => {
    if (!session?.user) return;
    const role = (session.user as { role?: string }).role || "FREE";
    if (role !== "FREE") return;
    // Don't gate if user is opening a saved project or pipeline result
    if (source === "pipeline" || source === "saved" || initialProjectId) return;

    fetch("/api/check-execution-eligibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogueIds: [] }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.canExecute && data.blocks?.length > 0) {
          setBlock(data.blocks[0]);
        }
      })
      .catch(() => {});
  }, [session, source, initialProjectId]);

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
          // Validate: must be a FloorPlanProject (has floors array + settings)
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
          // Basic validation: must have footprint and rooms array
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
        position: "relative",
      }}
    >
      {block && <UpgradeOverlay block={block} onDismiss={() => { window.location.href = "/dashboard"; }} />}
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
