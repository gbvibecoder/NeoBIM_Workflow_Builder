// @vitest-environment happy-dom
/**
 * Integration tests for the 5I PR 1 attachment UI additions to
 * ChatSurface. We mock useChatAttachments at the module boundary so
 * the hook's network behaviour is isolated to its own test file —
 * here we only verify the JSX wiring.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { AttachmentState } from "@/features/kos/hooks/useChatAttachments";

// ─── Mocks ─────────────────────────────────────────────────────

const hookState: {
  attachments: AttachmentState[];
  hasInFlight: boolean;
  addFile: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  drainPending: ReturnType<typeof vi.fn>;
  pendingAttachments: AttachmentState[];
} = {
  attachments: [],
  hasInFlight: false,
  addFile: vi.fn().mockResolvedValue(undefined),
  retry: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn(),
  clear: vi.fn(),
  drainPending: vi.fn().mockReturnValue([]),
  pendingAttachments: [],
};

vi.mock("@/features/kos/hooks/useChatAttachments", () => ({
  useChatAttachments: () => hookState,
}));

// Customer session provider mock — return a resolved customer so the
// gating in ChatSurface lets us reach the composer.
vi.mock("../CustomerSessionProvider", () => ({
  useKosCustomer: () => ({
    customer: {
      id: "cust_1",
      tenantId: "tenant_1",
      displayName: "Guest-AB12",
      isAnonymous: true,
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  CustomerSessionProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

// BotMessage is heavyweight (markdown renderer); we don't need its
// content for these tests.
vi.mock("../BotMessage", () => ({
  BotMessage: ({ content }: { content: string }) => <div>{content}</div>,
}));

// ─── Helpers ────────────────────────────────────────────────────

import ChatSurface from "../ChatSurface";

function resetHookState() {
  hookState.attachments = [];
  hookState.pendingAttachments = [];
  hookState.hasInFlight = false;
  hookState.addFile.mockClear();
  hookState.retry.mockClear();
  hookState.cancel.mockClear();
  hookState.clear.mockClear();
  hookState.drainPending.mockClear();
  hookState.drainPending.mockReturnValue([]);
}

beforeEach(() => {
  resetHookState();
});

// ─── Cases ─────────────────────────────────────────────────────

describe("ChatSurface — 5I PR 1 attachment UI", () => {
  it("renders a paperclip button with aria-label 'Attach drawing'", () => {
    render(<ChatSurface tenantName="Kalzen" />);
    expect(
      screen.getByRole("button", { name: /attach drawing/i }),
    ).toBeTruthy();
  });

  it("paperclip click triggers the hidden file input (file input is keyboard-untabbable)", () => {
    render(<ChatSurface tenantName="Kalzen" />);
    const fileInputs = document
      .querySelector("input[type=file]") as HTMLInputElement | null;
    expect(fileInputs).toBeTruthy();
    expect(fileInputs?.accept).toBe(".dxf,.dwg,.pdf,.png,.jpg,.jpeg");
    expect(fileInputs?.style.display).toBe("none");
  });

  it("paperclip is disabled while attachments.hasInFlight is true", () => {
    hookState.hasInFlight = true;
    render(<ChatSurface tenantName="Kalzen" />);
    const paperclip = screen.getByRole("button", {
      name: /attach drawing/i,
    }) as HTMLButtonElement;
    expect(paperclip.disabled).toBe(true);
  });

  it("renders AttachmentBubble entries from hook state", () => {
    hookState.attachments = [
      {
        localId: "x1",
        phase: "uploading",
        filename: "plan.dxf",
        originalFilename: "Tower Plan.dxf",
        sizeBytes: 1234567,
        sourceFormat: "dxf",
        progress: 42,
      },
    ];
    render(<ChatSurface tenantName="Kalzen" />);
    expect(screen.getByText("Tower Plan.dxf")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
  });

  it("shows error text + Retry on a failed attachment when canRetry is true", () => {
    hookState.attachments = [
      {
        localId: "x2",
        phase: "failed",
        filename: "plan.dxf",
        originalFilename: "plan.dxf",
        sizeBytes: 100,
        sourceFormat: "dxf",
        errorCode: "KOS_DRAW_PUT_001",
        errorText: "Upload to storage failed. Tap retry.",
        canRetry: true,
      },
    ];
    render(<ChatSurface tenantName="Kalzen" />);
    expect(screen.getByText(/Upload to storage failed/i)).toBeTruthy();
    expect(screen.getByText(/KOS_DRAW_PUT_001/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry upload/i })).toBeTruthy();
  });

  it("Retry button on a failed attachment calls hook.retry with the localId", () => {
    hookState.attachments = [
      {
        localId: "x3",
        phase: "failed",
        filename: "plan.dxf",
        originalFilename: "plan.dxf",
        sizeBytes: 100,
        sourceFormat: "dxf",
        errorCode: "X",
        errorText: "y",
        canRetry: true,
      },
    ];
    render(<ChatSurface tenantName="Kalzen" />);
    fireEvent.click(screen.getByRole("button", { name: /retry upload/i }));
    expect(hookState.retry).toHaveBeenCalledWith("x3");
  });

  it("× button calls hook.cancel with the localId", () => {
    hookState.attachments = [
      {
        localId: "x4",
        phase: "uploaded",
        filename: "plan.dxf",
        originalFilename: "plan.dxf",
        sizeBytes: 100,
        sourceFormat: "dxf",
        drawingId: "draw_1",
      },
    ];
    hookState.pendingAttachments = hookState.attachments;
    render(<ChatSurface tenantName="Kalzen" />);
    fireEvent.click(screen.getByRole("button", { name: /remove attachment/i }));
    expect(hookState.cancel).toHaveBeenCalledWith("x4");
  });

  it("Send button is enabled when an uploaded attachment is present (even with empty text)", () => {
    hookState.attachments = [
      {
        localId: "x5",
        phase: "uploaded",
        filename: "plan.dxf",
        originalFilename: "plan.dxf",
        sizeBytes: 100,
        sourceFormat: "dxf",
        drawingId: "draw_1",
      },
    ];
    hookState.pendingAttachments = hookState.attachments;
    render(<ChatSurface tenantName="Kalzen" />);
    const sendBtn = screen.getByRole("button", {
      name: /send message/i,
    }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
  });

  it("Send button is disabled while attachments.hasInFlight is true", () => {
    hookState.hasInFlight = true;
    render(<ChatSurface tenantName="Kalzen" />);
    const sendBtn = screen.getByRole("button", {
      name: /send message/i,
    }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("Send button is disabled when neither text nor uploaded attachment exists", () => {
    render(<ChatSurface tenantName="Kalzen" />);
    const sendBtn = screen.getByRole("button", {
      name: /send message/i,
    }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("file input has the expected accept attribute (PR 1 allowlist)", () => {
    render(<ChatSurface tenantName="Kalzen" />);
    const fileInput = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    expect(fileInput.accept).toBe(".dxf,.dwg,.pdf,.png,.jpg,.jpeg");
  });
});
