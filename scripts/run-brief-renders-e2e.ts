/**
 * Brief-to-Renders end-to-end smoke script.
 *
 * Drives the full pipeline directly against the running dev server:
 *
 *   1. POST /api/upload-brief        (multipart, uses --brief PATH)
 *   2. POST /api/brief-renders       (creates a job + dispatches QStash)
 *   3. Poll  /api/brief-renders/:id  until status === AWAITING_APPROVAL
 *   4. POST /api/brief-renders/:id/approve  (kicks Stage 3)
 *   5. Poll until status === COMPLETED (or FAILED / CANCELLED)
 *   6. HEAD the resulting `pdfUrl` to confirm the editorial PDF exists
 *
 * Designed for staging / preview environments. Will not run against
 * production by default — see `--allow-prod`.
 *
 * Usage:
 *   npx tsx scripts/run-brief-renders-e2e.ts \
 *     --base http://localhost:3000 \
 *     --cookie "next-auth.session-token=..." \
 *     --brief ./samples/marx12-mini.pdf
 *
 * Required:
 *   --base    Base URL (e.g. http://localhost:3000 or https://staging.neobim.app)
 *   --cookie  Session cookie string (the value of `Cookie:` header)
 *   --brief   Path to a PDF or DOCX brief on local disk
 *
 * Optional:
 *   --allow-prod                          Allow runs against production
 *   --timeout <minutes>                   Total budget (default 25)
 *   --idempotency-key <uuid>              Reuse a key (default generates one)
 *
 * Exit codes:
 *   0 = COMPLETED + pdfUrl reachable
 *   1 = startup / arg parsing error
 *   2 = job FAILED or CANCELLED
 *   3 = timed out before terminal state
 *   4 = pdfUrl unreachable
 */

/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── env loader (mirrors run-phase-2-10-e2e.ts) ─────────────────────

(function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

// ─── arg parser ─────────────────────────────────────────────────────

interface Args {
  base: string;
  cookie: string;
  brief: string;
  allowProd: boolean;
  timeoutMinutes: number;
  idempotencyKey: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Partial<Args> = {
    timeoutMinutes: 25,
    allowProd: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--base":
        out.base = next;
        i++;
        break;
      case "--cookie":
        out.cookie = next;
        i++;
        break;
      case "--brief":
        out.brief = next;
        i++;
        break;
      case "--allow-prod":
        out.allowProd = true;
        break;
      case "--timeout":
        out.timeoutMinutes = Number(next);
        i++;
        break;
      case "--idempotency-key":
        out.idempotencyKey = next;
        i++;
        break;
      default:
        if (flag.startsWith("--")) {
          console.error(`Unknown flag: ${flag}`);
          process.exit(1);
        }
    }
  }
  if (!out.base || !out.cookie || !out.brief) {
    console.error("Missing required: --base, --cookie, --brief");
    process.exit(1);
  }
  if (!out.idempotencyKey) {
    out.idempotencyKey = globalThis.crypto.randomUUID();
  }
  return out as Args;
}

// ─── http helpers ───────────────────────────────────────────────────

