import { Skeleton, SkeletonCard } from "@/shared/components/ui/Skeleton";

export default function AdminLoading() {
  return (
    <div
      aria-busy="true"
      style={{
        width: "100%",
        minHeight: "100%",
        padding: "28px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        background: "var(--bg-base)",
      }}
    >
      {/* Page title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton width={220} height={22} borderRadius={6} />
        <Skeleton width={360} height={12} />
      </div>

      {/* Stats strip — 4 cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={110} />)}
      </div>

      {/* Chart */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Skeleton width={160} height={14} />
          <div style={{ flex: 1 }} />
          <Skeleton width={80} height={24} borderRadius={6} />
        </div>
        <Skeleton height={220} borderRadius={8} />
      </div>

      {/* Table */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 16, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <Skeleton width="40%" height={10} />
          <Skeleton width="60%" height={10} />
          <Skeleton width="60%" height={10} />
          <Skeleton width="60%" height={10} />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 16, padding: "8px 0" }}>
            <Skeleton width="70%" height={12} />
            <Skeleton width="50%" height={12} />
            <Skeleton width="60%" height={12} />
            <Skeleton width="40%" height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}
