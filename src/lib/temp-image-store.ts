/**
 * Temporary image store backed by Upstash Redis.
 *
 * Kling's image-to-video API requires a publicly accessible image URL.
 * When R2 (cloud storage) is not configured, we store the image base64
 * in Upstash Redis (shared across all Vercel serverless instances) and
 * serve it via GET /api/temp-image/[id].
 *
 * Images auto-expire after 10 minutes via Redis TTL.
 */

import crypto from "crypto";
import { Redis } from "@upstash/redis";

const TTL_SECONDS = 600; // 10 minutes

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error("Upstash Redis is not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing)");
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

/**
 * Store an image in Redis and return a unique ID.
 * The image auto-expires after 10 minutes via Redis TTL.
 *
 * Stores as JSON: { base64, contentType }
 */
export async function storeImage(base64: string, contentType: string): Promise<string> {
  const id = crypto.randomUUID();
  const r = getRedis();

  const payload = JSON.stringify({ base64, contentType });
  console.log(`[temp-image] Storing image ${id} in Redis (${(payload.length / 1024).toFixed(0)}KB, TTL=${TTL_SECONDS}s)`);

  await r.set(`temp-img:${id}`, payload, { ex: TTL_SECONDS });

  return id;
}

/**
 * Retrieve a stored image by ID from Redis.
 * Returns null if expired or not found.
 */
export async function getImage(id: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const r = getRedis();
  const raw = await r.get<string>(`temp-img:${id}`);

  if (!raw) return null;

  try {
    const { base64, contentType } = JSON.parse(raw) as { base64: string; contentType: string };
    return { buffer: Buffer.from(base64, "base64"), contentType };
  } catch {
    return null;
  }
}

/**
 * Build the full public URL for a temp image.
 * Checks env vars: NEXT_PUBLIC_APP_URL → VERCEL_URL → RAILWAY_PUBLIC_DOMAIN → localhost.
 */
export function getTempImageUrl(id: string): string {
  const base = getBaseUrl();
  return `${base}/api/temp-image/${id}`;
}

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}

/**
 * Returns true when the resolved base URL is localhost (Kling cannot reach it).
 */
export function isLocalhost(): boolean {
  const base = getBaseUrl();
  return base.includes("localhost") || base.includes("127.0.0.1");
}
