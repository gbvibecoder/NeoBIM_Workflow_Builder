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
