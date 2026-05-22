/**
 * scripts/kos-test-retrieval.ts
 *
 * Stage-A CLI helper. Two modes:
 *
 *   1. DIRECT (default) — instantiate a script-only PrismaClient
 *      (pg adapter, not Neon WebSocket), call retrieveChunks()
 *      in-process. Tests the production code path end-to-end.
 *
 *   2. VIA-API — pass `--via-api`. Skip Prisma entirely. POST to
 *      /api/kos/bd/dev/test-retrieval-direct on the running Next
 *      dev server, print the response. Useful for confirming the
 *      Next runtime's Prisma client (Neon WebSocket adapter) works
 *      independently of the script's Prisma client.
 *
 * Usage:
 *   npm run kos:test-retrieval -- --query="..."
 *   npm run kos:test-retrieval -- --tenant=kalzen --query="..."
 *   npm run kos:test-retrieval -- --via-api --query="..."
 *
 * For --via-api, you need a BD session cookie in
 *   KOS_DEV_BD_SESSION_TOKEN=<value>
 * Run `npm run kos:bd-session` to mint one.
 *
 * IMPORTANT IMPORT ORDER (direct mode):
 *   `./lib/prisma-for-scripts` MUST be imported BEFORE
 *   `@/features/...` because it has a side effect — it sets
 *   `globalThis.prisma` so `@/lib/db` adopts the pg-backed client
 *   instead of building a fresh Neon WebSocket one. ESM imports
 *   are evaluated in declaration order, so keep this order
 *   intact: lint auto-sort that puts `@/` before `./lib/` would
 *   break the retriever path silently.
 */

// 1. Side-effect import: env load + globalThis.prisma assignment.
//    MUST come before the @/features import below.
import { prismaForScripts } from "./lib/prisma-for-scripts";

// 2. Now safe to pull in the retriever — its `@/lib/db` import
//    sees the pg-backed prisma already on globalThis.
import { retrieveChunks } from "@/features/kos/services/rag-retriever";

// ─── CLI arg parsing ────────────────────────────────────────────────
function parseArg(flag: string): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1).trim();
  }
  return null;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

const tenantSlug = parseArg("--tenant") ?? "kalzen";
const query = parseArg("--query");
const viaApi = hasFlag("--via-api");

if (!query) {
  console.error(
    'Usage: npm run kos:test-retrieval -- [--via-api] --tenant=<slug> --query="<text>"',
  );
  process.exit(1);
}

// ─── Mode 1: VIA-API — hit the Next dev server, no Prisma ───────────
async function mainViaApi(): Promise<void> {
  const cookie = process.env.KOS_DEV_BD_SESSION_TOKEN;
  if (!cookie) {
    throw new Error(
      "[kos-test-retrieval --via-api] KOS_DEV_BD_SESSION_TOKEN is not set in " +
        ".env.local. Run `npm run kos:bd-session` first to mint a token.",
    );
  }
  const baseUrl =
    process.env.KOS_DEV_API_BASE_URL ?? "http://kalzen.localhost:3000";
  const url = `${baseUrl}/api/kos/bd/dev/test-retrieval-direct`;

  console.info(
    `[kos-test-retrieval via-api] POST ${url} tenant="${tenantSlug}" query="${query}"`,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kos-tenant-slug-override": tenantSlug,
        Cookie: `kos_bd_session=${encodeURIComponent(cookie)}`,
      },
      body: JSON.stringify({ query, topK: 5 }),
    });
  } catch (err) {
    throw new Error(
      `[kos-test-retrieval --via-api] fetch failed — is the Next dev server running at ${baseUrl}? ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const text = await res.text();
  console.info(`[kos-test-retrieval via-api] status: ${res.status}`);
  console.info("[kos-test-retrieval via-api] body:");
  try {
    console.info(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.info(text);
  }
}

// ─── Mode 2: DIRECT — use prismaForScripts + retrieveChunks ─────────
async function mainDirect(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "[kos-test-retrieval] OPENAI_API_KEY is not set — embedding the query will fail.",
    );
  }

  const tenant = await prismaForScripts.tenant.findUnique({
    where: { slug: tenantSlug },
  });
  if (!tenant) {
    throw new Error(
      `[kos-test-retrieval] tenant slug="${tenantSlug}" not found.`,
    );
  }

  console.info(
    `[kos-test-retrieval] tenant="${tenantSlug}" topK=5 query="${query}"`,
  );

  const startedAt = Date.now();
  const chunks = await retrieveChunks(tenant.id, query!, { topK: 5 });
  const latencyMs = Date.now() - startedAt;

  console.info(
    `[kos-test-retrieval] returned ${chunks.length} chunk(s) in ${latencyMs}ms\n`,
  );

  if (chunks.length === 0) {
    console.info(
      "  (no chunks above minSimilarity=0.5 — make sure at least one document is in status=READY)",
    );
    return;
  }

  chunks.forEach((c, idx) => {
    const preview = c.content.slice(0, 200).replace(/\s+/g, " ").trim();
    const sim = c.similarity.toFixed(4);
    console.info(`#${idx + 1}  similarity=${sim}`);
    console.info(`     title:    ${c.documentTitle} (docType=${c.docType})`);
    console.info(`     chunkId:  ${c.chunkId}`);
    console.info(`     pageNum:  ${c.pageNum ?? "?"}`);
    console.info(`     preview:  ${preview}${c.content.length > 200 ? "…" : ""}`);
    console.info("");
  });
}

// ─── Entry point ────────────────────────────────────────────────────
(viaApi ? mainViaApi() : mainDirect())
  .catch((err) => {
    console.error("[kos-test-retrieval] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Only disconnect when we actually used the direct path.
    if (!viaApi) {
      try {
        await prismaForScripts.$disconnect();
      } catch {
        // ignore — we're exiting anyway
      }
    }
  });
