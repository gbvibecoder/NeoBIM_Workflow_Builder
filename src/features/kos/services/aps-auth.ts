/**
 * KOS BIM (Week 5A) — Autodesk APS authentication (2-legged OAuth).
 *
 * Server-to-server app using the Client Credentials grant. We cache the
 * access token in-process keyed by the requested scope-set so a burst of
 * pipeline calls share one token instead of hammering the (60 req/min)
 * auth endpoint. The token is refreshed when it's within 60s of expiry.
 *
 * SECRET HYGIENE: APS_CLIENT_ID / APS_CLIENT_SECRET are read here, lazily,
 * at the moment of the token request — never imported into a constant.
 * They are sent only as a Basic auth header to the official APS auth URL.
 *
 * RETRY CONTRACT: network errors + 5xx retry with exp backoff (via
 * `fetchWithRetry`); 401/403 (bad credentials) do NOT retry — they throw
 * KOS_APS_001 immediately, because a wrong secret will never become right.
 */

import {
  KOS_APS_AUTH_URL,
  KOS_APS_DEFAULT_SCOPES,
} from "@/features/kos/lib/kos-bim-constants";
import { fetchWithRetry } from "@/features/kos/lib/aps-http";
import { KosError } from "@/features/kos/lib/kos-errors";

interface CachedToken {
  token: string;
  /** Epoch ms at which the token expires. */
  expiresAt: number;
}

/** Refresh when this close to expiry, so an in-flight call never 401s. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

// Module-level cache. Keyed by the sorted, space-joined scope string so
// distinct scope-sets don't clobber each other.
const tokenCache = new Map<string, CachedToken>();

function scopeKey(scopes: readonly string[]): string {
  return [...scopes].sort().join(" ");
}

function readApsCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.APS_CLIENT_ID;
  const clientSecret = process.env.APS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const missing: string[] = [];
    if (!clientId) missing.push("APS_CLIENT_ID");
    if (!clientSecret) missing.push("APS_CLIENT_SECRET");
    throw new KosError(
      "KOS_APS_001",
      `Autodesk APS credentials not configured — missing env var(s): ${missing.join(
        ", ",
      )}. Create a Server-to-Server app at https://aps.autodesk.com, then set APS_CLIENT_ID + APS_CLIENT_SECRET in .env.local (development) or the Vercel project (production) before running any KOS BIM pipeline.`,
      500,
    );
  }
  return { clientId, clientSecret };
}

/**
 * Get a valid APS access token for the given scopes. Returns a cached
 * token when one is present and not near expiry; otherwise fetches a
 * fresh one and caches it.
 */
export async function getApsAccessToken(
  scopes: readonly string[] = KOS_APS_DEFAULT_SCOPES,
): Promise<string> {
  const key = scopeKey(scopes);
  const now = Date.now();

  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - now > TOKEN_REFRESH_SKEW_MS) {
    return cached.token;
  }

  const { clientId, clientSecret } = readApsCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: scopes.join(" "),
  });

  const res = await fetchWithRetry(
    KOS_APS_AUTH_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    },
    {
      label: "APS auth",
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxRetryOn429: 1,
      exhaustedCode: "KOS_APS_002",
    },
  );

  // 401 / 403 → bad credentials. Do not retry; surface a specific error.
  if (res.status === 401 || res.status === 403) {
    const detail = await safeBodyText(res);
    throw new KosError(
      "KOS_APS_001",
      `Autodesk APS rejected the credentials (HTTP ${res.status}). Verify APS_CLIENT_ID / APS_CLIENT_SECRET belong to a Server-to-Server app with the Client Credentials grant enabled. APS said: ${detail}`,
      401,
    );
  }

  if (!res.ok) {
    const detail = await safeBodyText(res);
    throw new KosError(
      "KOS_APS_002",
      `APS auth failed with HTTP ${res.status} requesting scopes [${scopes.join(
        " ",
      )}]: ${detail}`,
      502,
    );
  }

  let json: { access_token?: string; expires_in?: number; token_type?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch (err) {
    throw new KosError(
      "KOS_APS_002",
      `APS auth returned a 2xx but the JSON body was unparseable: ${
        err instanceof Error ? err.message : String(err)
      }`,
      502,
    );
  }

  if (!json.access_token || typeof json.expires_in !== "number") {
    throw new KosError(
      "KOS_APS_002",
      `APS auth response missing access_token / expires_in. Got keys: ${Object.keys(
        json,
      ).join(", ")}.`,
      502,
    );
  }

  tokenCache.set(key, {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });

  return json.access_token;
}

/**
 * Clear the in-memory token cache. Call this from tests, or after a
 * downstream call unexpectedly 401s (in case the cached token was revoked
 * server-side before its nominal expiry).
 */
export async function invalidateApsTokenCache(): Promise<void> {
  tokenCache.clear();
}

/** Read a response body as text without throwing if the stream is empty. */
async function safeBodyText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500) || "(empty body)";
  } catch {
    return "(body unreadable)";
  }
}
