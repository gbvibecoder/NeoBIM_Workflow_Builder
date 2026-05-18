/**
 * Deterministic runner — calls the Railway deterministic builder endpoint
 * instead of the agent loop. Returns the same `GeneratorResult` shape so
 * the caller (runs/route.ts) can treat both paths identically.
 *
 * Phase G — feature-flagged behind `USE_DETERMINISTIC_BUILDER` env.
 * Cost is $0 (no LLM in the builder). The only LLM spend is the
 * Layer 1 enrichment which happens upstream.
 */

import type {
  BriefSpec,
  GeneratorResult,
  SandboxValidateResult,
} from "../types";

const DEFAULT_TIMEOUT_MS = 30_000;

interface DeterministicBuildResponse {
  ok: boolean;
  ifc_url: string | null;
  entity_count: number;
  build_duration_ms: number;
  validation: SandboxValidateResult | null;
  error: string | null;
}

export interface RunDeterministicArgs {
  brief: BriefSpec;
  schema?: "IFC4" | "IFC2X3";
  timeoutMs?: number;
}

export async function runDeterministic(
  args: RunDeterministicArgs,
): Promise<GeneratorResult> {
  const startedAt = Date.now();
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const schema = args.schema ?? "IFC4";

  const url = process.env.IFC_SERVICE_URL;
  if (!url) {
    return failed(startedAt, "NOT_CONFIGURED", "IFC_SERVICE_URL is not set.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.IFC_SERVICE_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  let res: Response;
  try {
    res = await fetch(`${url}/api/v3/deterministic/build`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        brief_spec: args.brief,
        schema_version: schema,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    return failed(
      startedAt,
      isTimeout ? "DETERMINISTIC_TIMEOUT" : "DETERMINISTIC_NETWORK_ERROR",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return failed(
      startedAt,
      "DETERMINISTIC_HTTP_ERROR",
      `HTTP ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  let data: DeterministicBuildResponse;
  try {
    data = (await res.json()) as DeterministicBuildResponse;
  } catch {
    return failed(startedAt, "DETERMINISTIC_PARSE_ERROR", "Invalid JSON response");
  }

  if (!data.ok) {
    return failed(startedAt, "DETERMINISTIC_BUILD_ERROR", data.error ?? "unknown");
  }

  return {
    ok: true,
    ifcUrl: data.ifc_url,
    entityCount: data.entity_count,
    costUsd: 0, // Deterministic — no LLM cost
    durationMs: Date.now() - startedAt,
    turns: 0,
    ledger: [],
    turnRecords: [],
    finalValidation: data.validation,
    error: null,
  };
}

function failed(
  startedAt: number,
  code: string,
  message: string,
): GeneratorResult {
  return {
    ok: false,
    ifcUrl: null,
    entityCount: 0,
    costUsd: 0,
    durationMs: Date.now() - startedAt,
    turns: 0,
    ledger: [],
    turnRecords: [],
    finalValidation: null,
    error: { code, message },
  };
}
