/**
 * QStash helpers for VIP background jobs.
 *
 * Provides: scheduleVipWorker (enqueue job), verifyQstashSignature (webhook auth).
 */

import { Client, Receiver } from "@upstash/qstash";

let _client: Client | null = null;
let _receiver: Receiver | null = null;

function getClient(): Client {
  if (_client) return _client;
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN not set");
  _client = new Client({ token });
  return _client;
}

function getReceiver(): Receiver {
  if (_receiver) return _receiver;
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) throw new Error("QSTASH signing keys not set");
  _receiver = new Receiver({ currentSigningKey: current, nextSigningKey: next });
  return _receiver;
}

/**
 * Schedule the VIP worker to process a job.
 * QStash will POST to /api/vip-jobs/worker with the jobId in the body.
 */
export async function scheduleVipWorker(jobId: string): Promise<string> {
  const client = getClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const workerUrl = `${appUrl}/api/vip-jobs/worker`;

  const result = await client.publishJSON({
    url: workerUrl,
    body: { jobId },
    retries: 0,
    timeout: "10m",
  });

  return result.messageId;
}

/**
 * Phase 2.3 Workstream C: resume a paused VipJob by enqueuing Phase B
 * (Stages 3-7) against /api/vip-jobs/worker/resume.
 */
export async function scheduleVipWorkerResume(jobId: string): Promise<string> {
  const client = getClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const workerUrl = `${appUrl}/api/vip-jobs/worker/resume`;

  const result = await client.publishJSON({
    url: workerUrl,
    body: { jobId },
    retries: 0,
    timeout: "10m",
  });

  return result.messageId;
}

/**
 * Phase 2.3 Workstream C: regenerate the Stage 2 image for a paused
 * VipJob. Targets /api/vip-jobs/worker/regenerate-image. Runs Stage 2
 * only, updates intermediate state, stays AWAITING_APPROVAL.
 */
export async function scheduleVipWorkerRegenerateImage(jobId: string): Promise<string> {
  const client = getClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const workerUrl = `${appUrl}/api/vip-jobs/worker/regenerate-image`;

  const result = await client.publishJSON({
    url: workerUrl,
    body: { jobId },
    retries: 0,
    timeout: "10m",
  });

  return result.messageId;
}

// ─── Brief-to-Renders pipeline ──────────────────────────────────────

/**
 * Schedule the Brief-to-Renders worker for a freshly-created job.
 * QStash will POST to /api/brief-renders/worker with `{ jobId }`.
 *
 * Mirrors `scheduleVipWorker` exactly — same `retries: 0`, same
 * `timeout: "10m"`, same body shape. The orchestrator handles its own
 * retries (idempotent on cached stages) so QStash retry would just
 * cause duplicate work; `retries: 0` keeps the failure semantics clean.
 */
export async function scheduleBriefRenderWorker(jobId: string): Promise<string> {
  const client = getClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const workerUrl = `${appUrl}/api/brief-renders/worker`;

  const result = await client.publishJSON({
    url: workerUrl,
    body: { jobId },
    retries: 0,
    timeout: "10m",
  });

  return result.messageId;
}

/**
 * Schedule the per-shot render worker. Mirrors `scheduleBriefRenderWorker`
 * (retries=0, timeout=10m). Body shape matches
 * `/api/brief-renders/worker/render` — when `apartmentIndex` /
 * `shotIndexInApartment` are omitted, the worker picks the first
 * pending shot in row-major order. When specified, that exact shot
 * is targeted (used by `regenerate-shot` and the rate-limit-retry path).
 *
 * `delay` is a per-call enqueue delay in seconds — used by the rate-
 * limit backoff (5s → 15s → 45s) and the lock-busy retry.
 */
export interface ScheduleBriefRenderRenderOptions {
  apartmentIndex?: number;
  shotIndexInApartment?: number;
  retryCount?: number;
  /** Delay in seconds before QStash dispatches. Default: 0. */
  delay?: number;
}

export async function scheduleBriefRenderRenderWorker(
  jobId: string,
  options: ScheduleBriefRenderRenderOptions = {},
): Promise<string> {
  const client = getClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const workerUrl = `${appUrl}/api/brief-renders/worker/render`;

  const body: Record<string, unknown> = { jobId };
  if (typeof options.apartmentIndex === "number") {
    body.apartmentIndex = options.apartmentIndex;
  }
  if (typeof options.shotIndexInApartment === "number") {
    body.shotIndexInApartment = options.shotIndexInApartment;
  }
  if (typeof options.retryCount === "number") {
    body.retryCount = options.retryCount;
  }

  const result = await client.publishJSON({
    url: workerUrl,
    body,
    retries: 0,
    timeout: "10m",
    ...(typeof options.delay === "number" && options.delay > 0
      ? { delay: options.delay }
      : {}),
  });

  return result.messageId;
}

