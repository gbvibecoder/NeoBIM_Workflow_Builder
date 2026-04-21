// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ViewCube } from "@/features/ifc/components/ViewCube";
import type { ViewportHandle } from "@/types/ifc-viewer";
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";

describe("ViewCube position", () => {
  it("anchors to top-left of its container (left:12, top:12, no right)", () => {
    const viewportRef = { current: null as ViewportHandle | null };
    const { container } = render(
      <ViewCube viewportRef={viewportRef} cameraMatrixCSS="rotateX(0deg) rotateY(0deg)" />
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.position).toBe("absolute");
    expect(root.style.top).toBe("12px");
    expect(root.style.left).toBe("12px");
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

  it("renders IFCEnhancerPanel when the 'enhance' tab is active", () => {
    // Replaces the old "anchors to top:12, right:12" visual-position test.
    // New invariant: selecting the enhance tab renders the panel component.
    expect(src).toMatch(/bottomTab === "enhance"[\s\S]{0,200}<IFCEnhancerPanel/);
  });

  it("uses a Sparkles icon for the Enhance affordance", () => {
    expect(src).toMatch(/<Sparkles\b/);
  });
});
