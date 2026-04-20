"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, LogOut, Gift, Copy, Check, ChevronDown, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useLocale } from "@/hooks/useLocale";
import { useAvatar } from "@/hooks/useAvatar";
import { toast } from "sonner";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  /**
   * When true, the header becomes a transparent overlay — no background,
   * no border, absolutely positioned. Used on immersive pages (dashboard
   * landing hero) where the 3D scene should fill the full viewport and
   * only the right-side action pill needs to float above it.
   */
  floating?: boolean;
  /**
   * Color theme for the header chrome (background, borders, button
   * colors, separator, profile trigger). Defaults to "dark" — white
   * icons on the standard dark bar. Use "light" on pages whose content
   * surface is light (e.g. /dashboard/3d-render) so the nav blends into
   * the page instead of forming a dark strip above it. The profile
   * dropdown (rendered in a portal) stays dark in both themes — it's a
   * floating overlay and reads cleanly on any background.
   */
  theme?: "dark" | "light";
}

export function Header({ title, subtitle, floating = false, theme = "dark" }: HeaderProps) {
  const router = useRouter();
  const { t, locale, setLocale } = useLocale();
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
    // Capture phase — ReactFlow on the canvas page stops propagation on
    // mousedown, so a bubble-phase listener wouldn't fire for canvas clicks.
    if (profileOpen) document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
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

  // Light theme uses cool-grey chrome that sits on top of the page's light
  // gradient surface (see /dashboard/3d-render). The dropdown portal is
  // intentionally excluded from this palette — it keeps the dark styling
  // in both themes because it's a floating overlay.
  const isLight = theme === "light";
  const p = {
    barBg: isLight ? "rgba(250,251,254,0.92)" : "rgba(10,12,20,0.8)",
    barBorder: isLight ? "1px solid rgba(17,24,39,0.06)" : "1px solid rgba(255,255,255,0.1)",
    iconBorder: isLight ? "rgba(17,24,39,0.08)" : "rgba(255,255,255,0.12)",
    iconBg: isLight ? "rgba(17,24,39,0.03)" : "rgba(255,255,255,0.05)",
    iconBorderHover: isLight ? "rgba(99,102,241,0.25)" : "rgba(255,191,0,0.25)",
    iconBgHover: isLight ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.08)",
    iconColor: isLight ? "#4B5563" : "#CBD5E0",
    iconColorHover: isLight ? "#312E81" : "#F0F0F5",
    langColor: isLight ? "#4B5563" : "#A0AEC0",
    langColorHover: isLight ? "#6366F1" : "#FFBF00",
    langBorderHover: isLight ? "rgba(99,102,241,0.25)" : "rgba(255,191,0,0.25)",
    langBgHover: isLight ? "rgba(99,102,241,0.06)" : "rgba(255,191,0,0.06)",
    separator: isLight ? "rgba(17,24,39,0.08)" : "rgba(255,255,255,0.06)",
    profileBorder: isLight ? "1px solid rgba(17,24,39,0.08)" : "1px solid rgba(255,255,255,0.07)",
    profileBorderActive: isLight ? "1px solid rgba(99,102,241,0.3)" : "1px solid rgba(255,191,0,0.3)",
    profileBg: isLight ? "rgba(17,24,39,0.02)" : "rgba(255,255,255,0.03)",
    profileBgActive: isLight ? "rgba(99,102,241,0.06)" : "rgba(255,191,0,0.06)",
    profileHoverBorder: isLight ? "rgba(17,24,39,0.14)" : "rgba(255,255,255,0.12)",
    profileHoverBg: isLight ? "rgba(17,24,39,0.04)" : "rgba(255,255,255,0.05)",
    nameColor: isLight ? "#374151" : "#C8CDD8",
    chevronColor: isLight ? "#6B7280" : "#9090A8",
    avatarBg: isLight ? "linear-gradient(135deg, rgba(99,102,241,0.14), rgba(99,102,241,0.06))" : "linear-gradient(135deg, rgba(255,191,0,0.15), rgba(255,191,0,0.08))",
    avatarBorder: isLight ? "1px solid rgba(99,102,241,0.18)" : "1px solid rgba(255,191,0,0.12)",
    avatarInitialColor: isLight ? "#4338CA" : "#FFBF00",
    titleColor: isLight ? "#1F2937" : "#F0F0F5",
    subtitleColor: isLight ? "#6B7280" : "#9090A8",
    betaColor: isLight ? "#B45309" : "#FFBF00",
    betaBorder: isLight ? "1px solid rgba(180,83,9,0.2)" : "1px solid rgba(255,191,0,0.2)",
    betaBg: isLight ? "rgba(180,83,9,0.06)" : "rgba(255,191,0,0.06)",
  };

  return (
    <header
      className="flex items-center justify-between px-5 dashboard-header"
      style={{
        minHeight: floating ? 48 : 52,
        flexShrink: 0,
        // Transparent overlay for immersive landing — otherwise dark or light
        // bar depending on the page's content surface (theme prop).
        background: floating ? "transparent" : p.barBg,
        backdropFilter: floating ? "none" : "blur(20px)",
        WebkitBackdropFilter: floating ? "none" : "blur(20px)",
        borderBottom: floating ? "none" : p.barBorder,
        // Floating mode: absolute over the hero so content can fill the full
        // viewport. Static mode: relative in the flex flow.
        position: floating ? "absolute" : "relative",
        top: floating ? 0 : undefined,
        left: floating ? 0 : undefined,
        right: floating ? 0 : undefined,
        paddingTop: floating ? 10 : undefined,
        // Establish a stacking context above the canvas/ReactFlow area so the
        // canvas-toolbar dropdowns (Manual mode, Share, Run options) — which
        // are now portaled into this header — render above the canvas pane.
        zIndex: 40,
        pointerEvents: floating ? "none" : undefined,
      }}
    >
      {/* Left — Title (optional). Collapses when empty so the center toolbar
          slot can occupy the full available width. */}
      <div style={{ minWidth: 0, flex: title || subtitle ? 1 : "0 0 auto" }}>
        {title && (
          <div className="flex items-center gap-2.5">
            <h1 style={{ fontSize: 18, fontWeight: 700, color: p.titleColor, letterSpacing: "-0.02em" }}>{title}</h1>
            <span
              className="beta-badge"
              style={{
                padding: "2px 7px",
                borderRadius: 20,
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase" as const,
                color: p.betaColor,
                border: p.betaBorder,
                background: p.betaBg,
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              {t('dashboard.beta')}
            </span>
          </div>
        )}
        {subtitle && (
          <p className="font-mono-data" style={{ fontSize: 11, color: p.subtitleColor, marginTop: 1, letterSpacing: "0.02em" }}>{subtitle}</p>
        )}
      </div>

      {/* Center — Canvas toolbar slot (portal target, only filled on /dashboard/canvas).
          flex:1 so portaled content (ShowcaseHeader) can stretch and align its
          children left/right via space-between. The canvas toolbar pill inside
          stays centered via justify-center. */}
      <div
        id="canvas-toolbar-slot"
        className="hidden md:flex items-center justify-center"
        style={{ flex: 1, minWidth: 0, marginRight: 12 }}
      />

      {/* Right — Actions */}
      <div className="flex items-center gap-2.5" style={{ pointerEvents: "auto" }}>
        {/* Search — icon-only trigger for ⌘K command palette */}
        <button
          className="flex items-center justify-center transition-all"
          aria-label={t('nav.searchPlaceholder')}
          title={`${t('nav.searchPlaceholder')} (⌘K)`}
          style={{
            width: 36, height: 36,
            borderRadius: 10,
            border: `1px solid ${p.iconBorder}`,
            background: p.iconBg,
            color: p.iconColor,
          }}
          onClick={() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = p.iconBorderHover;
            e.currentTarget.style.background = p.iconBgHover;
            e.currentTarget.style.color = p.iconColorHover;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = p.iconBorder;
            e.currentTarget.style.background = p.iconBg;
            e.currentTarget.style.color = p.iconColor;
          }}
        >
          <Search size={14} />
        </button>

        {/* Language toggle */}
        <button
          className="header-lang-btn"
          onClick={() => setLocale(locale === "en" ? "de" : "en")}
          title={locale === "en" ? "Auf Deutsch wechseln" : "Switch to English"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 36, minWidth: 42, padding: "0 10px",
            borderRadius: 10,
            border: `1px solid ${p.iconBorder}`,
            background: p.iconBg,
            color: p.langColor,
            fontSize: 11, fontWeight: 700,
            cursor: "pointer",
            fontFamily: "var(--font-jetbrains), monospace",
            letterSpacing: "0.5px",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = p.langBorderHover;
            e.currentTarget.style.color = p.langColorHover;
            e.currentTarget.style.background = p.langBgHover;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = p.iconBorder;
            e.currentTarget.style.color = p.langColor;
            e.currentTarget.style.background = p.iconBg;
          }}
        >
          {locale === "en" ? "EN" : "DE"}
        </button>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: p.separator }} />

        {/* Profile dropdown */}
        <div style={{ position: "relative" }}>
          <button
            ref={triggerRef}
            onClick={() => { updatePosition(); setProfileOpen(!profileOpen); }}
            className="flex items-center gap-2 transition-all"
            style={{
              padding: "3px 8px 3px 3px",
              borderRadius: 10,
              border: profileOpen ? p.profileBorderActive : p.profileBorder,
              background: profileOpen ? p.profileBgActive : p.profileBg,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={e => {
              if (!profileOpen) {
                e.currentTarget.style.borderColor = p.profileHoverBorder;
                e.currentTarget.style.background = p.profileHoverBg;
              }
            }}
            onMouseLeave={e => {
              if (!profileOpen) {
                // Re-extract from palette border strings (they include "1px solid ")
                const baseBorder = p.profileBorder.replace(/^1px solid /, "");
                e.currentTarget.style.borderColor = baseBorder;
                e.currentTarget.style.background = p.profileBg;
              }
            }}
          >
            {/* Avatar */}
            <div style={{
              width: 30, height: 30, borderRadius: 8, overflow: "hidden",
              background: p.avatarBg,
              border: p.avatarBorder,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, color: p.avatarInitialColor,
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
              fontSize: 12, fontWeight: 600, color: p.nameColor,
              maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {userName.split(" ")[0]}
            </span>
            <ChevronDown size={11} style={{
              color: p.chevronColor,
              transition: "transform 0.2s",
              transform: profileOpen ? "rotate(180deg)" : "rotate(0deg)",
            }} />
          </button>

          {/* Dropdown — portal */}
          {profileOpen && createPortal(
            <div
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: dropdownPos.top,
                right: dropdownPos.right,
                width: 240, borderRadius: 12,
                background: "rgba(14,16,24,0.98)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                zIndex: 9999, overflow: "hidden",
              }}
            >
              {/* User info */}
              <div style={{
                padding: "12px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, overflow: "hidden",
                  background: "linear-gradient(135deg, rgba(255,191,0,0.15), rgba(255,191,0,0.08))",
                  border: "1px solid rgba(255,191,0,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700, color: "#FFBF00", flexShrink: 0,
                }}>
                  {avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    initial
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {userName}
                  </div>
                  <div style={{ fontSize: 9, color: "#9090A8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-jetbrains), monospace" }}>
                    {userEmail}
                  </div>
                </div>
              </div>

              {/* Menu items */}
              <div style={{ padding: "4px" }}>
                {/* Settings */}
                <button
                  onClick={() => { setProfileOpen(false); router.push("/dashboard/settings"); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "8px 10px", borderRadius: 8,
                    background: "transparent", border: "none",
                    color: "#9898B0", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#E2E8F0"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#9898B0"; }}
                >
                  <Settings size={13} />
                  Settings
                </button>

                {/* Referral */}
                <button
                  onClick={copyReferral}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "8px 10px", borderRadius: 8,
                    background: "transparent", border: "none",
                    color: referralCopied ? "#10B981" : "#9898B0",
                    fontSize: 12, fontWeight: 500,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { if (!referralCopied) { e.currentTarget.style.background = "rgba(16,185,129,0.06)"; e.currentTarget.style.color = "#10B981"; } }}
                  onMouseLeave={e => { if (!referralCopied) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#9898B0"; } }}
                >
                  {referralCopied ? <Check size={13} /> : <Gift size={13} />}
                  <span style={{ flex: 1, textAlign: "left" }}>
                    {referralCopied ? "Link Copied!" : "Refer & Earn"}
                  </span>
                  {!referralCopied && <Copy size={10} style={{ color: "#9090A8" }} />}
                </button>
              </div>

              {/* Sign out */}
              <div style={{ padding: "0 4px 4px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <button
                  onClick={() => {
                    // Clear all user-specific client state BEFORE signing out
                    // to prevent cross-user data leaks on shared devices.
                    try {
                      const keys = Object.keys(localStorage);
                      for (const key of keys) {
                        if (key.startsWith("buildflow-fp-")) localStorage.removeItem(key);
                      }
                      localStorage.removeItem("neobim-workflow-state");
                      sessionStorage.removeItem("floorPlanProject");
                      sessionStorage.removeItem("fp-editor-geometry");
                      sessionStorage.removeItem("fp-editor-prompt");
                    } catch { /* best-effort */ }
                    signOut({ callbackUrl: "/login" });
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "8px 10px", borderRadius: 8, marginTop: 4,
                    background: "transparent", border: "none",
                    color: "#9898B0", fontSize: 12, fontWeight: 500,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.06)"; e.currentTarget.style.color = "#EF4444"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#9898B0"; }}
                >
                  <LogOut size={13} />
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
