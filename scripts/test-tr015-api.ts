/**
 * Direct test of Anthropic API with web_search — run outside the pipeline
 * Usage: npx tsx scripts/test-tr015-api.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const apiKey = process.env.ANTHROPIC_API_KEY || "";
console.log(`API key: ${apiKey ? apiKey.slice(0, 15) + "..." : "MISSING"}`);
console.log(`Key format: ${apiKey.startsWith("sk-ant-api") ? "VALID" : "INVALID — must start with sk-ant-api"}`);

if (!apiKey || !apiKey.startsWith("sk-ant-api")) {
  console.error("Set ANTHROPIC_API_KEY in .env.local");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

const priceTool = {
  name: "report_prices",
  description: "Report construction prices",
  input_schema: {
    type: "object" as const,
    properties: {
      steel_per_tonne: { type: "number" as const },
      cement_per_bag: { type: "number" as const },
      mason_per_day: { type: "number" as const },
    },
    required: ["steel_per_tonne", "cement_per_bag", "mason_per_day"],
  },
};

async function testSonnetWithWebSearch() {
  console.log("\n═══ TEST 1: Sonnet + web_search (60s timeout) ═══");
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [
        { type: "web_search_20250305" as const, name: "web_search", max_uses: 2 },
        priceTool,
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: "What is the current TMT steel price per tonne in Pune, India? Search the web and use report_prices tool." }],
    }, { signal: ctrl.signal });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.log(`✅ Sonnet + web_search completed in ${elapsed}ms`);
    console.log(`   Stop reason: ${resp.stop_reason}`);
    console.log(`   Content blocks: ${resp.content.length}`);
    for (const block of resp.content) {
      const bt = block.type as string;
      if (bt === "web_search_tool_result" || bt === "server_tool_use") {
        console.log(`   Web search used: YES`);
      }
      if (block.type === "tool_use") {
        console.log(`   Tool call: ${block.name} → ${JSON.stringify(block.input)}`);
      }
      if (block.type === "text") {
        console.log(`   Text: ${block.text.slice(0, 200)}`);
      }
    }
    console.log(`   Usage: input=${resp.usage.input_tokens} output=${resp.usage.output_tokens}`);
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.error(`❌ Sonnet + web_search failed after ${elapsed}ms`);
    if (err instanceof Error) {
      console.error(`   Error name: ${err.name}`);
      console.error(`   Error message: ${err.message}`);
      console.error(`   Error cause: ${JSON.stringify((err as unknown as Record<string, unknown>).cause)}`);
      console.error(`   Status: ${(err as unknown as Record<string, unknown>).status}`);
      console.error(`   Headers: ${JSON.stringify((err as unknown as Record<string, unknown>).headers)}`);
    } else {
      console.error(`   Raw error:`, err);
    }
  }
}

async function testSonnetNoWebSearch() {
  console.log("\n═══ TEST 2: Sonnet WITHOUT web_search (30s timeout) ═══");
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [priceTool],
      tool_choice: { type: "tool", name: "report_prices" },
      messages: [{ role: "user", content: "Return current construction prices for Pune, Maharashtra, India. Steel per tonne, cement per bag, mason daily wage." }],
    }, { signal: ctrl.signal });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.log(`✅ Sonnet (no web search) completed in ${elapsed}ms`);
    for (const block of resp.content) {
      if (block.type === "tool_use") {
        console.log(`   Tool call: ${block.name} → ${JSON.stringify(block.input)}`);
      }
    }
    console.log(`   Usage: input=${resp.usage.input_tokens} output=${resp.usage.output_tokens}`);
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.error(`❌ Sonnet (no web search) failed after ${elapsed}ms`);
    if (err instanceof Error) {
      console.error(`   ${err.name}: ${err.message}`);
      console.error(`   Status: ${(err as Record<string, unknown>).status}`);
    }
  }
}

async function testHaiku() {
  console.log("\n═══ TEST 3: Haiku (12s timeout) ═══");
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      tools: [priceTool],
      tool_choice: { type: "tool", name: "report_prices" },
      messages: [{ role: "user", content: "Return construction prices for Pune, India: steel ₹/tonne, cement ₹/bag, mason ₹/day." }],
    }, { signal: ctrl.signal });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.log(`✅ Haiku completed in ${elapsed}ms`);
    for (const block of resp.content) {
      if (block.type === "tool_use") {
        console.log(`   Tool call: ${block.name} → ${JSON.stringify(block.input)}`);
      }
    }
    console.log(`   Usage: input=${resp.usage.input_tokens} output=${resp.usage.output_tokens}`);
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.error(`❌ Haiku failed after ${elapsed}ms`);
    if (err instanceof Error) {
      console.error(`   ${err.name}: ${err.message}`);
    }
  }
}

async function main() {
  console.log(`\nTesting Anthropic API at ${new Date().toISOString()}\n`);

  // Run all 3 tests sequentially
  await testHaiku();
  await testSonnetNoWebSearch();
  await testSonnetWithWebSearch();

  console.log("\n═══ DONE ═══\n");
}

main().catch(console.error);
