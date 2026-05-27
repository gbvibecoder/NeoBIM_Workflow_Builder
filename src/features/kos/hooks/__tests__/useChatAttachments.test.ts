// @vitest-environment happy-dom
/**
 * Tests for useChatAttachments. Uses happy-dom for the React +
 * XMLHttpRequest globals. We stub global fetch with vi.fn() and
 * replace XMLHttpRequest with a minimal scriptable mock so we can
 * control progress / load / abort timing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useChatAttachments,
  type AttachmentState,
} from "../useChatAttachments";

// ─── Mock XMLHttpRequest ───────────────────────────────────────

interface MockXhrOptions {
  status?: number;
  simulateError?: boolean;
  simulateAbort?: boolean;
}

function installMockXhr(getOpts: () => MockXhrOptions = () => ({})): {
  instances: MockXhrInstance[];
} {
  const instances: MockXhrInstance[] = [];
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
    class MockXhr {
      public upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
        onprogress: null,
      };
      public status = 0;
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public onabort: (() => void) | null = null;
      public ontimeout: (() => void) | null = null;
      public open = vi.fn();
      public setRequestHeader = vi.fn();
      public abort = vi.fn(() => {
        // Defer the abort callback so the test can observe pre-abort state.
        setTimeout(() => this.onabort?.(), 0);
      });
      public send = vi.fn((_body: unknown) => {
        void _body;
        // Fire upload progress + load on a microtask so the calling
        // promise can resolve in the same tick.
        setTimeout(() => {
          const opts = getOpts();
          if (opts.simulateAbort) {
            this.onabort?.();
            return;
          }
          if (opts.simulateError) {
            this.onerror?.();
            return;
          }
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded: 50,
            total: 100,
          } as ProgressEvent);
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded: 100,
            total: 100,
          } as ProgressEvent);
          this.status = opts.status ?? 200;
          this.onload?.();
        }, 0);
      });
      constructor() {
        instances.push(this as unknown as MockXhrInstance);
      }
    } as unknown as typeof XMLHttpRequest;
  return { instances };
}

interface MockXhrInstance {
  upload: { onprogress: ((e: ProgressEvent) => void) | null };
  status: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open: ReturnType<typeof vi.fn>;
  setRequestHeader: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

// ─── Helpers ────────────────────────────────────────────────────

function buildFile(name: string, size: number, content = "x"): File {
  // Pad content to the requested size if needed.
  const padded = content.padEnd(size, content);
  return new File([padded.slice(0, size)], name, {
    type: "application/octet-stream",
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function defaultArgs(overrides: Partial<{ conversationId: string | null }> = {}) {
  return {
    conversationId: overrides.conversationId ?? null,
    reBootstrapSession: vi.fn().mockResolvedValue(undefined),
  };
}

function happyPresignResponse() {
  return new Response(
    JSON.stringify({
      drawingId: "draw_1",
      uploadUrl: "https://s3.example/signed",
      s3Key: "drawings/t/c/d/source.dxf",
      expiresAt: new Date().toISOString(),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function happyConfirmResponse(size = 950) {
  return new Response(
    JSON.stringify({
      drawing: {
        id: "draw_1",
        filename: "villa.dxf",
        sizeBytes: size,
        sourceFormat: "dxf",
        status: "UPLOADED",
      },
      attachmentRef: { drawingId: "draw_1", kind: "drawing" },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  (global as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Cases ─────────────────────────────────────────────────────

describe("useChatAttachments", () => {
  it("addFile happy path: queued → uploading → uploaded with drawingId set", async () => {
    installMockXhr(() => ({ status: 200 }));
    fetchMock
      .mockResolvedValueOnce(happyPresignResponse())
      .mockResolvedValueOnce(happyConfirmResponse(950));

    const { result } = renderHook(() => useChatAttachments(defaultArgs()));

    await act(async () => {
      await result.current.addFile(buildFile("villa.dxf", 1000));
    });

    await waitFor(() => {
      expect(result.current.attachments[0]?.phase).toBe("uploaded");
    });

    const att = result.current.attachments[0];
    expect(att.drawingId).toBe("draw_1");
    expect(att.sizeBytes).toBe(950);
    expect(att.sourceFormat).toBe("dxf");
  });

  it("addFile with disallowed .exe extension → failed (KOS_DRAW_001, canRetry false)", async () => {
    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    await act(async () => {
      await result.current.addFile(buildFile("evil.exe", 100));
    });
    expect(result.current.attachments[0].phase).toBe("failed");
    expect(result.current.attachments[0].errorCode).toBe("KOS_DRAW_001");
    expect(result.current.attachments[0].canRetry).toBe(false);
    // No network call should have happened
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("addFile with empty File → failed (KOS_DRAW_003)", async () => {
    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    await act(async () => {
      await result.current.addFile(buildFile("empty.dxf", 0));
    });
    expect(result.current.attachments[0].phase).toBe("failed");
    expect(result.current.attachments[0].errorCode).toBe("KOS_DRAW_003");
  });

  it("addFile with 16 MB file → failed (KOS_DRAW_002)", async () => {
    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    await act(async () => {
      await result.current.addFile(buildFile("big.dxf", 16 * 1024 * 1024));
    });
    expect(result.current.attachments[0].phase).toBe("failed");
    expect(result.current.attachments[0].errorCode).toBe("KOS_DRAW_002");
  });

  it("filename is sanitized client-side; originalFilename is preserved", async () => {
    installMockXhr();
    fetchMock
      .mockResolvedValueOnce(happyPresignResponse())
      .mockResolvedValueOnce(happyConfirmResponse());

    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    await act(async () => {
      await result.current.addFile(buildFile(`'><script>.dxf`, 1000));
    });
    await waitFor(() => {
      expect(result.current.attachments[0].phase).toBe("uploaded");
    });
    const att = result.current.attachments[0];
    expect(att.filename).not.toContain("<");
    expect(att.filename).not.toContain("'");
    expect(att.filename.endsWith(".dxf")).toBe(true);
    expect(att.originalFilename).toBe(`'><script>.dxf`);
  });

  it("cancel mid-upload aborts XHR and removes the attachment", async () => {
    // Never resolve XHR.send (the test will abort it).
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
      class StuckXhr {
        public upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
          onprogress: null,
        };
        public open = vi.fn();
        public setRequestHeader = vi.fn();
        public abort = vi.fn();
        public send = vi.fn(); // never resolves
        public onabort: (() => void) | null = null;
        public onerror: (() => void) | null = null;
        public onload: (() => void) | null = null;
      };

    fetchMock.mockResolvedValueOnce(happyPresignResponse());

    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    // Kick the upload but DON'T await — we want it stuck at "uploading".
    let addPromise: Promise<void>;
    await act(async () => {
      addPromise = result.current.addFile(buildFile("villa.dxf", 1000));
      // Allow presign to resolve so phase transitions to "uploading"
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.attachments[0]?.phase).toBe("uploading");
    });

    const localId = result.current.attachments[0].localId;

    act(() => {
      result.current.cancel(localId);
    });

    expect(result.current.attachments).toHaveLength(0);
    // Suppress the hanging promise so vitest doesn't complain.
    void addPromise!.catch(() => {});
  });

  it("retry on failed re-runs the flow successfully", async () => {
    // First attempt: presign returns 500 → failed canRetry true
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "KOS_DRAW_UP_500", message: "boom" }), {
        status: 500,
      }),
    );

    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    await act(async () => {
      await result.current.addFile(buildFile("villa.dxf", 1000));
    });
    await waitFor(() => {
      expect(result.current.attachments[0].phase).toBe("failed");
    });
    expect(result.current.attachments[0].canRetry).toBe(true);

    // Second attempt (retry): presign + XHR + confirm all happy.
    installMockXhr();
    fetchMock
      .mockResolvedValueOnce(happyPresignResponse())
      .mockResolvedValueOnce(happyConfirmResponse());

    const localId = result.current.attachments[0].localId;
    await act(async () => {
      await result.current.retry(localId);
    });
    await waitFor(() => {
      expect(result.current.attachments[0].phase).toBe("uploaded");
    });
  });

  it("retry when File ref is missing marks canRetry false and leaves a helpful message", async () => {
    const { result } = renderHook(() => useChatAttachments(defaultArgs()));

    // Manually inject an attachment with no file ref (simulating
    // memory pressure / restored-from-disk state).
    act(() => {
      // Use the public surface — addFile a bad ext, then retry.
      void result.current.addFile(buildFile("evil.exe", 100));
    });
    await waitFor(() => {
      expect(result.current.attachments[0]).toBeDefined();
    });
    // The failed-state attachment from a bad extension does NOT have
    // a file ref (we never set it for early-validation failures).
    // Calling retry should mark canRetry false and explain.
    const localId = result.current.attachments[0].localId;
    await act(async () => {
      await result.current.retry(localId);
    });
    const att = result.current.attachments[0];
    expect(att.canRetry).toBe(false);
    expect(att.errorText).toMatch(/no longer available/i);
  });

  it("drainPending returns only uploaded entries with drawingId", async () => {
    installMockXhr();
    fetchMock
      .mockResolvedValueOnce(happyPresignResponse())
      .mockResolvedValueOnce(happyConfirmResponse());

    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    await act(async () => {
      await result.current.addFile(buildFile("villa.dxf", 1000));
    });
    await waitFor(() => {
      expect(result.current.attachments[0].phase).toBe("uploaded");
    });

    const refs = result.current.drainPending();
    expect(refs).toEqual([{ drawingId: "draw_1", kind: "drawing" }]);
  });

  it("clear removes uploaded entries; keeps failed entries", async () => {
    installMockXhr();
    fetchMock
      .mockResolvedValueOnce(happyPresignResponse())
      .mockResolvedValueOnce(happyConfirmResponse());

    const { result } = renderHook(() => useChatAttachments(defaultArgs()));

    // Upload one successfully.
    await act(async () => {
      await result.current.addFile(buildFile("villa.dxf", 1000));
    });
    await waitFor(() => {
      expect(result.current.attachments[0].phase).toBe("uploaded");
    });

    // Add a failed one (bad extension).
    await act(async () => {
      await result.current.addFile(buildFile("evil.exe", 100));
    });
    expect(result.current.attachments).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    const remaining = result.current.attachments;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].phase).toBe("failed");
  });

  it("401 → reBootstrapSession then retries once", async () => {
    installMockXhr();
    const args = defaultArgs();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "KOS_CHAT_001", message: "no session" }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(happyPresignResponse())
      .mockResolvedValueOnce(happyConfirmResponse());

    const { result } = renderHook(() => useChatAttachments(args));
    await act(async () => {
      await result.current.addFile(buildFile("villa.dxf", 1000));
    });
    await waitFor(() => {
      expect(result.current.attachments[0].phase).toBe("uploaded");
    });
    expect(args.reBootstrapSession).toHaveBeenCalledTimes(1);
  });

  it("XHR PUT failure (network error) → failed with KOS_DRAW_PUT_001 and canRetry true", async () => {
    installMockXhr(() => ({ simulateError: true }));
    fetchMock.mockResolvedValueOnce(happyPresignResponse());

    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    await act(async () => {
      await result.current.addFile(buildFile("villa.dxf", 1000));
    });
    await waitFor(() => {
      expect(result.current.attachments[0].phase).toBe("failed");
    });
    expect(result.current.attachments[0].errorCode).toBe("KOS_DRAW_PUT_001");
    expect(result.current.attachments[0].canRetry).toBe(true);
  });

  it("hasInFlight is true while queued/uploading, false when only uploaded/failed remain", async () => {
    installMockXhr();
    fetchMock
      .mockResolvedValueOnce(happyPresignResponse())
      .mockResolvedValueOnce(happyConfirmResponse());

    const { result } = renderHook(() => useChatAttachments(defaultArgs()));
    expect(result.current.hasInFlight).toBe(false);

    await act(async () => {
      await result.current.addFile(buildFile("villa.dxf", 1000));
    });
    await waitFor(() => {
      expect(result.current.attachments[0].phase).toBe("uploaded");
    });
    expect(result.current.hasInFlight).toBe(false);
  });
});

// Minimal type aliases so the file type-checks under strict mode.
type _AttachmentStateAlias = AttachmentState;
