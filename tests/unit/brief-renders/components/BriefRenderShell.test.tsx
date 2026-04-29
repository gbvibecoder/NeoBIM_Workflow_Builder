/**
 * BriefRenderShell — state-machine routing tests.
 *
 * The shell composes many child components; we mock all of them so the
 * tests focus on the routing logic (which child renders for which
 * status) rather than the children's internals (which have their own
 * tests).
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// ─── Mock children + the polling hook ───────────────────────────────

const useJobMock = vi.fn();

vi.mock("@/features/brief-renders/hooks/useBriefRenderJob", () => ({
  useBriefRenderJob: (...args: unknown[]) => useJobMock(...args),
}));

// `useSession` is read by BriefRenderShell to gate the admin
// JobLogsPanel. Default mock returns no session so the panel stays
// hidden in routing tests; admin-specific assertions can override.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("@/features/brief-renders/components/JobLogsPanel", () => ({
  JobLogsPanel: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="mock-logs-panel">logs-panel</div> : null,
}));

vi.mock("@/features/brief-renders/components/DetailedLogsSection", () => ({
  DetailedLogsSection: ({
    visible,
    onClose,
  }: {
    visible: boolean;
    onClose?: () => void;
  }) =>
    visible ? (
      <div data-testid="mock-detailed-logs">
        <button type="button" data-testid="mock-detailed-logs-close" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock("@/features/brief-renders/components/BriefUploader", () => ({
  BriefUploader: ({
    onJobCreated,
  }: {
    onJobCreated: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-uploader"
      onClick={() => onJobCreated("job-new")}
    >
      uploader
    </button>
  ),
}));

vi.mock("@/features/brief-renders/components/SpecReviewGate", () => ({
  SpecReviewGate: ({ jobId }: { jobId: string }) => (
    <div data-testid="mock-spec-review">spec-review:{jobId}</div>
  ),
}));

vi.mock("@/features/brief-renders/components/ShotGrid", () => ({
  ShotGrid: () => <div data-testid="mock-shot-grid">shot-grid</div>,
}));

vi.mock("@/features/brief-renders/components/PdfDownloadButton", () => ({
  PdfDownloadButton: ({
    pdfUrl,
    disabled,
  }: {
    pdfUrl: string | null;
    disabled?: boolean;
  }) =>
    pdfUrl && !disabled ? (
      <a data-testid="mock-pdf-download" href={pdfUrl}>
        download
      </a>
    ) : pdfUrl && disabled ? (
      <button type="button" data-testid="mock-pdf-disabled" disabled>
        recompiling
      </button>
    ) : null,
}));

vi.mock("@/features/brief-renders/components/JobStatusBanner", () => ({
  JobStatusBanner: () => (
    <div data-testid="mock-status-banner">status-banner</div>
  ),
}));

vi.mock("@/features/brief-renders/components/JobErrorBanner", () => ({
  JobErrorBanner: ({ onDismiss }: { onDismiss: () => void }) => (
    <button type="button" data-testid="mock-error-banner" onClick={onDismiss}>
      error
    </button>
  ),
}));

vi.mock("@/features/brief-renders/components/JobCancelledBanner", () => ({
  JobCancelledBanner: ({ onDismiss }: { onDismiss: () => void }) => (
    <button type="button" data-testid="mock-cancelled-banner" onClick={onDismiss}>
      cancelled
    </button>
  ),
}));

vi.mock("@/features/brief-renders/components/CancelJobButton", () => ({
  CancelJobButton: () => <button type="button" data-testid="mock-cancel-btn">cancel</button>,
}));

vi.mock("@/features/brief-renders/components/RecentJobsDrawer", () => ({
  RecentJobsDrawer: ({
    onSelect,
  }: {
    onSelect: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-recent-drawer"
      onClick={() => onSelect("job-from-drawer")}
    >
      drawer
    </button>
  ),
}));

import { BriefRenderShell } from "@/features/brief-renders/components/BriefRenderShell";

beforeEach(() => {
  useJobMock.mockReset();
  // Default: no job selected.
  useJobMock.mockReturnValue({
    job: null,
    status: null,
    isLoading: false,
    error: null,
  });
  // Reset URL between tests.
  window.history.replaceState(null, "", "/dashboard/brief-renders");
});

afterEach(() => {
  vi.clearAllMocks();
});

function jobView(overrides: Record<string, unknown>) {
  return {
    id: "job-1",
    status: "QUEUED",
    progress: 0,
    currentStage: null,
    specResult: null,
    shots: null,
    pdfUrl: null,
    errorMessage: null,
    costUsd: 0,
    ...overrides,
  };
}

describe("BriefRenderShell — routing", () => {
  it("no jobId → renders the uploader", () => {
    render(<BriefRenderShell />);
    expect(screen.getByTestId("mock-uploader")).toBeTruthy();
    expect(screen.queryByTestId("mock-status-banner")).toBeNull();
  });

  it("uploader fires onJobCreated → URL updates + polling starts", async () => {
    render(<BriefRenderShell />);
    act(() => {
      screen.getByTestId("mock-uploader").click();
    });
    await waitFor(() => {
      expect(window.location.search).toContain("jobId=job-new");
    });
    // After URL update + state set, the uploader should be unmounted
    // because the component re-evaluates and the !jobId branch is gone.
    expect(screen.queryByTestId("mock-uploader")).toBeNull();
  });

  it("AWAITING_APPROVAL → renders SpecReviewGate (not ShotGrid)", () => {
    window.history.replaceState(null, "", "/dashboard/brief-renders?jobId=job-1");
    useJobMock.mockReturnValue({
      job: jobView({ status: "AWAITING_APPROVAL" }),
      status: "AWAITING_APPROVAL",
      isLoading: false,
      error: null,
    });
    render(<BriefRenderShell />);
    expect(screen.getByTestId("mock-spec-review")).toBeTruthy();
    expect(screen.queryByTestId("mock-shot-grid")).toBeNull();
  });

  it("RUNNING with specResult+shots → ShotGrid + status banner + cancel button", () => {
    window.history.replaceState(null, "", "/dashboard/brief-renders?jobId=job-1");
    useJobMock.mockReturnValue({
      job: jobView({
        status: "RUNNING",
        specResult: { apartments: [] },
        shots: [],
      }),
      status: "RUNNING",
      isLoading: false,
      error: null,
    });
    render(<BriefRenderShell />);
    expect(screen.getByTestId("mock-status-banner")).toBeTruthy();
    expect(screen.getByTestId("mock-shot-grid")).toBeTruthy();
    expect(screen.getByTestId("mock-cancel-btn")).toBeTruthy();
  });

  it("COMPLETED + pdfUrl → PdfDownloadButton (not disabled)", () => {
    window.history.replaceState(null, "", "/dashboard/brief-renders?jobId=job-1");
    useJobMock.mockReturnValue({
      job: jobView({
        status: "COMPLETED",
        pdfUrl: "https://r2/x.pdf",
        specResult: { apartments: [] },
        shots: [],
      }),
      status: "COMPLETED",
      isLoading: false,
      error: null,
    });
    render(<BriefRenderShell />);
    expect(screen.getByTestId("mock-pdf-download")).toBeTruthy();
    expect(screen.queryByTestId("mock-pdf-disabled")).toBeNull();
  });

  it("FAILED → renders error banner; dismiss clears jobId", () => {
    window.history.replaceState(null, "", "/dashboard/brief-renders?jobId=job-1");
    useJobMock.mockReturnValue({
      job: jobView({ status: "FAILED", errorMessage: "x" }),
      status: "FAILED",
      isLoading: false,
      error: null,
    });
    render(<BriefRenderShell />);
    const banner = screen.getByTestId("mock-error-banner");
    act(() => {
      banner.click();
    });
    expect(window.location.search).not.toContain("jobId=");
  });

  it("CANCELLED → renders cancelled banner", () => {
    window.history.replaceState(null, "", "/dashboard/brief-renders?jobId=job-1");
    useJobMock.mockReturnValue({
      job: jobView({ status: "CANCELLED" }),
      status: "CANCELLED",
      isLoading: false,
      error: null,
    });
    render(<BriefRenderShell />);
    expect(screen.getByTestId("mock-cancelled-banner")).toBeTruthy();
  });

  it("recent-jobs drawer onSelect updates jobId via URL", async () => {
    render(<BriefRenderShell />);
    act(() => {
      screen.getByTestId("mock-recent-drawer").click();
    });
    await waitFor(() => {
      expect(window.location.search).toContain("jobId=job-from-drawer");
    });
  });
});
