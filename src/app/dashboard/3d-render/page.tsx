"use client";

import dynamic from "next/dynamic";

const VideoRenderStudio = dynamic(
  () => import("@/features/dashboard/components/VideoRenderStudio"),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: "#FAFBFC",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "3px solid #E5E7EB",
            borderTopColor: "#6366F1",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <span style={{ color: "#6B7280", fontSize: 14, fontWeight: 500, fontStyle: "italic" }}>
          Warming up the render engine...
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    ),
  }
);

export default function Page() {
  // No frame — the dashboard layout now renders a light-theme Header above
  // this page, so the page's light gradient butts directly up to the header
  // chrome with no visible seam. A rounded/bordered card here would reintroduce
  // the dark outline against the dark sidebar gutter.
  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <VideoRenderStudio />
    </div>
  );
}
