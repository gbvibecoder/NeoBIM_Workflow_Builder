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

describe("IFC Enhancer button source-level guard", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/ifc/components/IFCViewerPage.tsx"),
    "utf-8"
  );

  it("declares an 'IFC Enhancer' label", () => {
    expect(src).toContain("IFC Enhancer");
  });

  it("is gated behind hasModel", () => {
    expect(src).toMatch(/\{hasModel && \(\s*<button/);
  });

  it("anchors to top:12, right:12", () => {
    const buttonBlock = src.slice(src.indexOf("IFC Enhancer button"));
    expect(buttonBlock).toMatch(/top:\s*12/);
    expect(buttonBlock).toMatch(/right:\s*12/);
  });

  it("renders a Sparkles icon", () => {
    const buttonBlock = src.slice(src.indexOf("IFC Enhancer button"));
    expect(buttonBlock).toMatch(/<Sparkles\b/);
  });
});
