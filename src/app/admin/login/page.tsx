"use client";

import { useEffect } from "react";

// Redirect to main login page — admin tab is on the unified login page
export default function AdminLoginRedirect() {
  useEffect(() => {
    window.location.href = "/login";
  }, []);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#070809",
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: "50%",
        border: "2px solid rgba(0,245,255,0.3)",
        borderTopColor: "#00F5FF",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
