/**
 * BriefUploader — drag-drop UI + integration with the upload hook.
 *
 * The hook is exercised end-to-end via the same XHR + fetch stubs as
 * `use-brief-render-upload.test.ts`, then we assert the UI reacts and
 * eventually invokes `onJobCreated` with the new jobId.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

import { BriefUploader } from "@/features/brief-renders/components/BriefUploader";

interface MockXhr {
  open: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  upload: { addEventListener: ReturnType<typeof vi.fn> };
  addEventListener: ReturnType<typeof vi.fn>;
  responseText: string;
  status: number;
  withCredentials: boolean;
  __listeners: Record<string, Array<(e: Event) => void>>;
}

let lastXhr: MockXhr | null = null;
let fetchSpy: ReturnType<typeof vi.fn>;

// Constructor-friendly XHR stub. `vi.fn(() => obj)` is an arrow function
// and arrow functions cannot be invoked with `new`. We use a regular
// function so the hook's `new XMLHttpRequest()` succeeds.
function StubXhrConstructor(this: MockXhr): void {
  const listeners: Record<string, Array<(e: Event) => void>> = {};
  Object.assign(this, {
    open: vi.fn(),
    send: vi.fn(),
    abort: vi.fn(),
    upload: { addEventListener: vi.fn() },
    addEventListener: vi.fn((evt: string, fn: (e: Event) => void) => {
      (listeners[evt] ??= []).push(fn);
    }),
    responseText: "",
    status: 0,
    withCredentials: false,
    __listeners: listeners,
  });
  lastXhr = this;
}

beforeEach(() => {
  lastXhr = null;
  vi.stubGlobal("XMLHttpRequest", StubXhrConstructor);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fireXhrLoad(status: number, body: string): void {
  if (!lastXhr) throw new Error("No XHR captured");
  lastXhr.status = status;
  lastXhr.responseText = body;
  for (const fn of lastXhr.__listeners.load ?? []) fn(new Event("load"));
}

function pdfFile(name = "brief.pdf", size = 100): File {
  const buf = new Uint8Array(size);
  buf.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return new File([buf], name, { type: "application/pdf" });
}

describe("BriefUploader", () => {
  it("renders the drop zone + hidden file input", () => {
    render(<BriefUploader onJobCreated={vi.fn()} />);
    expect(screen.getByTestId("brief-uploader-dropzone")).toBeTruthy();
    expect(screen.getByTestId("brief-uploader-input")).toBeTruthy();
    expect(
      screen.getByText(/Drag a brief here, or click to browse/),
    ).toBeTruthy();
  });

  it("disabled prop locks the drop zone", () => {
    render(<BriefUploader onJobCreated={vi.fn()} disabled />);
    const dz = screen.getByTestId("brief-uploader-dropzone");
    expect(dz.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows validation error inline for non-PDF/DOCX file", async () => {
    render(<BriefUploader onJobCreated={vi.fn()} />);
    const input = screen.getByTestId("brief-uploader-input") as HTMLInputElement;
    const bad = new File([new Uint8Array(10)], "x.exe");
    fireEvent.change(input, { target: { files: [bad] } });
    await waitFor(() =>
      expect(screen.getByTestId("brief-uploader-error")).toBeTruthy(),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("upload → create-job → onJobCreated happy path", async () => {
    const onJobCreated = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jobId: "job-abc" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<BriefUploader onJobCreated={onJobCreated} />);
    const input = screen.getByTestId("brief-uploader-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdfFile()] } });

    await waitFor(() => expect(lastXhr).not.toBeNull());

    await act(async () => {
      fireXhrLoad(
        200,
        JSON.stringify({
          briefUrl: "https://r2/briefs/x.pdf",
          fileName: "brief.pdf",
          fileSize: 100,
        }),
      );
    });

    await waitFor(() => expect(onJobCreated).toHaveBeenCalledWith("job-abc"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/brief-renders");
  });

  it("upload XHR error surfaces inline + offers retry", async () => {
    render(<BriefUploader onJobCreated={vi.fn()} />);
    const input = screen.getByTestId("brief-uploader-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdfFile()] } });
    await waitFor(() => expect(lastXhr).not.toBeNull());
    await act(async () => {
      fireXhrLoad(500, "internal error");
    });
    await waitFor(() =>
      expect(screen.getByTestId("brief-uploader-error")).toBeTruthy(),
    );
    expect(screen.getByText("Try again")).toBeTruthy();
  });
});
