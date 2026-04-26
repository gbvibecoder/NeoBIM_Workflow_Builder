"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Settings, LogOut, Gift, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/hooks/useLocale";
import { useAvatar } from "@/hooks/useAvatar";

interface UserMenuProps {
  /**
   * Surface tone — `light` for cream/white pages (result page, BOQ
   * visualizer, settings), `dark` for canvas / IFC viewer / immersive
   * landing. Defaults to `light` since most authenticated pages now
   * use the cream surface introduced by the result-page redesign.
   */
  tone?: "light" | "dark";
}

const LOCALE_PILLS: { code: "en" | "de"; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "de", label: "DE" },
];

export function UserMenu({ tone = "light" }: UserMenuProps) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { data: session, status } = useSession();
  const { locale, setLocale } = useLocale();
  const avatarSrc = useAvatar(session?.user?.image);

  const [open, setOpen] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isDark = tone === "dark";
  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const initial = (userName[0] ?? "U").toUpperCase();

  const updatePosition = useCallback(() => {
    // Anchor to the plate (not the inner button) so the dropdown aligns
    // with the visible glass-pill edge, not the avatar circle's edge.
    const anchor = plateRef.current ?? triggerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const right = Math.max(12, window.innerWidth - rect.right);
    setDropdownPos({ top: rect.bottom + 8, right });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || referralCode) return;
    fetch("/api/referral")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.code) setReferralCode(d.code); })
      .catch(() => {});
  }, [open, referralCode]);

  const handleCopyReferral = async () => {
    let code = referralCode;
    if (!code) {
      try {
        const res = await fetch("/api/referral", { method: "POST" });
        if (res.ok) {
          const d = await res.json();
          code = d.code;
          if (code) setReferralCode(code);
        }
      } catch {
        toast.error("Couldn't generate referral link");
        return;
      }
    }
    if (!code) return;
    const link = `https://trybuildflow.in/register?ref=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setReferralCopied(true);
      toast.success("Referral link copied");
      setTimeout(() => setReferralCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link");
    }
  };

  const handleSignOut = async () => {
    if (signOutBusy) return;
    setSignOutBusy(true);
    try {
      const keys = Object.keys(localStorage);
      for (const key of keys) {
        if (key.startsWith("buildflow-fp-")) localStorage.removeItem(key);
      }
      localStorage.removeItem("neobim-workflow-state");
      sessionStorage.removeItem("floorPlanProject");
      sessionStorage.removeItem("fp-editor-geometry");
      sessionStorage.removeItem("fp-editor-prompt");
    } catch {
      /* best-effort */
    }
    try {
      await signOut({ callbackUrl: "/login" });
    } catch {
      setSignOutBusy(false);
      toast.error("Sign out failed — please try again");
    }
  };

  const palette = useMemo(() => {
    if (isDark) {
      return {
        triggerBorder: "rgba(255,255,255,0.12)",
        triggerBorderHover: "rgba(255,255,255,0.22)",
        triggerBg: "rgba(255,255,255,0.04)",
        triggerBgHover: "rgba(255,255,255,0.08)",
        triggerShadow: "0 1px 2px rgba(0,0,0,0.3)",
        avatarBg: "linear-gradient(135deg, rgba(255,191,0,0.15), rgba(255,191,0,0.08))",
        avatarColor: "#FFBF00",
        plateBg: "rgba(20,20,28,0.5)",
        plateBorder: "1px solid rgba(255,255,255,0.06)",
        plateShadow: "0 2px 12px rgba(0,0,0,0.4)",
      };
    }
    return {
      triggerBorder: "rgba(0,0,0,0.08)",
      triggerBorderHover: "rgba(0,0,0,0.16)",
      triggerBg: "rgba(255,255,255,0.6)",
      triggerBgHover: "rgba(255,255,255,0.9)",
      triggerShadow: "0 1px 2px rgba(0,0,0,0.04)",
      avatarBg: "linear-gradient(135deg, #E0E7FF, #C7D2FE)",
      avatarColor: "#3730A3",
      plateBg: "rgba(255,255,255,0.72)",
      plateBorder: "1px solid rgba(0,0,0,0.04)",
      plateShadow: "0 2px 8px rgba(0,0,0,0.06)",
    };
  }, [isDark]);

  if (status !== "authenticated") return null;

  const triggerSize = 32;
  const avatarInner = 28;

  return (
    <>
      {/* Glass plate anchor — wraps the avatar trigger so the chrome
          reads as a deliberate top-right handle. Sticky page elements
          scrolling underneath get softly de-emphasized through the
          backdrop-blur layer rather than competing with the avatar. */}
      <div
        ref={plateRef}
        className="user-menu-plate"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 4,
          borderRadius: 9999,
          background: palette.plateBg,
          border: palette.plateBorder,
          boxShadow: palette.plateShadow,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          pointerEvents: "auto",
        }}
      >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu-dropdown"
        aria-label="Open profile menu"
        onClick={() => setOpen(o => !o)}
        className="user-menu-trigger"
        style={{
          width: triggerSize,
          height: triggerSize,
          padding: 0,
          borderRadius: 9999,
          border: `1px solid ${palette.triggerBorder}`,
          background: palette.triggerBg,
          boxShadow: palette.triggerShadow,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          transition: reduce ? "none" : "border-color 0.18s ease, background 0.18s ease, transform 0.12s ease",
          pointerEvents: "auto",
        }}
        onMouseEnter={e => {
          if (reduce) return;
          e.currentTarget.style.borderColor = palette.triggerBorderHover;
          e.currentTarget.style.background = palette.triggerBgHover;
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = palette.triggerBorder;
          e.currentTarget.style.background = palette.triggerBg;
        }}
        onMouseDown={e => {
          if (!reduce) e.currentTarget.style.transform = "scale(0.97)";
        }}
        onMouseUp={e => {
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        <div
          style={{
            width: avatarInner,
            height: avatarInner,
            borderRadius: 9999,
            background: palette.avatarBg,
            color: palette.avatarColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            overflow: "hidden",
          }}
        >
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            initial
          )}
        </div>
      </button>
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && dropdownPos && (
              <motion.div
                ref={dropdownRef}
                id="user-menu-dropdown"
                role="menu"
                aria-label="Profile menu"
                initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={reduce ? { duration: 0 } : { duration: 0.12, ease: [0.25, 0.46, 0.45, 0.94] }}
                style={{
                  position: "fixed",
                  top: dropdownPos.top,
                  right: dropdownPos.right,
                  width: 240,
                  maxWidth: "calc(100vw - 24px)",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.97)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  border: "1px solid rgba(0,0,0,0.06)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)",
                  zIndex: 9999,
                  overflow: "hidden",
                  fontFamily: "var(--font-inter), ui-sans-serif, system-ui",
                }}
              >
                {/* Identity row */}
                <div
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9999,
                      background: "linear-gradient(135deg, #E0E7FF, #C7D2FE)",
                      color: "#3730A3",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      fontWeight: 700,
                      fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    {avatarSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      initial
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#0F172A",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {userName}
                    </div>
                    {userEmail && (
                      <div
                        style={{
                          fontSize: 10,
                          color: "#64748B",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {userEmail}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ height: 1, background: "rgba(0,0,0,0.06)" }} />

                {/* Language pills */}
                <div style={{ padding: "10px 14px" }}>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                      fontSize: 9,
                      fontWeight: 600,
                      color: "#94A3B8",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    Language
                  </div>
                  <div style={{ display: "flex", gap: 6 }} role="radiogroup" aria-label="Language">
                    {LOCALE_PILLS.map(p => {
                      const active = p.code === locale;
                      return (
                        <button
                          key={p.code}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setLocale(p.code)}
                          style={{
                            flex: 1,
                            padding: "6px 0",
                            borderRadius: 8,
                            border: `1px solid ${active ? "#0D9488" : "rgba(0,0,0,0.08)"}`,
                            background: active ? "rgba(13,148,136,0.08)" : "rgba(255,255,255,0.6)",
                            color: active ? "#0D9488" : "#475569",
                            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            cursor: "pointer",
                            transition: reduce ? "none" : "all 0.15s ease",
                          }}
                          onMouseEnter={e => {
                            if (active) return;
                            e.currentTarget.style.borderColor = "rgba(13,148,136,0.3)";
                            e.currentTarget.style.background = "rgba(13,148,136,0.04)";
                          }}
                          onMouseLeave={e => {
                            if (active) return;
                            e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)";
                            e.currentTarget.style.background = "rgba(255,255,255,0.6)";
                          }}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ height: 1, background: "rgba(0,0,0,0.06)" }} />

                {/* Menu items */}
                <div style={{ padding: 4 }}>
                  <MenuItem
                    icon={<Settings size={14} />}
                    label="Settings"
                    onClick={() => {
                      setOpen(false);
                      router.push("/dashboard/settings");
                    }}
                  />
                  <MenuItem
                    icon={referralCopied ? <Check size={14} /> : <Gift size={14} />}
                    label={referralCopied ? "Link copied" : "Refer & earn"}
                    onClick={handleCopyReferral}
                    rightSlot={!referralCopied ? <Copy size={11} style={{ color: "#94A3B8" }} /> : undefined}
                    color={referralCopied ? "#0D9488" : undefined}
                  />
                </div>

                <div style={{ height: 1, background: "rgba(0,0,0,0.06)" }} />

                {/* Sign out — gentle amber, not red */}
                <div style={{ padding: 4 }}>
                  <MenuItem
                    icon={<LogOut size={14} />}
                    label={signOutBusy ? "Signing out…" : "Sign out"}
                    onClick={handleSignOut}
                    color="#A05E1A"
                    hoverBg="rgba(160,94,26,0.06)"
                    disabled={signOutBusy}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  rightSlot?: React.ReactNode;
  color?: string;
  hoverBg?: string;
  disabled?: boolean;
}

function MenuItem({ icon, label, onClick, rightSlot, color, hoverBg, disabled }: MenuItemProps) {
  const restColor = color ?? "#475569";
  const restBg = "transparent";
  const finalHoverBg = hoverBg ?? "rgba(0,0,0,0.04)";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 8,
        background: restBg,
        border: "none",
        color: restColor,
        fontSize: 12.5,
        fontWeight: 500,
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background 0.12s ease, color 0.12s ease",
        textAlign: "left",
        fontFamily: "var(--font-inter), ui-sans-serif, system-ui",
      }}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.background = finalHoverBg;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = restBg;
      }}
    >
      <span style={{ flexShrink: 0, color: restColor }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {rightSlot}
    </button>
  );
}