async function postMultipart(
  base: string,
  cookie: string,
  filePath: string,
): Promise<{ briefUrl: string; fileName: string; fileSize: number }> {
  const buf = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([new Uint8Array(buf)]);
  const form = new FormData();
  form.append("file", blob, fileName);
  const res = await fetch(`${base}/api/upload-brief`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`upload-brief HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<{
    briefUrl: string;
    fileName: string;
    fileSize: number;
  }>;
}

async function postJson<T>(
  base: string,
  cookie: string,
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST ${path} HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(
  base: string,
  cookie: string,
  path: string,
): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: { cookie } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GET ${path} HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

interface JobView {
  id: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "AWAITING_APPROVAL"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  currentStage: string | null;
  pdfUrl: string | null;
  errorMessage: string | null;
  costUsd: number;
  progress: number;
}

async function pollUntil(
  base: string,
  cookie: string,
  jobId: string,
  predicate: (job: JobView) => boolean,
  budgetMs: number,
): Promise<JobView> {
  const started = Date.now();
  let lastSummary = "";
  while (Date.now() - started < budgetMs) {
    const job = await getJson<JobView>(
      base,
      cookie,
      `/api/brief-renders/${jobId}`,
    );
    const summary = `${job.status} · ${job.currentStage ?? "—"} · ${job.progress}%`;
    if (summary !== lastSummary) {
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(`  [${elapsed.toString().padStart(4)}s] ${summary}`);
      lastSummary = summary;
    }
    if (predicate(job)) return job;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`Polling timed out after ${budgetMs}ms`);
}

// ─── main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.allowProd && /(prod|production|neobim\.app)/i.test(args.base)) {
    console.error(
      "Refusing to run against what looks like production. Pass --allow-prod to override.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(args.brief)) {
    console.error(`Brief not found: ${args.brief}`);
    process.exit(1);
  }

  console.log("─".repeat(64));
  console.log("Brief→Renders E2E smoke");
  console.log(`  base:   ${args.base}`);
  console.log(`  brief:  ${args.brief}`);
  console.log(`  idem:   ${args.idempotencyKey}`);
  console.log(`  budget: ${args.timeoutMinutes} min total`);
  console.log("─".repeat(64));

  // 1. Upload.
  console.log("\n[1/5] Upload brief…");
  const upload = await postMultipart(args.base, args.cookie, args.brief);
  console.log(`  → briefUrl: ${upload.briefUrl}`);

  // 2. Create job.
  console.log("\n[2/5] Create job…");
  const created = await postJson<{ jobId: string }>(
    args.base,
    args.cookie,
    "/api/brief-renders",
    { briefUrl: upload.briefUrl },
    { "idempotency-key": args.idempotencyKey },
  );
  console.log(`  → jobId: ${created.jobId}`);

  // 3. Poll until awaiting approval.
  console.log("\n[3/5] Wait for AWAITING_APPROVAL…");
  const halfBudget = (args.timeoutMinutes * 60_000) / 2;
  const awaiting = await pollUntil(
    args.base,
    args.cookie,
    created.jobId,
    (j) =>
      j.status === "AWAITING_APPROVAL" ||
      j.status === "FAILED" ||
      j.status === "CANCELLED",
    halfBudget,
  );
  if (awaiting.status !== "AWAITING_APPROVAL") {
    console.error(
      `Job reached terminal state during spec extraction: ${awaiting.status} — ${awaiting.errorMessage ?? "no message"}`,
    );
    process.exit(2);
  }
  console.log(`  → AWAITING_APPROVAL (cost so far: $${awaiting.costUsd})`);

  // 4. Approve.
  console.log("\n[4/5] Approve job…");
  await postJson<unknown>(
    args.base,
    args.cookie,
    `/api/brief-renders/${created.jobId}/approve`,
    {},
  );
  console.log("  → approved");

  // 5. Poll until COMPLETED.
  console.log("\n[5/5] Wait for COMPLETED…");
  const final = await pollUntil(
    args.base,
    args.cookie,
    created.jobId,
    (j) =>
      j.status === "COMPLETED" ||
      j.status === "FAILED" ||
      j.status === "CANCELLED",
    halfBudget,
  );
  if (final.status !== "COMPLETED") {
    console.error(
      `Job ended in ${final.status}: ${final.errorMessage ?? "no message"}`,
    );
    process.exit(2);
  }
  if (!final.pdfUrl) {
    console.error("COMPLETED but pdfUrl is null");
    process.exit(2);
  }
  console.log(`  → COMPLETED (cost: $${final.costUsd}, pdf: ${final.pdfUrl})`);

  // 6. HEAD the PDF.
  console.log("\nVerifying PDF reachable…");
  const head = await fetch(final.pdfUrl, { method: "HEAD" });
  if (!head.ok) {
    console.error(`PDF unreachable: HTTP ${head.status}`);
    process.exit(4);
  }
  console.log(`  → PDF OK (${head.headers.get("content-length") ?? "?"} bytes)`);

  console.log("\n✓ E2E passed");
}

main().catch((err) => {
  console.error("\n✗ E2E failed:", err);
  process.exit(3);
});
