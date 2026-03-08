"use client";

import { Bell, Search, User, Command } from "lucide-react";

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header
      className="flex items-center justify-between px-6 dashboard-header"
      style={{
        minHeight: 56,
        background: "rgba(7,7,13,0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(79,138,255,0.06)",
      }}
    >
      <div>
        {title && (
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", letterSpacing: "-0.02em" }}>{title}</h1>
            <span
              className="beta-badge"
              style={{
                padding: "2px 8px",
                borderRadius: 20,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase" as const,
                color: "#F59E0B",
                border: "1px solid rgba(245,158,11,0.25)",
                background: "rgba(245,158,11,0.06)",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              BETA
            </span>
          </div>
        )}
        {subtitle && (
          <p className="font-mono-data" style={{ fontSize: 11, color: "#5C5C78", marginTop: 2, letterSpacing: "0.02em" }}>{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Search — pill-shaped */}
        <button
          className="h-[34px] flex items-center gap-2 px-3.5 text-xs transition-all"
          style={{
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.03)",
            color: "#5C5C78",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 11,
            letterSpacing: "0.02em",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "rgba(79,138,255,0.3)";
            e.currentTarget.style.boxShadow = "0 0 12px rgba(79,138,255,0.08)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <Search size={12} />
          <span className="search-text">Search workflows, templates...</span>
          <div className="flex items-center gap-0.5 ml-2">
            <kbd
              className="rounded"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: "1px 4px",
                fontSize: 9,
                color: "#3A3A50",
                minWidth: 18,
                height: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Command size={8} />
            </kbd>
            <kbd
              className="rounded"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: "1px 4px",
                fontSize: 9,
                color: "#3A3A50",
                minWidth: 18,
                height: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              K
            </kbd>
          </div>
        </button>

        {/* Notifications */}
        <button
          className="h-[34px] w-[34px] flex items-center justify-center transition-all relative"
          style={{
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            color: "#5C5C78",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "rgba(79,138,255,0.2)";
            e.currentTarget.style.color = "#e2e8f0";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "#5C5C78";
          }}
        >
          <Bell size={14} />
        </button>

        {/* Avatar */}
        <button
          className="h-[34px] w-[34px] flex items-center justify-center transition-all"
          style={{
            borderRadius: 10,
            border: "1px solid rgba(79,138,255,0.15)",
            background: "linear-gradient(135deg, rgba(79,138,255,0.08), rgba(99,102,241,0.05))",
            color: "#5C5C78",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "rgba(79,138,255,0.3)";
            e.currentTarget.style.color = "#e2e8f0";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "rgba(79,138,255,0.15)";
            e.currentTarget.style.color = "#5C5C78";
          }}
        >
          <User size={14} />
        </button>
      </div>
    </header>
  );
}
