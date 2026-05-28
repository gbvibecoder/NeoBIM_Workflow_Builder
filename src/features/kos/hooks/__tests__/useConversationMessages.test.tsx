// @vitest-environment happy-dom
/**
 * Tests for useConversationMessages — the 5I PR 4b2 hook that fetches
 * past conversation rows and maps them to UIMessage shapes for
 * ChatSurface's seed-once mount-time merge.
 *
 * Uses an inline Harness component that consumes the hook and exposes
 * its result via a `data-*` attribute so we can drive conversationId
 * changes and assert state transitions without a full ChatSurface.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";

import { useConversationMessages } from "../useConversationMessages";

const fetchMock = vi.fn();

function makeOkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface HarnessProps {
  conversationId: string | null | undefined;
  onResult?: (
    result: ReturnType<typeof useConversationMessages>,
  ) => void;
}

function Harness({ conversationId, onResult }: HarnessProps) {
  const result = useConversationMessages(conversationId);
  if (onResult) onResult(result);
  return (
    <div
      data-testid="harness"
      data-loading={String(result.loading)}
      data-error={result.error ?? ""}
      data-message-count={String(result.messages.length)}
      data-message-ids={result.messages.map((m) => m.id).join(",")}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Helper: flush microtasks + effects + state updates.
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useConversationMessages — idle paths", () => {
  it("null conversationId → no fetch, loading:false, messages:[]", async () => {
    const { getByTestId } = render(<Harness conversationId={null} />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    const el = getByTestId("harness");
    expect(el.dataset.loading).toBe("false");
    expect(el.dataset.error).toBe("");
    expect(el.dataset.messageCount).toBe("0");
  });

  it("undefined conversationId → no fetch, loading:false, messages:[]", async () => {
    const { getByTestId } = render(<Harness conversationId={undefined} />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getByTestId("harness").dataset.loading).toBe("false");
  });
});

describe("useConversationMessages — fetch + map", () => {
  it("valid conversationId → fetches once, maps response to UIMessages", async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse({
        conversationId: "conv_1",
        truncated: false,
        messages: [
          {
            id: "msg_a",
            role: "customer",
            content: "hi",
            timestamp: 1717000000000,
            attachmentRefs: ["cdraw_x"],
          },
          {
            id: "msg_b",
            role: "bot",
            content: "hello",
            timestamp: 1717000005000,
          },
        ],
      }),
    );

    const { getByTestId } = render(<Harness conversationId="conv_1" />);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe("/api/kos/customer/conversations/conv_1/messages");
    expect(callArgs[1]).toMatchObject({ credentials: "include" });

    const el = getByTestId("harness");
    expect(el.dataset.loading).toBe("false");
    expect(el.dataset.error).toBe("");
    expect(el.dataset.messageCount).toBe("2");
    expect(el.dataset.messageIds).toBe("msg_a,msg_b");
  });

  it("empty messages response → messages:[], loading:false, no error", async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse({ conversationId: "conv_1", truncated: false, messages: [] }),
    );
    const { getByTestId } = render(<Harness conversationId="conv_1" />);
    await flush();
    const el = getByTestId("harness");
    expect(el.dataset.loading).toBe("false");
    expect(el.dataset.error).toBe("");
    expect(el.dataset.messageCount).toBe("0");
  });
});

describe("useConversationMessages — error handling", () => {
  it("404 → empty messages, NO error (graceful: stale currentConversationId)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse({ error_code: "KOS_CONV_MSG_001", message: "Conversation not found." }, 404),
    );
    const { getByTestId } = render(<Harness conversationId="conv_gone" />);
    await flush();
    const el = getByTestId("harness");
    expect(el.dataset.error).toBe("");
    expect(el.dataset.messageCount).toBe("0");
    expect(el.dataset.loading).toBe("false");
  });

  it("500 with a message → empty messages, error set", async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse(
        { error_code: "KOS_CONV_MSG_002", message: "Failed to load conversation messages: db down" },
        500,
      ),
    );
    const { getByTestId } = render(<Harness conversationId="conv_1" />);
    await flush();
    const el = getByTestId("harness");
    expect(el.dataset.error).toContain("db down");
    expect(el.dataset.messageCount).toBe("0");
    expect(el.dataset.loading).toBe("false");
  });

  it("500 with no JSON body → generic error message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not json at all", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    const { getByTestId } = render(<Harness conversationId="conv_1" />);
    await flush();
    const el = getByTestId("harness");
    expect(el.dataset.error).toContain("HTTP 500");
  });

  it("network throw (offline) → empty messages, generic error set", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getByTestId } = render(<Harness conversationId="conv_1" />);
    await flush();

    const el = getByTestId("harness");
    expect(el.dataset.error).toContain("Failed to fetch");
    expect(el.dataset.messageCount).toBe("0");
    warnSpy.mockRestore();
  });
});

describe("useConversationMessages — idempotency + cancellation", () => {
  it("re-render with same conversationId does NOT refetch", async () => {
    fetchMock.mockResolvedValue(
      makeOkResponse({
        conversationId: "conv_1",
        truncated: false,
        messages: [{ id: "msg_a", role: "customer", content: "hi", timestamp: 1 }],
      }),
    );

    const { rerender } = render(<Harness conversationId="conv_1" />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<Harness conversationId="conv_1" />);
    await flush();
    rerender(<Harness conversationId="conv_1" />);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("conversationId change → cancels old fetch, starts new one", async () => {
    // First fetch never resolves until we resolve it manually; second
    // fetch resolves immediately. After change, only the second is
    // observed in state.
    let firstResolve: ((res: Response) => void) | null = null;
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          firstResolve = resolve;
        }),
      )
      .mockResolvedValueOnce(
        makeOkResponse({
          conversationId: "conv_2",
          truncated: false,
          messages: [{ id: "msg_b", role: "customer", content: "v2", timestamp: 2 }],
        }),
      );

    const { rerender, getByTestId } = render(
      <Harness conversationId="conv_1" />,
    );
    // First call kicked off; state still loading.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<Harness conversationId="conv_2" />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Now resolve the first (cancelled) fetch — it must NOT clobber
    // the now-completed second result.
    if (firstResolve) {
      (firstResolve as (res: Response) => void)(
        makeOkResponse({
          conversationId: "conv_1",
          truncated: false,
          messages: [{ id: "msg_a_stale", role: "customer", content: "v1", timestamp: 1 }],
        }),
      );
    }
    await flush();

    const el = getByTestId("harness");
    expect(el.dataset.messageIds).toBe("msg_b");
  });

  it("unmount aborts the in-flight fetch (no state update after teardown)", async () => {
    let resolveFetch: ((res: Response) => void) | null = null;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const onResult = vi.fn();
    const { unmount } = render(
      <Harness conversationId="conv_1" onResult={onResult} />,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callOpts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callOpts.signal).toBeDefined();

    // Capture how many times onResult has fired so far, then unmount
    // and resolve the fetch — after teardown nothing should fire.
    const callsBefore = onResult.mock.calls.length;
    unmount();
    if (resolveFetch) {
      (resolveFetch as (res: Response) => void)(
        makeOkResponse({
          conversationId: "conv_1",
          truncated: false,
          messages: [{ id: "msg_a", role: "customer", content: "x", timestamp: 1 }],
        }),
      );
    }
    await flush();
    expect(onResult.mock.calls.length).toBe(callsBefore);
  });
});

describe("useConversationMessages — UIMessage mapping fidelity", () => {
  it("preserves attachmentRefs, timestamp (number), and citations", async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse({
        conversationId: "conv_1",
        truncated: false,
        messages: [
          {
            id: "msg_a",
            role: "customer",
            content: "hi",
            timestamp: 1717000000000,
            attachmentRefs: ["cdraw_x", "cdraw_y"],
          },
          {
            id: "msg_b",
            role: "bot",
            content: "ack [1]",
            timestamp: 1717000005000,
            citations: [{ documentId: "d", chunkId: "c", pageNum: 1, snippet: "...", title: "T" }],
          },
        ],
      }),
    );

    let captured: ReturnType<typeof useConversationMessages> | null = null;
    render(
      <Harness
        conversationId="conv_1"
        onResult={(r) => {
          captured = r;
        }}
      />,
    );
    await flush();

    expect(captured).not.toBeNull();
    const msgs = captured!.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      id: "msg_a",
      role: "customer",
      content: "hi",
      timestamp: 1717000000000,
      attachmentRefs: ["cdraw_x", "cdraw_y"],
    });
    expect(typeof msgs[0].timestamp).toBe("number");
    expect(msgs[1].citations).toHaveLength(1);
  });
});
