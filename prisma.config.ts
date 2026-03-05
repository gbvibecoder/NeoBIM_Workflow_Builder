import path from "path";
import { defineConfig } from "prisma/config";
import { readFileSync } from "fs";

function getDbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Manually parse .env and .env.local since Prisma CLI doesn't load them
  for (const file of [".env", ".env.local"]) {
    try {
      const content = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of content.split("\n")) {
        const m = line.match(/^DATABASE_URL=["']?([^"'\r\n]+)["']?/);
        if (m) return m[1].trim();
      }
    } catch {}
  }
  // Return a dummy URL for prisma generate (only needs real URL for db push/pull)
  return "postgresql://dummy:dummy@localhost:5432/dummy";
}

export default defineConfig({
  datasource: {
    url: getDbUrl(),
  },
});
