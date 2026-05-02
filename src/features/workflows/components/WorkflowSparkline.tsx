import type { SparklineBar } from "@/features/workflows/lib/sparkline";
import s from "./page.module.css";

export function WorkflowSparkline({ bars }: { bars: SparklineBar[] }) {
  const max = Math.max(1, ...bars.map(b => b.count));
  return (
    <div className={s.sparkline} aria-label={`Activity over last ${bars.length} weeks`}>
      {bars.map((b, i) => (
        <div
          key={i}
          className={s.sparklineBar}
          data-active={b.isCurrent ? "true" : undefined}
          style={{ height: `${Math.max(12, (b.count / max) * 100)}%` }}
          title={`${b.count} run${b.count !== 1 ? "s" : ""}`}
        />
      ))}
    </div>
  );
}
