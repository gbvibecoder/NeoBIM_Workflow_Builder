// @vitest-environment happy-dom
/**
 * Phase 2.9/6 — Pipeline Logs Panel Phase 2.9 enhancement block.
 *
 * Locks in:
 *   - When Stage 5 log entry has enhancement.classified=true and passes
 *     applied, render badge "ON" and rows "applied".
 *   - When classified=true but rollback present, render badge "REVERTED"
 *     with rollback reason visible.
 *   - When classified=false, render badge "OFF" + reasons list.
 *   - Block only appears for Stage 5 entries, not other stages.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { PipelineLogsPanel } from "@/features/floor-plan/components/PipelineLogsPanel";
import type { StageLogEntry } from "@/features/floor-plan/lib/vip-pipeline/types";

function stage5Entry(
  enhancement: Record<string, unknown> | undefined,
): StageLogEntry {
  return {
    stage: 5,
    name: "Synthesis",
    status: "success",
    startedAt: "2026-04-22T00:00:00.000Z",
    durationMs: 1200,
    output: {
      rooms: 5,
      walls: 18,
      path: "fidelity",
      ...(enhancement ? { enhancement } : {}),
    },
  };
}

function expandStage5Row() {
  const rows = screen.getAllByTestId("pipeline-logs-row");
  const stage5Row = rows.find((r) => r.getAttribute("data-stage") === "5");
  if (!stage5Row) throw new Error("Stage 5 row not found");
  fireEvent.click(stage5Row);
}

describe("Phase 2.9 Logs Panel — enhancement block", () => {
  it("renders ON badge + applied rows when classifier + passes succeeded", () => {
    render(
      <PipelineLogsPanel
        stageLog={[
          stage5Entry({
            classified: true,
            plotSize: "standard",
            biasDetected: true,
            residential: true,
            dimCorrectionApplied: true,
            adjEnforcementApplied: true,
          }),
        ]}
        pipelineStatus="completed"
      />,
    );
    expandStage5Row();
    const block = screen.getByTestId("pipeline-logs-phase-29-block");
    expect(block).toBeTruthy();
    expect(block.textContent).toMatch(/ON/);
    expect(block.textContent).toMatch(/dimension correction[\s\S]*applied/);
    expect(block.textContent).toMatch(/adjacency enforcement[\s\S]*applied/);
  });

  it("renders REVERTED badge when either pass rolled back", () => {
    render(
      <PipelineLogsPanel
        stageLog={[
          stage5Entry({
            classified: true,
            dimCorrectionApplied: false,
            dimCorrectionRollback:
              "rollback — correction produced 2 overlaps (Kitchen×Living)",
            adjEnforcementApplied: false,
          }),
        ]}
        pipelineStatus="completed"
      />,
    );
    expandStage5Row();
    const block = screen.getByTestId("pipeline-logs-phase-29-block");
    expect(block.textContent).toMatch(/REVERTED/);
    expect(block.textContent).toMatch(/Kitchen×Living/);
  });

  it("renders OFF badge + reasons when classifier gates enhancement off", () => {
    render(
      <PipelineLogsPanel
        stageLog={[
          stage5Entry({
            classified: false,
            reasons: [
              "no grid-square bias detected in Stage 4 output",
              "brief not supplied — cannot look up target areas",
            ],
          }),
        ]}
        pipelineStatus="completed"
      />,
    );
    expandStage5Row();
    const block = screen.getByTestId("pipeline-logs-phase-29-block");
    expect(block.textContent).toMatch(/OFF/);
    expect(block.textContent).toMatch(/no grid-square bias/);
  });

  it("omits the block when Stage 5 has no enhancement payload", () => {
    render(
      <PipelineLogsPanel
        stageLog={[stage5Entry(undefined)]}
        pipelineStatus="completed"
      />,
    );
    expandStage5Row();
    expect(screen.queryByTestId("pipeline-logs-phase-29-block")).toBeNull();
  });

  it("does not render the block for non-Stage-5 entries", () => {
    const stage6Entry: StageLogEntry = {
      stage: 6,
      name: "Quality Gate",
      status: "success",
      startedAt: "2026-04-22T00:00:00.000Z",
      durationMs: 500,
      output: { enhancement: { classified: true, dimCorrectionApplied: true } },
    };
    render(
      <PipelineLogsPanel stageLog={[stage6Entry]} pipelineStatus="completed" />,
    );
    const rows = screen.getAllByTestId("pipeline-logs-row");
    fireEvent.click(rows[0]);
    expect(screen.queryByTestId("pipeline-logs-phase-29-block")).toBeNull();
  });
});
