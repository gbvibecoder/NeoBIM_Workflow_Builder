"use client";

import { Bell, Search, User, Command } from "lucide-react";

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header
      className="flex items-center justify-between px-6 border-b border-[rgba(255,255,255,0.06)] dashboard-header"
      style={{
        minHeight: 56,
        background: "linear-gradient(180deg, rgba(9,9,26,0.95) 0%, rgba(7,7,13,0.98) 100%)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div>
        {title && (
          <div className="flex items-center gap-2.5">
            <h1 className="text-[20px] font-bold text-[#F0F0F5] tracking-[-0.02em]">{title}</h1>
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.06em] beta-badge"
              style={{
                background: "rgba(245,158,11,0.1)",
                color: "#F59E0B",
                border: "1px solid rgba(245,158,11,0.2)",
              }}
            >
              BETA
            </span>
          </div>
        )}
        {subtitle && (
          <p className="text-[12.5px] text-[#5C5C78] mt-0.5 tracking-[-0.005em]">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Search */}
        <button
          className="h-[34px] flex items-center gap-2 rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] px-3 text-xs text-[#5C5C78] hover:border-[rgba(255,255,255,0.12)] hover:text-[#9898B0] hover:bg-[#16162A] transition-all"
          style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.02)" }}
        >
          <Search size={12} />
          <span className="search-text">Search...</span>
          <div className="flex items-center gap-0.5 ml-2">
            <kbd
              className="rounded bg-[#1A1A2A] border border-[rgba(255,255,255,0.06)] px-1 text-[9px] text-[#3A3A50] flex items-center justify-center"
              style={{ minWidth: 18, height: 18 }}
            >
              <Command size={8} />
            </kbd>
            <kbd
              className="rounded bg-[#1A1A2A] border border-[rgba(255,255,255,0.06)] px-1 text-[9px] text-[#3A3A50] flex items-center justify-center"
              style={{ minWidth: 18, height: 18 }}
            >
              K
            </kbd>
          </div>
        </button>

        {/* Notifications */}
        <button
          className="h-[34px] w-[34px] flex items-center justify-center rounded-[9px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] text-[#5C5C78] hover:text-[#F0F0F5] hover:border-[rgba(255,255,255,0.12)] hover:bg-[#16162A] transition-all relative"
          style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}
        >
          <Bell size={14} />
        </button>

        {/* Avatar */}
        <button
          className="h-[34px] w-[34px] flex items-center justify-center rounded-[9px] border border-[rgba(255,255,255,0.06)] text-[#5C5C78] hover:text-[#F0F0F5] hover:border-[rgba(255,255,255,0.12)] transition-all"
          style={{
            background: "linear-gradient(135deg, rgba(79,138,255,0.08) 0%, rgba(139,92,246,0.08) 100%)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
          }}
        >
          <User size={14} />
        </button>
      </div>
    </header>
  );
}
