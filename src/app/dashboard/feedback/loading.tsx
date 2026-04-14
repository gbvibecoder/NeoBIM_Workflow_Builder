import { Skeleton } from "@/shared/components/ui/Skeleton";

export default function FeedbackLoading() {
  return (
    <div
      aria-busy="true"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        padding: "48px 24px",
        background: "var(--bg-base)",
        overflow: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Title block */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton width={240} height={24} borderRadius={6} />
          <Skeleton width="80%" height={14} />
        </div>

        {/* Type picker pills */}
        <div style={{ display: "flex", gap: 10 }}>
          <Skeleton width={120} height={36} borderRadius={999} />
          <Skeleton width={120} height={36} borderRadius={999} />
          <Skeleton width={120} height={36} borderRadius={999} />
        </div>

        {/* Subject */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width={80} height={12} />
          <Skeleton height={42} borderRadius={8} />
        </div>

        {/* Message textarea */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width={80} height={12} />
          <Skeleton height={180} borderRadius={8} />
        </div>

        {/* Submit */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <Skeleton width={140} height={40} borderRadius={8} />
        </div>
      </div>
    </div>
  );
}
