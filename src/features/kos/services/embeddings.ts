/**
 * OpenAI embeddings adapter for KOS.
 *
 * Sole entry point: `embedTexts(texts)`. Sends `text-embedding-3-large`
 * by default (3072 dims) — Week 2 promotes the pgvector column to
 * `halfvec(3072)` to fit (see migration `kos_pgvector_dim_3072_week2`).
 *
 * Batching: 100 inputs per call — the OpenAI embeddings endpoint
 * accepts up to ~2048 inputs per request, but 100 keeps each round-
 * trip well under the rate-limit token bucket and gives us a sensible
 * unit for retries.
 *
 * Retries: 3 attempts with exponential backoff (1s/2s/4s) on 429 /
 * 5xx. Below that, the call fails fast — a 4xx is the caller's bug,
 * not a transient blip.
 *
 * Token accounting: prints `[kos-embeddings]` log lines with model /
 * batchSize / totalTokensUsed so we have a visible cost-per-ingest
 * number until proper telemetry lands.
 */

// Server-only by construction (OpenAI client + API key reads); we
// don't `import "server-only"` because that package isn't in deps.

import OpenAI from "openai";

import { KosError } from "@/features/kos/lib/kos-errors";

export const KOS_EMBEDDING_MODEL = "text-embedding-3-large";
export const KOS_EMBEDDING_DIMENSIONS = 3072;
export const KOS_EMBEDDING_BATCH_SIZE = 100;

const RETRY_DELAYS_MS = [1000, 2000, 4000];

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new KosError(
      "KOS_EMBED_002",
      "OPENAI_API_KEY is not set — cannot generate embeddings.",
      500,
    );
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * Embed an array of texts and return their vectors in the same order.
 *
 * Empty `texts` returns `[]` immediately — no API call. Individual
 * empty strings are NOT filtered here (the caller should drop them
 * before calling — OpenAI returns 400 on empty input).
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts)) {
    throw new KosError(
      "KOS_EMBED_003",
      "embedTexts expects an array of strings.",
      500,
    );
  }
  if (texts.length === 0) return [];

  const client = getClient();
  const out: number[][] = new Array(texts.length);
  let totalTokensUsed = 0;

  for (let start = 0; start < texts.length; start += KOS_EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + KOS_EMBEDDING_BATCH_SIZE);
    const response = await callWithRetry(client, batch);

    if (!response.data || response.data.length !== batch.length) {
      throw new KosError(
        "KOS_EMBED_004",
        `OpenAI returned ${response.data?.length ?? 0} embeddings for ${batch.length} inputs — alignment broken.`,
        502,
      );
    }

    for (let i = 0; i < batch.length; i++) {
      const vec = response.data[i].embedding;
      if (!Array.isArray(vec) || vec.length !== KOS_EMBEDDING_DIMENSIONS) {
        throw new KosError(
          "KOS_EMBED_005",
          `Embedding ${start + i} has ${vec?.length ?? "?"} dims, expected ${KOS_EMBEDDING_DIMENSIONS}.`,
          502,
        );
      }
      out[start + i] = vec;
    }

    totalTokensUsed += response.usage?.total_tokens ?? 0;
  }

  console.info(
    `[kos-embeddings] model=${KOS_EMBEDDING_MODEL} batchSize=${KOS_EMBEDDING_BATCH_SIZE} inputs=${texts.length} totalTokensUsed=${totalTokensUsed}`,
  );

  return out;
}

async function callWithRetry(
  client: OpenAI,
  inputs: string[],
): Promise<{
  data: { embedding: number[] }[];
  usage?: { total_tokens?: number };
}> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await client.embeddings.create({
        model: KOS_EMBEDDING_MODEL,
        input: inputs,
      });
      return res as unknown as {
        data: { embedding: number[] }[];
        usage?: { total_tokens?: number };
      };
    } catch (err) {
      lastErr = err;
      if (!isTransientEmbedError(err) || attempt === RETRY_DELAYS_MS.length) {
        break;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[kos-embeddings] transient error on attempt ${attempt + 1} — backing off ${delay}ms (${describeErr(err)})`,
      );
      await sleep(delay);
    }
  }
  throw new KosError(
    "KOS_EMBED_001",
    `OpenAI embeddings call failed after retries: ${describeErr(lastErr)}`,
    502,
  );
}

function isTransientEmbedError(err: unknown): boolean {
  // OpenAI SDK throws APIError with `.status`. Anything in 408 / 429 /
  // 5xx is worth retrying; everything else is the caller's bug.
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
  }
  // Network-level errors (TLS, DNS, ECONNRESET) won't have a status.
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("network") ||
      msg.includes("fetch failed")
    ) {
      return true;
    }
  }
  return false;
}

function describeErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
