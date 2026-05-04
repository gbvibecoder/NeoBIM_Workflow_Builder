"use client";

import { useLocale } from "@/hooks/useLocale";
import { Globe } from "lucide-react";
import { useState } from "react";

export function LightLanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const [hovered, setHovered] = useState(false);
  const nextLocale = locale === "en" ? "de" : "en";

  return (
    <button
      onClick={() => setLocale(nextLocale)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={locale === "en" ? "Auf Deutsch wechseln" : "Switch to English"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 14px",
        borderRadius: 20,
        border: `1px solid ${hovered ? "rgba(0, 0, 0, 0.18)" : "rgba(0, 0, 0, 0.10)"}`,
        background: hovered ? "rgba(0, 0, 0, 0.04)" : "transparent",
        color: hovered ? "var(--light-ink)" : "#6B6B5E",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        letterSpacing: "0.5px",
      }}
    >
      <Globe
        size={14}
        style={{
          color: "#6B6B5E",
          transition: "transform 0.3s ease",
          transform: hovered ? "rotate(20deg)" : "none",
        }}
      />
      <span>{locale === "en" ? "EN" : "DE"}</span>
    </button>
  );
}
