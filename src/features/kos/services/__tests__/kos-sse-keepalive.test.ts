/**
 * Tests for startSseKeepalive — fake timers + mock controller.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  startSseKeepalive,
  __SSE_KEEPALIVE_PAYLOAD_FOR_TESTS,
} from "../kos-sse-keepalive";
import { kosLog } from "@/features/kos/lib/kos-logger";

function makeMockController(): {
  controller: ReadableStreamDefaultController<Uint8Array>;
  enqueueMock: ReturnType<typeof vi.fn>;
} {
  const enqueueMock = vi.fn();
  const controller = {
    enqueue: enqueueMock,
    close: vi.fn(),
    error: vi.fn(),
    desiredSize: 1,
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, enqueueMock };
}

describe("startSseKeepalive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes ': keepalive\\n\\n' to the controller every intervalMs", () => {
    const { controller, enqueueMock } = makeMockController();
    const encoder = new TextEncoder();
    const stop = startSseKeepalive(controller, encoder, 100);

    vi.advanceTimersByTime(100);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(300);
    expect(enqueueMock).toHaveBeenCalledTimes(5);

    // Verify the exact payload bytes
    const written = enqueueMock.mock.calls[0][0] as Uint8Array;
    expect(new TextDecoder().decode(written)).toBe(
      __SSE_KEEPALIVE_PAYLOAD_FOR_TESTS,
    );
    expect(new TextDecoder().decode(written)).toBe(": keepalive\n\n");

    stop();
  });

  it("stop() prevents further writes", () => {
    const { controller, enqueueMock } = makeMockController();
    const stop = startSseKeepalive(controller, new TextEncoder(), 100);

    vi.advanceTimersByTime(100);
    expect(enqueueMock).toHaveBeenCalledTimes(1);

    stop();
    vi.advanceTimersByTime(1_000);
    expect(enqueueMock).toHaveBeenCalledTimes(1); // no new writes
  });

  it("multiple stop() calls are idempotent", () => {
    const { controller } = makeMockController();
    const stop = startSseKeepalive(controller, new TextEncoder(), 100);
    expect(() => {
      stop();
      stop();
      stop();
    }).not.toThrow();
  });

  it("silently stops + logs when controller.enqueue throws (stream closed)", () => {
    const { controller, enqueueMock } = makeMockController();
    enqueueMock.mockImplementationOnce(() => {
      throw new TypeError("Cannot enqueue on closed stream");
    });
    const warnSpy = vi.spyOn(kosLog, "warn");

    const stop = startSseKeepalive(controller, new TextEncoder(), 100);
    vi.advanceTimersByTime(100);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "kos_sse_keepalive_write_failed",
      expect.objectContaining({ err: expect.stringContaining("closed stream") }),
    );

    // Confirm no further writes after the failure
    vi.advanceTimersByTime(1_000);
    expect(enqueueMock).toHaveBeenCalledTimes(1);

    stop(); // still idempotent
  });

  it("respects the intervalMs argument (custom interval)", () => {
    const { controller, enqueueMock } = makeMockController();
    const stop = startSseKeepalive(controller, new TextEncoder(), 250);

    vi.advanceTimersByTime(249);
    expect(enqueueMock).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);

    stop();
  });

  it("throws on non-positive interval (programmer error)", () => {
    const { controller } = makeMockController();
    const enc = new TextEncoder();
    expect(() => startSseKeepalive(controller, enc, 0)).toThrow(/positive finite/);
    expect(() => startSseKeepalive(controller, enc, -100)).toThrow(/positive finite/);
    expect(() => startSseKeepalive(controller, enc, Number.NaN)).toThrow(
      /positive finite/,
    );
  });

  it("default 15s interval is unblocked — no writes before 15s elapses", () => {
    const { controller, enqueueMock } = makeMockController();
    const stop = startSseKeepalive(controller, new TextEncoder(), 15_000);

    vi.advanceTimersByTime(14_999);
    expect(enqueueMock).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);

    stop();
  });
});
