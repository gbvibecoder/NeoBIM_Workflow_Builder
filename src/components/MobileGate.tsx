"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

const DISMISSED_KEY = "neobim_mobile_gate_dismissed";

export function MobileGate({ children }: { children: React.ReactNode }) {
  const [isSmall, setIsSmall] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(DISMISSED_KEY) === "1"
  );

  useEffect(() => {
    const check = () => setIsSmall(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  if (isSmall && !dismissed) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0A0A0F",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          zIndex: 9999,
          textAlign: "center",
          gap: 20,
        }}
        role="alert"
        aria-live="polite"
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: "rgba(79,138,255,0.08)",
            border: "1px solid rgba(79,138,255,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#4F8AFF",
          }}
        >
          <Monitor size={28} strokeWidth={1.5} />
        </div>

        <div style={{ maxWidth: 320 }}>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#F0F0F5",
              marginBottom: 10,
              lineHeight: 1.3,
            }}
          >
            Desktop recommended
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#55556A",
              lineHeight: 1.65,
            }}
          >
            Workflow Builder is designed for screens 1024px and wider.
            Open it on a desktop or laptop for the best experience.
          </p>
        </div>

        <button
          onClick={handleDismiss}
          style={{
            padding: "9px 22px",
            borderRadius: 8,
            background: "rgba(79,138,255,0.1)",
            border: "1px solid rgba(79,138,255,0.3)",
            color: "#4F8AFF",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Continue anyway
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
