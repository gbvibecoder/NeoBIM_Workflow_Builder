// @vitest-environment happy-dom
/**
 * Phase 2.6 — ImageApprovalGate component tests.
 *
 * The gate is now the default UX (Phase 2.6 flipped the feature flag).
 * These tests lock in the UX contract:
 *   - renders image + both action buttons when given a base64 PNG
 *   - clicks fire onApprove / onRegenerate
 *   - approving/regenerating=true disables buttons and shows spinner
 *   - errorMessage renders a visible alert the user can retry from
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ImageApprovalGate } from "@/features/floor-plan/components/ImageApprovalGate";

const FAKE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

describe("ImageApprovalGate — render contract", () => {
  it("renders the image and both action buttons", () => {
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={() => {}}
        onRegenerate={() => {}}
      />,
    );

    const img = screen.getByAltText(/Stage 2 generated floor plan/i) as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain("data:image/png;base64,");
    expect(img.src).toContain(FAKE_BASE64);

    expect(screen.getByRole("button", { name: /Looks good/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Regenerate image/i })).toBeTruthy();
  });

  it("omits the Cancel button when onCancel is not provided", () => {
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={() => {}}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.queryByLabelText(/Cancel generation/i)).toBeNull();
  });
});

describe("ImageApprovalGate — action handlers", () => {
  it("invokes onApprove when the approve button is clicked", () => {
    const onApprove = vi.fn();
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={onApprove}
        onRegenerate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Looks good/i }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("invokes onRegenerate when the regenerate button is clicked", () => {
    const onRegenerate = vi.fn();
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={() => {}}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Regenerate image/i }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});

describe("ImageApprovalGate — loading state", () => {
  it("disables both buttons and shows 'Starting CAD…' when approving", () => {
    const onApprove = vi.fn();
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={onApprove}
        onRegenerate={() => {}}
        approving
      />,
    );
    const approveBtn = screen.getByRole("button", { name: /Starting CAD/i }) as HTMLButtonElement;
    const regenBtn = screen.getByRole("button", { name: /Regenerate image/i }) as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
    expect(regenBtn.disabled).toBe(true);
    // aria-busy reflects the in-flight action
    expect(approveBtn.getAttribute("aria-busy")).toBe("true");

    // Clicks on disabled button must be no-ops
    fireEvent.click(approveBtn);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("disables both buttons and shows 'Regenerating…' when regenerating", () => {
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={() => {}}
        onRegenerate={() => {}}
        regenerating
      />,
    );
    const regenBtn = screen.getByRole("button", { name: /Regenerating/i }) as HTMLButtonElement;
    const approveBtn = screen.getByRole("button", { name: /Looks good/i }) as HTMLButtonElement;
    expect(regenBtn.disabled).toBe(true);
    expect(approveBtn.disabled).toBe(true);
    expect(regenBtn.getAttribute("aria-busy")).toBe("true");
  });
});

describe("ImageApprovalGate — error surface", () => {
  it("renders the errorMessage as a role=alert banner", () => {
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={() => {}}
        onRegenerate={() => {}}
        errorMessage="Network error approving image. Try again?"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Network error approving image/i);
  });

  it("does not render the banner when errorMessage is null", () => {
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={() => {}}
        onRegenerate={() => {}}
        errorMessage={null}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps buttons clickable after an error (user can retry)", () => {
    const onApprove = vi.fn();
    render(
      <ImageApprovalGate
        imageBase64={FAKE_BASE64}
        onApprove={onApprove}
        onRegenerate={() => {}}
        errorMessage="Failed to approve image. Try again?"
      />,
    );
    const btn = screen.getByRole("button", { name: /Looks good/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
