/**
 * Public health status reporter for the NeoBIM IFC microservice.
 *
 * Thin wrapper over `isServiceReady` in `ifc-service-client.ts` that
 * reshapes the internal probe result into a format suitable for a future
 * admin dashboard, monitoring agent, or status page.
 *
 * Phase 1 Track A.5 — no UI consumer exists yet. This file exists so the
 * future admin health widget doesn't trigger a refactor of the ex-001
 * call site when it lands.
 */

import { isServiceReady } from "@/features/ifc/services/ifc-service-client";
import type { ServiceReadinessReason } from "@/features/ifc/services/ifc-service-client";

export interface ServiceHealthStatus {
  /** True when the service replied to /ready with body.ready === true. */
  ready: boolean;
  /** Wall-clock probe latency in ms. 0 if the service URL is not configured. */
  latencyMs: number;
  /** Date.now() timestamp of the most recent check. */
  lastChecked: number;
  /** Short error message when ready=false; undefined when ready=true. */
  lastError?: string;
  /** Coarse classification of why the probe returned its verdict. */
  reason: ServiceReadinessReason;
  /** HTTP status when a response was received; undefined for network failures. */
  statusCode?: number;
}

/**
 * Probe the IFC service and return a status snapshot.
 *
 * Reuses the 60 s cache inside `isServiceReady`, so repeated calls from
 * admin dashboards / status-page pollers are cheap.
 *
 * Never throws.
 */
export async function getServiceHealthStatus(
  timeoutMs?: number,
): Promise<ServiceHealthStatus> {
  const r = await isServiceReady(timeoutMs);
  return {
    ready: r.ready,
    latencyMs: r.latencyMs,
    lastChecked: r.checkedAt,
    lastError: r.error,
    reason: r.reason,
    statusCode: r.statusCode,
  };
}
