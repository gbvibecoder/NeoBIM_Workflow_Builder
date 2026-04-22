"use client";

import { Sparkles } from "lucide-react";
import type { RefObject } from "react";
import type { ViewportHandle } from "@/types/ifc-viewer";
import { UI } from "@/features/ifc/components/constants";

interface IFCEnhancePanelProps {
  viewportRef: RefObject<ViewportHandle | null>;
  hasModel: boolean;
}

/**
 * Phase 1 placeholder for the new "Enhance with AI" tab.
 *
 * This panel does NOT implement any tier logic — see
 * `IFC_ENGINE_AUDIT_2026-04-21.md` §6 for the STAY verdict and the tier roadmap.
 * Tier 1 (PBR + HDRI), Tier 2 (procedural context), Tier 3 (AI furniture), and
 * Tier 4 (hero shot) land in later phases.
 */
export function IFCEnhancePanel({ viewportRef, hasModel }: IFCEnhancePanelProps) {
  /* viewportRef is intentionally retained in the signature so future tier
     phases can reach `getSceneRefs`, `getMeshMap`, `getSpaceBounds`, etc.,
     without touching the tab-wiring in `IFCViewerPage.tsx`. */
  void viewportRef;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 16,
        gap: 12,
        color: UI.text.primary,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles size={18} color={UI.accent.cyan} strokeWidth={2.2} aria-hidden />
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Enhance with AI</h2>
      </header>

      <section
        style={{
          borderRadius: UI.radius.md,
          border: `1px solid ${UI.border.default}`,
          background: UI.bg.elevated,
          padding: 14,
        }}
      >
        {!hasModel ? (
          <p style={{ fontSize: 12.5, lineHeight: 1.55, color: UI.text.secondary, margin: 0 }}>
            Upload an IFC file to start enhancing.
          </p>
        ) : (
          <p style={{ fontSize: 12.5, lineHeight: 1.55, color: UI.text.secondary, margin: 0 }}>
            Coming soon — this panel will let you apply PBR materials, lighting,
            roof synthesis, procedural context (trees, cars, ground), AI-placed
            furniture, and photoreal hero shots to your current model. Your .ifc
            file is never modified.
          </p>
        )}
      </section>
    </div>
  );
}
