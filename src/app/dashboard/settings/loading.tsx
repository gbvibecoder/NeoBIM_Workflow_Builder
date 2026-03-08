import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div style={{ padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton width={180} height={24} borderRadius={8} />
        <Skeleton width={280} height={12} />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {[1, 2, 3].map(i => (
          <Skeleton key={i} width={80} height={36} borderRadius={8} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} width="100%" height={48} borderRadius={8} />
        ))}
      </div>
    </div>
  );
}
