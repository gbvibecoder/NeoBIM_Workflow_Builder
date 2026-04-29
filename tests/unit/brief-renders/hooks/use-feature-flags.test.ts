/**
 * useFeatureFlags — cross-cutting client hook tests.
 *
 * Asserts:
 *   • defaults to all flags off until the fetch lands
 *   • single fetch is shared across consumers (module-cached)
 *   • network failure preserves the safe defaults
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import {
  useFeatureFlags,
  _resetFeatureFlagsCache,
} from "@/hooks/useFeatureFlags";

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _resetFeatureFlagsCache();
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFeatureFlags", () => {
  it("returns DEFAULT_FLAGS synchronously on first render", () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ vipJobsEnabled: true, briefRendersEnabled: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { result } = renderHook(() => useFeatureFlags());
    expect(result.current.briefRendersEnabled).toBe(false);
    expect(result.current.vipJobsEnabled).toBe(false);
  });

  it("updates flags after the fetch resolves", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ vipJobsEnabled: true, briefRendersEnabled: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { result } = renderHook(() => useFeatureFlags());
    await waitFor(() => {
      expect(result.current.briefRendersEnabled).toBe(true);
      expect(result.current.vipJobsEnabled).toBe(true);
    });
  });

  it("merges partial response onto defaults", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ briefRendersEnabled: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { result } = renderHook(() => useFeatureFlags());
    await waitFor(() => {
      expect(result.current.briefRendersEnabled).toBe(true);
    });
    expect(result.current.vipJobsEnabled).toBe(false);
  });

  it("network error preserves default-off state without throwing", async () => {
    fetchSpy.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useFeatureFlags());
    // Wait a tick so the rejected promise resolves.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.briefRendersEnabled).toBe(false);
    expect(result.current.vipJobsEnabled).toBe(false);
  });

  it("non-OK response preserves default-off state", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useFeatureFlags());
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.briefRendersEnabled).toBe(false);
  });

  it("only fetches once even with multiple consumers", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ briefRendersEnabled: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const a = renderHook(() => useFeatureFlags());
    const b = renderHook(() => useFeatureFlags());
    await waitFor(() => expect(a.result.current.briefRendersEnabled).toBe(true));
    await waitFor(() => expect(b.result.current.briefRendersEnabled).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
