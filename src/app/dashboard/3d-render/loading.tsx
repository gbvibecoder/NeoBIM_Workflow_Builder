import { Skeleton } from "@/shared/components/ui/Skeleton";

export default function ThreeDRenderLoading() {
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <Skeleton width={180} height={18} borderRadius={6} />
        <div style={{ flex: 1 }} />
        <Skeleton width={110} height={30} borderRadius={8} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Viewport */}
        <div style={{ flex: 1, padding: 20, position: "relative" }}>
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
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-tertiary)" }}>Preparing render studio…</span>
          </div>
        </div>

        {/* Right controls */}
        <aside style={{ width: 300, borderLeft: "1px solid rgba(255,255,255,0.06)", padding: 16, display: "flex", flexDirection: "column", gap: 14, background: "rgba(10,12,14,0.6)" }}>
          <Skeleton width="55%" height={14} />
          <Skeleton height={44} borderRadius={8} />
          <Skeleton height={44} borderRadius={8} />
          <Skeleton height={44} borderRadius={8} />
          <div style={{ flex: 1 }} />
          <Skeleton height={40} borderRadius={8} />
        </aside>
      </div>

      {/* Bottom gallery */}
      <div style={{ display: "flex", gap: 10, padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,12,14,0.4)" }}>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} width={96} height={64} borderRadius={8} />)}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
