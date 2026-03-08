"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Workflow,
  Globe,
  BookOpen,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  LogOut,
  History,
  CreditCard,
  BarChart3,
  Menu,
  X,
  Sparkles,
  Crown,
  FlaskConical,
} from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useLocale } from "@/hooks/useLocale";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { t } = useLocale();
  const pathname = usePathname();
  const { data: session } = useSession();

  const PRIMARY_NAV = [
    { href: "/dashboard",           label: t("nav.dashboard"),   icon: LayoutDashboard, exact: true },
    { href: "/dashboard/workflows", label: t("nav.myWorkflows"), icon: Workflow },
    { href: "/dashboard/history",   label: t("nav.history"),     icon: History },
    { href: "/dashboard/analytics", label: t("nav.analytics"),   icon: BarChart3 },
    { href: "/dashboard/templates", label: t("nav.templates"),   icon: BookOpen, badge: String(PREBUILT_WORKFLOWS.length) },
  ];

  const SECONDARY_NAV = [
    { href: "/dashboard/community", label: t("nav.community"), icon: Globe, badge: "Beta" },
    { href: "/dashboard/billing",   label: t("nav.billing"),   icon: CreditCard },
    { href: "/dashboard/settings",  label: t("nav.settings"),  icon: Settings },
    ...(process.env.NODE_ENV === "development"
      ? [{ href: "/dashboard/test-results", label: "Test Suite", icon: FlaskConical }]
      : []),
  ];

  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [newBtnHover, setNewBtnHover] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!mobileOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [mobileOpen]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const [showLabels, setShowLabels] = useState(false);
  useEffect(() => {
    if (!collapsed || hoverExpanded) {
      const timer = setTimeout(() => setShowLabels(true), 80);
      return () => clearTimeout(timer);
    } else {
      setShowLabels(false);
    }
  }, [collapsed, hoverExpanded]);

  const isEffectivelyCollapsed = collapsed && !hoverExpanded;
  const sidebarWidth = isMobile ? 272 : isEffectivelyCollapsed ? 56 : 248;

  const handleSidebarEnter = useCallback(() => {
    if (!collapsed || isMobile) return;
    hoverTimerRef.current = setTimeout(() => setHoverExpanded(true), 150);
  }, [collapsed, isMobile]);

  const handleSidebarLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverExpanded(false);
  }, []);

  // Compute showLabels from effective collapse state
  const effectiveShowLabels = !isEffectivelyCollapsed && showLabels;

  return (
    <>
      {/* ── Mobile hamburger ─────────────────────────────────────────── */}
      {isMobile && !mobileOpen && (
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
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

      {/* ── Mobile overlay ───────────────────────────────────────────── */}
      <AnimatePresence>
        {isMobile && mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeMobile}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)",
              zIndex: 8999,
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <motion.aside
        initial={!isMobile ? { x: -16, opacity: 0 } : false}
        animate={{ width: sidebarWidth, x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={handleSidebarLeave}
        className={`sidebar-desktop ${isMobile && mobileOpen ? "sidebar-open" : ""}`}
        style={{
          display: "flex", flexDirection: "column",
          height: "100%",
          overflow: "hidden", flexShrink: 0,
          position: isMobile ? "fixed" : "relative",
          zIndex: isMobile ? 9000 : 1,
          top: isMobile ? 0 : undefined,
          left: isMobile ? 0 : undefined,
          bottom: isMobile ? 0 : undefined,
          transform: isMobile && !mobileOpen ? "translateX(-100%)" : "translateX(0)",
          transition: isMobile ? "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : undefined,
          boxShadow: isMobile && mobileOpen ? "20px 0 60px rgba(0,0,0,0.6)" : undefined,
          background: "#070809",
          borderRight: "1px solid rgba(184,115,51,0.15)",
        }}
      >
        {/* Ambient background layers */}
        <div className="sb-ambient" />
        <div className="sb-scanline" />

        {/* Right edge glow line */}
        <div style={{
          position: "absolute", top: "15%", right: 0, height: "70%", width: 1,
          background: "linear-gradient(180deg, transparent 0%, rgba(184,115,51,0.15) 30%, rgba(184,115,51,0.25) 50%, rgba(184,115,51,0.15) 70%, transparent 100%)",
          pointerEvents: "none", zIndex: 2,
        }} />

        {/* ── Logo ─────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: isEffectivelyCollapsed ? "center" : "space-between",
          padding: isEffectivelyCollapsed ? "18px 0" : "20px 16px 18px 18px",
          minHeight: 72, flexShrink: 0, position: "relative", zIndex: 1,
        }}>
          <Link href="/dashboard" className="sb-logo-link" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none", overflow: "hidden" }}>
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
                <span style={{
                  fontSize: 8, fontWeight: 600, letterSpacing: "2.5px",
                  textTransform: "uppercase" as const,
                  color: "rgba(184,115,51,0.25)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  marginTop: 3,
                }}>
                  PARAMETRIC BLUEPRINT
                </span>
              </motion.div>
            )}
          </Link>

          {isMobile ? (
            <button onClick={closeMobile} aria-label="Close menu" className="sb-icon-btn">
              <X size={15} />
            </button>
          ) : effectiveShowLabels ? (
            <button
              onClick={() => { setCollapsed(true); setShowLabels(false); }}
              title={t("nav.collapseSidebar")}
              aria-label={t("nav.collapseSidebar")}
              className="sb-icon-btn"
            >
              <ChevronLeft size={13} />
            </button>
          ) : null}
        </div>

        {/* Divider with blueprint ticks */}
        <div className="sb-divider-blueprint" />

        {/* ── New Workflow ────────────────────────────────────────── */}
        <div style={{ padding: isEffectivelyCollapsed ? "14px 8px" : "14px 14px", flexShrink: 0, position: "relative", zIndex: 1 }}>
          <motion.div whileHover={{ scale: 1.015, y: -1 }} whileTap={{ scale: 0.975 }}>
            <Link
              href="/dashboard/workflows/new"
              onMouseEnter={() => setNewBtnHover(true)}
              onMouseLeave={() => setNewBtnHover(false)}
              className="sb-new-btn"
              style={{
                display: "flex", alignItems: "center",
                justifyContent: "center", gap: 8,
                padding: isEffectivelyCollapsed ? "10px" : "10px 16px",
                borderRadius: 10,
                textDecoration: "none",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: 12.5, fontWeight: 600, letterSpacing: "0.3px",
                color: "#00F5FF",
                whiteSpace: "nowrap",
              }}
            >
              <Plus
                size={15} strokeWidth={2.5}
                style={{
                  flexShrink: 0,
                  transition: "transform 250ms cubic-bezier(0.34,1.56,0.64,1)",
                  transform: newBtnHover ? "rotate(90deg)" : "rotate(0deg)",
                }}
              />
              {effectiveShowLabels && <span>{t("nav.newWorkflow")}</span>}
            </Link>
          </motion.div>
        </div>

        {/* ── Nav ─────────────────────────────────────────────────── */}
        <nav
          aria-label="Main navigation"
          style={{
            flex: 1, display: "flex", flexDirection: "column",
            overflowY: "auto", position: "relative", zIndex: 1,
            padding: "2px 0",
          }}
        >
          {/* Section label */}
          {effectiveShowLabels && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="sb-section-label"
            >
              <span className="sb-section-tick" />
              MAIN
            </motion.div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px" }}>
            {PRIMARY_NAV.map((item, idx) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <NavItem
                  key={item.href} href={item.href}
                  label={item.label} badge={item.badge} icon={item.icon}
                  isActive={isActive} collapsed={isEffectivelyCollapsed}
                  showLabels={effectiveShowLabels} index={idx}
                />
              );
            })}
          </div>

          {/* Blueprint divider */}
          <div className="sb-divider-subtle" />

          {/* Section label */}
          {effectiveShowLabels && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="sb-section-label"
            >
              <span className="sb-section-tick" />
              MORE
            </motion.div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px" }}>
            {SECONDARY_NAV.map((item, idx) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <NavItem
                  key={item.href} href={item.href}
                  label={item.label} badge={(item as { badge?: string }).badge} icon={item.icon}
                  isActive={isActive} collapsed={isEffectivelyCollapsed}
                  showLabels={effectiveShowLabels} index={idx + PRIMARY_NAV.length}
                />
              );
            })}
          </div>
        </nav>

        {/* ── Bottom user section ─────────────────────────────────── */}
        {effectiveShowLabels && (
          <div style={{ marginTop: "auto", flexShrink: 0, position: "relative", zIndex: 1 }}>
            {/* Top border gradient */}
            <div style={{
              height: 1,
              background: "linear-gradient(90deg, transparent 0%, rgba(184,115,51,0.12) 30%, rgba(255,191,0,0.12) 70%, transparent 100%)",
            }} />

            <div style={{ padding: "14px 12px 12px" }}>
              {session?.user ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* User card */}
                  <div className="sb-user-card">
                    {/* Ambient glow behind avatar */}
                    <div style={{
                      position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                      width: 40, height: 40, borderRadius: "50%",
                      background: "radial-gradient(circle, rgba(184,115,51,0.15) 0%, transparent 70%)",
                      pointerEvents: "none",
                    }} />

                    {/* Avatar */}
                    <div className="sb-avatar">
                      {session.user.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={session.user.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span>{(session.user.name ?? session.user.email ?? "U")[0].toUpperCase()}</span>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600, color: "#E4E8F8",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        lineHeight: 1.3,
                      }}>
                        {session.user.name ?? "User"}
                      </div>
                      <div style={{
                        fontSize: 10.5, color: "rgba(255,255,255,0.25)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        fontFamily: "var(--font-jetbrains), monospace",
                        lineHeight: 1.4,
                      }}>
                        {session.user.email}
                      </div>
                    </div>
                  </div>

                  {/* Language */}
                  <LanguageSwitcher />

                  {/* Upgrade */}
                  <Link href="/dashboard/billing" className="sb-upgrade-btn" style={{ textDecoration: "none" }}>
                    <span className="sb-upgrade-shimmer" />
                    <Crown size={12} style={{ position: "relative", zIndex: 1 }} />
                    <span style={{ position: "relative", zIndex: 1 }}>{t("nav.upgrade")}</span>
                  </Link>

                  {/* Sign out */}
                  <button onClick={() => signOut({ callbackUrl: "/login" })} className="sb-signout-btn">
                    <LogOut size={11} />
                    {t("nav.signOut")}
                  </button>
                </div>
              ) : (
                <Link href="/login" style={{ display: "block", textAlign: "center", fontSize: 12, color: "#5B9AFF", textDecoration: "none", padding: 8, borderRadius: 8 }}>
                  {t("nav.signIn")}
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ── Expand button (collapsed) ───────────────────────────── */}
        {isEffectivelyCollapsed && (
          <div style={{ padding: 8, borderTop: "1px solid rgba(184,115,51,0.1)", flexShrink: 0, position: "relative", zIndex: 1 }}>
            <button
              onClick={() => { setCollapsed(false); setHoverExpanded(false); }}
              title={t("nav.expandSidebar")}
              aria-label={t("nav.expandSidebar")}
              className="sb-icon-btn"
              style={{ width: "100%", justifyContent: "center", padding: "8px 0" }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </motion.aside>
    </>
  );
}

// ─── NavItem ─────────────────────────────────────────────────────────────────

interface NavItemProps {
  href: string;
  label: string;
  badge?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>;
  isActive: boolean;
  collapsed: boolean;
  showLabels: boolean;
  index: number;
}

function NavItem({ href, label, badge, icon: Icon, isActive, collapsed, showLabels, index }: NavItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.12 + index * 0.04, duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
    >
      <Link
        href={href}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
        aria-current={isActive ? "page" : undefined}
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

        {/* Left accent */}
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

        {/* Icon container */}
        <span className={`sb-icon-wrap ${isActive ? "sb-icon-active" : ""}`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: isActive ? 30 : 22,
            height: isActive ? 30 : 22,
            borderRadius: isActive ? 8 : 6,
            flexShrink: 0,
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
          <>
            <span style={{
              flex: 1,
              fontSize: 13,
              fontWeight: isActive ? 600 : 450,
              color: isActive ? "#E2E8F0" : (hovered ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)"),
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              transition: "all 200ms ease",
              letterSpacing: isActive ? "0.2px" : "0.1px",
              position: "relative",
            }}>
              {label}
            </span>

            {badge && (
              <span className="sb-badge">
                {badge}
              </span>
            )}
          </>
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
    </motion.div>
  );
}
