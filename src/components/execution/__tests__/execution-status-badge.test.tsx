// @vitest-environment happy-dom
/**
 * Tests for `<ExecutionStatusBadge>` — renders all 5 statuses
 * (Phase v3 observability §D5 acceptance gate 11).
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { ExecutionStatusBadge } from "../execution-status-badge";

describe("ExecutionStatusBadge", () => {
  it.each([
    ["PENDING",   "Queued"],
    ["RUNNING",   "Running"],
    ["COMPLETED", "Completed"],
    ["FAILED",    "Failed"],
    ["CANCELLED", "Cancelled"],
  ] as const)("renders %s with label %s", (status, expectedLabel) => {
    const { getByTestId } = render(<ExecutionStatusBadge status={status} />);
    const el = getByTestId(`execution-status-badge-${status}`);
    expect(el.textContent).toContain(expectedLabel);
  });

  it("RUNNING uses role=progressbar for screen readers", () => {
    const { getByRole } = render(<ExecutionStatusBadge status="RUNNING" />);
    expect(getByRole("progressbar")).toBeTruthy();
  });

  it("terminal statuses use role=status", () => {
    const { getByRole } = render(<ExecutionStatusBadge status="COMPLETED" />);
    expect(getByRole("status")).toBeTruthy();
  });
});
