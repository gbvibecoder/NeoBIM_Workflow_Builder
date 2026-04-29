/**
 * ShotCell — render-state + regen-action tests.
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ShotCell } from "@/features/brief-renders/components/ShotCell";
import type { ShotResult } from "@/features/brief-renders/services/brief-pipeline/types";

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeShot(overrides: Partial<ShotResult> = {}): ShotResult {
  return {
    shotIndex: 0,
    apartmentIndex: 0,
    shotIndexInApartment: 0,
    status: "success",
    prompt: "p",
    aspectRatio: "3:2",
    templateVersion: "v1",
    imageUrl: "https://r2/s.png",
    errorMessage: null,
    costUsd: 0.25,
    createdAt: "2026-04-28T10:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("ShotCell — render states", () => {
  it("success → renders <img> with imageUrl", () => {
    render(<ShotCell jobId="job-1" shot={makeShot()} label="Apt A · Living" />);
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://r2/s.png");
  });

  it("running → renders shimmer + Rendering label", () => {
    render(
      <ShotCell
        jobId="job-1"
        shot={makeShot({ status: "running", imageUrl: null })}
        label="Apt A · Living"
      />,
    );
    expect(screen.getByText(/Rendering/)).toBeTruthy();
  });

  it("failed → renders error message + regen button", () => {
    render(
      <ShotCell
        jobId="job-1"
        shot={makeShot({
          status: "failed",
          imageUrl: null,
          errorMessage: "rate_limit_exceeded",
        })}
        label="Apt A · Living"
      />,
    );
    expect(screen.getByText("Render failed")).toBeTruthy();
    expect(screen.getByText("rate_limit_exceeded")).toBeTruthy();
    expect(screen.getByTestId("regen-0")).toBeTruthy();
  });

  it("pending → no regen button, no image", () => {
    render(
      <ShotCell
        jobId="job-1"
        shot={makeShot({ status: "pending", imageUrl: null })}
        label="Apt A · Living"
      />,
    );
    expect(screen.queryByTestId("regen-0")).toBeNull();
    expect(screen.getByText("Pending")).toBeTruthy();
  });
});

describe("ShotCell — regenerate action", () => {
  it("POSTs to /api/brief-renders/:jobId/regenerate-shot with idempotency-key", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const onRegen = vi.fn();
    render(
      <ShotCell
        jobId="job-1"
        shot={makeShot()}
        label="Apt A · Living"
        onRegenerated={onRegen}
      />,
    );
    fireEvent.click(screen.getByTestId("regen-0"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/brief-renders/job-1/regenerate-shot");
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body as string)).toEqual({
      apartmentIndex: 0,
      shotIndexInApartment: 0,
    });
    await waitFor(() => expect(onRegen).toHaveBeenCalledTimes(1));
  });

  it("surfaces server error inline without calling onRegenerated", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("server error body", { status: 500 }),
    );
    const onRegen = vi.fn();
    render(
      <ShotCell
        jobId="job-1"
        shot={makeShot()}
        label="Apt A · Living"
        onRegenerated={onRegen}
      />,
    );
    fireEvent.click(screen.getByTestId("regen-0"));
    await waitFor(() =>
      expect(screen.getByText("server error body")).toBeTruthy(),
    );
    expect(onRegen).not.toHaveBeenCalled();
  });

  it("each click mints a fresh idempotency key", async () => {
    // Two fresh Response objects per call so the second click doesn't
    // hit a body-already-consumed error.
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    render(<ShotCell jobId="job-1" shot={makeShot()} label="Living" />);
    fireEvent.click(screen.getByTestId("regen-0"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Wait for the button to come back out of "Queuing…" (busy=false).
    await waitFor(() =>
      expect(screen.getByTestId("regen-0").textContent).toBe("Regenerate"),
    );
    fireEvent.click(screen.getByTestId("regen-0"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const k1 = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const k2 = (fetchSpy.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(k1["idempotency-key"]).not.toBe(k2["idempotency-key"]);
  });

  it("disabled prop hides the regen button", () => {
    render(
      <ShotCell jobId="job-1" shot={makeShot()} label="Living" disabled />,
    );
    expect(screen.queryByTestId("regen-0")).toBeNull();
  });
});
