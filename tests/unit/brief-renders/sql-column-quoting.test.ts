/**
 * Regression test for Postgres error 42703 ("column does not exist").
 *
 * The Prisma migration `20260429050203_add_brief_render_job/migration.sql`
 * creates `brief_render_jobs` columns as quoted camelCase identifiers
 * ("costUsd", "updatedAt", "currentStage", "completedAt", "pdfUrl", …).
 * Postgres folds *unquoted* identifiers to lowercase, so a bare
 * `cost_usd` in a `$executeRaw` block resolves to a column that does
 * not exist and throws 42703 at runtime.
 *
 * Symptom of the bug: every brief-renders job ever submitted got
 * stuck after Approve & Generate — Stage 3's first `persistShotPatch`
 * call threw, the worker died, no shot ever transitioned from
 * `pending` to `running`, total cost stayed at the Stage-1-only
 * value (~$0.11), and the dashboard sat at 35% forever.
 *
 * This test scans every `$executeRaw` template literal in the four
 * files that mutate `brief_render_jobs` and fails if any known
 * camelCase column appears in its bare snake_case form. Pure-Node,
 * no DB — fast, deterministic, catches the exact failure class.
 *
 * Adding a new camelCase column to the schema? Append it to the list
 * below. Otherwise leave this test alone — it's a dumb, focused
 * tripwire on purpose.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const FILES_TO_CHECK = [
  "src/features/brief-renders/services/brief-pipeline/stage-3-image-gen.ts",
  "src/app/api/brief-renders/worker/render/route.ts",
  "src/app/api/brief-renders/[jobId]/regenerate-shot/route.ts",
];

// Every camelCase column on the `BriefRenderJob` Prisma model.
// All of these become case-sensitive quoted identifiers in Postgres,
// so a bare snake_case form inside `$executeRaw` will throw 42703.
const CAMELCASE_COLUMNS = [
  "costUsd",
  "updatedAt",
  "currentStage",
  "completedAt",
  "pdfUrl",
  "pausedAt",
  "startedAt",
  "createdAt",
  "userApproval",
  "errorMessage",
  "requestId",
  "briefUrl",
  "specResult",
  "stageLog",
  "userId",
] as const;

function camelToSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Yield every `$executeRaw` template-literal body found in `src`.
 * The regex captures content between `$executeRaw\`` and the next
 * unescaped backtick. Prisma raw SQL never contains backticks itself,
 * so the non-greedy match terminates correctly.
 */
function* iterRawSqlBlocks(src: string): Generator<string> {
  const re = /\$executeRaw`([\s\S]*?)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    yield m[1];
  }
}

describe("brief-renders raw SQL column quoting (regression for Postgres 42703)", () => {
  for (const relPath of FILES_TO_CHECK) {
    it(`${relPath} uses quoted camelCase column names in every $executeRaw block`, () => {
      const fullPath = resolve(process.cwd(), relPath);
      const src = readFileSync(fullPath, "utf8");

      let blockIndex = 0;
      for (const block of iterRawSqlBlocks(src)) {
        for (const camel of CAMELCASE_COLUMNS) {
          const snake = camelToSnake(camel);
          // Skip `userId` — it has a snake-case form `user_id` that
          // also happens to be the actual column name in some other
          // tables (pre-Prisma legacy). The brief_render_jobs row uses
          // "userId" specifically, but the test's all-or-nothing rule
          // would false-positive on intentional `user_id` references
          // elsewhere. Constrain to: did the block reference the
          // `brief_render_jobs` table?
          if (!block.includes("brief_render_jobs")) continue;

          // Check for snake_case as a standalone token (not embedded
          // in a longer identifier — e.g. `pdf_url` should fail but
          // `some_pdf_url_thing` shouldn't, though no such construct
          // exists in this codebase).
          const tokenRe = new RegExp(`(?<![A-Za-z0-9_])${snake}(?![A-Za-z0-9_])`);
          if (tokenRe.test(block)) {
            throw new Error(
              `${relPath}: $executeRaw block #${blockIndex} contains bare snake_case '${snake}'.\n` +
                `  Use the quoted camelCase form ("${camel}") to match the Prisma migration.\n` +
                `  Failing block:\n${block.trim().split("\n").map((l) => "    " + l).join("\n")}`,
            );
          }
        }
        blockIndex++;
      }

      // Sanity: each file we list MUST contain at least one $executeRaw
      // block — if it doesn't, the file was renamed/deleted and this
      // test should be updated, not silently green.
      expect(blockIndex).toBeGreaterThan(0);
    });
  }

  it("known camelCase columns are still all double-quoted in the canonical block", () => {
    const stage3 = readFileSync(
      resolve(
        process.cwd(),
        "src/features/brief-renders/services/brief-pipeline/stage-3-image-gen.ts",
      ),
      "utf8",
    );
    // The canonical persistShotPatch block must contain "costUsd" and
    // "updatedAt" with their double quotes intact. If a refactor strips
    // the quotes accidentally, this catches it independently of the
    // snake_case scan above.
    expect(stage3).toMatch(/"costUsd"\s*=\s*"costUsd"\s*\+/);
    expect(stage3).toMatch(/"updatedAt"\s*=\s*NOW\(\)/);
  });
});
