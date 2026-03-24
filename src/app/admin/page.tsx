"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export default function AdminRootPage() {
  const router = useRouter();

  useEffect(() => {
    const cookies = document.cookie;
    if (cookies.includes(`${ADMIN_COOKIE_NAME}=`)) {
      window.location.href = "/admin/dashboard";
    } else {
      window.location.href = "/admin/login";
    }
  }, [router]);

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