/**
 * Schedule the Stage 4 compile worker for a job whose shots are all
 * rendered. Mirrors `scheduleBriefRenderRenderWorker` shape (retries=0,
 * timeout=10m). Body is just `{ jobId }` — Stage 4 is a single-shot
 * orchestration, no per-shot indices or retry counters.
 */
export async function scheduleBriefRenderCompileWorker(
  jobId: string,
): Promise<string> {
  const client = getClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const workerUrl = `${appUrl}/api/brief-renders/worker/compile`;

  const result = await client.publishJSON({
    url: workerUrl,
    body: { jobId },
    retries: 0,
    timeout: "10m",
  });

  return result.messageId;
}

// ─── Brief-to-IFC v2 (Phase 2 queued pipeline) ──────────────────────

/**
 * Schedule the Brief-to-IFC v2 worker for a job. QStash POSTs to
 * `/api/brief-to-ifc-job/worker` with `{ jobId }`. Used both to kick off
 * a freshly-created job AND by the worker to re-enqueue itself between
 * the three stages (enrich → architect → generate) so each stage gets a
 * fresh Vercel per-invocation budget.
 *
 * Mirrors `scheduleBriefRenderWorker` — `retries: 0` (the worker owns its
 * own idempotent retries via atomic claims), `timeout: "10m"`. `delay`
 * (seconds) backs off transient-failure re-enqueues.
 */
export async function scheduleBriefToIfcWorker(
  jobId: string,
  options: { delay?: number } = {},
): Promise<string> {
  const client = getClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const workerUrl = `${appUrl}/api/brief-to-ifc-job/worker`;

  const result = await client.publishJSON({
    url: workerUrl,
    body: { jobId },
    retries: 0,
    timeout: "10m",
    ...(typeof options.delay === "number" && options.delay > 0
      ? { delay: options.delay }
      : {}),
  });

  return result.messageId;
}

// ─── Brief-to-IFC v3 Agent Build (Phase gamma.2) ───────────────────

/**
 * Schedule the v3 agent build worker. QStash POSTs to
 * `/api/brief-to-ifc/v3/agent-job` with the full γ.1 Direct Agent Mode
 * payload: runId + briefText + suggestions + iteration. The worker loads
 * briefSpec from the DB, combines with the payload fields, and runs the
 * generator loop with the verify→hint→iterate quality loop.
 *
 * Phase gamma.3: payload now carries ALL γ.1 fields (briefText,
 * suggestions, iteration) — γ.2 only passed runId and the agent ran
 * blind on spec-only input (quality 45, proven on cmpdqhfx).
 */
export interface AgentBuildWorkerPayload {
  runId: string;
  briefText?: string;
  suggestions?: Record<string, unknown>;
  previousFeedback?: string;
  iteration?: number;
}

export interface ScheduleAgentBuildWorkerOptions {
  /**
   * Optional Upstash-Deduplication-Id header value. Phase δ.3 uses
   * this as defense-in-depth for the per-iteration QStash chain:
   * set `<runId>-iter-<N>` when re-enqueueing iteration N, so any
   * QStash double-delivery is dropped at the queue level (in addition
   * to the DB-level atomic currentIteration counter check in the
   * worker, which is the primary guard).
   */
  dedupId?: string;
}

export async function scheduleAgentBuildWorker(
  payload: AgentBuildWorkerPayload,
  options: ScheduleAgentBuildWorkerOptions = {},
): Promise<string> {
  const client = getClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const workerUrl = `${appUrl}/api/brief-to-ifc/v3/agent-job`;

  const headers: Record<string, string> = {};
  if (options.dedupId) {
    // QStash deduplicates publishes that share an Upstash-Deduplication-Id
    // within the configured dedup window. The DB-level currentIteration
    // counter is the authoritative idempotency guard; this header is a
    // belt-and-braces measure that prevents the duplicate from ever
    // reaching the worker.
    headers["Upstash-Deduplication-Id"] = options.dedupId;
  }

  const result = await client.publishJSON({
    url: workerUrl,
    body: payload,
    retries: 0,
    timeout: "15m",
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  });

  return result.messageId;
}

/**
 * Verify that a request came from QStash (signature validation).
 * Returns true if valid, false otherwise.
 */
export async function verifyQstashSignature(
  signature: string | null,
  body: string,
): Promise<boolean> {
  if (!signature) return false;
  try {
    const receiver = getReceiver();
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}
