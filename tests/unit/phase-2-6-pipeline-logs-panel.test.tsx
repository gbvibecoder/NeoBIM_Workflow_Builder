// @vitest-environment happy-dom
/**
 * Phase 2.6 — PipelineLogsPanel component tests.
 *
 * The panel renders VIP pipeline stage telemetry polled from the
 * server. These tests lock in:
 *   - empty state (nothing written yet + pipeline idle) renders nothing
 *   - stages render with correct status icons and per-row metadata
 *   - clicking a row with output toggles the JSON preview
 *   - the footer aggregates total cost / duration / progress
 *   - Copy All Logs writes JSON to the clipboard
 *   - failed stages raise the footer alert banner
 *   - pending (not-yet-started) stages are rendered as placeholders
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { PipelineLogsPanel } from "@/features/floor-plan/components/PipelineLogsPanel";
import type { StageLogEntry } from "@/features/floor-plan/lib/vip-pipeline/types";

function entry(partial: Partial<StageLogEntry> & { stage: number; status: StageLogEntry["status"] }): StageLogEntry {
  return {
    name: `Stage ${partial.stage}`,
    startedAt: "2026-04-21T00:00:00.000Z",
    ...partial,
  } as StageLogEntry;
}

describe("PipelineLogsPanel — empty / idle state", () => {
  it("renders nothing when log is empty and pipeline is idle", () => {
    const { container } = render(
      <PipelineLogsPanel stageLog={[]} pipelineStatus="idle" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when log is empty but pipeline is polling", () => {
    render(<PipelineLogsPanel stageLog={[]} pipelineStatus="polling" />);
    expect(screen.getByRole("region", { name: /Pipeline Logs/i })).toBeTruthy();
  });
});

describe("PipelineLogsPanel — row rendering", () => {
  it("renders each stage entry with name and duration", () => {
    render(
      <PipelineLogsPanel
        stageLog={[
          entry({ stage: 1, status: "success", name: "Prompt Intelligence", durationMs: 8300, costUsd: 0.015 }),
          entry({ stage: 2, status: "success", name: "Parallel Image Gen", durationMs: 32000, costUsd: 0.034 }),
        ]}
        pipelineStatus="polling"
      />,
    );
    expect(screen.getByText("Prompt Intelligence")).toBeTruthy();
    expect(screen.getByText("Parallel Image Gen")).toBeTruthy();
    // Durations formatted as seconds with one decimal
    expect(screen.getByText("8.3s")).toBeTruthy();
    expect(screen.getByText("32.0s")).toBeTruthy();
    // Cost present
    expect(screen.getByText("$0.015")).toBeTruthy();
    expect(screen.getByText("$0.034")).toBeTruthy();
  });

  it("uses ⏳ for running entries, ✓ for success, ✗ for failed", () => {
    render(
      <PipelineLogsPanel
        stageLog={[
          entry({ stage: 1, status: "success", name: "Brief", durationMs: 1000 }),
          entry({ stage: 2, status: "failed", name: "Image", durationMs: 1000, error: "content filter" }),
          entry({ stage: 3, status: "running", name: "Jury" }),
        ]}
        pipelineStatus="polling"
      />,
    );
    const rows = screen.getAllByTestId("pipeline-logs-row");
    // First three rows correspond to logged stages
    expect(rows[0].textContent).toContain("✓");
    expect(rows[1].textContent).toContain("✗");
    expect(rows[2].textContent).toContain("⏳");
  });

  it("fills in placeholder rows for stages not yet started while polling", () => {
    render(
      <PipelineLogsPanel
        stageLog={[entry({ stage: 1, status: "success", name: "Brief", durationMs: 1000 })]}
        pipelineStatus="polling"
      />,
    );
    const rows = screen.getAllByTestId("pipeline-logs-row");
    // 1 real + 6 placeholders for stages 2-7
    expect(rows.length).toBe(7);
    // Placeholders use hollow circle
    expect(rows[rows.length - 1].textContent).toContain("◯");
  });
});

describe("PipelineLogsPanel — row expand / collapse", () => {
  it("clicking a row with output reveals the JSON preview", () => {
    render(
      <PipelineLogsPanel
        stageLog={[
          entry({
            stage: 1,
            status: "success",
            name: "Brief",
            durationMs: 1000,
            output: { rooms: 8, plot: { width: 30, depth: 50 } },
          }),
        ]}
        pipelineStatus="polling"
      />,
    );
    expect(screen.queryByTestId("pipeline-logs-row-output")).toBeNull();
    fireEvent.click(screen.getAllByTestId("pipeline-logs-row")[0]);
    const out = screen.getByTestId("pipeline-logs-row-output");
    expect(out.textContent).toContain("rooms");
    expect(out.textContent).toContain("8");
  });

  it("rows without output are not clickable/expandable", () => {
    render(
      <PipelineLogsPanel
        stageLog={[entry({ stage: 1, status: "running", name: "Brief" })]}
        pipelineStatus="polling"
      />,
    );
    fireEvent.click(screen.getAllByTestId("pipeline-logs-row")[0]);
    expect(screen.queryByTestId("pipeline-logs-row-output")).toBeNull();
  });
});

describe("PipelineLogsPanel — footer totals", () => {
  it("sums cost + duration and shows progress fraction", () => {
    render(
      <PipelineLogsPanel
        stageLog={[
          entry({ stage: 1, status: "success", name: "Brief", durationMs: 8_000, costUsd: 0.015 }),
          entry({ stage: 2, status: "success", name: "Image", durationMs: 32_000, costUsd: 0.034 }),
          entry({ stage: 3, status: "success", name: "Jury", durationMs: 5_000, costUsd: 0.015 }),
        ]}
        pipelineStatus="polling"
      />,
    );
    // 3/7 success against default expectedStages
    expect(screen.getByText("3/7")).toBeTruthy();
    // 0.015 + 0.034 + 0.015 = 0.064
    expect(screen.getByText("$0.064")).toBeTruthy();
    // 45s total
    expect(screen.getByText("45.0s")).toBeTruthy();
  });

  it("raises a failure alert when any stage is failed", () => {
    render(
      <PipelineLogsPanel
        stageLog={[entry({ stage: 2, status: "failed", name: "Image", error: "boom", durationMs: 1000 })]}
        pipelineStatus="failed"
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/One or more stages failed/i);
  });
});

describe("PipelineLogsPanel — clipboard + download", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("Copy All Logs writes the JSON to navigator.clipboard", async () => {
    const log = [entry({ stage: 1, status: "success", name: "Brief", durationMs: 1000 })];
    render(<PipelineLogsPanel stageLog={log} pipelineStatus="completed" />);
    fireEvent.click(screen.getByRole("button", { name: /Copy all logs/i }));
    // writeText is async — give it a tick
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0][0] as string;
    expect(arg).toContain('"stage": 1');
    expect(arg).toContain('"name": "Brief"');
  });
});
