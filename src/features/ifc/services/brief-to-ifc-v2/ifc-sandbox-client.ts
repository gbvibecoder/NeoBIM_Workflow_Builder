/**
 * HTTP client for the Railway Python sandbox endpoint
 * `POST /api/v1/execute-builder-script`.
 *
 * Mirrors `src/features/ifc/services/ifc-service-client.ts` — same
 * `IFC_SERVICE_URL` + `IFC_SERVICE_API_KEY` env vars, same Bearer auth,
 * same "never throw, return a typed result" contract.
 *
 * Two failure layers, kept distinct so EX-006 can map them correctly:
 *   • TRANSPORT failure  → `{ ok: false, kind: ... }` — service down,
 *     timeout, non-2xx, unparseable body. EX-006 → 503 SANDBOX_UNAVAILABLE.
 *   • SCRIPT failure     → `{ ok: true, response: { status: "failed" } }` —
 *     the sandbox ran fine but the architect's script errored / timed out /
 *     produced no output. EX-006 maps `response.error.code` to 408/413/422.
 */

import {
  ExecuteBuilderScriptResponseSchema,
  type ExecuteBuilderScriptResponse,
} from "./contracts";

const IFC_SERVICE_URL = process.env.IFC_SERVICE_URL;
const IFC_SERVICE_API_KEY = process.env.IFC_SERVICE_API_KEY;

/** The sandbox enforces a 120 s wall budget internally; allow margin for
 *  upload + network so a real timeout surfaces as the sandbox's own
 *  SANDBOX_TIMEOUT rather than a client-side abort. */
const SANDBOX_TIMEOUT_MS = 150_000;

export interface ExecuteBuilderScriptArgs {
  /** The IfcOpenShell Python script from TR-022. */
  pythonCode: string;
  /** Filename prefix for the R2 upload of the generated IFC. */
  filePrefix: string;
  /** The architect's expected entity count — forwarded as a sanity signal. */
  expectedEntityCount: number;
}

export type SandboxTransportFailureKind =
  | "not-configured"
  | "timeout"
  | "network-error"
  | "http-error"
  | "parse-error";

export type ExecuteBuilderScriptResult =
  | { ok: true; response: ExecuteBuilderScriptResponse }
  | {
      ok: false;
      kind: SandboxTransportFailureKind;
      message: string;
      statusCode?: number;
    };

/**
 * POST a builder script to the Railway sandbox. Never throws — returns a
 * discriminated result describing success or the transport failure mode.
 */
export async function executeBuilderScript(
  args: ExecuteBuilderScriptArgs,
): Promise<ExecuteBuilderScriptResult> {
  if (!IFC_SERVICE_URL) {
    return {
      ok: false,
      kind: "not-configured",
      message:
        "IFC_SERVICE_URL is not configured — the Python sandbox is unreachable.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${IFC_SERVICE_URL}/api/v1/execute-builder-script`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(IFC_SERVICE_API_KEY
          ? { Authorization: `Bearer ${IFC_SERVICE_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        python_code: args.pythonCode,
        file_prefix: args.filePrefix,
        expected_entity_count: args.expectedEntityCount,
      }),
      signal: AbortSignal.timeout(SANDBOX_TIMEOUT_MS),
    });
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return {
      ok: false,
      kind: isAbort ? "timeout" : "network-error",
      message:
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      /* body unreadable — fall through with empty detail */
    }
    return {
      ok: false,
      kind: "http-error",
      statusCode: response.status,
      message: `Sandbox responded ${response.status} ${response.statusText}${
        detail ? `: ${detail}` : ""
      }`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      kind: "parse-error",
      message: `Sandbox response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const parsed = ExecuteBuilderScriptResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      kind: "parse-error",
      message: `Sandbox response failed schema validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    };
  }

  return { ok: true, response: parsed.data };
}
