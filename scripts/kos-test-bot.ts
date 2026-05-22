/**
 * scripts/kos-test-bot.ts
 *
 * Phase 3A CLI test harness for the bot orchestrator. Calls
 * `runBotTurn` directly (NOT via SSE — the orchestrator is just an
 * async generator) and pretty-prints the event stream to stdout.
 *
 * Usage:
 *   npm run kos:test-bot -- --tenant=kalzen --query="What is the procedure for PAC application?"
 *   npm run kos:test-bot -- --tenant=kalzen --query="..." --customer-id=ck...
 *   npm run kos:test-bot -- --tenant=kalzen --query="..." --conversation-id=ck...
 *
 * If --customer-id is omitted we create a brand-new anonymous
 * KosCustomer for the run. We do NOT mint a real session cookie;
 * the orchestrator only needs the customer id, not the cookie.
 *
 * Import ordering: prisma-for-scripts (pg adapter) MUST load before
 * `@/features/kos/services/bot-orchestrator` so the orchestrator's
 * `@/lib/db` import inherits the pg-backed client. See the same
 * dance in `kos-test-retrieval.ts`.
 */

// 1. Side-effect import: env load + globalThis.prisma assignment.
//    MUST be the first import.
import { prismaForScripts } from "./lib/prisma-for-scripts";

// 2. Now safe to pull in the orchestrator (transitively imports
//    @/lib/db, which adopts globalThis.prisma).
import {
  runBotTurn,
  type BotEvent,
} from "@/features/kos/services/bot-orchestrator";

// ─── CLI arg parsing ────────────────────────────────────────────────
function parseArg(flag: string): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1).trim();
  }
  return null;
}

const tenantSlug = parseArg("--tenant") ?? "kalzen";
const query = parseArg("--query");
const passedCustomerId = parseArg("--customer-id");
const passedConversationId = parseArg("--conversation-id");

if (!query) {
  console.error(
    'Usage: npm run kos:test-bot -- --tenant=<slug> --query="<text>"' +
      " [--customer-id=<id>] [--conversation-id=<id>]",
  );
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "[kos-test-bot] ANTHROPIC_API_KEY is not set in .env.local — the bot " +
      "cannot reach Claude. Aborting.",
  );
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error(
    "[kos-test-bot] OPENAI_API_KEY is not set — embeddings for retrieval " +
      "will fail. Aborting.",
  );
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────

async function resolveTenant() {
  const tenant = await prismaForScripts.tenant.findUnique({
    where: { slug: tenantSlug },
  });
  if (!tenant) {
    throw new Error(
      `[kos-test-bot] tenant slug="${tenantSlug}" not found in DB.`,
    );
  }
  return tenant;
}

async function resolveCustomerId(tenantId: string): Promise<{
  id: string;
  displayName: string;
}> {
  if (passedCustomerId) {
    const existing = await prismaForScripts.kosCustomer.findUnique({
      where: { id: passedCustomerId },
    });
    if (!existing) {
      throw new Error(
        `[kos-test-bot] customer id="${passedCustomerId}" not found.`,
      );
    }
    if (existing.tenantId !== tenantId) {
      throw new Error(
        `[kos-test-bot] customer id="${passedCustomerId}" belongs to a different tenant.`,
      );
    }
    return {
      id: existing.id,
      displayName: existing.displayName ?? existing.name ?? "Guest-CLI",
    };
  }
  // No --customer-id → mint a fresh anonymous customer directly.
  // We bypass the cookie flow because this script doesn't have a
  // browser; the orchestrator only needs the customer id.
  const anon = await prismaForScripts.kosCustomer.create({
    data: {
      tenantId,
      // Synthetic placeholder so the unique [tenantId, phone]
      // constraint holds without inventing a fake E.164.
      phone: `anon-cli:${Date.now()}:${Math.floor(Math.random() * 1e6)}`,
      displayName: "Guest-CLI",
      firstSeenChannel: "WEB",
      isAnonymous: true,
    },
  });
  return { id: anon.id, displayName: anon.displayName ?? "Guest-CLI" };
}

function printEvent(event: BotEvent): void {
  switch (event.type) {
    case "text_delta":
      process.stdout.write(event.text);
      break;
    case "tool_call_start": {
      const inputPreview = JSON.stringify(event.input).slice(0, 200);
      console.log(`\n[tool_call_start] ${event.tool} ${inputPreview}`);
      break;
    }
    case "tool_call_result": {
      const outputLen = JSON.stringify(event.output).length;
      console.log(
        `[tool_call_result] ${event.tool} (output omitted, length=${outputLen})`,
      );
      break;
    }
    case "citations":
      console.log("\n\n[citations]");
      event.citations.forEach((c, i) => {
        const page = c.pageNum ?? "?";
        const snip = c.snippet.replace(/\s+/g, " ").slice(0, 80);
        console.log(`  [${i + 1}] ${c.title} p.${page} — ${snip}...`);
      });
      break;
    case "escalation":
      console.log(`\n[escalation] ${event.reason}`);
      break;
    case "done":
      console.log(
        `\n[done] messageId=${event.messageId} conversationId=${event.conversationId}`,
      );
      break;
    case "error":
      console.error(`\n[error] ${event.code}: ${event.message}`);
      process.exitCode = 1;
      break;
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tenant = await resolveTenant();
  const customer = await resolveCustomerId(tenant.id);

  console.log(
    `[kos-test-bot] tenant="${tenant.slug}" customerId=${customer.id} (${customer.displayName})`,
  );
  if (passedConversationId) {
    console.log(`[kos-test-bot] continuing conversation ${passedConversationId}`);
  } else {
    console.log("[kos-test-bot] starting a new conversation");
  }
  console.log(`[kos-test-bot] query: ${query}`);
  console.log("---");

  const generator = runBotTurn({
    tenantId: tenant.id,
    tenantName: tenant.name,
    conversationId: passedConversationId ?? null,
    customerId: customer.id,
    customerMessage: query!,
    customerDisplayName: customer.displayName,
  });

  for await (const event of generator) {
    printEvent(event);
  }
}

main()
  .catch((err) => {
    console.error("\n[kos-test-bot] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prismaForScripts.$disconnect();
    } catch {
      // ignore — we're exiting anyway
    }
  });
