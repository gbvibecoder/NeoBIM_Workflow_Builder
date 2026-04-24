// Results V2 preview screenshot capture — Playwright-driven, no new deps.
// Run with:  node scripts/results-v2-screenshots.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.V2_PREVIEW_URL ?? "http://localhost:3456/preview/results-v2";
const OUT_DIR = resolve(process.cwd(), "docs/screenshots/results-v2");
mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

// Preview page sections and their in-page anchors
const SECTIONS = [
  { anchor: "#section-video", label: "variant-1-hero-video" },
  { anchor: "#section-image", label: "variant-2-hero-image" },
  { anchor: "#section-3d", label: "variant-3-hero-viewer3d" },
  { anchor: "#section-floor", label: "variant-4-hero-floorplan" },
  { anchor: "#section-kpi", label: "variant-5-hero-kpi" },
  { anchor: "#section-skeleton", label: "variant-6-hero-skeleton" },
  { anchor: "#section-full", label: "full-experience" },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", err => console.warn(`[${vp.name}] page error:`, err?.message));

    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    // Give Next dev-mode + framer-motion a beat to settle.
    await page.waitForTimeout(3000);

    // Top-of-page capture for each viewport — shows the first (video) hero + header
    const topPath = resolve(OUT_DIR, `${vp.name}-top.png`);
    await page.screenshot({ path: topPath, fullPage: false });
    console.log(`✓ ${vp.name}-top → ${topPath}`);

    for (const sec of SECTIONS) {
      try {
        await page.evaluate(anchor => {
          const el = document.querySelector(anchor);
          if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
        }, sec.anchor);
        await page.waitForTimeout(900);
        const out = resolve(OUT_DIR, `${vp.name}-${sec.label}.png`);
        await page.screenshot({ path: out, fullPage: false });
        console.log(`✓ ${vp.name}-${sec.label} → ${out}`);
      } catch (err) {
        console.warn(`[${vp.name}] skip ${sec.label}:`, err?.message);
      }
    }

    // Full-page tall capture for desktop + mobile (tablet is redundant)
    if (vp.name !== "tablet") {
      const fullPath = resolve(OUT_DIR, `${vp.name}-full-scroll.png`);
      await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: fullPath, fullPage: true });
      console.log(`✓ ${vp.name}-full-scroll → ${fullPath}`);
    }

    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log("\nDone. Screenshots written to docs/screenshots/results-v2/");
