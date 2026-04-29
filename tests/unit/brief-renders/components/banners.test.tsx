/**
 * Status / error / cancelled banner tests.
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { JobStatusBanner } from "@/features/brief-renders/components/JobStatusBanner";
import { JobErrorBanner } from "@/features/brief-renders/components/JobErrorBanner";
import { JobCancelledBanner } from "@/features/brief-renders/components/JobCancelledBanner";
import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";

function makeJob(overrides: Partial<BriefRenderJobView> = {}): BriefRenderJobView {
  return {
    id: "job-1",
    requestId: "req-1",
    briefUrl: "https://r2/b.pdf",
    status: "RUNNING",
    progress: 50,
    currentStage: "rendering",
    specResult: null,
    shots: null,
    pdfUrl: null,
    errorMessage: null,
    costUsd: 1.23,
    startedAt: null,
    completedAt: null,
    pausedAt: null,
    userApproval: null,
    stageLog: null,
    createdAt: "2026-04-28T10:00:00Z",
    updatedAt: "2026-04-28T10:00:00Z",
    ...overrides,
  };
}

describe("JobStatusBanner", () => {
  it("renders for RUNNING with progress + stage label", () => {
    render(<JobStatusBanner job={makeJob()} />);
    const banner = screen.getByTestId("job-status-banner");
    expect(banner.getAttribute("data-status")).toBe("RUNNING");
    expect(banner.textContent).toContain("Generating images");
    expect(banner.textContent).toContain("50%");
  });

  it("clamps progress to [0,100]", () => {
    render(<JobStatusBanner job={makeJob({ progress: 9999 })} />);
    expect(screen.getByTestId("job-status-banner").textContent).toContain("100%");
  });

  it("renders nothing for terminal states", () => {
    const completed = render(
      <JobStatusBanner job={makeJob({ status: "COMPLETED" })} />,
    );
    expect(completed.container.innerHTML).toBe("");

    const failed = render(
      <JobStatusBanner job={makeJob({ status: "FAILED" })} />,
    );
    expect(failed.container.innerHTML).toBe("");

    const cancelled = render(
      <JobStatusBanner job={makeJob({ status: "CANCELLED" })} />,
    );
    expect(cancelled.container.innerHTML).toBe("");
  });

  it("falls back to raw stage when label is missing", () => {
    render(
      <JobStatusBanner job={makeJob({ currentStage: "totally_unknown" })} />,
    );
    expect(screen.getByTestId("job-status-banner").textContent).toContain(
      "totally_unknown",
    );
  });
});

describe("JobErrorBanner", () => {
  it("renders nothing when status is not FAILED", () => {
    const dismiss = vi.fn();
    const { container } = render(
      <JobErrorBanner job={makeJob({ status: "RUNNING" })} onDismiss={dismiss} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("surfaces errorMessage verbatim", () => {
    const dismiss = vi.fn();
    render(
      <JobErrorBanner
        job={makeJob({ status: "FAILED", errorMessage: "spec_extract failed" })}
        onDismiss={dismiss}
      />,
    );
    expect(screen.getByTestId("job-error-banner").textContent).toContain(
      "spec_extract failed",
    );
  });

  it('falls back to "An unknown error occurred." when errorMessage is null', () => {
    const dismiss = vi.fn();
    render(
      <JobErrorBanner
        job={makeJob({ status: "FAILED", errorMessage: null })}
        onDismiss={dismiss}
      />,
    );
    expect(screen.getByTestId("job-error-banner").textContent).toContain(
      "An unknown error occurred.",
    );
  });

  it("invokes onDismiss when start-over is clicked", () => {
    const dismiss = vi.fn();
    render(
      <JobErrorBanner
        job={makeJob({ status: "FAILED", errorMessage: "x" })}
        onDismiss={dismiss}
      />,
    );
    fireEvent.click(screen.getByText("Start a new brief"));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("JobCancelledBanner", () => {
  it("renders nothing when status is not CANCELLED", () => {
    const dismiss = vi.fn();
    const { container } = render(
      <JobCancelledBanner
        job={makeJob({ status: "RUNNING" })}
        onDismiss={dismiss}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders cancellation copy + dismiss button when CANCELLED", () => {
    const dismiss = vi.fn();
    render(
      <JobCancelledBanner
        job={makeJob({ status: "CANCELLED" })}
        onDismiss={dismiss}
      />,
    );
    expect(screen.getByTestId("job-cancelled-banner").textContent).toContain(
      "Job cancelled",
    );
    fireEvent.click(screen.getByText("Start a new brief"));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
