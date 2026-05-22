// @vitest-environment happy-dom
/**
 * Test the v3 results-page root component renders all 4 lifecycle
 * states (Phase v3 observability §D5 acceptance gate 11).
 *
 * Strategy: mock `fetch` to return each of the 4 status shapes in
 * turn; assert the right state-branch DOM node is mounted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  fetchMock.mockReset();
});

// Pusher mock — never invoked in these tests beyond construction.
vi.mock("@/lib/pusher-client", () => ({
  getPusherClient: () => null,
}));

import { ExecutionRunRoot } from "../run-root";

function statusResponse(overrides: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "r1",
      status: "PENDING",
      ifcUrl: null,
      entityCount: null,
      errorCode: null,
      errorMessage: null,
      generatorCostUsd: 0,
      generatorMs: 0,
      turns: 0,
      lastHeartbeatAt: null,
      startedAt: null,
      completedAt: null,
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      ...overrides,
    }),
  } as Response;
}

describe("ExecutionRunRoot — 4 lifecycle states", () => {
  it("renders PENDING state", async () => {
    fetchMock.mockResolvedValue(statusResponse({ status: "PENDING" }));
    const { getByTestId } = render(<ExecutionRunRoot runId="r1" />);
    await waitFor(() => {
      expect(getByTestId("state-pending")).toBeTruthy();
    });
  });

  it("renders RUNNING state with heartbeat indicator", async () => {
    fetchMock.mockResolvedValue(statusResponse({
      status: "RUNNING",
      turns: 3,
      generatorCostUsd: 0.42,
      lastHeartbeatAt: new Date(Date.now() - 2_000).toISOString(),
    }));
    const { getByTestId } = render(<ExecutionRunRoot runId="r1" />);
    await waitFor(() => {
      expect(getByTestId("state-running")).toBeTruthy();
      expect(getByTestId("heartbeat-indicator")).toBeTruthy();
    });
  });

  it("renders COMPLETED state with IFC download link", async () => {
    fetchMock.mockResolvedValue(statusResponse({
      status: "COMPLETED",
      ifcUrl: "https://r2.example/file.ifc",
      entityCount: 1234,
      turns: 7,
      generatorCostUsd: 0.86,
    }));
    const { getByTestId } = render(<ExecutionRunRoot runId="r1" />);
    await waitFor(() => {
      expect(getByTestId("state-completed")).toBeTruthy();
      const link = getByTestId("ifc-download-link") as HTMLAnchorElement;
      expect(link.href).toContain("file.ifc");
    });
  });

  it("Phase ε.2 — COMPLETED state renders the Enhance button linking to the viewer with autoEnhance=1", async () => {
    fetchMock.mockResolvedValue(statusResponse({
      status: "COMPLETED",
      ifcUrl: "https://r2.example/villa.ifc",
      entityCount: 2000,
      turns: 50,
      generatorCostUsd: 0.42,
    }));
    const { getByTestId } = render(<ExecutionRunRoot runId="r2" />);
    await waitFor(() => {
      const enhance = getByTestId("enhance-link") as HTMLAnchorElement;
      // Links to the IFC viewer with both ?url= (IFC source) AND
      // ?autoEnhance=1 (the ε.2 opt-in flag that opens the Enhance
      // panel on first render).
      expect(enhance.href).toContain("/dashboard/ifc-viewer");
      expect(enhance.href).toContain("url=");
      expect(enhance.href).toContain(encodeURIComponent("https://r2.example/villa.ifc"));
      expect(enhance.href).toContain("autoEnhance=1");
      // Visually distinguished — the button text signals the photoreal
      // pass with a sparkle emoji.
      expect(enhance.textContent).toMatch(/Enhance/);
    });
  });

  it("Phase ε.2 — the plain 'Open in viewer' link does NOT include autoEnhance (preserves raw-IFC default)", async () => {
    fetchMock.mockResolvedValue(statusResponse({
      status: "COMPLETED",
      ifcUrl: "https://r2.example/file.ifc",
      entityCount: 1234,
      turns: 7,
      generatorCostUsd: 0.86,
    }));
    const { getByTestId } = render(<ExecutionRunRoot runId="r3" />);
    await waitFor(() => {
      const viewer = getByTestId("open-viewer-link") as HTMLAnchorElement;
      expect(viewer.href).toContain("/dashboard/ifc-viewer");
      // The plain "Open in viewer" path stays raw-IFC-by-default per
      // the 2026-05-18 UX baseline. Only the explicit "Enhance" button
      // opts into auto-expanding the Enhance panel.
      expect(viewer.href).not.toContain("autoEnhance");
    });
  });

  it("renders FAILED state with errorCode + retry-context", async () => {
    fetchMock.mockResolvedValue(statusResponse({
      status: "FAILED",
      errorCode: "COST_CAP_EXCEEDED",
      errorMessage: "cap was 0.50 USD",
      turns: 12,
      generatorCostUsd: 0.51,
    }));
    const { getByTestId } = render(<ExecutionRunRoot runId="r1" />);
    await waitFor(() => {
      expect(getByTestId("state-failed")).toBeTruthy();
      const summary = getByTestId("error-summary");
      expect(summary.textContent).toContain("COST_CAP_EXCEEDED");
      expect(summary.textContent).toContain("cap was 0.50 USD");
    });
  });
});
