/**
 * Shared JSON-only sidecar HTTP client (5I PR 2a).
 *
 * Three KOS sidecar endpoints take JSON in and emit JSON out:
 *   - POST /kos/generate-panel-layout
 *   - POST /boq/generate
 *   - POST /formwork/generate
 *
 * All three share the same auth, the same abort-controller timeout
 * pattern, the same error-envelope union, and the same kosLog
 * dispatch/done/error event triplet. This module centralises that;
 * each wrapper thunks straight into `callJsonSidecar()`.
 *
 * Note: `/kos/parse-drawing` is NOT routed through here because it
 * uploads multipart/form-data, not JSON. That route keeps its own
 * fetch dispatch in `kos-drawing-parser.ts`.
 *
 * Tenancy: the sidecar is tenant-blind today. `tenantId` is captured
 * for LOGGING only — it is never put in the request body or headers.
 * Tenant scoping is the Next.js API edge's job.
 */

import { KosError } from "@/features/kos/lib/kos-errors";
import { kosLog } from "@/features/kos/lib/kos-logger";
import type { KosSidecarErrorEnvelope } from "@/features/kos/types/sidecar";

/**
 * Resolve the sidecar base URL. Prefers `KOS_SIDECAR_URL`; falls back
 * to the same Railway host that `kos-drawing-constants.ts` defaults to.
 * Reading at call time (not module load) keeps tests able to stub the
 * env var via `vi.stubEnv` without import-order gymnastics.
 */
function getSidecarUrl(): string {
  return (
    process.env.KOS_SIDECAR_URL ??
    "https://buildflow-python-server.up.railway.app"
  );
}

/**
 * Resolve the bearer token. Prefers `KOS_SIDECAR_API_KEY` so a future
 * split (KOS vs IFC) doesn't require code changes; falls back to the
 * existing `IFC_SERVICE_API_KEY` so today's deployment keeps working
 * without re-keying.
 */
function getSidecarApiKey(): string {
  // Use `||` (not `??`) so an empty string in KOS_SIDECAR_API_KEY falls
  // through to IFC_SERVICE_API_KEY. Operationally `""` and "unset" are
  // the same — both mean "key not configured for this env var".
  return (
    process.env.KOS_SIDECAR_API_KEY ||
    process.env.IFC_SERVICE_API_KEY ||
    ""
  );
}

export interface CallJsonSidecarArgs<TBody> {
  /** Path with leading slash, e.g. "/boq/generate". */
  endpoint: string;
  /** HTTP verb. Defaults to "POST". */
  method?: "POST" | "GET";
  /** JSON-serialisable request body (omit for GET). */
  body?: TBody;
  /** Hard cap on the round-trip — fires AbortController. */
  timeoutMs: number;
  /**
   * Prefix for the wrapper's surfaced `KosError` code, e.g. `"KOS_BOQ_GEN"`.
   * Final codes are `<prefix>_SIDECAR_4XX`, `<prefix>_SIDECAR_5XX`,
   * `<prefix>_TIMEOUT`, `<prefix>_NETWORK`, `<prefix>_AUTH_001`,
   * `<prefix>_RESPONSE_001`.
   */
  errorCodePrefix: string;
  /** For LOGGING only — sidecar is tenant-blind today. */
  tenantId?: string;
}

