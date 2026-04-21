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
