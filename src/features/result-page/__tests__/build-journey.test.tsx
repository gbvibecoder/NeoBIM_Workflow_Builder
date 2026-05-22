/**
 * Phase gamma.1 — Build Journey Section tests.
 *
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuildJourneySection } from "../components/sections/BuildJourneySection";

describe("BuildJourneySection (Phase gamma.1)", () => {
  it("renders when totalAgentTurns > 0", () => {
    const { container } = render(
      <BuildJourneySection
        totalAgentTurns={120}
        renderPreviewCalls={5}
        retryHints={[]}
      />,
    );
    expect(container.textContent).toContain("Build Journey");
    expect(container.textContent).toContain("120 turns");
    expect(container.textContent).toContain("5 previews");
  });

  it("hidden when single-pass run with no render_preview", () => {
    const { container } = render(
      <BuildJourneySection
        totalAgentTurns={0}
        renderPreviewCalls={0}
        retryHints={[]}
      />,
    );
    // Should render nothing
    expect(container.innerHTML).toBe("");
  });

  it("retry hints render as plain text (not JSON)", () => {
    const hints = [
      "The cutting table was collapsed. Build it with 4 parts: top, legs, stretcher, felt.",
      "The mannequin is missing. Add a torso form, neck, head, pole, and tripod base.",
    ];
    const { container } = render(
      <BuildJourneySection
        totalAgentTurns={200}
        renderPreviewCalls={8}
        retryHints={hints}
      />,
    );
    // Expand the section
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    fireEvent.click(button!);
    // Hints should be visible as plain text
    expect(container.textContent).toContain("cutting table was collapsed");
    expect(container.textContent).toContain("mannequin is missing");
    // No JSON artifacts
    expect(container.textContent).not.toContain("{");
    expect(container.textContent).not.toContain("patch_type");
  });

  it("render preview count shown", () => {
    const { container } = render(
      <BuildJourneySection
        totalAgentTurns={80}
        renderPreviewCalls={3}
        retryHints={[]}
      />,
    );
    expect(container.textContent).toContain("3 previews");
  });

  it("shows iteration labels for retry hints", () => {
    const { container } = render(
      <BuildJourneySection
        totalAgentTurns={200}
        renderPreviewCalls={5}
        retryHints={["Fix the table.", "Fix the mannequin."]}
      />,
    );
    const button = container.querySelector("button");
    fireEvent.click(button!);
    expect(container.textContent).toContain("Iteration 1");
    expect(container.textContent).toContain("Iteration 2");
  });
});
