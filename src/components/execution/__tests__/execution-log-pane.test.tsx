// @vitest-environment happy-dom
/**
 * Tests for `<ExecutionLogPane>` — covers all 4 connection states
 * (Phase v3 observability §D5 acceptance gate 10).
 *
 * Pusher is stubbed via `vi.mock("@/lib/pusher-client")` so the test
 * has full control over `connection.state` + event delivery. `fetch`
 * is mocked globally to return controlled hydrate responses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock fetch — must be before importing the component.
const fetchMock = vi.fn();
beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  fetchMock.mockReset();
});

// Pusher client mock — exposes a configurable `connection.state` plus
// handler-capture so tests can simulate Pusher state changes.
const pusherHandlers: Record<string, Array<(arg?: unknown) => void>> = {};
const channelHandlers: Record<string, (arg: unknown) => void> = {};
const subscribeMock = vi.fn(() => ({
  bind(eventName: string, handler: (arg: unknown) => void) {
    channelHandlers[eventName] = handler;
  },
}));
const unsubscribeMock = vi.fn();
let pusherConnState = "connected";
vi.mock("@/lib/pusher-client", () => ({
  getPusherClient: () => ({
    subscribe: subscribeMock,
    unsubscribe: unsubscribeMock,
    connection: {
      get state() { return pusherConnState; },
      bind(event: string, h: (arg?: unknown) => void) {
        if (!pusherHandlers[event]) pusherHandlers[event] = [];
        pusherHandlers[event].push(h);
      },
    },
  }),
}));

import { ExecutionLogPane } from "../execution-log-pane";

const HYDRATE_OK = {
  logs: [
    {
      id: "l1",
      executionId: "r1",
      level: "INFO",
      source: "LIFECYCLE",
      message: "Run entered RUNNING state.",
      metadata: null,
      timestamp: "2026-05-15T12:00:00.000Z",
    },
  ],
  pusher: { channel: "private-bf-v3-r1", event: "execution-log:appended" },
};

describe("ExecutionLogPane — connection states", () => {
  it("renders the 'initial' state before hydrate resolves", async () => {
    fetchMock.mockImplementationOnce(
      () => new Promise(() => { /* never */ }),
    );
    pusherConnState = "connected";
    render(<ExecutionLogPane runId="r1" />);
    expect(screen.getByTestId("log-connection-initial")).toBeTruthy();
  });

  it("renders the 'live' state after hydrate AND Pusher reports connected", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => HYDRATE_OK,
    } as Response);
    pusherConnState = "connected";
    render(<ExecutionLogPane runId="r1" />);
    await waitFor(() => {
      expect(screen.getByTestId("log-connection-live")).toBeTruthy();
    });
    expect(screen.getAllByTestId("execution-log-entry").length).toBe(1);
  });

  it("renders the 'reconnecting' state when Pusher state is not 'connected'", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => HYDRATE_OK,
    } as Response);
    pusherConnState = "connecting";
    render(<ExecutionLogPane runId="r1" />);
    await waitFor(() => {
      expect(screen.getByTestId("log-connection-reconnecting")).toBeTruthy();
    });
  });

  it("renders the 'offline' state when initial hydrate returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({}),
    } as Response);
    render(<ExecutionLogPane runId="r1" />);
    await waitFor(() => {
      expect(screen.getByTestId("log-connection-offline")).toBeTruthy();
    });
  });
});
