// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ViewCube } from "@/features/ifc/components/ViewCube";
import type { ViewportHandle } from "@/types/ifc-viewer";
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";

describe("ViewCube position", () => {
  it("anchors below the toolbar (left:16, top:72, no right)", () => {
    // Phase Z.IFC.2 follow-up (2026-05-19) moved the cube down to clear the
    // floating toolbar (top:16, height:40) → top:72, left:16.
    const viewportRef = { current: null as ViewportHandle | null };
    const { container } = render(
      <ViewCube viewportRef={viewportRef} cameraMatrixCSS="rotateX(0deg) rotateY(0deg)" />
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.position).toBe("absolute");
    expect(root.style.top).toBe("72px");
    expect(root.style.left).toBe("16px");
    expect(root.style.right).toBe("");
  });
});

describe("IFC Enhancer source-level guard (right-side panel per PR #251)", () => {
  // PR #250 shipped a floating modal-style "IFC Enhancer" button anchored at
  // top:12/right:12. PR #251 replaced that modal with an always-visible
  // right-side sidebar panel (IFCEnhancerPanel) with tabs. These tests were
  // re-anchored to the new panel invariants on merge of fix/vip-weak-areas-
  // persistence so the CI suite stays green across Govind's refactor.
  const src = readFileSync(
    join(process.cwd(), "src/features/ifc/components/IFCViewerPage.tsx"),
    "utf-8"
  );

  it("declares an 'IFC Enhancer' label", () => {
    expect(src).toContain("IFC Enhancer");
  });

  it("gates the Enhancer sidebar behind hasModel", () => {
    // Panel/sidebar block wraps its content in `{hasModel && (` — the same
    // gating invariant as the old modal button, now applied to the sidebar.
    expect(src).toMatch(/\{hasModel && \(/);
  });

  it("renders the EditPanel when the 'edit' tab is active", () => {
    // The Phase Z.IFC.2 refactor collapsed the sidebar to "tree" | "edit"
    // and merged the Enhance + Editor surfaces into <EditPanel> (which now
    // houses IFCEnhancerPanel — see EditPanel.tsx). The edit tab gates that
    // panel's visibility.
    expect(src).toMatch(/bottomTab === "edit"[\s\S]{0,400}<EditPanel/);
  });

  it("uses a Sparkles icon for the Enhance affordance", () => {
    expect(src).toMatch(/<Sparkles\b/);
  });
});
