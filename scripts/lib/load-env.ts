/**
 * scripts/lib/load-env.ts
 *
 * Side-effect module: loads `.env.local` then `.env` into `process.env`
 * (existing vars win). tsx does NOT auto-load env files the way Next.js
 * does, so KOS scripts that read `process.env.*` at module-init time must
 * import THIS module FIRST — before any `@/features/...` import whose
 * constants capture env at load time (e.g. `kos-drawing-constants.ts`).
 *
 * Mirrors the loader baked into `scripts/lib/prisma-for-scripts.ts`, but
 * standalone so DB-free scripts can reuse it without pulling in Prisma.
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvFromFile(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=["']?([^"'\r\n]+)["']?/);
        if (!m) continue;
        const [, key, value] = m;
        if (process.env[key]) continue; // existing env wins
        process.env[key] = value.trim();
      }
    } catch {
      // file missing — keep looking
    }
  }
}

loadEnvFromFile();
