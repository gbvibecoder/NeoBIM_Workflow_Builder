import fs from "node:fs";
import path from "node:path";
import type { SnapshotFile } from "./types";

function load(name: string): SnapshotFile {
  const p = path.resolve(__dirname, "snapshots", `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function diff(beforeName: string, afterName: string): void {
  const before = load(beforeName);
  const after = load(afterName);

  const beforeById = new Map(before.results.map(r => [r.id, r]));
  const afterById = new Map(after.results.map(r => [r.id, r]));

  const allIds = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();

  console.log(`\n=== DIFF: ${beforeName}  →  ${afterName} ===`);
  const cols = ["ID", "BEFORE", "AFTER", "Δ", "COMP_Δ", "VASTU_Δ", "DIM_Δ", "POS_Δ", "HAL_Δ", "GAP_Δ"];
  console.log(cols.map(c => c.padStart(8)).join(" "));

  for (const id of allIds) {
    const b = beforeById.get(id);
    const a = afterById.get(id);
    const bScore = b?.score?.total ?? 0;
    const aScore = a?.score?.total ?? 0;
    const delta = aScore - bScore;
    const compDelta = (a?.score?.components.completeness ?? 0) - (b?.score?.components.completeness ?? 0);
    const vastuDelta = (a?.score?.components.vastu ?? 0) - (b?.score?.components.vastu ?? 0);
    const dimsDelta = (a?.score?.components.dims ?? 0) - (b?.score?.components.dims ?? 0);
    const posDelta = (a?.score?.components.positions ?? 0) - (b?.score?.components.positions ?? 0);
    const halDelta = (a?.score?.components.hallucinations ?? 0) - (b?.score?.components.hallucinations ?? 0);
    const gapDelta = (a?.score?.components.gaps ?? 0) - (b?.score?.components.gaps ?? 0);
    const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    console.log(
      [id, bScore, aScore, fmt(delta), fmt(compDelta), fmt(vastuDelta), fmt(dimsDelta), fmt(posDelta), fmt(halDelta), fmt(gapDelta)]
        .map(v => String(v).padStart(8))
        .join(" "),
    );
  }

  const avgDelta = after.average - before.average;
  console.log(`\nAVG: ${before.average.toFixed(1)} → ${after.average.toFixed(1)} (Δ ${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(1)})`);

  const regressions = allIds.filter(id => {
    const b = beforeById.get(id)?.score?.total ?? 0;
    const a = afterById.get(id)?.score?.total ?? 0;
    return a < b;
  });
  if (regressions.length > 0) {
    console.log(`\n⚠ REGRESSIONS on ${regressions.length} prompt(s): ${regressions.join(", ")}`);
  }
}

const [, , beforeName, afterName] = process.argv;
if (!beforeName || !afterName) {
  console.error("usage: vitest run tests/floor-plan/diff-snapshots.ts -- <before> <after>");
  console.error("   or: tsx tests/floor-plan/diff-snapshots.ts <before> <after>");
  process.exit(1);
}
diff(beforeName, afterName);
