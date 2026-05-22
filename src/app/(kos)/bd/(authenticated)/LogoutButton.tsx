"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/kos/bd/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? `Logout request failed: ${err.message}`
          : "Logout request failed.";
      toast.error(message);
    } finally {
      window.location.href = "/bd/login";
    }
  }
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        background: "transparent",
        border: "1px solid rgba(255,255,255,0.15)",
        color: "#fafafa",
        fontSize: 12,
        fontWeight: 600,
        padding: "6px 10px",
        borderRadius: 8,
        cursor: busy ? "not-allowed" : "pointer",
        opacity: busy ? 0.6 : 1,
        width: "100%",
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
