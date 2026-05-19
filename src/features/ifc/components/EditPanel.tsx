"use client";

/* ─── EditPanel — Phase Z.IFC.2 (2026-05-19) ─────────────────────────────
   The unified "change-the-model" sidebar surface. Replaces the prior
   Enhance + Edit two-tab split with one coherent panel that stacks:

     ┌─ <ApplyHero/> (inside <IFCEnhancePanel embedded/>)
     ├─ AI ENHANCEMENT sections (Environment 360°, Materials, Site,
     │  Roof, Building details, etc.) — from IFCEnhancePanel
     ├─ GroupDivider "STRUCTURE EDITS"
     ├─ STRUCTURE EDITS sections (Floors, Rooms, Custom Prompt) —
     │  from IFCEnhancerPanel
     └─ EXPERIMENTAL EDITS expander — from IFCEnhancerPanel

   Architecture decision (Option B per spec §2.2): keep the existing
   IFCEnhancePanel + IFCEnhancerPanel components alive and render them
   with a new `embedded` prop that suppresses their outer scrollable
   shell and inner header banners. This keeps all of the engine
   lifecycle (resetIfApplied / applyAll imperative handles, Tier
   1-4 + panorama orchestration, IFCEnhancer prompt → /api/enhance-ifc
   flow) byte-for-byte unchanged.

   Forward ref to IFCEnhancePanel so the parent IFCViewerPage can still
   call `enhancePanelRef.current.resetIfApplied()` before file reloads. */

import React, { forwardRef, type RefObject } from "react";
import { UI } from "@/features/ifc/components/constants";
import { IFCEnhancePanel, type IFCEnhancePanelHandle } from "@/features/ifc/components/IFCEnhancePanel";
import { IFCEnhancerPanel, type EnhanceSuccess } from "@/features/ifc/components/IFCEnhancerPanel";
import type { ViewportHandle } from "@/types/ifc-viewer";

interface EditPanelProps {
  viewportRef: RefObject<ViewportHandle | null>;
  hasModel: boolean;
  sourceFile: { name: string; buffer: ArrayBuffer } | null;
  onApplyToViewer: (result: EnhanceSuccess) => void;
}

/* ─── Group divider — full-width separator between AI and STRUCTURE
       groups. Mono uppercase title left, optional meta right, dashed
       border-top so groups feel "drafted" rather than walled off. */
function GroupDivider({ title, meta }: { title: string; meta?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 16px 8px",
        borderTop: `1px dashed ${UI.border.subtle}`,
        marginTop: 4,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: UI.text.primary,
          fontFamily: UI.font.mono,
        }}
      >
        {title}
      </span>
      {meta && (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: UI.text.tertiary,
            fontFamily: UI.font.mono,
          }}
        >
          {meta}
        </span>
      )}
    </div>
  );
}

export const EditPanel = forwardRef<IFCEnhancePanelHandle, EditPanelProps>(
  function EditPanel({ viewportRef, hasModel, sourceFile, onApplyToViewer }, ref) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: UI.bg.trace,
          color: UI.text.primary,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {/* AI ENHANCEMENT group — wraps the embedded IFCEnhancePanel which
            includes the <ApplyHero/> CTA + status banner + all 7 sections
            (Panorama, Materials, Environment, Lighting, Site, Roof,
            Building details). The embedded prop strips its outer flex shell
            so this outer scroll owns the height. */}
        <IFCEnhancePanel
          ref={ref}
          viewportRef={viewportRef}
          hasModel={hasModel}
          embedded
        />

        {/* STRUCTURE EDITS group divider */}
        <GroupDivider title="Structure edits" meta="Direct edit" />

        {/* STRUCTURE EDITS group — Floors, Rooms, Custom Prompt are the
            three sections that apply directly via /api/enhance-ifc.
            The 11 AI-Beta sections live INSIDE this panel under their
            own "Experimental edits" expander. Embedded mode removes the
            "IFC Enhancer · filename" banner (file identity is already
            shown in the toolbar's drafting strip). */}
        <IFCEnhancerPanel
          sourceFile={sourceFile}
          onApplyToViewer={onApplyToViewer}
          embedded
        />
      </div>
    );
  },
);

EditPanel.displayName = "EditPanel";
