// @vitest-environment happy-dom
/**
 * Tests for ArtifactBubble (5I PR 3).
 *
 * Pure-rendering component — no internal state, no network. Tests
 * assert ARIA roles, status badges, spinners, summaries, and the stub
 * Download click behaviour.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { ArtifactBubble, type ArtifactBubbleState } from "../ArtifactBubble";
import type { DrawingSseStatus } from "@/features/kos/lib/kos-sse-events";

function buildState(overrides: Partial<ArtifactBubbleState> = {}): ArtifactBubbleState {
  return {
    drawingId: "draw_1",
    filename: "test.dxf",
    status: "PROCESSING_PARSE",
    ...overrides,
  };
}

afterEach(cleanup);

describe("ArtifactBubble — rendering & ARIA", () => {
  it("renders a region with aria-label and the filename", () => {
    render(<ArtifactBubble state={buildState({ filename: "plan.dxf" })} />);
    const region = screen.getByRole("region", { name: /plan\.dxf/i });
    expect(region).toBeTruthy();
    expect(region.getAttribute("data-drawing-id")).toBe("draw_1");
  });

  it("renders a status badge with data-status matching the current status", () => {
    render(<ArtifactBubble state={buildState({ status: "GENERATING_BOQ" })} />);
    const badge = screen.getByTestId("kos-artifact-status-badge");
    expect(badge.getAttribute("data-status")).toBe("GENERATING_BOQ");
  });

  it.each<DrawingSseStatus>([
    "PROCESSING_PARSE",
    "PROCESSING_MAPPER",
    "READY_FOR_GENERATION",
    "GENERATING_BOQ",
    "GENERATING_FORMWORK",
  ])("shows a spinner during %s status", (status) => {
    render(<ArtifactBubble state={buildState({ status })} />);
    expect(screen.getByTestId("kos-artifact-spinner")).toBeTruthy();
  });

  it.each<DrawingSseStatus>(["COMPLETE", "FAILED", "NEEDS_CLASSIFICATION"])(
    "does NOT show a spinner in %s status",
    (status) => {
      render(<ArtifactBubble state={buildState({ status })} />);
      expect(screen.queryByTestId("kos-artifact-spinner")).toBeNull();
    },
  );
});

describe("ArtifactBubble — summary line", () => {
  it("renders summary stats when present", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "READY_FOR_GENERATION",
          summary: { walls: 140, junctions: 213, openings: 25 },
        })}
      />,
    );
    expect(screen.getByText(/140 walls/i)).toBeTruthy();
    expect(screen.getByText(/213 junctions/i)).toBeTruthy();
    expect(screen.getByText(/25 openings/i)).toBeTruthy();
  });

  it("hides the summary line when no summary is present", () => {
    render(<ArtifactBubble state={buildState({ status: "PROCESSING_PARSE" })} />);
    expect(screen.queryByText(/walls/i)).toBeNull();
  });

  it("hides openings count when 0 (not informative)", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "READY_FOR_GENERATION",
          summary: { walls: 5, junctions: 0, openings: 0 },
        })}
      />,
    );
    expect(screen.getByText(/5 walls/i)).toBeTruthy();
    expect(screen.queryByText(/openings/i)).toBeNull();
  });
});

describe("ArtifactBubble — BOQ tile", () => {
  it("renders BOQ summary + Download button when boq data is present (PR 3 stub path: must pass onDownloadStub)", () => {
    // PR 4 contract: button only renders if EITHER a real downloadUrl
    // is supplied (via boqDownloadUrl prop or state.boqDownloadUrl)
    // OR a stub callback is provided. Without either, the tile shows
    // a "Preparing…" label.
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          boq: {
            s3Key: "k",
            summary: {
              totalStandardPanels: 15583,
              grandTotalInrFormatted: "₹4,80,70,359.97",
              customQuotesPendingCount: 81,
            },
          },
        })}
        onDownloadStub={() => {}}
      />,
    );
    const tile = screen.getByTestId("kos-artifact-tile-boq");
    expect(tile.getAttribute("data-state")).toBe("ready");
    expect(tile.textContent).toContain("15,583 panels");
    expect(tile.textContent).toContain("₹4,80,70,359.97");
    expect(tile.textContent).toContain("81 custom-quote items");
    expect(
      screen.getByRole("button", { name: /Download Bill of Quantities/i }),
    ).toBeTruthy();
  });

  it("renders BOQ error tile (no download button) when boqError set", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          boqError: { errorCode: "KOS_BOQ_GEN_SIDECAR_4XX", errorMessage: "bad input" },
        })}
      />,
    );
    const tile = screen.getByTestId("kos-artifact-tile-boq");
    expect(tile.getAttribute("data-state")).toBe("failed");
    expect(tile.textContent).toContain("bad input");
    expect(tile.textContent).toContain("KOS_BOQ_GEN_SIDECAR_4XX");
    expect(
      screen.queryByRole("button", { name: /Download Bill of Quantities/i }),
    ).toBeNull();
  });
});

describe("ArtifactBubble — Formwork tile", () => {
  it("renders Formwork summary with props/walers/kickers counts", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          formwork: {
            s3Key: "k",
            summary: {
              propsCount: 5456,
              walersCount: 5456,
              kickersCount: 24545,
            },
          },
        })}
      />,
    );
    const tile = screen.getByTestId("kos-artifact-tile-formwork");
    expect(tile.textContent).toContain("5,456 props");
    expect(tile.textContent).toContain("5,456 walers");
    expect(tile.textContent).toContain("24,545 kickers");
  });
});

describe("ArtifactBubble — interactions", () => {
  it("clicking Download invokes onDownloadStub with kind + drawingId", () => {
    const onDownloadStub = vi.fn();
    render(
      <ArtifactBubble
        state={buildState({
          drawingId: "draw_xyz",
          status: "COMPLETE",
          boq: { s3Key: "k", summary: { totalStandardPanels: 1 } },
          formwork: { s3Key: "k", summary: { propsCount: 1 } },
        })}
        onDownloadStub={onDownloadStub}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Download Bill of Quantities/i }),
    );
    expect(onDownloadStub).toHaveBeenCalledWith("boq", "draw_xyz");

    fireEvent.click(
      screen.getByRole("button", { name: /Download Formwork Quantities/i }),
    );
    expect(onDownloadStub).toHaveBeenCalledWith("formwork", "draw_xyz");
  });

  it("PR 4 contract: neither downloadUrl nor stub → renders 'Preparing…', no button to click", () => {
    // Renamed from the PR 3 "clicking Download with no onDownloadStub
    // does NOT throw" assertion. New contract: no URL + no stub means
    // the tile waits with a Preparing label rather than rendering a
    // dead button that does nothing.
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          boq: { s3Key: "k", summary: { totalStandardPanels: 1 } },
        })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Download Bill of Quantities/i }),
    ).toBeNull();
    expect(screen.getByTestId("kos-artifact-download-boq-preparing").textContent).toContain(
      "Preparing",
    );
  });
});

describe("ArtifactBubble — PR 4 real download URLs", () => {
  it("boqDownloadUrl prop renders <a href download> with the URL", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          boq: { s3Key: "k", summary: { totalStandardPanels: 1 } },
        })}
        boqDownloadUrl="/api/kos/customer/drawings/draw_1/boq/download"
      />,
    );
    const link = screen.getByTestId("kos-artifact-download-boq") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(
      "/api/kos/customer/drawings/draw_1/boq/download",
    );
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("formworkDownloadUrl prop renders <a href download> with the URL", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          formwork: { s3Key: "k", summary: { propsCount: 1 } },
        })}
        formworkDownloadUrl="/api/kos/customer/drawings/draw_1/formwork/download"
      />,
    );
    const link = screen.getByTestId("kos-artifact-download-formwork") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toContain("/formwork/download");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("URL prop wins over state.boqDownloadUrl when both are set", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          boq: { s3Key: "k", summary: { totalStandardPanels: 1 } },
          boqDownloadUrl: "/from-state",
        })}
        boqDownloadUrl="/from-prop"
      />,
    );
    const link = screen.getByTestId("kos-artifact-download-boq") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/from-prop");
  });

  it("falls back to state.boqDownloadUrl when prop URL is absent (hydration-hook path)", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          boq: { s3Key: "k", summary: { totalStandardPanels: 1 } },
          boqDownloadUrl: "/hydrated",
        })}
      />,
    );
    const link = screen.getByTestId("kos-artifact-download-boq") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/hydrated");
  });

  it("URL prop takes precedence over onDownloadStub (no stub fallback when real URL exists)", () => {
    const onDownloadStub = vi.fn();
    render(
      <ArtifactBubble
        state={buildState({
          status: "COMPLETE",
          boq: { s3Key: "k", summary: { totalStandardPanels: 1 } },
        })}
        boqDownloadUrl="/api/path"
        onDownloadStub={onDownloadStub}
      />,
    );
    // The anchor renders; the stub button should NOT be in the tree.
    expect(screen.queryByTestId("kos-artifact-download-boq-stub")).toBeNull();
    expect(screen.getByTestId("kos-artifact-download-boq").tagName).toBe("A");
    // Clicking the anchor should NOT trigger the stub callback either.
    fireEvent.click(screen.getByTestId("kos-artifact-download-boq"));
    expect(onDownloadStub).not.toHaveBeenCalled();
  });

  it("clicking the real anchor does not throw + console.info traces the event", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    render(
      <ArtifactBubble
        state={buildState({
          drawingId: "draw_xyz",
          status: "COMPLETE",
          boq: { s3Key: "k", summary: { totalStandardPanels: 1 } },
        })}
        boqDownloadUrl="/x"
      />,
    );
    expect(() =>
      fireEvent.click(screen.getByTestId("kos-artifact-download-boq")),
    ).not.toThrow();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("download_clicked"),
    );
    infoSpy.mockRestore();
  });
});

describe("ArtifactBubble — FAILED + NEEDS_CLASSIFICATION states", () => {
  it("FAILED renders a role=alert with the error message + code", () => {
    render(
      <ArtifactBubble
        state={buildState({
          status: "FAILED",
          errorCode: "KOS_DRAWING_001",
          errorMessage: "Sidecar timed out",
        })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Sidecar timed out");
    expect(alert.textContent).toContain("KOS_DRAWING_001");
  });

  it("NEEDS_CLASSIFICATION shows the reply prompt (chips deferred)", () => {
    render(<ArtifactBubble state={buildState({ status: "NEEDS_CLASSIFICATION" })} />);
    expect(
      screen.getByText(/Reply with the drawing type to continue/i),
    ).toBeTruthy();
  });
});
