"use client";

import { Bell, Search, User } from "lucide-react";

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-[rgba(255,255,255,0.06)] bg-[#07070D]">
      <div>
        {title && (
          <h1 className="text-[20px] font-semibold text-[#F0F0F5] tracking-[-0.01em]">{title}</h1>
        )}
        {subtitle && (
          <p className="text-[13px] text-[#5C5C78] mt-0.5">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Search */}
        <button className="h-8 flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#12121E] px-3 text-xs text-[#5C5C78] hover:border-[rgba(255,255,255,0.12)] hover:text-[#9898B0] transition-all">
          <Search size={12} />
          <span>Search...</span>
          <kbd className="ml-1 rounded bg-[#1A1A2A] border border-[rgba(255,255,255,0.06)] px-1 text-[9px] text-[#3A3A50]">
            K
          </kbd>
        </button>

        {/* Notifications */}
        <button className="h-8 w-8 flex items-center justify-center rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#12121E] text-[#5C5C78] hover:text-[#F0F0F5] hover:border-[rgba(255,255,255,0.12)] transition-all">
          <Bell size={13} />
        </button>

        {/* Avatar */}
        <button className="h-8 w-8 flex items-center justify-center rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#1A1A2A] text-[#5C5C78] hover:text-[#F0F0F5] hover:border-[rgba(255,255,255,0.12)] transition-all">
          <User size={13} />
        </button>
      </div>
    </header>
  );
}
