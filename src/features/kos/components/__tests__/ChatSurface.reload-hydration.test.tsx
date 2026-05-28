// @vitest-environment happy-dom
/**
 * Tests for the 5I PR 4b2 ChatSurface reload-hydration wiring.
 *
 * We mock `useConversationMessages` so each test drives a specific
 * shape (loading vs. messages vs. 404-equivalent vs. error), then
 * assert what the ChatSurface renders + that the merge-not-replace
 * seed effect runs at most once per mount (the critical correctness
 * invariant — protects SSE messages that arrived during a slow
 * hydration fetch from being clobbered by a delayed hook re-render).
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
  act,
  cleanup,
  render,
  screen,
} from "@testing-library/react";

import type { UIMessage } from "@/features/kos/types/chat";

const {
  useChatAttachmentsMock,
  useKosCustomerMock,
  useConversationMessagesMock,
  botMessageMock,
} = vi.hoisted(() => ({
  useChatAttachmentsMock: vi.fn(),
  useKosCustomerMock: vi.fn(),
  useConversationMessagesMock: vi.fn(),
  botMessageMock: vi.fn(),
}));

vi.mock("@/features/kos/hooks/useChatAttachments", () => ({
  useChatAttachments: useChatAttachmentsMock,
}));
vi.mock("../CustomerSessionProvider", () => ({
  useKosCustomer: useKosCustomerMock,
}));
vi.mock("@/features/kos/hooks/useConversationMessages", () => ({
  useConversationMessages: useConversationMessagesMock,
}));
vi.mock("../BotMessage", () => ({
  BotMessage: (props: { content: string }) => {
    botMessageMock(props);
    return <div data-testid="bot-msg">{props.content}</div>;
  },
}));

// Stub fetch so streaming sends fall through. None of these tests
// dispatch SSE — they verify state derived from useConversationMessages.
const fetchMock = vi.fn();

import ChatSurface from "../ChatSurface";

const baseAttachmentsHook = {
  attachments: [],
  pendingAttachments: [],
  hasInFlight: false,
  addFile: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  clear: vi.fn(),
  drainPending: vi.fn(() => []),
};

function mockCustomer(overrides: Partial<{ currentConversationId: string | null }> = {}) {
  useKosCustomerMock.mockReturnValue({
    customer: {
      id: "c1",
      displayName: "Test",
      isAnonymous: true,
      currentConversationId: null,
      ...overrides,
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  useChatAttachmentsMock.mockReturnValue({ ...baseAttachmentsHook });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ChatSurface reload-hydration — no currentConversationId", () => {
  it("renders welcome state immediately when customer has no currentConversationId", () => {
    mockCustomer({ currentConversationId: null });
    useConversationMessagesMock.mockReturnValue({
      messages: [],
      loading: false,
      error: null,
    });

    render(<ChatSurface tenantName="Kalzen" />);

    // Hydration loading hint absent
    expect(screen.queryByTestId("kos-hydration-loading")).toBeNull();
    // Welcome state's suggested-prompt buttons visible
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("passes null conversationId into the hook when customer has no current conv", () => {
    mockCustomer({ currentConversationId: null });
    useConversationMessagesMock.mockReturnValue({
      messages: [],
      loading: false,
      error: null,
    });

    render(<ChatSurface tenantName="Kalzen" />);

    expect(useConversationMessagesMock).toHaveBeenCalled();
    // First positional arg is the conversationId
    const lastCall =
      useConversationMessagesMock.mock.calls[
        useConversationMessagesMock.mock.calls.length - 1
      ];
    expect(lastCall[0]).toBeNull();
  });
});

describe("ChatSurface reload-hydration — loading state", () => {
  it("shows the 'Loading conversation history…' hint while the hook is loading", () => {
    mockCustomer({ currentConversationId: "conv_1" });
    useConversationMessagesMock.mockReturnValue({
      messages: [],
      loading: true,
      error: null,
    });

    render(<ChatSurface tenantName="Kalzen" />);

    const loader = screen.getByTestId("kos-hydration-loading");
    expect(loader.textContent ?? "").toContain("Loading conversation history");
  });

  it("does NOT render welcome state while loading (would flicker if there is history)", () => {
    mockCustomer({ currentConversationId: "conv_1" });
    useConversationMessagesMock.mockReturnValue({
      messages: [],
      loading: true,
      error: null,
    });

    render(<ChatSurface tenantName="Kalzen" />);

    // The welcome-copy paragraph isn't in the DOM during loading.
    expect(
      screen.queryByText(/Hi! I'm the Kalzen assistant/),
    ).toBeNull();
  });
});

describe("ChatSurface reload-hydration — happy seed", () => {
  it("seeds local messages once the hook resolves with non-empty history", async () => {
    mockCustomer({ currentConversationId: "conv_1" });
    const historical: UIMessage[] = [
      { id: "msg_a", role: "customer", content: "process my drawing", timestamp: 100 },
      { id: "msg_b", role: "bot", content: "On it.", timestamp: 200 },
    ];
    useConversationMessagesMock.mockReturnValue({
      messages: historical,
      loading: false,
      error: null,
    });

    render(<ChatSurface tenantName="Kalzen" />);
    await act(async () => {
      await Promise.resolve();
    });

    // Loader gone
    expect(screen.queryByTestId("kos-hydration-loading")).toBeNull();
    // Customer message text shows
    expect(screen.getByText("process my drawing")).toBeTruthy();
    // Bot message renders via the mocked BotMessage
    expect(screen.getByTestId("bot-msg").textContent).toBe("On it.");
  });

  it("seeds at most once per mount — a later hook update with extra messages does NOT clobber local state", async () => {
    mockCustomer({ currentConversationId: "conv_1" });

    // First render returns 1 historical message.
    useConversationMessagesMock.mockReturnValue({
      messages: [
        { id: "msg_h1", role: "customer", content: "first historical", timestamp: 100 },
      ],
      loading: false,
      error: null,
    });

    const { rerender } = render(<ChatSurface tenantName="Kalzen" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("first historical")).toBeTruthy();

    // Now the hook returns a DIFFERENT non-empty list (simulating
    // a stale/late response). With seededRef latched, ChatSurface
    // MUST NOT re-merge — otherwise this would clobber any SSE-
    // pushed messages that arrived after the initial seed.
    useConversationMessagesMock.mockReturnValue({
      messages: [
        { id: "msg_other", role: "customer", content: "should NOT appear", timestamp: 300 },
      ],
      loading: false,
      error: null,
    });
    rerender(<ChatSurface tenantName="Kalzen" />);
    await act(async () => {
      await Promise.resolve();
    });

    // First historical is still there (the seed stuck).
    expect(screen.getByText("first historical")).toBeTruthy();
    // The "should NOT appear" text is NOT in the DOM.
    expect(screen.queryByText("should NOT appear")).toBeNull();
  });

  it("when historical is empty after loading, welcome state appears (no flicker hold)", async () => {
    mockCustomer({ currentConversationId: "conv_1" });
    useConversationMessagesMock.mockReturnValue({
      messages: [],
      loading: false,
      error: null,
    });

    render(<ChatSurface tenantName="Kalzen" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("kos-hydration-loading")).toBeNull();
    // The empty-state copy returns
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});

describe("ChatSurface reload-hydration — graceful failure paths", () => {
  it("404-equivalent (hook returns empty + null error) → welcome state, no error UI", async () => {
    mockCustomer({ currentConversationId: "conv_stale" });
    useConversationMessagesMock.mockReturnValue({
      messages: [],
      loading: false,
      error: null,
    });

    render(<ChatSurface tenantName="Kalzen" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("kos-hydration-loading")).toBeNull();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("500-equivalent (hook returns empty + error string) — UI still functional", async () => {
    mockCustomer({ currentConversationId: "conv_1" });
    useConversationMessagesMock.mockReturnValue({
      messages: [],
      loading: false,
      error: "Failed to load conversation history.",
    });

    render(<ChatSurface tenantName="Kalzen" />);
    await act(async () => {
      await Promise.resolve();
    });

    // Composer textarea is present and enabled — chat is still usable
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false);
  });
});

describe("ChatSurface reload-hydration — pass-through to useDrawingArtifactHydration", () => {
  it("historical customer message with attachmentRefs renders the ArtifactBubble (drives PR 4 hydration downstream)", async () => {
    mockCustomer({ currentConversationId: "conv_1" });
    // The drawing-summary endpoint may be queried by
    // useDrawingArtifactHydration once messages populate — stub a 404
    // so the test doesn't error on an unmatched fetch, while the
    // bubble still renders in its initial PROCESSING_PARSE state.
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 404 }),
    );
    useConversationMessagesMock.mockReturnValue({
      messages: [
        {
          id: "msg_attached",
          role: "customer",
          content: "process this",
          timestamp: 100,
          attachmentRefs: ["cdraw_alpha"],
        },
      ],
      loading: false,
      error: null,
    });

    render(<ChatSurface tenantName="Kalzen" />);
    await act(async () => {
      await Promise.resolve();
    });

    // The message text shows; the ArtifactBubble's "PROCESSING_PARSE"
    // initial state shows the drawingId as a filename fallback per
    // ChatSurface's artifactStates derivation.
    expect(screen.getByText("process this")).toBeTruthy();
    // ArtifactBubble renders the filename (or fallback drawingId).
    expect(screen.queryAllByText(/cdraw_alpha/).length).toBeGreaterThan(0);
  });
});
