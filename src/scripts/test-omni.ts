/**
 * Test script for Kling 3.0 Omni endpoint.
 * Run with: npx tsx src/scripts/test-omni.ts
 *
 * Tests POST /v1/videos/omni-video with model_name: "kling-v3-omni"
 * Uses a tiny 1x1 red JPEG so we don't need a real image file.
 */

import * as crypto from "crypto";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const KLING_BASE_URL = "https://api.klingai.com";
const KLING_OMNI_PATH = "/v1/videos/omni-video";

// ─── JWT ────────────────────────────────────────────────────────────────────

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateJwt(): string {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error("KLING_ACCESS_KEY and KLING_SECRET_KEY must be set in .env.local");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5, iat: now };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(signingInput)
    .digest("base64url");

  return `${signingInput}.${signature}`;
}

// ─── Minimal test image (1x1 red JPEG, 631 bytes) ──────────────────────────

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS" +
  "Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ" +
  "CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
  "MjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/" +
  "EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAA" +
  "AAAAAAAA//aAAwDAQACEQMRAD8AKwA//9k=";

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Kling 3.0 Omni Endpoint Test ===\n");

  const token = generateJwt();
  const url = `${KLING_BASE_URL}${KLING_OMNI_PATH}`;

  const body = {
    model_name: "kling-v3-omni",
    prompt: "A small red building in a green field, cinematic camera orbit @image_1",
    image_list: [
      { image_url: TINY_JPEG_BASE64 },
    ],
    duration: "5",
    mode: "std",
    aspect_ratio: "16:9",
    callback_url: "",
    external_task_id: "",
  };

  console.log("POST", url);
  console.log("Body:", JSON.stringify({ ...body, image_list: [{ image_url: "[base64 ~631 bytes]" }] }, null, 2));
  console.log();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    console.log("HTTP Status:", res.status);
    const data = await res.json();
    console.log("Response:", JSON.stringify(data, null, 2));

    if (data.code === 0) {
      console.log("\n✅ SUCCESS! Task ID:", data.data?.task_id);
      console.log("The Omni endpoint works. Re-enable it in submitFloorPlanWalkthrough.");
    } else {
      console.log("\n❌ API Error — code:", data.code, "message:", data.message);
    }
  } catch (err) {
    console.error("\n❌ Request failed:", (err as Error).message);
  }
}

main();
