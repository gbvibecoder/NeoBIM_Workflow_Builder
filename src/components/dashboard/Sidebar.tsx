"use client";

import React, { useState, useEffect } from "react";
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
  Zap,
  Plus,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  LogOut,
  History,
  CreditCard,
  BarChart3,
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

  // Delay label appearance on expand so the sidebar opens first
  const [showLabels, setShowLabels] = useState(true);
  useEffect(() => {
    if (!collapsed) {
      const t = setTimeout(() => setShowLabels(true), 130);
      return () => clearTimeout(t);
    }
  }, [collapsed]);

  return (
    <motion.aside
      animate={{ width: collapsed ? 56 : 232 }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#06060c",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
      }}
    >
      {/* Subtle atmospheric glow at top */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 120,
        background: "radial-gradient(ellipse at 50% -20%, rgba(79, 138, 255, 0.04), transparent 70%)",
        pointerEvents: "none",
      }} />

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
            background: "linear-gradient(135deg, #4F8AFF 0%, #7C6FF7 50%, #A78BFA 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 12px rgba(79,138,255,0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}>
            <Zap size={14} color="white" fill="white" />
          </div>

          {showLabels && (
            <span style={{
              fontSize: 16, fontWeight: 700, color: "#F0F0F5",
              letterSpacing: "-0.4px", whiteSpace: "nowrap",
            }}>
              Build<span style={{ color: "#4F8AFF" }}>Flow</span>
            </span>
          )}
        </Link>

        {/* Collapse button */}
        {showLabels && (
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
        )}
      </div>

      {/* ── New Workflow button ───────────────────────────────────────────── */}
      <div style={{ padding: collapsed ? "12px 10px" : "12px 12px", flexShrink: 0 }}>
        <Link
          href="/dashboard/workflows/new"
          className="press-effect"
          style={{
            display: "flex", alignItems: "center",
            justifyContent: "center", gap: 7,
            padding: collapsed ? "9px" : "0",
            height: 40,
            borderRadius: 10,
            background: "linear-gradient(to right, #4F8AFF, #6366F1)",
            color: "white", fontWeight: 600, fontSize: 14,
            textDecoration: "none",
            boxShadow: "0 2px 16px rgba(79,138,255,0.25)",
            whiteSpace: "nowrap",
            transition: "all 200ms ease",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 24px rgba(79,138,255,0.4)";
            (e.currentTarget as HTMLElement).style.filter = "brightness(1.1)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 16px rgba(79,138,255,0.25)";
            (e.currentTarget as HTMLElement).style.filter = "brightness(1)";
          }}
        >
          <Plus size={14} strokeWidth={2.5} style={{ flexShrink: 0 }} />
          {showLabels && <span>{t('nav.newWorkflow')}</span>}
        </Link>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav aria-label="Main navigation" style={{ flex: 1, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
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
              icon={<Icon size={18} strokeWidth={isActive ? 2 : 1.5} style={{ color: isActive ? "#4F8AFF" : "#5C5C78", flexShrink: 0, transition: "color 0.12s" }} />}
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
                  background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 100%)",
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
                    background: "rgba(79,138,255,0.06)", border: "1px solid rgba(79,138,255,0.12)",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(79,138,255,0.12)"; e.currentTarget.style.borderColor = "rgba(79,138,255,0.25)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(79,138,255,0.06)"; e.currentTarget.style.borderColor = "rgba(79,138,255,0.12)"; }}
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
  );
}

// ─── NavItem ─────────────────────────────────────────────────────────────────

interface NavItemProps {
  href: string;
  label: string;
  badge?: string;
  icon: React.ReactNode;
  isActive: boolean;
  collapsed: boolean;
  showLabels: boolean;
}

function NavItem({ href, label, badge, icon, isActive, collapsed, showLabels }: NavItemProps) {
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
          ? "rgba(255,255,255,0.06)"
          : (hovered ? "rgba(255,255,255,0.04)" : "transparent"),
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
          borderTopRightRadius: 9999,
          borderBottomRightRadius: 9999,
          pointerEvents: "none",
        }} />
      )}

      <span style={{ position: "relative", display: "flex" }}>{icon}</span>

      {showLabels && (
        <>
          <span style={{
            flex: 1,
            fontSize: 13,
            fontWeight: isActive ? 600 : 400,
            color: isActive ? "#F0F0F5" : (hovered ? "#9898B0" : "#5C5C78"),
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 0.15s ease",
            letterSpacing: "-0.01em",
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
