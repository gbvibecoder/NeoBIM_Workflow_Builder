"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useLocale } from "@/hooks/useLocale";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { t } = useLocale();
  const pathname    = usePathname();
  const { data: session } = useSession();

  const NAV_ITEMS = [
    { href: "/dashboard",            label: t('nav.dashboard'),    icon: LayoutDashboard, exact: true },
    { href: "/dashboard/workflows",  label: t('nav.myWorkflows'),  icon: Workflow },
    { href: "/dashboard/history",    label: t('nav.history'),      icon: History },
    { href: "/dashboard/analytics",  label: t('nav.analytics'),    icon: BarChart3 },
    { href: "/dashboard/templates",  label: t('nav.templates'),    icon: BookOpen,  badge: String(PREBUILT_WORKFLOWS.length) },
    { href: "/dashboard/community",  label: t('nav.community'),    icon: Globe },
    { href: "/dashboard/billing",    label: t('nav.billing'),      icon: CreditCard },
    { href: "/dashboard/settings",   label: t('nav.settings'),     icon: Settings },
  ];
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 769);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [pathname, isMobile]);

  // Close on ESC
  useEffect(() => {
    if (!mobileOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [mobileOpen]);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Delay label appearance on expand so the sidebar opens first
  const [showLabels, setShowLabels] = useState(true);
  useEffect(() => {
    if (!collapsed) {
      const t = setTimeout(() => setShowLabels(true), 130);
      return () => clearTimeout(t);
    }
  }, [collapsed]);

  return (
    <>
      {/* Mobile hamburger button */}
      {isMobile && !mobileOpen && (
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          style={{
            position: "fixed",
            top: 12,
            left: 12,
            zIndex: 9001,
            width: 44,
            height: 44,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(8,10,15,0.95)",
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9898B0",
            cursor: "pointer",
          }}
        >
          <Menu size={20} />
        </button>
      )}

      {/* Mobile overlay */}
      {isMobile && mobileOpen && (
        <div
          className="sidebar-overlay sidebar-overlay-visible"
          onClick={closeMobile}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 8999,
          }}
        />
      )}

    <motion.aside
      animate={{ width: isMobile ? 280 : (collapsed ? 56 : 232) }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      className={`sidebar-desktop ${isMobile && mobileOpen ? "sidebar-open" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#080A0F",
        borderRight: "1px solid rgba(255,255,255,0.05)",
        overflow: "hidden",
        flexShrink: 0,
        position: isMobile ? "fixed" : "relative",
        zIndex: isMobile ? 9000 : undefined,
        top: isMobile ? 0 : undefined,
        left: isMobile ? 0 : undefined,
        bottom: isMobile ? 0 : undefined,
        transform: isMobile && !mobileOpen ? "translateX(-100%)" : "translateX(0)",
        transition: isMobile ? "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)" : undefined,
        boxShadow: isMobile && mobileOpen ? "16px 0 48px rgba(0,0,0,0.5)" : undefined,
      }}
    >
      {/* ── Logo row ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: collapsed ? "center" : "space-between",
        padding: collapsed ? "14px 0" : "14px 18px 14px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        minHeight: 56, flexShrink: 0, position: "relative",
      }}>
        <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", overflow: "hidden" }}>
          {/* Logo icon */}
          <div style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
            background: "linear-gradient(135deg, #4F8AFF 0%, #7C6FF7 50%, #6366F1 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(79,138,255,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
            padding: 4,
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="BuildFlow" style={{ width: 20, height: 20, filter: "brightness(0) invert(1)" }} />
          </div>

          {showLabels && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{
                fontSize: 19, fontWeight: 800, color: "#F0F0F5",
                letterSpacing: "-0.4px", whiteSpace: "nowrap", lineHeight: 1.1,
              }}>
                Build<span style={{ color: "#4F8AFF" }}>Flow</span>
              </span>
              <span style={{
                fontSize: 7, fontWeight: 700, letterSpacing: "2px",
                textTransform: "uppercase" as const,
                color: "#3A3A50",
                fontFamily: "var(--font-jetbrains), monospace",
                marginTop: 1,
              }}>
                PARAMETRIC BLUEPRINT
              </span>
            </div>
          )}
        </Link>

        {/* Close button on mobile, collapse button on desktop */}
        {isMobile ? (
          <button
            onClick={closeMobile}
            aria-label="Close menu"
            style={{
              width: 32, height: 32, borderRadius: 8, border: "none",
              background: "rgba(255,255,255,0.04)", cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#9898B0", transition: "all 0.15s",
            }}
          >
            <X size={16} />
          </button>
        ) : showLabels ? (
          <button
            onClick={() => { setCollapsed(true); setShowLabels(false); }}
            title={t('nav.collapseSidebar')}
            aria-label={t('nav.collapseSidebar')}
            style={{
              width: 22, height: 22, borderRadius: 6, border: "none",
              background: "transparent", cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#2E2E40", transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#9898B0"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#2E2E40"; e.currentTarget.style.background = "transparent"; }}
          >
            <ChevronLeft size={13} />
          </button>
        ) : null}
      </div>

      {/* ── New Workflow button ───────────────────────────────────────────── */}
      <div style={{ padding: collapsed ? "12px 10px" : "12px 12px", flexShrink: 0, position: "relative" }}>
        <Link
          href="/dashboard/workflows/new"
          className="press-effect"
          style={{
            display: "flex", alignItems: "center",
            justifyContent: "center", gap: 7,
            padding: collapsed ? "9px" : "0",
            height: 40,
            borderRadius: 10,
            background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "white", fontWeight: 600, fontSize: 13,
            textDecoration: "none",
            boxShadow: "0 1px 3px rgba(79,138,255,0.3), 0 4px 12px rgba(79,138,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)",
            fontFamily: "var(--font-jetbrains), monospace",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            transition: "all 200ms ease",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(79,138,255,0.4), 0 4px 16px rgba(79,138,255,0.25)";
            (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(79,138,255,0.3), 0 4px 12px rgba(79,138,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)";
            (e.currentTarget as HTMLElement).style.filter = "brightness(1)";
          }}
        >
          <Plus size={14} strokeWidth={2.5} style={{ flexShrink: 0 }} />
          {showLabels && <span>{t('nav.newWorkflow')}</span>}
        </Link>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav aria-label="Main navigation" style={{ flex: 1, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", position: "relative" }}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              badge={item.badge}
              icon={Icon}
              isActive={isActive}
              collapsed={collapsed}
              showLabels={showLabels}
            />
          );
        })}
      </nav>

      {/* ── User info + sign out ─────────────────────────────────────────── */}
      {showLabels && (
        <div style={{ padding: "12px 16px 14px", borderTop: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }}>
          {session?.user ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* User row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  background: "linear-gradient(135deg, #4F8AFF 0%, #7C6FF7 50%, #6366F1 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, color: "#fff",
                  overflow: "hidden",
                  boxShadow: "0 2px 8px rgba(79,138,255,0.2)",
                }}>
                  {session.user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.user.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    (session.user.name ?? session.user.email ?? "U")[0].toUpperCase()
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "#F0F0F5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session.user.name ?? "User"}
                  </div>
                  <div style={{ fontSize: 10, color: "#5C5C78", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session.user.email}
                  </div>
                </div>
              </div>

              {/* Language switcher */}
              <LanguageSwitcher />

              {/* Upgrade + Sign out row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Link
                  href="/dashboard/billing"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 10.5, fontWeight: 600, color: "#4F8AFF", textDecoration: "none",
                    padding: "3px 8px", borderRadius: 6,
                    background: "rgba(79,138,255,0.06)", border: "1px solid rgba(79,138,255,0.15)",
                    fontFamily: "var(--font-jetbrains), monospace",
                    letterSpacing: "0.03em",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(79,138,255,0.12)"; e.currentTarget.style.borderColor = "rgba(79,138,255,0.3)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(79,138,255,0.06)"; e.currentTarget.style.borderColor = "rgba(79,138,255,0.15)"; }}
                >
                  <TrendingUp size={10} />
                  {t('nav.upgrade')}
                </Link>

                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 10.5, color: "#55556A", background: "none", border: "none",
                    cursor: "pointer", padding: "3px 6px", borderRadius: 6,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#EF4444"; e.currentTarget.style.background = "rgba(239,68,68,0.06)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#55556A"; e.currentTarget.style.background = "transparent"; }}
                >
                  <LogOut size={10} />
                  {t('nav.signOut')}
                </button>
              </div>
            </div>
          ) : (
            <Link
              href="/login"
              style={{ display: "block", textAlign: "center", fontSize: 12, color: "#4F8AFF", textDecoration: "none", padding: "6px", borderRadius: 8 }}
            >
              {t('nav.signIn')}
            </Link>
          )}
        </div>
      )}

      {/* ── Expand button (collapsed state footer) ───────────────────────── */}
      {collapsed && (
        <div style={{ padding: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <button
            onClick={() => setCollapsed(false)}
            title={t('nav.expandSidebar')}
            aria-label={t('nav.expandSidebar')}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
              padding: "8px 0", borderRadius: 8, border: "none",
              background: "transparent", cursor: "pointer",
              color: "#2E2E40",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = "#9898B0";
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = "#2E2E40";
              e.currentTarget.style.background = "transparent";
            }}
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
}

function NavItem({ href, label, badge, icon: Icon, isActive, collapsed, showLabels }: NavItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={isActive ? "page" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 38,
        padding: collapsed ? "10px 0" : "0 12px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 8,
        background: isActive
          ? "rgba(79,138,255,0.06)"
          : (hovered ? "rgba(255,255,255,0.03)" : "transparent"),
        textDecoration: "none",
        transition: "all 150ms ease",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Active left bar indicator */}
      {isActive && !collapsed && (
        <div style={{
          position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
          width: 3, height: 20,
          background: "#4F8AFF",
          boxShadow: "0 0 8px rgba(79,138,255,0.4)",
          borderTopRightRadius: 9999,
          borderBottomRightRadius: 9999,
          pointerEvents: "none",
        }} />
      )}

      {/* Icon with blue background when active */}
      <span style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: isActive ? 28 : "auto",
        height: isActive ? 28 : "auto",
        borderRadius: isActive ? 7 : 0,
        background: isActive ? "rgba(27,79,255,0.2)" : "transparent",
        flexShrink: 0,
        transition: "all 0.15s ease",
      }}>
        <Icon
          size={isActive ? 14 : 18}
          strokeWidth={isActive ? 2.2 : 1.5}
          style={{
            color: isActive ? "#fff" : "#5C5C78",
            flexShrink: 0,
            transition: "color 0.12s",
          }}
        />
      </span>

      {showLabels && (
        <>
          <span style={{
            flex: 1,
            fontSize: 12.5,
            fontWeight: isActive ? 600 : 400,
            color: isActive ? "#e2e8f0" : (hovered ? "#94a3b8" : "#5C5C78"),
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 0.15s ease, transform 0.15s ease",
            letterSpacing: "0.01em",
            transform: hovered && !isActive ? "translateX(2px)" : "translateX(0)",
          }}>
            {label}
          </span>

          {badge && (
            <span style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 6, flexShrink: 0,
              background: "rgba(139,92,246,0.15)",
              color: "#A78BFA", fontWeight: 600,
            }}>
              {badge}
            </span>
          )}
        </>
      )}
    </Link>
  );
}
