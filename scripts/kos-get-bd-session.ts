/**
 * scripts/kos-get-bd-session.ts
 *
 * Logs in via /api/kos/bd/login using KOS_BD_SEED_EMAIL +
 * KOS_BD_SEED_PASSWORD and prints the resulting `kos_bd_session`
 * cookie value to stdout in `KEY=value` form so the caller can
 * paste it straight into .env.local as KOS_DEV_BD_SESSION_TOKEN.
 *
 * Used by `npm run kos:test-retrieval -- --via-api`.
 *
 * Usage:
 *   npm run kos:bd-session                  # tenant=kalzen (default)
 *   npm run kos:bd-session -- --tenant=foo  # other tenant slug
 *
 * The Next dev server must be running at the URL named by
 * `KOS_DEV_API_BASE_URL` (defaults to http://kalzen.localhost:3000).
 */

import path from "node:path";
import fs from "node:fs";

// ─── Manual .env loader ───────────────────────────────────────────────
function loadEnvFromFile(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=["']?([^"'\r\n]+)["']?/);
        if (!m) continue;
        const [, key, value] = m;
        if (process.env[key]) continue;
        process.env[key] = value.trim();
      }
    } catch {
      // file missing — keep looking
    }
  }
}

loadEnvFromFile();

function parseArg(flag: string): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1).trim();
  }
  return null;
}

const tenantSlug = parseArg("--tenant") ?? "kalzen";
const baseUrl = process.env.KOS_DEV_API_BASE_URL ?? "http://kalzen.localhost:3000";
const email = process.env.KOS_BD_SEED_EMAIL?.trim().toLowerCase();
const password = process.env.KOS_BD_SEED_PASSWORD;

if (!email || !password) {
  console.error(
    "[kos-get-bd-session] KOS_BD_SEED_EMAIL and KOS_BD_SEED_PASSWORD must be " +
      "set in .env.local (the same values you fed into `npm run seed:kos-bd`).",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const url = `${baseUrl}/api/kos/bd/login`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kos-tenant-slug-override": tenantSlug,
      },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    console.error(
      `[kos-get-bd-session] fetch to ${url} failed — is the Next dev server ` +
        "running at KOS_DEV_API_BASE_URL? Error:",
      err,
    );
    process.exit(1);
  }

  const responseText = await res.text();
  if (!res.ok) {
    console.error(
      `[kos-get-bd-session] login failed (HTTP ${res.status}). Body:`,
      responseText.slice(0, 1000),
    );
    process.exit(1);
  }

  // The login route sets the cookie via Set-Cookie. Browser fetch
  // exposes that via headers.get("set-cookie"), though only one
  // header line — sufficient here because we only set one cookie.
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/kos_bd_session=([^;]+)/);
  if (!match) {
    console.error(
      "[kos-get-bd-session] login succeeded but no kos_bd_session cookie " +
        "found in the response. Raw Set-Cookie:",
      setCookie,
    );
    process.exit(1);
  }

  const token = decodeURIComponent(match[1]);
  console.info(
    `[kos-get-bd-session] login OK for ${email} on tenant="${tenantSlug}". ` +
      "Paste this into .env.local (or your shell env):",
  );
  console.info("");
  console.info(`KOS_DEV_BD_SESSION_TOKEN=${token}`);
  console.info("");
}

main().catch((err) => {
  console.error("[kos-get-bd-session] failed:", err);
  process.exit(1);
});
