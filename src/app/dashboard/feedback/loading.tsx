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
        padding: "56px 56px",
        background: "var(--rs-bone, #F6F4EE)",
        overflow: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1280, display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Hero skeleton */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton width={160} height={28} borderRadius={99} />
          <Skeleton width={320} height={36} borderRadius={6} />
          <Skeleton width="60%" height={14} />
        </div>

        {/* Type cards skeleton */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginTop: 16 }}>
          <Skeleton height={200} borderRadius={16} />
          <Skeleton height={200} borderRadius={16} />
          <Skeleton height={200} borderRadius={16} />
        </div>

        {/* Submissions skeleton */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
          <Skeleton width={200} height={20} borderRadius={6} />
          <Skeleton height={72} borderRadius={14} />
          <Skeleton height={72} borderRadius={14} />
        </div>
      </div>
    </div>
  );
}
