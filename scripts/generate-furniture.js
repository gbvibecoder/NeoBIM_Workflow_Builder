#!/usr/bin/env node
/**
 * BuildFlow Furniture Generator
 *
 * Generates photorealistic GLB furniture models via 3DAI Studio API
 * (Hunyuan 3D Pro). Models are saved to public/models/ for use
 * in the Three.js floor plan builder.
 *
 * Usage:
 *   THREEDAI_API_KEY=your_key node scripts/generate-furniture.js
 *
 * Or set THREEDAI_API_KEY in .env.local and run:
 *   node scripts/generate-furniture.js
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ── Config ───────────────────────────────────────────────────────────────────

// Try loading from .env.local if dotenv is available
try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
} catch {
  // dotenv not installed — that's fine, use env var directly
}

const API_KEY = process.env.THREEDAI_API_KEY;
if (!API_KEY) {
  console.error("Error: THREEDAI_API_KEY not set.");
  console.error("Set it via environment variable or in .env.local");
  process.exit(1);
}

const API_BASE = "https://api.3daistudio.com/v1";
const OUTPUT_DIR = path.join(__dirname, "..", "public", "models");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ── Furniture definitions ────────────────────────────────────────────────────
// Optimized prompts for architectural visualization furniture

const FURNITURE = [
  // Living Room
  {
    id: "sofa",
    prompt:
      "modern L-shaped sofa, gray fabric upholstery, tapered wooden legs, clean geometry, photorealistic furniture for interior design",
    filename: "sofa.glb",
  },
  {
    id: "coffee-table",
    prompt:
      "modern rectangular coffee table, walnut wood top, black metal hairpin legs, photorealistic furniture, clean geometry",
    filename: "coffee-table.glb",
  },
  {
    id: "potted-plant",
    prompt:
      "indoor potted plant, fiddle leaf fig in white ceramic pot, photorealistic, interior design prop",
    filename: "potted-plant.glb",
  },
  {
    id: "floor-lamp",
    prompt:
      "modern arc floor lamp, brass finish, white fabric shade, photorealistic lighting fixture",
    filename: "floor-lamp.glb",
  },
  {
    id: "tv-unit",
    prompt:
      "modern low TV console, walnut wood, open shelves, matte black details, photorealistic furniture",
    filename: "tv-unit.glb",
  },

  // Bedroom
  {
    id: "bed",
    prompt:
      "modern queen bed, upholstered gray headboard, white bedding with pillows, oak wood frame, photorealistic furniture",
    filename: "bed.glb",
  },
  {
    id: "nightstand",
    prompt:
      "modern bedside table with single drawer, oak wood, brass pull handle, photorealistic furniture",
    filename: "nightstand.glb",
  },

  // Dining Room
  {
    id: "dining-table",
    prompt:
      "modern rectangular dining table for 6, solid oak wood, tapered legs, photorealistic furniture",
    filename: "dining-table.glb",
  },
  {
    id: "dining-chair",
    prompt:
      "modern dining chair, molded wood seat, black metal legs, photorealistic furniture, clean geometry",
    filename: "dining-chair.glb",
  },

  // Kitchen
  {
    id: "fridge",
    prompt:
      "modern stainless steel double-door refrigerator, photorealistic kitchen appliance, clean geometry",
    filename: "fridge.glb",
  },

  // Bathroom
  {
    id: "toilet",
    prompt:
      "modern white ceramic one-piece toilet, contemporary design, photorealistic bathroom fixture",
    filename: "toilet.glb",
  },
  {
    id: "bathroom-vanity",
    prompt:
      "modern bathroom vanity, white cabinet, marble countertop, rectangular basin sink, photorealistic",
    filename: "bathroom-vanity.glb",
  },

  // Office
  {
    id: "office-desk",
    prompt:
      "modern minimalist desk, light oak wood top, black metal frame legs, photorealistic office furniture",
    filename: "office-desk.glb",
  },
  {
    id: "office-chair",
    prompt:
      "modern ergonomic office chair, black mesh back, chrome base with wheels, photorealistic",
    filename: "office-chair.glb",
  },
];

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function apiRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + endpoint);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: "Bearer " + API_KEY,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(filepath);
    proto
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlinkSync(filepath);
          return downloadFile(res.headers.location, filepath)
            .then(resolve)
            .catch(reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(filepath);
          return reject(new Error("HTTP " + res.statusCode));
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (e) => {
        file.close();
        fs.unlink(filepath, () => {});
        reject(e);
      });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Generate one model ───────────────────────────────────────────────────────

function extractGlbUrl(data) {
  const results = data.results || [];

  // Prefer 3D_MODEL type (the .glb file)
  for (const r of results) {
    if (r.asset_type === "3D_MODEL" && r.asset && r.asset.startsWith("http")) {
      return r.asset;
    }
  }

  // Fallback: any result with an asset URL
  for (const r of results) {
    if (r.asset && typeof r.asset === "string" && r.asset.startsWith("http")) {
      return r.asset;
    }
  }

  return null;
}

async function generateModel(item) {
  const filepath = path.join(OUTPUT_DIR, item.filename);

  // Skip if already exists and is non-trivial
  if (fs.existsSync(filepath)) {
    const stats = fs.statSync(filepath);
    if (stats.size > 1000) {
      console.log(
        `  OK ${item.id} — already exists (${(stats.size / 1024).toFixed(0)} KB)`
      );
      return true;
    }
  }

  console.log(`  .. ${item.id} — submitting to Hunyuan Pro...`);

  try {
    const gen = await apiRequest("POST", "/3d-models/tencent/generate/pro/", {
      prompt: item.prompt,
      model: "3.1",
      enable_pbr: true,
    });

    if (gen.status === 402) {
      console.log(`  XX ${item.id} — insufficient credits`);
      return false;
    }
    if (gen.status !== 200 && gen.status !== 201) {
      console.log(
        `  XX ${item.id} — API error ${gen.status}:`,
        JSON.stringify(gen.data).substring(0, 200)
      );
      return false;
    }

    const taskId = gen.data.task_id || gen.data.id;
    if (!taskId) {
      console.log(
        `  XX ${item.id} — no task_id:`,
        JSON.stringify(gen.data).substring(0, 200)
      );
      return false;
    }

    console.log(`  .. ${item.id} — task ${taskId}, polling...`);

    // Poll for up to 10 minutes (120 × 5s) — Pro models take longer + CDN upload delay
    for (let i = 0; i < 120; i++) {
      await sleep(5000);
      const poll = await apiRequest(
        "GET",
        `/generation-request/${taskId}/status/`
      );

      if (poll.data.status === "FINISHED") {
        const assetUrl = extractGlbUrl(poll.data);

        if (assetUrl) {
          console.log(
            `  <- ${item.id} — downloading from: ${assetUrl.substring(0, 100)}`
          );
          await downloadFile(assetUrl, filepath);
          const stats = fs.statSync(filepath);
          if (stats.size > 500) {
            console.log(
              `  OK ${item.id} — done (${(stats.size / 1024).toFixed(0)} KB)`
            );
            return true;
          } else {
            console.log(
              `  XX ${item.id} — downloaded file too small (${stats.size}B)`
            );
            fs.unlinkSync(filepath);
          }
        } else {
          // FINISHED but asset URL not ready yet — keep polling
          console.log(
            `  .. ${item.id} — FINISHED but asset uploading, waiting...`
          );
          continue;
        }
      }

      if (poll.data.status === "FAILED") {
        console.log(
          `  XX ${item.id} — generation failed:`,
          JSON.stringify(poll.data).substring(0, 200)
        );
        return false;
      }

      // Progress log every 20s
      if (i % 4 === 0) {
        console.log(
          `  .. ${item.id} — ${poll.data.status} (${poll.data.progress ?? "?"}%)`
        );
      }
    }

    console.log(`  XX ${item.id} — timed out after 10 minutes`);
    return false;
  } catch (err) {
    console.log(`  XX ${item.id} — error:`, err.message);
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Allow filtering: node scripts/generate-furniture.js sofa bed toilet
  const filter = process.argv.slice(2);
  const items =
    filter.length > 0
      ? FURNITURE.filter((f) => filter.includes(f.id))
      : FURNITURE;

  console.log("=".repeat(50));
  console.log("BuildFlow Furniture Generator (Hunyuan 3D Pro)");
  console.log(`Output:  ${OUTPUT_DIR}`);
  console.log(`Models:  ${items.length} of ${FURNITURE.length}`);
  console.log("=".repeat(50));

  let ok = 0,
    fail = 0;
  for (let i = 0; i < items.length; i++) {
    console.log(`\n[${i + 1}/${items.length}] ${items[i].id}`);
    if (await generateModel(items[i])) ok++;
    else fail++;
    // Rate-limit pause between submissions
    if (i < items.length - 1) await sleep(2000);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Done: ${ok} succeeded, ${fail} failed`);

  const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".glb"));
  if (files.length) {
    console.log(`\nGLB files in public/models/ (${files.length}):`);
    files.forEach((f) => {
      const sz = fs.statSync(path.join(OUTPUT_DIR, f)).size;
      console.log(`  ${f} — ${(sz / 1024).toFixed(0)} KB`);
    });
  }
  console.log("=".repeat(50));
}

main().catch(console.error);