export async function callJsonSidecar<TResponse, TBody = Record<string, unknown>>(
  args: CallJsonSidecarArgs<TBody>,
): Promise<TResponse> {
  const method = args.method ?? "POST";
  const url = `${getSidecarUrl()}${args.endpoint}`;
  const apiKey = getSidecarApiKey();
  const startedAt = Date.now();

  kosLog.info("kos_sidecar_dispatch", {
    endpoint: args.endpoint,
    method,
    tenantId: args.tenantId,
    timeoutMs: args.timeoutMs,
  });

  if (!apiKey) {
    throw new KosError(
      `${args.errorCodePrefix}_AUTH_001`,
      `Sidecar API key not configured — neither KOS_SIDECAR_API_KEY nor IFC_SERVICE_API_KEY is set in process.env. Cannot call ${url}.`,
      500,
    );
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), args.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    const durationMs = Date.now() - startedAt;
    const aborted = err instanceof Error && err.name === "AbortError";
    if (aborted) {
      kosLog.error("kos_sidecar_timeout", {
        endpoint: args.endpoint,
        tenantId: args.tenantId,
        durationMs,
        timeoutMs: args.timeoutMs,
      });
      throw new KosError(
        `${args.errorCodePrefix}_TIMEOUT`,
        `Sidecar ${args.endpoint} did not respond within ${args.timeoutMs}ms — ${url} may be cold-starting or unreachable.`,
        504,
      );
    }
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    kosLog.error("kos_sidecar_network_error", {
      endpoint: args.endpoint,
      tenantId: args.tenantId,
      durationMs,
      err: errMsg,
    });
    throw new KosError(
      `${args.errorCodePrefix}_NETWORK`,
      `Sidecar ${args.endpoint} unreachable at ${url}: ${errMsg}`,
      502,
    );
  }
  clearTimeout(timeoutHandle);

  const durationMs = Date.now() - startedAt;
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    let envelope: KosSidecarErrorEnvelope | null = null;
    let rawText = "";
    try {
      rawText = await response.text();
      if (contentType.includes("application/json") && rawText.length > 0) {
        envelope = JSON.parse(rawText) as KosSidecarErrorEnvelope;
      }
    } catch {
      // Non-JSON body or parse failure — fall through to rawText fallback.
    }

    const sidecarCode = envelope?.error_code ?? envelope?.error ?? `HTTP_${response.status}`;
    const sidecarMessage =
      envelope?.message ??
      (rawText.slice(0, 500) || `Sidecar ${args.endpoint} returned ${response.status}`);
    const sidecarHint = envelope?.hint ?? null;

    const isClientErr = response.status >= 400 && response.status < 500;
    const surfacedCode = `${args.errorCodePrefix}_SIDECAR_${isClientErr ? "4XX" : "5XX"}`;
    const surfacedHttp = isClientErr ? 400 : 502;
    const surfacedMessage = `${sidecarCode}: ${sidecarMessage}${sidecarHint ? ` (hint: ${sidecarHint})` : ""} [status=${response.status}]`;

    kosLog.warn("kos_sidecar_error", {
      endpoint: args.endpoint,
      tenantId: args.tenantId,
      durationMs,
      status: response.status,
      sidecarCode,
      sidecarHint,
      errorCode: surfacedCode,
    });

    throw new KosError(surfacedCode, surfacedMessage, surfacedHttp);
  }

  if (!contentType.includes("application/json")) {
    kosLog.warn("kos_sidecar_non_json_response", {
      endpoint: args.endpoint,
      tenantId: args.tenantId,
      durationMs,
      contentType,
    });
    throw new KosError(
      `${args.errorCodePrefix}_RESPONSE_001`,
      `Sidecar ${args.endpoint} returned 200 but content-type was "${contentType}" (expected application/json) at ${url}.`,
      502,
    );
  }

  let parsed: TResponse;
  try {
    parsed = (await response.json()) as TResponse;
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    kosLog.error("kos_sidecar_invalid_json", {
      endpoint: args.endpoint,
      tenantId: args.tenantId,
      durationMs,
      err: errMsg,
    });
    throw new KosError(
      `${args.errorCodePrefix}_RESPONSE_001`,
      `Sidecar ${args.endpoint} returned 200 but body was not valid JSON at ${url}: ${errMsg}`,
      502,
    );
  }

  kosLog.info("kos_sidecar_done", {
    endpoint: args.endpoint,
    tenantId: args.tenantId,
    durationMs,
  });

  return parsed;
}
