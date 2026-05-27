// @vitest-environment happy-dom
/**
 * Tests for useDrawingArtifactHydration.
 *
 * Uses `render` + an inline test harness component so we can drive
 * `messages` and inspect the setter mock without a full ChatSurface
 * wiring.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";

import { useDrawingArtifactHydration } from "../useDrawingArtifactHydration";
import type { UIMessage } from "@/features/kos/types/chat";
import type { ArtifactBubbleState } from "@/features/kos/components/ArtifactBubble";

function buildCustomerMessage(refs: string[]): UIMessage {
  return {
    id: `m-${refs.join(",")}`,
    role: "customer",
    content: "process",
    timestamp: Date.now(),
    attachmentRefs: refs,
  };
}

interface HarnessProps {
  messages: UIMessage[];
  setDrawingArtifacts: (
    updater: (prev: Record<string, ArtifactBubbleState>) => Record<string, ArtifactBubbleState>,
  ) => void;
  fetchImpl: typeof fetch;
}

function Harness({ messages, setDrawingArtifacts, fetchImpl }: HarnessProps) {
  useDrawingArtifactHydration(messages, setDrawingArtifacts, { fetchImpl });
  return null;
}

function makeFetchMock(
  responseFor: (url: string) => Response | Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return responseFor(url);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(cleanup);

describe("useDrawingArtifactHydration", () => {
  it("empty messages → no fetch", async () => {
    const fetchMock = makeFetchMock(() => jsonResponse({}));
    const setter = vi.fn();
    render(<Harness messages={[]} setDrawingArtifacts={setter} fetchImpl={fetchMock} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it("one customer message with one drawingId → one fetch", async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({
        drawingId: "draw_1",
        filename: "Plan.dxf",
        status: "PARSED",
        hasMapper: true,
        boq: {
          boqId: "boq_x",
          totalStandardPanels: 100,
          grandTotalInrFormatted: "₹1L",
          customQuotesPendingCount: 0,
          warningsCount: 0,
          downloadUrl: "/api/kos/customer/drawings/draw_1/boq/download",
        },
        formwork: null,
      }),
    );
    const setter = vi.fn();
    render(
      <Harness
        messages={[buildCustomerMessage(["draw_1"])]}
        setDrawingArtifacts={setter}
        fetchImpl={fetchMock}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toBe("/api/kos/customer/drawings/draw_1");
    expect(setter).toHaveBeenCalled();
  });

  it("multiple messages with overlapping refs → de-duped fetches", async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({
        drawingId: "draw_1",
        filename: "x.dxf",
        status: "PARSED",
        hasMapper: true,
      }),
    );
    const setter = vi.fn();
    render(
      <Harness
        messages={[buildCustomerMessage(["draw_1"]), buildCustomerMessage(["draw_1"])]}
        setDrawingArtifacts={setter}
        fetchImpl={fetchMock}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-render with same drawingId → fetched only once across renders (hydratedIdsRef)", async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({
        drawingId: "draw_1",
        filename: "x.dxf",
        status: "PARSED",
        hasMapper: true,
      }),
    );
    const setter = vi.fn();
    const { rerender } = render(
      <Harness
        messages={[buildCustomerMessage(["draw_1"])]}
        setDrawingArtifacts={setter}
        fetchImpl={fetchMock}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Re-render with a NEW messages array (same drawingId)
    rerender(
      <Harness
        messages={[buildCustomerMessage(["draw_1"]), buildCustomerMessage(["draw_1"])]}
        setDrawingArtifacts={setter}
        fetchImpl={fetchMock}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("404 response → marks hydrated, no setter call for that id (graceful)", async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({ error_code: "KOS_DL_SUMMARY_001" }, 404),
    );
    const setter = vi.fn();
    render(
      <Harness
        messages={[buildCustomerMessage(["orphan"])]}
        setDrawingArtifacts={setter}
        fetchImpl={fetchMock}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setter).not.toHaveBeenCalled();
  });

  it("fetch throws → marks hydrated, no setter call, no crash", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    const setter = vi.fn();
    render(
      <Harness
        messages={[buildCustomerMessage(["draw_x"])]}
        setDrawingArtifacts={setter}
        fetchImpl={fetchMock}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(setter).not.toHaveBeenCalled();
  });

  it("SSE-fresh state (status === COMPLETE) is NOT regressed by hydration", async () => {
    const fetchMock = makeFetchMock(() =>
      jsonResponse({
        drawingId: "draw_1",
        filename: "Plan.dxf",
        status: "PARSED", // server says PARSED but client is COMPLETE
        hasMapper: true,
        boq: {
          boqId: "boq_x",
          totalStandardPanels: 100,
          grandTotalInrFormatted: "₹1L",
          customQuotesPendingCount: 0,
          warningsCount: 0,
          downloadUrl: "/url",
        },
      }),
    );

    // Capture the merged state by simulating real Record<string, ArtifactBubbleState>
    let state: Record<string, ArtifactBubbleState> = {
      draw_1: {
        drawingId: "draw_1",
        filename: "Plan.dxf",
        status: "COMPLETE", // SSE-fresh
      },
    };
    const setter = (
      updater: (prev: Record<string, ArtifactBubbleState>) => Record<string, ArtifactBubbleState>,
    ) => {
      state = updater(state);
    };

    render(
      <Harness
        messages={[buildCustomerMessage(["draw_1"])]}
        setDrawingArtifacts={setter}
        fetchImpl={fetchMock}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Status preserved as COMPLETE — NOT regressed to PARSED-derived state
    expect(state.draw_1.status).toBe("COMPLETE");
    // Download URL merged in from hydration
    expect(state.draw_1.boqDownloadUrl).toBe("/url");
  });

  it("ignores bot-role messages", async () => {
    const fetchMock = makeFetchMock(() => jsonResponse({}));
    const setter = vi.fn();
    const botMsg: UIMessage = {
      id: "b",
      role: "bot",
      content: "",
      timestamp: Date.now(),
      attachmentRefs: ["draw_x"], // shouldn't happen but defensive
    };
    render(
      <Harness messages={[botMsg]} setDrawingArtifacts={setter} fetchImpl={fetchMock} />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects HYDRATION_CONCURRENCY (chunks 10 ids into batches of 5)", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `d${i}`);
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const setter = vi.fn();
    render(
      <Harness
        messages={[buildCustomerMessage(ids)]}
        setDrawingArtifacts={setter}
        fetchImpl={fetchMock}
      />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });
});
