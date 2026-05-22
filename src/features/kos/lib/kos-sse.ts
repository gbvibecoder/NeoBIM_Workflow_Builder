/**
 * Manual Server-Sent Events decoder for the KOS chat stream.
 *
 * We parse SSE by hand rather than pulling in a dependency (and the
 * browser `EventSource` API can't POST a body, which we need). The
 * server frames each event as:
 *
 *     event: <type>\n
 *     data: <JSON payload>\n
 *     \n
 *
 * `KosSseDecoder` is fed raw `Uint8Array` chunks off a
 * `ReadableStreamDefaultReader` and returns zero-or-more fully-parsed
 * events per chunk. It is robust to:
 *   - a single network chunk containing multiple SSE events,
 *   - an SSE event split across two network chunks (partial buffer is
 *     retained until the terminating blank line arrives),
 *   - multi-byte UTF-8 sequences split across chunks (TextDecoder
 *     `stream: true`),
 *   - malformed JSON in a `data:` line (logged + skipped, never throws).
 *
 * Ownership of the reader (and therefore `reader.cancel()` on unmount)
 * stays with the caller; this class only handles buffering + parsing.
 */

import type { KosBotEvent, KosCitation } from "@/features/kos/types/chat";

export class KosSseDecoder {
  private buffer = "";
  private readonly textDecoder = new TextDecoder();

  /** Feed one network chunk; returns any events that completed within it. */
  decode(chunk: Uint8Array): KosBotEvent[] {
    this.buffer += this.textDecoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  /** Flush the decoder at end-of-stream; returns any trailing event. */
  flush(): KosBotEvent[] {
    this.buffer += this.textDecoder.decode();
    return this.drain(true);
  }

  private drain(isFinal: boolean): KosBotEvent[] {
    const out: KosBotEvent[] = [];
    let boundary: number;
    // Events are separated by a blank line. Handle both "\n\n" and the
    // "\r\n\r\n" CRLF variant defensively.
    while (
      (boundary = this.nextBoundary()) !== -1
    ) {
      const sep = this.buffer.startsWith("\r\n", boundary) ? 4 : 2;
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + sep);
      const event = parseSseEvent(raw);
      if (event) out.push(event);
    }
    if (isFinal) {
      const tail = this.buffer.trim();
      this.buffer = "";
      if (tail) {
        const event = parseSseEvent(tail);
        if (event) out.push(event);
      }
    }
    return out;
  }

  private nextBoundary(): number {
    const lf = this.buffer.indexOf("\n\n");
    const crlf = this.buffer.indexOf("\r\n\r\n");
    if (lf === -1) return crlf;
    if (crlf === -1) return lf;
    return Math.min(lf, crlf);
  }
}

/**
 * Parse one SSE event block (no trailing blank line) into a typed
 * `KosBotEvent`. Returns null for blocks with no recognised event name
 * or with malformed JSON — the caller treats null as "skip, keep going".
 */
export function parseSseEvent(raw: string): KosBotEvent | null {
  let eventName = "";
  const dataParts: string[] = [];

  for (const line of raw.split("\n")) {
    const clean = line.replace(/\r$/, "");
    if (clean.startsWith(":")) continue; // SSE comment / heartbeat
    if (clean.startsWith("event:")) {
      eventName = clean.slice("event:".length).trim();
    } else if (clean.startsWith("data:")) {
      // Spec: a single leading space after the colon is stripped.
      dataParts.push(clean.slice("data:".length).replace(/^ /, ""));
    }
  }

  if (!eventName) return null;

  const dataStr = dataParts.join("\n");
  let payload: unknown = {};
  if (dataStr) {
    try {
      payload = JSON.parse(dataStr);
    } catch (err) {
      console.warn(
        `[kos-sse] malformed JSON for event "${eventName}": ` +
          `${err instanceof Error ? err.message : String(err)}; ` +
          `raw="${dataStr.slice(0, 200)}"`,
      );
      return null;
    }
  }

  return coerceEvent(eventName, payload);
}

function coerceEvent(name: string, payload: unknown): KosBotEvent | null {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<
    string,
    unknown
  >;

  switch (name) {
    case "text_delta":
      return typeof p.text === "string"
        ? { type: "text_delta", text: p.text }
        : null;
    case "tool_call_start":
      return {
        type: "tool_call_start",
        tool: typeof p.tool === "string" ? p.tool : "",
        input: p.input,
      };
    case "tool_call_result":
      return {
        type: "tool_call_result",
        tool: typeof p.tool === "string" ? p.tool : "",
        output: p.output,
      };
    case "citations":
      return {
        type: "citations",
        citations: Array.isArray(p.citations)
          ? (p.citations as KosCitation[])
          : [],
      };
    case "escalation":
      return {
        type: "escalation",
        reason: typeof p.reason === "string" ? p.reason : "",
      };
    case "done":
      return {
        type: "done",
        messageId: typeof p.messageId === "string" ? p.messageId : "",
        conversationId:
          typeof p.conversationId === "string" ? p.conversationId : "",
      };
    case "error":
      return {
        type: "error",
        code: typeof p.code === "string" ? p.code : "KOS_BOT_003",
        message:
          typeof p.message === "string" ? p.message : "Unknown stream error.",
      };
    default:
      console.warn(`[kos-sse] unknown event type "${name}" — skipping.`);
      return null;
  }
}
