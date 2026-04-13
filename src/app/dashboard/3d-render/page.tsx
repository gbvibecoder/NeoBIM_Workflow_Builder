"use client";

import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";

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

interface BlockInfo {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

function UpgradeOverlay({ block, onDismiss }: { block: BlockInfo; onDismiss: () => void }) {
  const isVerify = block.actionUrl?.includes("settings");
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)" }}>
      <div style={{ maxWidth: 440, width: "100%", borderRadius: 24, overflow: "hidden", background: "linear-gradient(180deg, #0F0F2A, #080816)", border: "1px solid rgba(79,138,255,0.12)", boxShadow: "0 40px 120px rgba(0,0,0,0.8)", padding: "40px 32px 28px", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>{isVerify ? "\uD83D\uDCEC" : "\uD83C\uDFAC"}</div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: "#F0F2F8", marginBottom: 8, letterSpacing: "-0.03em" }}>{block.title}</h2>
        <p style={{ fontSize: 13, color: "#9898B0", lineHeight: 1.65, marginBottom: 24, maxWidth: 360, margin: "0 auto 24px" }}>{block.message}</p>
        {block.action && block.actionUrl && (
          <a href={block.actionUrl} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 32px", borderRadius: 14, background: "linear-gradient(135deg, #4F8AFF, #A855F7)", color: "#fff", fontSize: 15, fontWeight: 700, textDecoration: "none", boxShadow: "0 8px 32px rgba(79,138,255,0.3)" }}>
            {block.action} &rarr;
          </a>
        )}
        <div style={{ marginTop: 14 }}>
          <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#3A3A52", fontSize: 12, cursor: "pointer" }}>Go back to dashboard</button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const { data: session } = useSession();
  const [block, setBlock] = useState<BlockInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    const role = (session.user as { role?: string }).role || "FREE";
    // Only gate FREE users — paid users pass through
    if (role !== "FREE") { setChecked(true); return; }

    fetch("/api/check-execution-eligibility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogueIds: [] }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.canExecute && data.blocks?.length > 0) {
          setBlock(data.blocks[0]);
        }
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [session]);

  return (
    <div
      style={{
        height: "100%",
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
        position: "relative",
      }}
    >
      {block && <UpgradeOverlay block={block} onDismiss={() => { window.location.href = "/dashboard"; }} />}
      {checked && <VideoRenderStudio />}
      {!checked && !block && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "#FAFBFC" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #E5E7EB", borderTopColor: "#6366F1", animation: "spin 0.8s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}
    </div>
  );
}
