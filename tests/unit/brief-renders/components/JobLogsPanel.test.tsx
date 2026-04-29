/**
 * JobLogsPanel — admin debug surface tests.
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { JobLogsPanel } from "@/features/brief-renders/components/JobLogsPanel";
import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";

function makeJob(overrides: Partial<BriefRenderJobView> = {}): BriefRenderJobView {
  return {
    id: "job-1",
    requestId: "abcdef0123456789ffffffffffff",
    briefUrl: "https://r2/b.pdf",
    status: "RUNNING",
    progress: 25,
    currentStage: "spec_extracting",
    specResult: null,
    shots: null,
    pdfUrl: null,
    errorMessage: null,
    costUsd: 0.045,
    startedAt: "2026-04-29T10:00:00.000Z",
    completedAt: null,
    pausedAt: null,
    userApproval: null,
    stageLog: null,
    createdAt: "2026-04-29T10:00:00.000Z",
    updatedAt: "2026-04-29T10:00:00.000Z",
    ...overrides,
  };
}

describe("JobLogsPanel — visibility gate", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(<JobLogsPanel job={makeJob()} visible={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the panel when visible=true", () => {
    render(<JobLogsPanel job={makeJob()} visible />);
    expect(screen.getByTestId("job-logs-panel")).toBeTruthy();
  });
});

describe("JobLogsPanel — current state cells", () => {
  it("shows status, current stage, cost", () => {
    render(<JobLogsPanel job={makeJob()} visible />);
    const current = screen.getByTestId("job-logs-current");
    expect(current.textContent).toContain("RUNNING");
    expect(current.textContent).toContain("spec_extracting");
    expect(current.textContent).toContain("$0.045");
  });

  it('falls back to "—" for null currentStage', () => {
    render(<JobLogsPanel job={makeJob({ currentStage: null })} visible />);
    expect(screen.getByTestId("job-logs-current").textContent).toContain("—");
  });
});

describe("JobLogsPanel — stage timeline", () => {
  it("shows empty-state copy when stageLog is null", () => {
    render(<JobLogsPanel job={makeJob({ stageLog: null })} visible />);
    expect(screen.getByTestId("job-logs-stage-list").textContent).toContain(
      "No stages logged yet",
    );
  });

  it("renders one row per log entry with stage number + name", () => {
    const stageLog = [
      {
        stage: 1,
        name: "Spec Extract",
        status: "success" as const,
        startedAt: "2026-04-29T10:00:00.000Z",
        completedAt: "2026-04-29T10:00:30.000Z",
        durationMs: 30_000,
        costUsd: 0.045,
        summary: "Parsed 1 apartment, 12 shots",
        output: null,
        error: null,
      },
      {
        stage: 2,
        name: "Prompt Gen",
        status: "running" as const,
        startedAt: "2026-04-29T10:00:30.000Z",
        completedAt: null,
        durationMs: null,
        costUsd: null,
        summary: null,
        output: null,
        error: null,
      },
    ];
    render(<JobLogsPanel job={makeJob({ stageLog })} visible />);
    const s1 = screen.getByTestId("stage-log-entry-1");
    expect(s1.getAttribute("data-status")).toBe("success");
    expect(s1.textContent).toContain("S1");
    expect(s1.textContent).toContain("Spec Extract");
    expect(s1.textContent).toContain("Parsed 1 apartment, 12 shots");
    expect(s1.textContent).toContain("30.0s");
    expect(s1.textContent).toContain("$0.045");

    const s2 = screen.getByTestId("stage-log-entry-2");
    expect(s2.getAttribute("data-status")).toBe("running");
    expect(s2.textContent).toContain("running…");
  });

  it("renders failed entries with error text inline", () => {
    const stageLog = [
      {
        stage: 1,
        name: "Spec Extract",
        status: "failed" as const,
        startedAt: "2026-04-29T10:00:00.000Z",
        completedAt: "2026-04-29T10:00:05.000Z",
        durationMs: 5_000,
        costUsd: null,
        summary: null,
        output: null,
        error: "Anthropic returned 429 rate limit",
      },
    ];
    render(<JobLogsPanel job={makeJob({ stageLog })} visible />);
    const row = screen.getByTestId("stage-log-entry-1");
    expect(row.textContent).toContain("Anthropic returned 429 rate limit");
  });
});

describe("JobLogsPanel — shot progress strip", () => {
  it("does not render the strip when shots is empty/null", () => {
    render(<JobLogsPanel job={makeJob({ shots: null })} visible />);
    expect(screen.queryByTestId("job-logs-shot-progress")).toBeNull();
  });

  it("aggregates per-status counts", () => {
    const shots = [
      { status: "success" },
      { status: "success" },
      { status: "running" },
      { status: "failed" },
      { status: "pending" },
    ].map((s, i) => ({
      shotIndex: i,
      apartmentIndex: 0,
      shotIndexInApartment: i,
      status: s.status as "pending" | "running" | "success" | "failed",
      prompt: "p",
      aspectRatio: "3:2",
      templateVersion: "v1",
      imageUrl: null,
      errorMessage: null,
      costUsd: null,
      createdAt: "2026-04-29T10:00:00.000Z",
      startedAt: null,
      completedAt: null,
    }));
    render(<JobLogsPanel job={makeJob({ shots })} visible />);
    const strip = screen.getByTestId("job-logs-shot-progress");
    expect(strip.textContent).toContain("✓ 2 success");
    expect(strip.textContent).toContain("▸ 1 running");
    expect(strip.textContent).toContain("✗ 1 failed");
    expect(strip.textContent).toContain("of 5");
  });
});

describe("JobLogsPanel — collapse + error block", () => {
  it("toggles via the header button", () => {
    render(<JobLogsPanel job={makeJob()} visible />);
    const toggle = screen.getByTestId("job-logs-panel-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("job-logs-current")).toBeNull();
  });

  it("renders the job-error block when errorMessage is set", () => {
    render(
      <JobLogsPanel
        job={makeJob({ status: "FAILED", errorMessage: "spec_extract failed" })}
        visible
      />,
    );
    // Error block is the alert div containing both the "Job error:"
    // bold prefix AND the message — querying the alert role gives us
    // the full container.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Job error:");
    expect(alert.textContent).toContain("spec_extract failed");
  });
});
