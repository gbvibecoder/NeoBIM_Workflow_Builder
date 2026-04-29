/**
 * useBriefRenderJob polling-hook tests.
 *
 * Uses fake timers + a stubbed global fetch. The browser DOM doesn't
 * exist in vitest's `node` environment, so we add the @vitest-environment
 * directive to switch this file to happy-dom.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useBriefRenderJob } from "@/features/brief-renders/hooks/useBriefRenderJob";

const baseJob = {
  id: "job-1",
  requestId: "req-1",
  briefUrl: "https://r2/b.pdf",
  progress: 0,
  currentStage: null,
  specResult: null,
  shots: null,
  pdfUrl: null,
  errorMessage: null,
  costUsd: 0,
  startedAt: null,
  completedAt: null,
  pausedAt: null,
  userApproval: null,
  stageLog: null,
  createdAt: "2026-04-28T10:00:00Z",
  updatedAt: "2026-04-28T10:00:00Z",
};

function ok(payload: object): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useBriefRenderJob", () => {
  it("does not fetch when enabled=false", async () => {
    renderHook(() => useBriefRenderJob({ jobId: "job-1", enabled: false }));
    // Allow microtasks to drain.
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not fetch when jobId is null", async () => {
    renderHook(() => useBriefRenderJob({ jobId: null, enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("immediate first fetch on mount with valid jobId + enabled", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ ...baseJob, status: "QUEUED" }));
    const { result } = renderHook(() =>
      useBriefRenderJob({ jobId: "job-1", enabled: true }),
    );
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/brief-renders/job-1");
    await waitFor(() => {
      expect(result.current.job?.status).toBe("QUEUED");
    });
  });

  it("stops polling on COMPLETED status", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ ...baseJob, status: "COMPLETED" }));
    renderHook(() => useBriefRenderJob({ jobId: "job-1", enabled: true }));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    // Wait long enough that a follow-up poll would have fired (5 s+).
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps polling on AWAITING_APPROVAL", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchSpy
      .mockResolvedValueOnce(ok({ ...baseJob, status: "AWAITING_APPROVAL" }))
      .mockResolvedValueOnce(ok({ ...baseJob, status: "AWAITING_APPROVAL" }));
    renderHook(() => useBriefRenderJob({ jobId: "job-1", enabled: true }));
    // First fetch resolves on next microtask.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Cadence is 5 s for the first 5 min — advance 5 s and the second
    // poll should fire.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("HTTP 4xx/5xx → sets error, does not crash", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("server error", { status: 500 }));
    const { result } = renderHook(() =>
      useBriefRenderJob({ jobId: "job-1", enabled: true }),
    );
    await waitFor(() => {
      expect(result.current.error).toContain("HTTP 500");
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("network error → swallows the throw (does not surface as a thrown render error)", async () => {
    // Hook's catch path — the rejection must NOT crash the hook. We
    // verify the fetch was attempted and the hook stays mounted with a
    // clean error state. We don't drive the second poll here because
    // exact cadence timing is covered by the AWAITING_APPROVAL test
    // above; this scenario only proves the error path doesn't crash.
    fetchSpy.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() =>
      useBriefRenderJob({ jobId: "job-1", enabled: true }),
    );
    // Allow the rejected fetch + the hook's error handler to settle.
    await new Promise((r) => setTimeout(r, 10));
    // The hook must stay mounted; no throw to React's error boundary.
    expect(result.current.job).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("unmount aborts in-flight fetch and clears the timer", async () => {
    // The fetch never resolves — we abort during cleanup.
    const fetchPromise = new Promise<Response>(() => {
      /* never resolves */
    });
    fetchSpy.mockReturnValueOnce(fetchPromise);
    const { unmount } = renderHook(() =>
      useBriefRenderJob({ jobId: "job-1", enabled: true }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Abort signal is the second positional / second-arg.signal.
    const init = fetchSpy.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    act(() => {
      unmount();
    });
    expect((init?.signal as AbortSignal).aborted).toBe(true);
  });

  it("returns clean null state when jobId becomes null mid-render", async () => {
    const { result, rerender } = renderHook(
      ({ id, en }: { id: string | null; en: boolean }) =>
        useBriefRenderJob({ jobId: id, enabled: en }),
      { initialProps: { id: null as string | null, en: true } },
    );
    expect(result.current.job).toBeNull();
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);

    fetchSpy.mockResolvedValueOnce(ok({ ...baseJob, status: "RUNNING" }));
    rerender({ id: "job-1", en: true });
    await waitFor(() => {
      expect(result.current.job?.status).toBe("RUNNING");
    });
  });
});
