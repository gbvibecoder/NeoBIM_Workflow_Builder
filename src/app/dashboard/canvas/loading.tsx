import { Skeleton } from "@/shared/components/ui/Skeleton";

const NODES = [
  { x: "12%", y: "22%", w: 150, h: 64 },
  { x: "40%", y: "12%", w: 150, h: 64 },
  { x: "40%", y: "46%", w: 150, h: 64 },
  { x: "68%", y: "30%", w: 150, h: 64 },
];

export default function CanvasLoading() {
  return (
    <div
      aria-busy="true"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
        backgroundImage: "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        overflow: "hidden",
      }}
    >
      {/* Toolbar strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,12,14,0.8)" }}>
        <Skeleton width={72} height={28} borderRadius={8} />
        <Skeleton width={28} height={28} borderRadius={8} />
        <Skeleton width={28} height={28} borderRadius={8} />
        <div style={{ flex: 1 }} />
        <Skeleton width={96} height={28} borderRadius={8} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Canvas area with node placeholders */}
        <div style={{ flex: 1, position: "relative" }}>
          {NODES.map((n, i) => (
            <div key={i} style={{ position: "absolute", left: n.x, top: n.y }}>
              <Skeleton width={n.w} height={n.h} borderRadius={12} />
            </div>
          ))}
        </div>
        {/* Right panel */}
        <aside style={{ width: 280, borderLeft: "1px solid rgba(255,255,255,0.06)", padding: 16, display: "flex", flexDirection: "column", gap: 12, background: "rgba(10,12,14,0.6)" }}>
          <Skeleton width="60%" height={14} />
          <Skeleton height={72} borderRadius={10} />
          <Skeleton height={40} borderRadius={8} />
          <Skeleton height={40} borderRadius={8} />
        </aside>
      </div>
    </div>
  );
}
