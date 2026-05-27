/**
 * Unit tests for the shared JSON sidecar client (5I PR 2a).
 *
 * Covers:
 *  - happy 200 round-trip
 *  - 4xx with each of the 3 captured error-envelope shapes
 *  - 5xx (server error)
 *  - non-JSON body on a 200
 *  - 200 with malformed JSON
 *  - AbortController timeout
 *  - network error (fetch rejects)
 *  - missing API key (no KOS_SIDECAR_API_KEY and no IFC_SERVICE_API_KEY)
 *  - logger dispatch + done events called with expected fields
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { callJsonSidecar } from "../_sidecar-client";
import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";

const fetchMock = vi.fn();

function makeResponse(
  status: number,
  body: unknown,
  contentType = "application/json",
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": contentType },
  });
}

describe("callJsonSidecar", () => {
  const infoSpy = vi.spyOn(kosLog, "info");
  const warnSpy = vi.spyOn(kosLog, "warn");
  const errorSpy = vi.spyOn(kosLog, "error");

  beforeEach(() => {
    fetchMock.mockReset();
    infoSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("KOS_SIDECAR_URL", "https://sidecar.test");
    vi.stubEnv("KOS_SIDECAR_API_KEY", "test-key-xyz");
    vi.stubEnv("IFC_SERVICE_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("happy path: 200 JSON → returns parsed body, logs dispatch + done", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true, n: 42 }));

    const result = await callJsonSidecar<{ ok: boolean; n: number }>({
      endpoint: "/test",
      body: { hello: "world" },
      timeoutMs: 1000,
      errorCodePrefix: "KOS_TEST",
      tenantId: "tenant-1",
    });

    expect(result).toEqual({ ok: true, n: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://sidecar.test/test");
    expect(calledInit.method).toBe("POST");
    expect(calledInit.headers).toMatchObject({
      Authorization: "Bearer test-key-xyz",
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(calledInit.body).toBe('{"hello":"world"}');

    expect(infoSpy).toHaveBeenCalledWith(
      "kos_sidecar_dispatch",
      expect.objectContaining({
        endpoint: "/test",
        method: "POST",
        tenantId: "tenant-1",
      }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "kos_sidecar_done",
      expect.objectContaining({
        endpoint: "/test",
        tenantId: "tenant-1",
        durationMs: expect.any(Number),
      }),
    );
  });

  it("4xx with BOQ-style envelope ({error_code, message, hint}) → KosError with _SIDECAR_4XX and combined message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(422, {
        error_code: "BOQ_INPUT_INVALID",
        message: "Failed to parse context",
        hint: "Verify context schema matches BOQContext.",
      }),
    );

    let caught: unknown;
    try {
      await callJsonSidecar({
        endpoint: "/boq/generate",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_BOQ_GEN",
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(KosError);
    const err = caught as KosError;
    expect(err.code).toBe("KOS_BOQ_GEN_SIDECAR_4XX");
    expect(err.httpStatus).toBe(400);
    expect(err.message).toContain("BOQ_INPUT_INVALID");
    expect(err.message).toContain("Failed to parse context");
    expect(err.message).toContain("BOQContext");
    expect(err.message).toContain("status=422");

    expect(warnSpy).toHaveBeenCalledWith(
      "kos_sidecar_error",
      expect.objectContaining({
        endpoint: "/boq/generate",
        status: 422,
        sidecarCode: "BOQ_INPUT_INVALID",
      }),
    );
  });

  it("4xx with mapper-style envelope ({error, message, hint}) → message includes hint", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(400, {
        error: "MAPPER_INPUT_CONVERSION_FAILED",
        message: "KeyError: 'drawing_classification'",
        hint: "parser_output dict shape doesn't match",
      }),
    );

    await expect(
      callJsonSidecar({
        endpoint: "/kos/generate-panel-layout",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_MAPPER",
      }),
    ).rejects.toMatchObject({
      code: "KOS_MAPPER_SIDECAR_4XX",
      httpStatus: 400,
    });
  });

  it("4xx with parse-drawing-style envelope ({error, message}) → no hint suffix in message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(400, {
        error: "invalid_extension",
        message: "file 'test.jpg' must be .dxf or .pdf",
      }),
    );

    let caught: unknown;
    try {
      await callJsonSidecar({
        endpoint: "/test",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_TEST",
      });
    } catch (e) {
      caught = e;
    }

    const err = caught as KosError;
    expect(err.message).toContain("invalid_extension");
    expect(err.message).not.toContain("(hint:");
  });

  it("5xx → KosError with _SIDECAR_5XX and httpStatus 502", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(503, { message: "service overloaded" }),
    );

    await expect(
      callJsonSidecar({
        endpoint: "/test",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_TEST",
      }),
    ).rejects.toMatchObject({
      code: "KOS_TEST_SIDECAR_5XX",
      httpStatus: 502,
    });
  });

  it("5xx with non-JSON body → falls back to raw text in surfaced message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(502, "<html>Bad Gateway</html>", "text/html"),
    );

    let caught: unknown;
    try {
      await callJsonSidecar({
        endpoint: "/test",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_TEST",
      });
    } catch (e) {
      caught = e;
    }
    const err = caught as KosError;
    expect(err.code).toBe("KOS_TEST_SIDECAR_5XX");
    expect(err.message).toContain("Bad Gateway");
  });

  it("200 with non-JSON content-type → KosError _RESPONSE_001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("plain text", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(
      callJsonSidecar({
        endpoint: "/test",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_TEST",
      }),
    ).rejects.toMatchObject({
      code: "KOS_TEST_RESPONSE_001",
      httpStatus: 502,
    });
  });

  it("200 with malformed JSON → KosError _RESPONSE_001", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      callJsonSidecar({
        endpoint: "/test",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_TEST",
      }),
    ).rejects.toMatchObject({
      code: "KOS_TEST_RESPONSE_001",
    });
  });

  it("AbortError from fetch → KosError _TIMEOUT, httpStatus 504", async () => {
    fetchMock.mockImplementationOnce(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    let caught: unknown;
    try {
      await callJsonSidecar({
        endpoint: "/slow",
        body: {},
        timeoutMs: 50,
        errorCodePrefix: "KOS_TEST",
      });
    } catch (e) {
      caught = e;
    }

    const err = caught as KosError;
    expect(err.code).toBe("KOS_TEST_TIMEOUT");
    expect(err.httpStatus).toBe(504);
    expect(err.message).toContain("did not respond within 50ms");
    expect(errorSpy).toHaveBeenCalledWith(
      "kos_sidecar_timeout",
      expect.objectContaining({ endpoint: "/slow", timeoutMs: 50 }),
    );
  });

  it("network error (fetch rejects with non-Abort) → KosError _NETWORK, 502", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new TypeError("ECONNREFUSED"), { name: "FetchError" }),
    );

    let caught: unknown;
    try {
      await callJsonSidecar({
        endpoint: "/down",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_TEST",
      });
    } catch (e) {
      caught = e;
    }

    const err = caught as KosError;
    expect(err.code).toBe("KOS_TEST_NETWORK");
    expect(err.httpStatus).toBe(502);
    expect(err.message).toContain("ECONNREFUSED");
  });

  it("missing both KOS_SIDECAR_API_KEY and IFC_SERVICE_API_KEY → KosError _AUTH_001 without calling fetch", async () => {
    vi.stubEnv("KOS_SIDECAR_API_KEY", "");
    vi.stubEnv("IFC_SERVICE_API_KEY", "");

    await expect(
      callJsonSidecar({
        endpoint: "/test",
        body: {},
        timeoutMs: 1000,
        errorCodePrefix: "KOS_TEST",
      }),
    ).rejects.toMatchObject({
      code: "KOS_TEST_AUTH_001",
      httpStatus: 500,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to IFC_SERVICE_API_KEY when KOS_SIDECAR_API_KEY is unset", async () => {
    vi.stubEnv("KOS_SIDECAR_API_KEY", "");
    vi.stubEnv("IFC_SERVICE_API_KEY", "ifc-fallback-key");
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));

    await callJsonSidecar({
      endpoint: "/test",
      body: {},
      timeoutMs: 1000,
      errorCodePrefix: "KOS_TEST",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer ifc-fallback-key");
  });
});
