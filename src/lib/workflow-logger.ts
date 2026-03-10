/**
 * Workflow Execution Logger — LOCAL DEV ONLY
 *
 * Writes detailed structured logs to logs/workflow-executions.log
 * Captures: auth, rate-limit, node start/end, errors, timing, input/output summaries.
 *
 * This file is server-side only (uses fs/path). The log file is .gitignored.
 * In production (no fs access on Vercel), all calls silently no-op.
 */

import { appendFile, mkdir } from "fs/promises";
import { join } from "path";

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "workflow-executions.log");

// Only log in development
const IS_DEV = process.env.NODE_ENV === "development";

let dirReady = false;

async function ensureDir() {
  if (dirReady) return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    dirReady = true;
  } catch {
    // Silently fail (e.g. Vercel serverless — no writable fs)
  }
}

function ts(): string {
  return new Date().toISOString();
}

function separator(): string {
  return "─".repeat(90);
}

function truncate(val: unknown, maxLen = 500): string {
  const str = typeof val === "string" ? val : JSON.stringify(val, null, 2);
  if (!str) return "(empty)";
  return str.length > maxLen ? str.slice(0, maxLen) + `... (${str.length} chars total)` : str;
}

async function write(line: string) {
  if (!IS_DEV) return;
  try {
    await ensureDir();
    await appendFile(LOG_FILE, line + "\n", "utf-8");
  } catch {
    // Silently fail — logging must never break the app
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function logWorkflowStart(executionId: string, userId: string, userRole: string, userEmail: string) {
  await write(`\n${separator()}`);
  await write(`[${ts()}] WORKFLOW EXECUTION STARTED`);
  await write(`  executionId : ${executionId}`);
  await write(`  userId      : ${userId}`);
  await write(`  userRole    : ${userRole}`);
  await write(`  userEmail   : ${userEmail}`);
  await write(separator());
}

export async function logRateLimit(executionId: string, passed: boolean, details: {
  remaining?: number;
  limit?: number;
  reset?: number;
  skipped?: boolean;
  userRole?: string;
}) {
  const icon = passed ? "PASS" : "BLOCKED";
  await write(`[${ts()}] RATE LIMIT ${icon}  execution=${executionId}`);
  if (details.skipped) {
    await write(`  (skipped — already counted for this executionId)`);
  } else {
    await write(`  remaining : ${details.remaining ?? "?"} / ${details.limit ?? "?"}`);
    await write(`  userRole  : ${details.userRole ?? "?"}`);
    if (details.reset) {
      const resetDate = new Date(details.reset);
      await write(`  resets at : ${resetDate.toISOString()}`);
    }
  }
}

export async function logNodeStart(executionId: string, catalogueId: string, tileInstanceId: string, inputSummary?: unknown) {
  await write(`\n[${ts()}] NODE START  catalogue=${catalogueId}  tile=${tileInstanceId}  execution=${executionId}`);
  if (inputSummary) {
    await write(`  inputData : ${truncate(inputSummary, 800)}`);
  }
}

export async function logNodeSuccess(executionId: string, catalogueId: string, tileInstanceId: string, durationMs: number, outputSummary?: unknown) {
  await write(`[${ts()}] NODE SUCCESS  catalogue=${catalogueId}  tile=${tileInstanceId}  duration=${durationMs}ms`);
  if (outputSummary) {
    await write(`  output : ${truncate(outputSummary, 600)}`);
  }
}

export async function logNodeError(executionId: string, catalogueId: string, tileInstanceId: string, error: unknown, durationMs?: number) {
  await write(`[${ts()}] NODE ERROR  catalogue=${catalogueId}  tile=${tileInstanceId}  duration=${durationMs ?? 0}ms`);

  if (error instanceof Error) {
    await write(`  error.name    : ${error.name}`);
    await write(`  error.message : ${error.message}`);
    if (error.stack) {
      const stackLines = error.stack.split("\n").slice(0, 8).map(l => `    ${l.trim()}`).join("\n");
      await write(`  stack:\n${stackLines}`);
    }
    // Log cause if present (e.g. API errors wrapping upstream errors)
    if ((error as Error & { cause?: unknown }).cause) {
      await write(`  cause : ${truncate((error as Error & { cause?: unknown }).cause, 300)}`);
    }
  } else {
    await write(`  error : ${truncate(error, 800)}`);
  }
}

export async function logApiCall(executionId: string, service: string, details: {
  method?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  error?: string;
  responsePreview?: string;
}) {
  const icon = details.error ? "FAIL" : "OK";
  await write(`[${ts()}] API CALL ${icon}  service=${service}  execution=${executionId}`);
  if (details.method && details.url) await write(`  ${details.method} ${details.url}`);
  if (details.statusCode) await write(`  status   : ${details.statusCode}`);
  if (details.durationMs) await write(`  duration : ${details.durationMs}ms`);
  if (details.error) await write(`  error    : ${details.error}`);
  if (details.responsePreview) await write(`  response : ${truncate(details.responsePreview, 400)}`);
}

export async function logValidationError(executionId: string, catalogueId: string, message: string) {
  await write(`[${ts()}] VALIDATION ERROR  catalogue=${catalogueId}  execution=${executionId}`);
  await write(`  message : ${message}`);
}

export async function logWorkflowEnd(executionId: string, status: string, totalNodes: number, durationMs: number) {
  await write(`\n[${ts()}] WORKFLOW EXECUTION ENDED`);
  await write(`  executionId  : ${executionId}`);
  await write(`  status       : ${status}`);
  await write(`  totalNodes   : ${totalNodes}`);
  await write(`  totalDuration: ${durationMs}ms (${(durationMs / 1000).toFixed(1)}s)`);
  await write(separator() + "\n");
}

export async function logInfo(executionId: string, message: string) {
  await write(`[${ts()}] INFO  execution=${executionId}  ${message}`);
}

export async function logWarn(executionId: string, message: string) {
  await write(`[${ts()}] WARN  execution=${executionId}  ${message}`);
}
