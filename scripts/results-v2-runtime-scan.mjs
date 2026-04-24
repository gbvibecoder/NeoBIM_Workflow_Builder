/**
 * Phase E — runtime error scan for /preview/results-v2.
 *
 * Boots a Chromium headless browser via the Playwright that's already in
 * node_modules (no npm install), loads the preview route, exercises every
 * micro-interaction, and records every `console.error`, `pageerror`, and
 * `requestfailed` event to `docs/phase-e-runtime-scan.json`.
 *
 * Exits non-zero if any fatal event is captured (after filtering known-safe
 * noise like favicon fetch failures, dev-mode HMR requests, and third-party
 * image host timeouts that don't impact the V2 surface's correctness).
 *
 * Usage:
 *   node scripts/results-v2-runtime-scan.mjs
 *   # Override the URL if the dev server runs elsewhere:
 *   V2_SCAN_URL=http://localhost:3000/preview/results-v2 node scripts/results-v2-runtime-scan.mjs
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.env.V2_SCAN_URL ?? "http://localhost:3456/preview/results-v2";
const OUT = resolve(process.cwd(), "docs/phase-e-runtime-scan.json");
mkdirSync(resolve(process.cwd(), "docs"), { recursive: true });

// Known-safe noise — dev-only, third-party delivery hiccups, or pre-existing
// app-level analytics that fire on every page and are NOT V2 bugs. Anything
// matching these patterns is captured but not counted as a ship-blocker.
const NOISE = [
  /favicon\.ico/i,
  /_next\/webpack-hmr/i,
  /__nextjs_original-stack-frames/i,
  // Fixture CDNs — third-party delivery, not V2 correctness.
  /picsum\.photos/i,
  /commondatastorage\.googleapis\.com/i,
  /ERR_ABORTED.*loadeddata/i,
  // App-level analytics tags (TrackingScripts / GA / Ads / Vercel Insights
  // / Clarity) — load on every dashboard page, blocked by local CSP, not
  // originated by V2.
  /va\.vercel-scripts\.com/i,
  /vercel[-_]insights/i,
  /pagead2\.googlesyndication/i,
  /googlesyndication\.com/i,
  /doubleclick\.net/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /googleadservices\.com/i,
  /clarity\.ms/i,
  /facebook\.com\/tr/i,
  /connect\.facebook\.net/i,
  // Generic CSP block message that these tags trigger — we filter the URL
  // patterns above, this covers the plain "Failed to load resource: 403"
  // console.error lines that accompany a blocked analytics fetch.
  /violates the following Content Security Policy/i,
  /Failed to load resource: the server responded with a status of 403/i,
  /Fetch API cannot load https:\/\/(pagead|www\.googleadservices|va\.vercel)/i,
];

function isNoise(text) {
  return NOISE.some(re => re.test(String(text)));
}

const events = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on("console", msg => {
  if (msg.type() === "error") {
    events.push({
      kind: "console.error",
      text: msg.text(),
      location: msg.location(),
      noise: isNoise(msg.text()),
    });
  } else if (msg.type() === "warning") {
    const text = msg.text();
    // Capture only React-Compiler-ish warnings — other warnings are ignored.
    if (/(setState in effect|Invalid hook|hydration mismatch|Can't perform a React state update)/i.test(text)) {
      events.push({ kind: "console.warn", text, noise: false });
    }
  }
});

page.on("pageerror", err => {
  events.push({
    kind: "pageerror",
    message: err?.message ?? String(err),
    stack: err?.stack ?? "",
    noise: isNoise(err?.message ?? ""),
  });
});

page.on("requestfailed", req => {
  const url = req.url();
  const failure = req.failure()?.errorText ?? "unknown";
  events.push({
    kind: "requestfailed",
    url,
    failure,
    noise: isNoise(url) || isNoise(failure),
  });
});

try {
  console.log(`→ navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500); // framer-motion entrance settle

  // 1. Full scroll sweep — triggers every whileInView entrance.
  console.log("→ scroll sweep");
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const y = Math.round((scrollHeight * i) / steps);
    await page.evaluate(yy => window.scrollTo({ top: yy, behavior: "auto" }), y);
    await page.waitForTimeout(350);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // 2. Full-experience composition interactions — scroll into the ribbon section.
  console.log("→ full-experience interactions");
  await page.evaluate(() => {
    document.querySelector("#section-full")?.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await page.waitForTimeout(800);

  // 2a. Hover each ribbon chip — tests the hover-thumbnail tooltip render path.
  const ribbonButtons = await page.locator("nav[aria-label='Generated artifacts'] button").all();
  console.log(`   hovering ${ribbonButtons.length} ribbon chip(s)`);
  for (const btn of ribbonButtons) {
    try {
      await btn.hover({ timeout: 2000 });
      await page.waitForTimeout(200);
    } catch { /* a chip might be off-screen — non-fatal */ }
  }

  // 2b. Click the first ribbon chip — tests smooth-scroll + state flip.
  if (ribbonButtons.length > 0) {
    try { await ribbonButtons[0].click({ timeout: 2000 }); } catch { /* no-op */ }
    await page.waitForTimeout(400);
  }

  // 2c. Click the share button — tests the "Link copied" tooltip (micro-delight #3).
  console.log("→ share tooltip");
  try {
    await page.getByRole("button", { name: /share results/i }).click({ timeout: 2000 });
    await page.waitForTimeout(800);
  } catch { /* no-op */ }

  // 2d. Click a download row — tests the arrow→check morph (micro-delight #2).
  console.log("→ download morph");
  try {
    // Prevent the browser from actually navigating on the download link click.
    await page.evaluate(() => {
      document.querySelectorAll('a[download]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
    });
    const downloadLink = page.locator('a[download]').first();
    if (await downloadLink.count() > 0) {
      await downloadLink.click({ timeout: 2000 });
      await page.waitForTimeout(700);
    }
  } catch { /* no-op */ }

  // 3. Shot-chip cycling on the full video hero — tests segment swap.
  console.log("→ shot chip cycling");
  try {
    const chips = await page.locator('button[aria-pressed]').all();
    for (const c of chips.slice(0, 3)) {
      try { await c.click({ timeout: 1000 }); } catch { /* no-op */ }
      await page.waitForTimeout(250);
    }
  } catch { /* no-op */ }

  // 4. HeroImage keyboard arrows — tests prev/next direction tracking.
  console.log("→ keyboard arrows on image hero");
  try {
    await page.evaluate(() => {
      document.querySelector("#section-image")?.scrollIntoView({ behavior: "instant", block: "start" });
    });
    await page.waitForTimeout(500);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
  } catch { /* no-op */ }

  // 5. Let one animation tick pass so any deferred errors land.
  await page.waitForTimeout(1200);
} catch (err) {
  events.push({
    kind: "scan.exception",
    message: err?.message ?? String(err),
    noise: false,
  });
} finally {
  await ctx.close();
  await browser.close();
}

const fatalEvents = events.filter(e => !e.noise);
const summary = {
  url: URL,
  runAt: new Date().toISOString(),
  totalEvents: events.length,
  fatalEvents: fatalEvents.length,
  noiseEvents: events.length - fatalEvents.length,
  byKind: events.reduce((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {}),
  events,
};

writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(`\n→ wrote ${OUT}`);
console.log(`→ ${summary.totalEvents} total · ${summary.fatalEvents} fatal · ${summary.noiseEvents} noise`);
console.log(`→ byKind: ${JSON.stringify(summary.byKind)}`);

process.exit(fatalEvents.length === 0 ? 0 : 1);
