"use client";

import React, { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  LayoutDashboard, Users, CreditCard, Workflow,
  BarChart3, MessageSquareHeart, Settings, ChevronLeft, ChevronRight,
  LogOut, Shield, Menu, X, TrendingUp,
} from "lucide-react";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

// ─── Navigation ──────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: "/admin/dashboard", labelKey: "admin.nav.overview" as const, icon: LayoutDashboard },
  { href: "/admin/users",     labelKey: "admin.nav.users" as const,    icon: Users },
  { href: "/admin/billing",   labelKey: "admin.nav.revenue" as const,  icon: CreditCard },
  { href: "/admin/workflows", labelKey: "admin.nav.workflows" as const, icon: Workflow },
  { href: "/admin/growth",    labelKey: "admin.nav.growth" as const,    icon: TrendingUp },
  { href: "/admin/analytics", labelKey: "admin.nav.analytics" as const, icon: BarChart3 },
  { href: "/admin/support",   labelKey: "admin.nav.feedback" as const,  icon: MessageSquareHeart },
  { href: "/admin/settings",  labelKey: "admin.nav.settings" as const,  icon: Settings },
] as const;

function getBreadcrumbs(pathname: string, t: (key: TranslationKey) => string) {
  const crumbs = [{ label: t("admin.badge"), href: "/admin/dashboard" }];
  const item = NAV_ITEMS.find((n) => n.href === pathname);
  if (item) crumbs.push({ label: t(item.labelKey), href: item.href });
  return crumbs;
}

