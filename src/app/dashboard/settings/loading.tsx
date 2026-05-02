import { Skeleton } from "@/shared/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div style={{
      background: "#F6F4EE",
      height: "100%",
      padding: "40px 48px",
      maxWidth: 960,
      margin: "0 auto",
    }}>
      {/* Hero strip */}
      <Skeleton width="100%" height={28} borderRadius={6} />
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton width={120} height={10} borderRadius={4} />
        <Skeleton width={320} height={28} borderRadius={6} />
        <Skeleton width={400} height={14} borderRadius={4} />
      </div>

      {/* Layout: sidebar + content */}
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 32, marginTop: 32 }}>
        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <Skeleton width="100%" height={28} borderRadius={6} />
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} width="100%" height={52} borderRadius={0} />
          ))}
        </div>

        {/* Content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton width="100%" height={220} borderRadius={10} />
          <Skeleton width="100%" height={180} borderRadius={10} />
          <Skeleton width="100%" height={280} borderRadius={10} />
        </div>
      </div>
    </div>
  );
}
