"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, Command, LogOut, Gift, Copy, Check, ChevronDown, Globe, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useLocale } from "@/hooks/useLocale";
import { useAvatar } from "@/hooks/useAvatar";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { toast } from "sonner";

interface HeaderProps {
  title?: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const router = useRouter();
  const { t } = useLocale();
  const { data: session } = useSession();
  const avatarSrc = useAvatar(session?.user?.image);
  const [profileOpen, setProfileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

  // Referral state
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);

  // Position dropdown below trigger button
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
    };
    if (profileOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileOpen]);

  // Fetch referral code when dropdown opens
  useEffect(() => {
    if (!profileOpen || referralCode) return;
    fetch("/api/referral").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.code) setReferralCode(d.code);
    }).catch(() => {});
  }, [profileOpen, referralCode]);

  const copyReferral = async () => {
    if (!referralCode) {
      // Generate one
      try {
        const res = await fetch("/api/referral", { method: "POST" });
        if (res.ok) {
          const d = await res.json();
          setReferralCode(d.code);
        }
      } catch { return; }
    }
    const link = `https://trybuildflow.in/register?ref=${referralCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setReferralCopied(true);
      toast.success("Referral link copied!");
      setTimeout(() => setReferralCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const initial = (userName[0] ?? "U").toUpperCase();

  return (
    <header
      className="flex items-center justify-between px-6 dashboard-header"
      style={{
        minHeight: 56,
        marginTop: 6,
        background: "rgba(10,12,20,0.75)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
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
              {t('dashboard.beta')}
            </span>
          </div>
        )}
        {subtitle && (
          <p className="font-mono-data" style={{ fontSize: 11, color: "#7C7C96", marginTop: 2, letterSpacing: "0.02em" }}>{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Search — opens CommandPalette (⌘K) */}
        <button
          className="h-[40px] flex items-center gap-2 px-3.5 text-xs transition-all"
          aria-label={t('nav.searchPlaceholder')}
          style={{
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            color: "#7C7C96",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: 11,
            letterSpacing: "0.02em",
          }}
          onClick={() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = "rgba(79,138,255,0.3)";
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          }}
        >
          <Search size={13} />
          <span className="search-text">{t('nav.searchPlaceholder')}</span>
          <div className="flex items-center gap-0.5 ml-2">
            <kbd
              className="rounded"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                padding: "1px 5px",
                fontSize: 9,
                color: "#5C5C78",
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
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                padding: "1px 5px",
                fontSize: 9,
                color: "#5C5C78",
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

        {/* ── Profile dropdown ─────────────────────────────────── */}
        <div style={{ position: "relative" }}>
          <button
            ref={triggerRef}
            onClick={() => { updatePosition(); setProfileOpen(!profileOpen); }}
            className="flex items-center gap-2 transition-all"
            style={{
              padding: "5px 10px 5px 5px",
              borderRadius: 12,
              border: profileOpen ? "1px solid rgba(79,138,255,0.3)" : "1px solid rgba(255,255,255,0.08)",
              background: profileOpen ? "rgba(79,138,255,0.08)" : "rgba(255,255,255,0.04)",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={e => {
              if (!profileOpen) {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              }
            }}
            onMouseLeave={e => {
              if (!profileOpen) {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }
            }}
          >
            {/* Avatar */}
            <div style={{
              width: 30, height: 30, borderRadius: 8, overflow: "hidden",
              background: "linear-gradient(135deg, rgba(79,138,255,0.2), rgba(139,92,246,0.2))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, color: "#E2E8F0",
              flexShrink: 0,
            }}>
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                initial
              )}
            </div>
            <span className="profile-name-text" style={{
              fontSize: 12, fontWeight: 600, color: "#C8CDD8",
              maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {userName.split(" ")[0]}
            </span>
            <ChevronDown size={12} style={{
              color: "#5C5C78",
              transition: "transform 0.2s",
              transform: profileOpen ? "rotate(180deg)" : "rotate(0deg)",
            }} />
          </button>

          {/* Dropdown menu — rendered via portal to escape overflow:hidden */}
          {profileOpen && createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: dropdownPos.top,
                right: dropdownPos.right,
                width: 260, borderRadius: 14,
                background: "rgba(14,16,24,0.98)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)",
                zIndex: 9999, overflow: "hidden",
              }}
            >
              {/* User info */}
              <div style={{
                padding: "14px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, overflow: "hidden",
                  background: "linear-gradient(135deg, rgba(79,138,255,0.2), rgba(139,92,246,0.2))",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, color: "#E2E8F0", flexShrink: 0,
                }}>
                  {avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    initial
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {userName}
                  </div>
                  <div style={{ fontSize: 10, color: "#5C5C78", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-jetbrains), monospace" }}>
                    {userEmail}
                  </div>
                </div>
              </div>

              {/* Menu items */}
              <div style={{ padding: "6px" }}>
                {/* Settings */}
                <button
                  onClick={() => { setProfileOpen(false); router.push("/dashboard/settings"); }}
                  className="header-dropdown-item"
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%",
                    padding: "9px 12px", borderRadius: 8,
                    background: "transparent", border: "none",
                    color: "#9898B0", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#E2E8F0"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#9898B0"; }}
                >
                  <Settings size={14} />
                  Settings
                </button>

                {/* Language */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 8,
                }}>
                  <Globe size={14} style={{ color: "#9898B0", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <LanguageSwitcher />
                  </div>
                </div>

                {/* Referral */}
                <button
                  onClick={copyReferral}
                  className="header-dropdown-item"
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%",
                    padding: "9px 12px", borderRadius: 8,
                    background: "transparent", border: "none",
                    color: referralCopied ? "#10B981" : "#9898B0",
                    fontSize: 12, fontWeight: 500,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { if (!referralCopied) { e.currentTarget.style.background = "rgba(16,185,129,0.06)"; e.currentTarget.style.color = "#10B981"; } }}
                  onMouseLeave={e => { if (!referralCopied) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#9898B0"; } }}
                >
                  {referralCopied ? <Check size={14} /> : <Gift size={14} />}
                  <span style={{ flex: 1, textAlign: "left" }}>
                    {referralCopied ? "Link Copied!" : "Refer & Earn"}
                  </span>
                  {!referralCopied && <Copy size={11} style={{ color: "#5C5C78" }} />}
                </button>
              </div>

              {/* Sign out */}
              <div style={{ padding: "0 6px 6px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="header-dropdown-item"
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%",
                    padding: "9px 12px", borderRadius: 8, marginTop: 6,
                    background: "transparent", border: "none",
                    color: "#9898B0", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.06)"; e.currentTarget.style.color = "#EF4444"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#9898B0"; }}
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </header>
  );
}
