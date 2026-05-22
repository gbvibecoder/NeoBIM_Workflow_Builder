/**
 * HTTP client for the v3 Railway Python sandbox.
 *
 * Calls four endpoints on `IFC_SERVICE_URL` (the existing Phase 1/2
 * service host — v3 adds a sibling router at `/api/v3/generator/*`):
 *
 *   POST /api/v3/generator/exec       — run agent-authored Python in
 *                                       the session's restricted namespace
 *   POST /api/v3/generator/validate   — structural validation of the
 *                                       current session IFC
 *   POST /api/v3/generator/summary    — read-only summary of the IFC
 *   POST /api/v3/generator/finalize   — upload + return public URL
 *
 * Session id is carried as the `bf-session-id` header on every request
 * after the first `exec` (which mints + returns one). The auth model
 * is `Authorization: Bearer <IFC_SERVICE_API_KEY>` — same as every
 * other Railway caller in this codebase (`parse-ifc/route.ts`,
 * `brief-to-ifc-v2/ifc-sandbox-client.ts`, `ifc-service-client.ts`).
 * The earlier `X-API-Key` claim in this docstring was wrong; the
 * server middleware (`neobim-ifc-service/app/auth.py:65-73`) only
 * reads `Authorization` and only accepts the `Bearer ` prefix.
 *
 * Never throws — every call returns a typed result, transport failures
 * inclusive, so the agent driver can decide whether to retry the tool
 * call or surface the failure to Anthropic.
 */

import type {
  BriefSpec,
  SandboxExecResult,
  SandboxFinalizeResult,
  SandboxSummaryResult,
  SandboxValidateResult,
} from "../types";

const DEFAULT_TIMEOUT_MS = 60_000;

/** Best-effort error envelope when the transport fails before we can
 *  observe a structured response. The caller treats this as a retryable
 *  tool result rather than a fatal exception. */
export type TransportFailure =
  | { kind: "not-configured"; message: string }
  | { kind: "http-error"; statusCode: number; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "network-error"; message: string }
  | { kind: "parse-error"; message: string };

export type SandboxClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: TransportFailure };

function configured(): { url: string; apiKey: string | undefined } | null {
  const url = process.env.IFC_SERVICE_URL;
  if (!url) return null;
  return { url, apiKey: process.env.IFC_SERVICE_API_KEY };
}

async function postJson<T>(
  path: string,
  body: unknown,
  sessionId: string | null,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SandboxClientResult<T>> {
  const cfg = configured();
  if (!cfg) {
    return {
      ok: false,
      failure: {
        kind: "not-configured",
        message: "IFC_SERVICE_URL is not configured — the v3 sandbox is unreachable.",
      },
    };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  if (sessionId) headers["bf-session-id"] = sessionId;

  let res: Response;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return {
      ok: false,
      failure: {
        kind: isAbort ? "timeout" : "network-error",
        message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      },
    };
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* unreadable body */
    }
    return {
      ok: false,
      failure: {
        kind: "http-error",
        statusCode: res.status,
        message: `Sandbox responded ${res.status} ${res.statusText}${
          detail ? `: ${detail}` : ""
        }`,
      },
    };
  }

  try {
    const parsed = (await res.json()) as T;
    return { ok: true, data: parsed };
  } catch (err) {
    return {
      ok: false,
      failure: {
        kind: "parse-error",
        message: `Could not parse sandbox response: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    };
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export interface ExecArgs {
  code: string;
  /** Required on the FIRST exec call in a session; ignored thereafter. */
  brief?: BriefSpec;
  /** Carried across calls — `null` on the very first call returns a new id. */
  sessionId: string | null;
  /** Per-call wall-clock cap. Defaults to 30s (sandbox typically returns
   *  in <5s; `bf.write()` is the slowest piece at ~1-3s for ~3k entities). */
  timeoutMs?: number;
}

export async function sandboxExec(
  args: ExecArgs,
): Promise<SandboxClientResult<SandboxExecResult>> {
  const body: Record<string, unknown> = { code: args.code };
  if (args.brief) body.brief = args.brief;
  return postJson<SandboxExecResult>(
    "/api/v3/generator/exec",
    body,
    args.sessionId,
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
}

export async function sandboxValidate(
  sessionId: string,
): Promise<SandboxClientResult<SandboxValidateResult>> {
  return postJson<SandboxValidateResult>(
    "/api/v3/generator/validate",
    {},
    sessionId,
  );
}

export async function sandboxSummary(
  sessionId: string,
): Promise<SandboxClientResult<SandboxSummaryResult>> {
  return postJson<SandboxSummaryResult>(
    "/api/v3/generator/summary",
    {},
    sessionId,
  );
}

export async function sandboxFinalize(
  sessionId: string,
  filePrefix: string = "ai-ifc-v3",
): Promise<SandboxClientResult<SandboxFinalizeResult>> {
  return postJson<SandboxFinalizeResult>(
    "/api/v3/generator/finalize",
    { file_prefix: filePrefix },
    sessionId,
  );
}
