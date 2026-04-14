import { Skeleton } from "@/shared/components/ui/Skeleton";

export default function IfcViewerLoading() {
  return (
    <div
      aria-busy="true"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "var(--bg-base)",
        overflow: "hidden",
      }}
    >
      {/* 3D viewport */}
      <div style={{ flex: 1, position: "relative", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Skeleton width={160} height={18} borderRadius={6} />
          <div style={{ flex: 1 }} />
          <Skeleton width={90} height={28} borderRadius={8} />
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          <Skeleton width="100%" height="100%" borderRadius={12} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, pointerEvents: "none" }}>
            <div
              style={{
                width: 18, height: 18, borderRadius: "50%",
                border: "2px solid rgba(0,245,255,0.25)",
                borderTopColor: "var(--interactive)",
                animation: "spin 0.9s linear infinite",
              }}
              aria-hidden="true"
            />
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)", letterSpacing: "0.02em" }}>
              Loading 3D model…
            </span>
          </div>
        </div>
      </div>

      {/* Right entity tree */}
      <aside style={{ width: 300, borderLeft: "1px solid rgba(255,255,255,0.06)", padding: 16, display: "flex", flexDirection: "column", gap: 10, background: "rgba(10,12,14,0.6)" }}>
        <Skeleton width="60%" height={14} />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: (i % 3) * 12 }}>
            <Skeleton width={12} height={12} borderRadius={3} />
            <Skeleton width={`${50 + (i % 5) * 8}%`} height={12} />
          </div>
        ))}
      </aside>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