// ─── NavItem ─────────────────────────────────────────────────────────────────
function NavItem({
  href, label, icon: Icon, isActive, collapsed, showLabels, onClick,
}: {
  href: string; label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  isActive: boolean; collapsed: boolean; showLabels: boolean; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`sb-nav-item ${isActive ? "sb-nav-active" : ""}`}
      style={{
        display: "flex", alignItems: "center", gap: 11,
        padding: collapsed ? "10px 0" : "9px 12px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 10, textDecoration: "none",
        position: "relative", overflow: "hidden",
      }}
    >
      {/* Active background glow */}
      {isActive && (
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse 120% 100% at 0% 50%, rgba(0,245,255,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
      )}

      {/* Left accent bar */}
      <div style={{
        position: "absolute", left: 0,
        top: isActive ? 4 : "20%",
        bottom: isActive ? 4 : "20%",
        width: isActive ? 3 : 2,
        borderRadius: "0 4px 4px 0",
        background: isActive
          ? "linear-gradient(180deg, #00F5FF, #4FC3F7)"
          : "rgba(184,115,51,0.4)",
        opacity: isActive ? 1 : (hovered ? 0.8 : 0),
        transition: "all 200ms cubic-bezier(0.4,0,0.2,1)",
        boxShadow: isActive ? "0 0 12px rgba(0,245,255,0.5), 0 0 4px rgba(0,245,255,0.8)" : "none",
        pointerEvents: "none",
      }} />

      {/* Icon */}
      <span
        className={`sb-icon-wrap ${isActive ? "sb-icon-active" : ""}`}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: isActive ? 30 : 22, height: isActive ? 30 : 22,
          borderRadius: isActive ? 8 : 6, flexShrink: 0,
          transition: "all 200ms ease",
        }}
      >
        <Icon
          size={isActive ? 15 : 17}
          strokeWidth={isActive ? 2.2 : 1.6}
          style={{
            color: isActive ? "#fff" : (hovered ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)"),
            transition: "all 200ms ease",
            filter: isActive ? "drop-shadow(0 0 4px rgba(0,245,255,0.5))" : "none",
          }}
        />
      </span>

      {showLabels && (
        <span style={{
          flex: 1, fontSize: 13,
          fontWeight: isActive ? 600 : 450,
          color: isActive ? "#E2E8F0" : (hovered ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)"),
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          transition: "all 200ms ease",
          letterSpacing: isActive ? "0.2px" : "0.1px",
        }}>
          {label}
        </span>
      )}

      {/* Hover shimmer */}
      {hovered && !isActive && (
        <motion.div
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: "200%", opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{
            position: "absolute", top: 0, left: 0,
            width: "40%", height: "100%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)",
            pointerEvents: "none",
          }}
        />
      )}
    </Link>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useLocale();
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth check via server-side API (httponly cookie can't be read from JS)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin", { credentials: "same-origin" })
      .then(res => {
        if (cancelled) return;
        if (res.ok) {
          setAuthenticated(true);
        } else {
          setAuthenticated(false);
          window.location.href = "/login";
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthenticated(false);
          window.location.href = "/login";
        }
      });
    return () => { cancelled = true; };
  }, [pathname]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 769);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close mobile nav on route change
    if (isMobile) setMobileOpen(false);
  }, [pathname, isMobile]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const [showLabels, setShowLabels] = useState(false);
  useEffect(() => {
    if (!collapsed || hoverExpanded || isMobile) {
      const timer = setTimeout(() => setShowLabels(true), 80);
      return () => clearTimeout(timer);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync labels with collapse state
      setShowLabels(false);
    }
  }, [collapsed, hoverExpanded, isMobile]);

  const isEffectivelyCollapsed = isMobile ? false : (collapsed && !hoverExpanded);
  const sidebarWidth = isMobile ? 272 : isEffectivelyCollapsed ? 56 : 248;
  const effectiveShowLabels = !isEffectivelyCollapsed && showLabels;

  const handleSidebarEnter = useCallback(() => {
    if (!collapsed || isMobile) return;
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), 150);
  }, [collapsed, isMobile]);

  const handleSidebarLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverExpanded(false);
  }, []);

  function handleLogout() {
    document.cookie = `${ADMIN_COOKIE_NAME}=; path=/; max-age=0`;
    window.location.href = "/login";
  }

  // Loading state
  if (authenticated === null) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#070809",
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: "50%",
          border: "2px solid rgba(0,245,255,0.3)",
          borderTopColor: "#00F5FF",
          animation: "spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const breadcrumbs = getBreadcrumbs(pathname, t);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#070809" }}>
      {/* ── Mobile hamburger ──────────────────────────────────────────── */}
      {isMobile && !mobileOpen && (
        <button
          onClick={() => setMobileOpen(true)}
          aria-label={t("admin.openMenu")}
          style={{
            position: "fixed", top: 12, left: 12, zIndex: 9001,
            width: 42, height: 42, borderRadius: 12,
            border: "1px solid rgba(184,115,51,0.15)",
            background: "rgba(7,8,9,0.92)",
            backdropFilter: "blur(16px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(255,255,255,0.5)", cursor: "pointer",
          }}
        >
          <Menu size={18} />
        </button>
      )}

      {/* ── Mobile overlay ────────────────────────────────────────────── */}
      <AnimatePresence>
        {isMobile && mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeMobile}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.82)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              zIndex: 8999,
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <motion.aside
        initial={isMobile ? { x: -280 } : { x: -16, opacity: 0 }}
        animate={{
          width: sidebarWidth,
          x: isMobile ? (mobileOpen ? 0 : -280) : 0,
          opacity: 1,
        }}
        transition={isMobile
          ? { type: "tween", duration: 0.3, ease: [0.4, 0, 0.2, 1] }
          : { type: "spring", stiffness: 400, damping: 32 }
        }
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={handleSidebarLeave}
        style={{
          display: "flex", flexDirection: "column",
          height: "100vh",
          overflow: "hidden", flexShrink: 0,
          position: isMobile ? "fixed" : "sticky",
          top: 0,
          zIndex: isMobile ? 9000 : 10,
          left: isMobile ? 0 : undefined,
          bottom: isMobile ? 0 : undefined,
          boxShadow: isMobile && mobileOpen ? "20px 0 60px rgba(0,0,0,0.6)" : undefined,
          background: "#070809",
          borderRight: "1px solid rgba(184,115,51,0.15)",
        }}
      >
        {/* Ambient background layers (same as main app) */}
        <div className="sb-ambient" />
        <div className="sb-scanline" />

        {/* Right edge glow */}
        <div style={{
          position: "absolute", top: "15%", right: 0, height: "70%", width: 1,
          background: "linear-gradient(180deg, transparent 0%, rgba(184,115,51,0.15) 30%, rgba(184,115,51,0.25) 50%, rgba(184,115,51,0.15) 70%, transparent 100%)",
          pointerEvents: "none", zIndex: 2,
        }} />

        {/* ── Logo ────────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: isEffectivelyCollapsed ? "center" : "space-between",
          padding: isEffectivelyCollapsed ? "18px 0" : "20px 16px 18px 18px",
          minHeight: 72, flexShrink: 0, position: "relative", zIndex: 1,
        }}>
          <Link href="/admin/dashboard" className="sb-logo-link" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none", overflow: "hidden" }}>
            <div className="sb-logo-mark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/buildflow_logo.png" alt="BuildFlow" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} />
            </div>
            {effectiveShowLabels && (
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: 0.05 }}
                style={{ display: "flex", flexDirection: "column" }}
              >
                <span style={{
                  fontSize: 18, fontWeight: 800, color: "#F0F2FF",
                  letterSpacing: "-0.5px", whiteSpace: "nowrap", lineHeight: 1.1,
                  fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
                }}>
                  Build<span style={{
                    background: "linear-gradient(135deg, #FFBF00 0%, #B87333 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}>Flow</span>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                  <span style={{
                    fontSize: 8, fontWeight: 600, letterSpacing: "2.5px",
                    textTransform: "uppercase" as const,
                    color: "rgba(184,115,51,0.25)",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    {t("admin.badge")}
                  </span>
                  <Shield size={8} style={{ color: "rgba(0,245,255,0.4)" }} />
                </div>
              </motion.div>
            )}
          </Link>

          {isMobile ? (
            <button onClick={closeMobile} aria-label={t("admin.closeMenu")} className="sb-icon-btn">
              <X size={15} />
            </button>
          ) : effectiveShowLabels ? (
            <button
              onClick={() => { setCollapsed(true); setShowLabels(false); }}
              aria-label={t("admin.collapseSidebar")}
              className="sb-icon-btn"
            >
              <ChevronLeft size={13} />
            </button>
          ) : null}
        </div>

        {/* Blueprint divider */}
        <div className="sb-divider-blueprint" />

        {/* ── Nav ──────────────────────────────────────────────────────── */}
        <nav style={{
          flex: 1, display: "flex", flexDirection: "column",
          overflowY: "auto", position: "relative", zIndex: 1,
          padding: "2px 0",
        }}>
          {effectiveShowLabels && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="sb-section-label"
            >
              <span className="sb-section-tick" />
              {t("admin.sectionPlatform")}
            </motion.div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px" }}>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={t(item.labelKey)}
                  icon={item.icon}
                  isActive={isActive}
                  collapsed={isEffectivelyCollapsed}
                  showLabels={effectiveShowLabels}
                  onClick={() => { if (isMobile) setMobileOpen(false); }}
                />
              );
            })}
          </div>
        </nav>

        {/* ── Bottom section ───────────────────────────────────────────── */}
        {effectiveShowLabels && (
          <div style={{ marginTop: "auto", flexShrink: 0, position: "relative", zIndex: 1 }}>
            <div style={{
              height: 1,
              background: "linear-gradient(90deg, transparent 0%, rgba(184,115,51,0.12) 30%, rgba(255,191,0,0.12) 70%, transparent 100%)",
            }} />

            <div style={{ padding: "14px 12px 12px" }}>
              {/* Admin info card */}
              <div className="sb-user-card" style={{ borderRadius: 12 }}>
                <div style={{
                  position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                  width: 40, height: 40, borderRadius: "50%",
                  background: "radial-gradient(circle, rgba(0,245,255,0.1) 0%, transparent 70%)",
                  pointerEvents: "none",
                }} />
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "linear-gradient(135deg, rgba(0,245,255,0.2), rgba(184,115,51,0.2))",
                  border: "1px solid rgba(0,245,255,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative", zIndex: 1,
                }}>
                  <Shield size={14} style={{ color: "#00F5FF" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: "#E8ECF8",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    lineHeight: 1.3,
                  }}>
                    {t("admin.badge")}
                  </div>
                  <div style={{
                    fontSize: 10, color: "rgba(255,255,255,0.3)",
                    fontFamily: "var(--font-jetbrains), monospace",
                    lineHeight: 1.4,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {t("admin.platformManager")}
                  </div>
                </div>
              </div>

              {/* Logout */}
              <button
                onClick={handleLogout}
                style={{
                  display: "flex", alignItems: "center", gap: 6, marginTop: 8,
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  cursor: "pointer", transition: "all 0.15s ease",
                  fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.2)"; e.currentTarget.style.color = "#EF4444"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.3)"; }}
              >
                <LogOut size={11} />
                {t("admin.signOut")}
              </button>
            </div>
          </div>
        )}

        {/* Expand button (collapsed) */}
        {isEffectivelyCollapsed && (
          <div style={{ padding: 8, borderTop: "1px solid rgba(184,115,51,0.1)", flexShrink: 0, position: "relative", zIndex: 1 }}>
            <button
              onClick={() => { setCollapsed(false); setHoverExpanded(false); }}
              aria-label={t("admin.expandSidebar")}
              className="sb-icon-btn"
              style={{ width: "100%", justifyContent: "center", padding: "8px 0" }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </motion.aside>

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <div className="admin-main-content" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top header */}
        <header
          className="admin-header"
          style={{
            position: "sticky", top: 0, zIndex: 100,
            minHeight: 56, display: "flex", alignItems: "center",
            padding: "0 24px", gap: 16,
            background: "rgba(7,7,13,0.85)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderBottom: "1px solid rgba(184,115,51,0.06)",
          }}
        >
          {/* Breadcrumbs */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={`${i}-${crumb.href}`}>
                {i > 0 && (
                  <span style={{ color: "#2A3040", fontSize: 11 }}>/</span>
                )}
                <Link
                  href={crumb.href}
                  style={{
                    color: i === breadcrumbs.length - 1 ? "#F0F0F5" : "#556070",
                    fontSize: 12, fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
                    textDecoration: "none",
                    fontFamily: "var(--font-jetbrains), monospace",
                    letterSpacing: "0.02em",
                    ...(i === breadcrumbs.length - 1 ? {
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap" as const,
                      maxWidth: "40vw",
                    } : {}),
                  }}
                >
                  {crumb.label}
                </Link>
              </React.Fragment>
            ))}
          </div>

          {/* Language switcher */}
          <div className="admin-lang-switcher" style={{
            display: "flex", alignItems: "center",
            borderRadius: 20, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            flexShrink: 0,
          }}>
            <button onClick={() => setLocale("en")} style={{
              padding: "3px 10px", fontSize: 10, fontWeight: 600,
              border: "none", cursor: "pointer",
              background: locale === "en" ? "rgba(0,245,255,0.12)" : "transparent",
              color: locale === "en" ? "#00F5FF" : "rgba(255,255,255,0.3)",
              fontFamily: "var(--font-jetbrains), monospace",
              letterSpacing: "0.5px",
            }}>EN</button>
            <button onClick={() => setLocale("de")} style={{
              padding: "3px 10px", fontSize: 10, fontWeight: 600,
              border: "none", cursor: "pointer",
              background: locale === "de" ? "rgba(0,245,255,0.12)" : "transparent",
              color: locale === "de" ? "#00F5FF" : "rgba(255,255,255,0.3)",
              fontFamily: "var(--font-jetbrains), monospace",
              letterSpacing: "0.5px",
            }}>DE</button>
          </div>

          {/* Admin badge */}
          <span className="admin-badge-pill" style={{
            padding: "2px 8px", borderRadius: 20,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            color: "#B87333",
            border: "1px solid rgba(184,115,51,0.25)",
            background: "rgba(184,115,51,0.06)",
            fontFamily: "var(--font-jetbrains), monospace",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}>
            {t("admin.badge")}
          </span>

          {/* Shield avatar */}
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            border: "1px solid rgba(0,245,255,0.15)",
            background: "linear-gradient(135deg, rgba(0,245,255,0.08), rgba(184,115,51,0.05))",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Shield size={14} style={{ color: "#00F5FF" }} />
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflow: "auto", background: "#070809" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              style={{ minHeight: "100%" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .admin-header {
            padding: 0 12px 0 56px !important;
            min-height: 48px !important;
            gap: 8px !important;
          }
          .admin-header .admin-lang-switcher {
            display: none !important;
          }
          .admin-main-content {
            max-width: 100vw;
          }
        }
        @media (max-width: 480px) {
          .admin-header {
            padding: 0 8px 0 56px !important;
            gap: 6px !important;
          }
          .admin-badge-pill {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
