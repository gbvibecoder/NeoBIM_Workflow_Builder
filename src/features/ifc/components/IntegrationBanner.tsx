"use client";

import React, { useState, useEffect } from "react";
import { Sparkles, X, DollarSign } from "lucide-react";
import { UI } from "@/features/ifc/components/constants";

const DISMISSED_KEY = "buildflow-ifc-viewer-banner-dismissed";

interface IntegrationBannerProps {
  visible: boolean;
}

export function IntegrationBanner({ visible }: IntegrationBannerProps) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "true");
  }, []);

  if (!visible || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, "true");
  };

  /* autoAttachIFC=1 tells the canvas to pull the currently-loaded IFC out of
     IndexedDB (same-origin, shared with this tab) and wire it into the
     template's IFC Upload node so the user doesn't re-upload the same file
     they're already viewing. */
  const actions = [
    {
      label: "Estimate Costs / Generate BOQ",
      icon: DollarSign,
      desc: "Quantities, regional pricing & BOQ",
      onClick: () => window.open("/dashboard/canvas?template=wf-09&autoAttachIFC=1", "_blank"),
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 14px",
        background: "linear-gradient(90deg, rgba(99,130,255,0.06), rgba(139,92,246,0.06), rgba(99,130,255,0.06))",
        borderBottom: "1px solid rgba(99,130,255,0.1)",
        flexShrink: 0,
        minHeight: 36,
      }}
    >
      <Sparkles size={13} color={UI.accent.amber} />
      <span style={{ color: UI.text.secondary, fontSize: 12, whiteSpace: "nowrap" }}>Want more?</span>

      <div style={{ display: "flex", gap: 8 }}>
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.label}
              onClick={a.onClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: UI.radius.sm,
                border: "1px solid rgba(79,138,255,0.15)",
                background: "rgba(79,138,255,0.06)",
                color: UI.accent.blue,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                transition: UI.transition,
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(79,138,255,0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(79,138,255,0.06)";
              }}
            >
              <Icon size={12} />
              {a.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <span style={{ color: UI.text.tertiary, fontSize: 11 }}>
        Powered by BuildFlow AI
      </span>

      <button
        onClick={dismiss}
        style={{
          background: "none",
          border: "none",
          color: UI.text.tertiary,
          cursor: "pointer",
          padding: 4,
          display: "flex",
          opacity: 0.5,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = "0.5";
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
