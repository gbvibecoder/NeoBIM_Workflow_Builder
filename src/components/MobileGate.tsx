"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Monitor } from "lucide-react";

const DISMISSED_KEY = "buildflow_mobile_gate_dismissed";

export function MobileGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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

  // Only show the gate on canvas page (workflow builder) which truly needs a large screen.
  // All other pages (landing, auth, dashboard, settings, etc.) are now fully responsive.
  const isCanvasPage = pathname === "/dashboard/canvas";

  if (isSmall && !dismissed && isCanvasPage) {
    return (
      <>
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,10,15,0.95)",
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
              The workflow canvas works best on screens 1024px and wider.
              You can still explore, but some canvas features may be limited.
            </p>
          </div>

          <button
            onClick={handleDismiss}
            style={{
              padding: "12px 28px",
              borderRadius: 10,
              background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              border: "none",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              minHeight: 44,
            }}
          >
            Continue anyway
          </button>
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
}
