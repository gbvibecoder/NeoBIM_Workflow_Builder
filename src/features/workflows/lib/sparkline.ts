export interface SparklineBar {
  week: number;
  count: number;
  isCurrent: boolean;
}

/**
 * Bucket execution timestamps into N weekly bars for a sparkline.
 * Returns oldest → newest, left → right.
 */
export function buildWeeklySparkline(
  executions: Array<{ completedAt: string | null }>,
  weeks = 12
): SparklineBar[] {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const buckets: number[] = new Array(weeks).fill(0);

  for (const ex of executions) {
    if (!ex.completedAt) continue;
    const t = new Date(ex.completedAt).getTime();
    const weeksAgo = Math.floor((now - t) / weekMs);
    if (weeksAgo >= 0 && weeksAgo < weeks) {
      buckets[weeks - 1 - weeksAgo]++;
    }
  }

  return buckets.map((count, i) => ({
    week: i,
    count,
    isCurrent: i >= weeks - 2,
  }));
}
