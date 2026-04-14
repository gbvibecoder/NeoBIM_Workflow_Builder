import { Skeleton } from "@/shared/components/ui/Skeleton";

export default function FloorPlanLoading() {
  return (
    <div
      aria-busy="true"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
        overflow: "hidden",
      }}
    >
      {/* Top toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,12,14,0.8)", height: 44, flexShrink: 0 }}>
        <Skeleton width={60} height={24} borderRadius={6} />
        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.06)", margin: "0 4px" }} />
        <Skeleton width={100} height={24} borderRadius={6} />
        <Skeleton width={80} height={24} borderRadius={6} />
        <div style={{ flex: 1 }} />
        <Skeleton width={90} height={24} borderRadius={6} />
        <Skeleton width={24} height={24} borderRadius={6} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left tool strip */}
        <div style={{ width: 56, borderRight: "1px solid rgba(255,255,255,0.06)", padding: "8px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "rgba(10,12,14,0.6)" }}>
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} width={36} height={36} borderRadius={8} />)}
        </div>

        {/* Drawing area */}
        <div style={{ flex: 1, padding: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Skeleton width="100%" height="100%" borderRadius={12} />
        </div>

        {/* Right panel */}
        <aside style={{ width: 260, borderLeft: "1px solid rgba(255,255,255,0.06)", padding: 14, display: "flex", flexDirection: "column", gap: 10, background: "rgba(10,12,14,0.6)" }}>
          <Skeleton width="50%" height={12} />
          <Skeleton height={60} borderRadius={8} />
          <Skeleton height={36} borderRadius={6} />
          <Skeleton height={36} borderRadius={6} />
          <Skeleton height={36} borderRadius={6} />
        </aside>
      </div>

      {/* Bottom status bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", height: 28, flexShrink: 0 }}>
        <Skeleton width={80} height={10} />
        <Skeleton width={60} height={10} />
        <div style={{ flex: 1 }} />
        <Skeleton width={40} height={14} borderRadius={4} />
        <Skeleton width={40} height={14} borderRadius={4} />
      </div>
    </div>
  );
}
