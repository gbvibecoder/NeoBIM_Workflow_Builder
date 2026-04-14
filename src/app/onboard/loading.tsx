import { Skeleton } from "@/shared/components/ui/Skeleton";

export default function OnboardLoading() {
  return (
    <div
      aria-busy="true"
      style={{
        position: "relative",
        minHeight: "100vh",
        width: "100%",
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Architectural grid — same backdrop language as the real shell */}
      <div
        className="canvas-grid-bg"
        style={{ position: "absolute", inset: 0, opacity: 0.4, zIndex: 0 }}
        aria-hidden="true"
      />
      {/* Soft glow */}
      <div
        style={{
          position: "absolute",
          top: "-15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(900px, 90vw)",
          height: 500,
          borderRadius: "50%",
          pointerEvents: "none",
          background: "radial-gradient(ellipse, rgba(79,138,255,0.10) 0%, transparent 70%)",
          filter: "blur(20px)",
          zIndex: 0,
        }}
        aria-hidden="true"
      />

      {/* Progress dots placeholder */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "center", padding: "24px 40px" }}>
        <div style={{ display: "flex", gap: 10, padding: "8px 14px", borderRadius: 999, background: "rgba(18,18,30,0.5)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <Skeleton width={28} height={8} borderRadius={999} />
          <Skeleton width={8} height={8} borderRadius={999} />
          <Skeleton width={8} height={8} borderRadius={999} />
          <Skeleton width={8} height={8} borderRadius={999} />
        </div>
      </div>

      {/* Heading placeholder */}
      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32, padding: "0 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <Skeleton width={280} height={32} borderRadius={8} />
          <Skeleton width={360} height={14} />
        </div>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 220px))", maxWidth: 720 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={96} borderRadius={12} />
          ))}
        </div>
      </div>
    </div>
  );
}
