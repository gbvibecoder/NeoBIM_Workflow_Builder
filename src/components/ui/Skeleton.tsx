"use client";

import React from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: number;
  className?: string;
}

export function Skeleton({ width = "100%", height = 16, borderRadius = 6, className }: SkeletonProps) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)",
        backgroundSize: "200% 100%",
        animation: "skeleton-shimmer 1.5s ease-in-out infinite",
      }}
    />
  );
}

export function SkeletonCard({ height = 160 }: { height?: number }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12,
      padding: 20,
      height,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <Skeleton width="40%" height={14} />
      <Skeleton width="70%" height={10} />
      <div style={{ flex: 1 }} />
      <Skeleton width="30%" height={10} />
    </div>
  );
}

export function PageSkeleton({ cards = 6, title = true }: { cards?: number; title?: boolean }) {
  return (
    <div style={{ padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
      {title && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width={200} height={24} borderRadius={8} />
          <Skeleton width={320} height={12} />
        </div>
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 16,
      }}>
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
