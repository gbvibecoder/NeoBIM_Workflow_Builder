#!/usr/bin/env node
/**
 * Upload GLB models from public/models/ to Cloudflare R2.
 *
 * Reads credentials from environment or .env.local:
 *   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY, R2_SECRET_KEY, R2_PUBLIC_URL
 *
 * Usage:
 *   node scripts/upload-to-r2.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

// ── Config ───────────────────────────────────────────────────────────────────

try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
} catch {
  // dotenv not installed — use env vars directly
}

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET || "buildflow-models";
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_PUBLIC_URL) {
  console.error("Missing R2 credentials. Set in .env.local:");
  console.error("  R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_PUBLIC_URL");
  process.exit(1);
}

const MODELS_DIR = path.join(__dirname, "..", "public", "models");

// ── AWS Signature V4 ────────────────────────────────────────────────────────

function hmac(key, msg) {
  return crypto.createHmac("sha256", key).update(msg).digest();
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = hmac("AWS4" + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function uploadToR2(filePath, objectKey) {
  return new Promise((resolve, reject) => {
    const fileContent = fs.readFileSync(filePath);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const shortDate = amzDate.substring(0, 8);
    const region = "auto";
    const service = "s3";

    const contentHash = crypto
      .createHash("sha256")
      .update(fileContent)
      .digest("hex");
    const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

    const canonicalHeaders =
      `content-type:model/gltf-binary\nhost:${host}\nx-amz-content-sha256:${contentHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      "PUT",
      `/${R2_BUCKET}/${objectKey}`,
      "",
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join("\n");

    const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const signingKey = getSignatureKey(R2_SECRET_KEY, shortDate, region, service);
    const signature = crypto
      .createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const req = https.request(
      {
        hostname: host,
        path: `/${R2_BUCKET}/${objectKey}`,
        method: "PUT",
        headers: {
          "Content-Type": "model/gltf-binary",
          "Content-Length": fileContent.length,
          "x-amz-content-sha256": contentHash,
          "x-amz-date": amzDate,
          Authorization: authorization,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(`${R2_PUBLIC_URL}/${objectKey}`);
          } else {
            reject(new Error(`Upload failed: HTTP ${res.statusCode} — ${data.substring(0, 200)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(fileContent);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const files = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".glb"));

  if (files.length === 0) {
    console.log("No GLB files found in", MODELS_DIR);
    process.exit(1);
  }

  console.log("=".repeat(50));
  console.log("BuildFlow R2 Uploader");
  console.log(`Source:  ${MODELS_DIR}`);
  console.log(`Bucket:  ${R2_BUCKET}`);
  console.log(`Models:  ${files.length}`);
  console.log("=".repeat(50));

  const urls = {};

  for (const file of files) {
    const filePath = path.join(MODELS_DIR, file);
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

    process.stdout.write(`  ${file} (${sizeMB} MB) ... `);

    try {
      const url = await uploadToR2(filePath, `models/${file}`);
      console.log("OK — " + url);
      urls[file.replace(".glb", "")] = url;
    } catch (e) {
      console.log("FAIL — " + e.message);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("URLs:\n" + JSON.stringify(urls, null, 2));

  // Write TypeScript constant file
  const urlMapPath = path.join(
    __dirname,
    "..",
    "src",
    "constants",
    "model-urls.ts"
  );
  const tsContent = `// Auto-generated by scripts/upload-to-r2.js — do not edit manually
export const MODEL_URLS: Record<string, string> = ${JSON.stringify(urls, null, 2)};

export const MODEL_CDN_BASE = "${R2_PUBLIC_URL}/models";
`;
  fs.writeFileSync(urlMapPath, tsContent);
  console.log("\nSaved URL mapping to:", urlMapPath);
  console.log("=".repeat(50));
}

main().catch(console.error);
