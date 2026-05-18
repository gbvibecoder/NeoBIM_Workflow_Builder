/**
 * TR-028 routing smoke test.
 *
 * Verifies that TR-028 is present in BOTH the server-side REAL_NODE_IDS
 * (execute-node/route.ts) AND the client-side REAL_NODE_IDS + LIVE_NODE_IDS
 * (useExecution.ts). This test would have caught the Phase Alpha regression
 * where TR-028 was registered server-side but missing client-side, causing
 * the canvas executor to use the mock path.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("TR-028 routing", () => {
  it("TR-028 is in the server-side REAL_NODE_IDS (execute-node/route.ts)", () => {
    const routePath = path.join(
      __dirname, "..", "route.ts",
    );
    const source = fs.readFileSync(routePath, "utf-8");

    // Find the REAL_NODE_IDS set definition
    const match = source.match(/const REAL_NODE_IDS\s*=\s*new Set\(\[([^\]]+)\]\)/);
    expect(match).not.toBeNull();
    const ids = match![1];
    expect(ids).toContain('"TR-028"');
  });

  it("TR-028 is in the client-side REAL_NODE_IDS (useExecution.ts)", () => {
    const hookPath = path.join(
      __dirname, "..", "..", "..", "..", "features", "execution", "hooks", "useExecution.ts",
    );
    const source = fs.readFileSync(hookPath, "utf-8");

    // The client-side REAL_NODE_IDS is the FIRST Set in the file
    const match = source.match(/const REAL_NODE_IDS\s*=\s*new Set\(\[([^\]]+)\]\)/);
    expect(match).not.toBeNull();
    const ids = match![1];
    expect(ids).toContain('"TR-028"');
  });

  it("TR-028 is in the client-side LIVE_NODE_IDS (useExecution.ts)", () => {
    const hookPath = path.join(
      __dirname, "..", "..", "..", "..", "features", "execution", "hooks", "useExecution.ts",
    );
    const source = fs.readFileSync(hookPath, "utf-8");

    // LIVE_NODE_IDS is the second Set — find it specifically
    const match = source.match(/const LIVE_NODE_IDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(match).not.toBeNull();
    const ids = match![1];
    expect(ids).toContain('"TR-028"');
  });

  it("TR-028 is registered in the handler map (handlers/index.ts)", () => {
    const indexPath = path.join(
      __dirname, "..", "handlers", "index.ts",
    );
    const source = fs.readFileSync(indexPath, "utf-8");

    expect(source).toContain('import { handleTR028 }');
    expect(source).toContain('"TR-028": handleTR028');
  });

  it("TR-028 handler file exists", () => {
    const handlerPath = path.join(
      __dirname, "..", "handlers", "tr-028.ts",
    );
    expect(fs.existsSync(handlerPath)).toBe(true);
  });
});
