/**
 * Regression test for the sandbox-client auth header.
 *
 * Yesterday's eval cycle (2026-05-16) proved that the v3 sandbox client
 * was sending `X-API-Key: <key>` while the Railway sandbox middleware
 * (`neobim-ifc-service/app/auth.py:65-73`) only accepts
 * `Authorization: Bearer <key>`. Every `run_python` call returned 401
 * AUTH_MISSING_TOKEN; the agent gave up cleanly with AGENT_GAVE_UP.
 *
 * Fix: 1-line change at sandbox-client.ts:72. This test asserts the
 * outgoing fetch carries `Authorization: Bearer <key>` and DOES NOT
 * carry `X-API-Key`. It fails on the broken code (X-API-Key present,
 * Authorization absent) and passes on the fix — the same fail-on-old /
 * pass-on-new shape as the after() wrapping test.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { sandboxExec } from "../sandbox-client";

describe("sandbox-client — Authorization: Bearer header", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("IFC_SERVICE_URL", "https://sandbox.test.local");
    vi.stubEnv("IFC_SERVICE_API_KEY", "test-api-key-12345");
    fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({
        session_id: "test-session",
        ok: true,
        stdout: "",
        stderr: "",
        error_type: null,
        error_message: null,
        error_traceback: null,
        duration_ms: 1,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("sends Authorization: Bearer header and NOT X-API-Key", async () => {
    const result = await sandboxExec({
      code: "print('hello')",
      sessionId: null,
    });

    // Confirm the call landed in the success path so we know the
    // request actually went out (not aborted by `configured() === null`).
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    // (1) The load-bearing assertion: Authorization: Bearer is present.
    expect(headers["Authorization"]).toBe("Bearer test-api-key-12345");

    // (2) The dispositive negative: X-API-Key is GONE. On the broken
    //     code this header was set; on the fix it must not be.
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("omits the Authorization header when IFC_SERVICE_API_KEY is unset", async () => {
    // Edge case: env present but key missing → no auth header at all.
    // (The sandbox will 401 — the client doesn't pretend to have a key.)
    vi.unstubAllEnvs();
    vi.stubEnv("IFC_SERVICE_URL", "https://sandbox.test.local");
    // Deliberately do NOT stub IFC_SERVICE_API_KEY.
    // Some environments default unset env vars to "" — guard against that.
    vi.stubEnv("IFC_SERVICE_API_KEY", "");

    await sandboxExec({ code: "noop", sessionId: null });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["X-API-Key"]).toBeUndefined();
  });
});
