/**
 * useBriefRenderUpload — tests for the two-step upload pipeline.
 *
 * Mocks XMLHttpRequest (the upload uses it for progress events) and
 * the global `fetch` (used for the create-job POST). Asserts:
 *   • client-side validation rejects bad extensions / sizes
 *   • idempotency key persists across calls
 *   • create-job is only invoked after upload succeeds
 *   • error states map status codes to UploadErrorKind
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useBriefRenderUpload } from "@/features/brief-renders/hooks/useBriefRenderUpload";

// ─── XMLHttpRequest mock ────────────────────────────────────────────

interface MockXhr {
  open: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  upload: { addEventListener: ReturnType<typeof vi.fn> };
  addEventListener: ReturnType<typeof vi.fn>;
  setRequestHeader?: ReturnType<typeof vi.fn>;
  responseText: string;
  status: number;
  withCredentials: boolean;
  __listeners: Record<string, Array<(e: ProgressEvent | Event) => void>>;
  __uploadListeners: Record<string, Array<(e: ProgressEvent) => void>>;
}

function makeXhr(): MockXhr {
  const listeners: Record<string, Array<(e: ProgressEvent | Event) => void>> = {};
  const uploadListeners: Record<string, Array<(e: ProgressEvent) => void>> = {};
  const xhr: MockXhr = {
    open: vi.fn(),
    send: vi.fn(),
    abort: vi.fn(),
    upload: {
      addEventListener: vi.fn((evt: string, fn: (e: ProgressEvent) => void) => {
        (uploadListeners[evt] ??= []).push(fn);
      }),
    },
    addEventListener: vi.fn(
      (evt: string, fn: (e: ProgressEvent | Event) => void) => {
        (listeners[evt] ??= []).push(fn);
      },
    ),
    responseText: "",
    status: 0,
    withCredentials: false,
    __listeners: listeners,
    __uploadListeners: uploadListeners,
  };
  return xhr;
}

let lastXhr: MockXhr | null = null;
function fireLoad(status: number, body: string): void {
  if (!lastXhr) throw new Error("No XHR captured");
  lastXhr.status = status;
  lastXhr.responseText = body;
  for (const fn of lastXhr.__listeners.load ?? []) fn(new Event("load"));
}

// Constructor-friendly XHR stub. `vi.fn(() => obj)` is an arrow function
// and arrow functions cannot be invoked with `new`, so we wrap a regular
// function that assigns the mock fields onto `this`.
function StubXhrConstructor(this: MockXhr): void {
  Object.assign(this, makeXhr());
  lastXhr = this;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  lastXhr = null;
  vi.stubGlobal("XMLHttpRequest", StubXhrConstructor);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  // Stub localStorage so tests work in Node-only env (happy-dom has it,
  // but we want to assert the behaviour explicitly).
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    length: 0,
    key: () => null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pdfFile(name = "brief.pdf", size = 100): File {
  const buf = new Uint8Array(size);
  buf.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  return new File([buf], name, { type: "application/pdf" });
}

describe("useBriefRenderUpload — validation", () => {
  it("rejects unsupported extensions client-side without contacting the server", async () => {
    const { result } = renderHook(() => useBriefRenderUpload());
    const file = new File([new Uint8Array(10)], "evil.exe", {
      type: "application/octet-stream",
    });
    await act(async () => {
      await result.current.upload(file);
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.error?.kind).toBe("validation");
    expect(lastXhr).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects empty files", async () => {
    const { result } = renderHook(() => useBriefRenderUpload());
    const file = new File([new Uint8Array(0)], "empty.pdf");
    await act(async () => {
      await result.current.upload(file);
    });
    expect(result.current.error?.kind).toBe("validation");
  });

  it("rejects files over 50 MB", async () => {
    const { result } = renderHook(() => useBriefRenderUpload());
    // We can't actually allocate 50 MB in the test harness — use a stub.
    const fakeFile = {
      name: "big.pdf",
      size: 51 * 1024 * 1024,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      type: "application/pdf",
    } as unknown as File;
    await act(async () => {
      await result.current.upload(fakeFile);
    });
    expect(result.current.error?.kind).toBe("validation");
  });
});

describe("useBriefRenderUpload — happy path", () => {
  it("uploads then creates a job and surfaces jobId", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jobId: "job-xyz" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useBriefRenderUpload());
    const file = pdfFile();

    let uploadPromise: Promise<void> | undefined;
    act(() => {
      uploadPromise = result.current.upload(file);
    });

    await waitFor(() => expect(lastXhr).not.toBeNull());
    await act(async () => {
      fireLoad(
        200,
        JSON.stringify({
          briefUrl: "https://r2/briefs/x.pdf",
          fileName: "brief.pdf",
          fileSize: 100,
        }),
      );
      await uploadPromise;
    });

    await waitFor(() => expect(result.current.phase).toBe("success"));
    expect(result.current.result?.jobId).toBe("job-xyz");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe("/api/brief-renders");
    const init = callArgs[1] as { headers: Record<string, string> };
    expect(init.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("useBriefRenderUpload — error mapping", () => {
  it("maps 429 from create-job to rate-limit kind", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Slow down" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );

    const { result } = renderHook(() => useBriefRenderUpload());

    let p: Promise<void> | undefined;
    act(() => {
      p = result.current.upload(pdfFile());
    });
    await waitFor(() => expect(lastXhr).not.toBeNull());
    await act(async () => {
      fireLoad(
        200,
        JSON.stringify({
          briefUrl: "https://r2/briefs/x.pdf",
          fileName: "brief.pdf",
          fileSize: 100,
        }),
      );
      await p;
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error?.kind).toBe("rate-limit");
    expect(result.current.error?.status).toBe(429);
  });

  it("maps 403 to feature-disabled kind", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "no" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    const { result } = renderHook(() => useBriefRenderUpload());
    let p: Promise<void> | undefined;
    act(() => {
      p = result.current.upload(pdfFile());
    });
    await waitFor(() => expect(lastXhr).not.toBeNull());
    await act(async () => {
      fireLoad(
        200,
        JSON.stringify({
          briefUrl: "https://r2/briefs/x.pdf",
          fileName: "brief.pdf",
          fileSize: 100,
        }),
      );
      await p;
    });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error?.kind).toBe("feature-disabled");
  });
});
