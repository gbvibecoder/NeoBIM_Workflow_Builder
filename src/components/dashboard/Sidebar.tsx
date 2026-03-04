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
} from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";

// ─── Nav items ───────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: "/dashboard",            label: "Dashboard",   icon: LayoutDashboard, exact: true },
  { href: "/dashboard/workflows",  label: "My Workflows",icon: Workflow },
  { href: "/dashboard/history",    label: "History",     icon: History },
  { href: "/dashboard/templates",  label: "Templates",   icon: BookOpen,  badge: String(PREBUILT_WORKFLOWS.length) },
  { href: "/dashboard/community",  label: "Community",   icon: Globe },
  { href: "/dashboard/settings",   label: "Settings",    icon: Settings },
];

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname    = usePathname();
  const { data: session } = useSession();
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
      animate={{ width: collapsed ? 48 : 220 }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#07070D",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* ── Logo row ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: collapsed ? "center" : "space-between",
        padding: collapsed ? "12px 0" : "12px 16px 12px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        minHeight: 52, flexShrink: 0,
      }}>
        <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", overflow: "hidden" }}>
          {/* Logo icon */}
          <div style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(79,138,255,0.25)",
          }}>
            <Zap size={14} color="white" fill="white" />
          </div>

          {showLabels && (
            <span style={{
              fontSize: 15, fontWeight: 700, color: "#F0F0F5",
              letterSpacing: "-0.3px", whiteSpace: "nowrap",
            }}>
              Neo<span style={{ color: "#4F8AFF" }}>BIM</span>
            </span>
          )}
        </Link>

        {/* Collapse button — visible only when expanded */}
        {showLabels && (
          <button
            onClick={() => { setCollapsed(true); setShowLabels(false); }}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            style={{
              width: 20, height: 20, borderRadius: 4, border: "none",
              background: "transparent", cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#2E2E40", transition: "color 0.1s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#8888A0"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#2E2E40"; }}
          >
            <ChevronLeft size={13} />
          </button>
        )}
      </div>

      {/* ── New Workflow button ───────────────────────────────────────────── */}
      <div style={{ padding: collapsed ? "10px 8px" : "10px 10px", flexShrink: 0 }}>
        <Link
          href="/dashboard/workflows/new"
          style={{
            display: "flex", alignItems: "center",
            justifyContent: "center", gap: 6,
            padding: collapsed ? "8px" : "7px 12px",
            borderRadius: 8,
            background: "linear-gradient(135deg, #4F8AFF 0%, #6D6AF6 100%)",
            color: "white", fontWeight: 600, fontSize: 12,
            textDecoration: "none",
            boxShadow: "0 2px 10px rgba(79,138,255,0.28)",
            transition: "opacity 0.15s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
        >
          <Plus size={13} strokeWidth={2.5} style={{ flexShrink: 0 }} />
          {showLabels && <span>New Workflow</span>}
        </Link>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav aria-label="Main navigation" style={{ flex: 1, padding: "4px 8px", display: "flex", flexDirection: "column", gap: 1, overflowY: "auto" }}>
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
        <div style={{ padding: "10px 10px 12px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          {session?.user ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* User row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: "#fff",
                  overflow: "hidden",
                }}>
                  {session.user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.user.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    (session.user.name ?? session.user.email ?? "U")[0].toUpperCase()
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#E0E0EA", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session.user.name ?? "User"}
                  </div>
                  <div style={{ fontSize: 10, color: "#55556A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session.user.email}
                  </div>
                </div>
              </div>

              {/* Upgrade + Sign out row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Link
                  href="/dashboard/settings"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "#4F8AFF", textDecoration: "none" }}
                >
                  <TrendingUp size={9} />
                  Upgrade
                </Link>

                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 10, color: "#55556A", background: "none", border: "none",
                    cursor: "pointer", padding: 0, transition: "color 0.1s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#EF4444"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#55556A"; }}
                >
                  <LogOut size={10} />
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <Link
              href="/login"
              style={{ display: "block", textAlign: "center", fontSize: 11, color: "#4F8AFF", textDecoration: "none" }}
            >
              Sign in
            </Link>
          )}
        </div>
      )}

      {/* ── Expand button (collapsed state footer) ───────────────────────── */}
      {collapsed && (
        <div style={{ padding: "8px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <button
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
              padding: "8px 0", borderRadius: 8, border: "none",
              background: "transparent", cursor: "pointer",
              color: "#2E2E40", transition: "color 0.1s, background 0.1s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = "#8888A0";
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

  const activeBg   = "rgba(79,138,255,0.08)";
  const hoverBg    = "rgba(255,255,255,0.04)";
  const borderBar  = isActive ? "#4F8AFF" : "transparent";

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
        gap: 9,
        padding: collapsed ? "9px 0" : "8px 10px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 8,
        /* Active 3-px left bar */
        borderLeft: `3px solid ${borderBar}`,
        /* Subtle bg for active / hovered */
        background: isActive ? activeBg : (hovered ? hoverBg : "transparent"),
        textDecoration: "none",
        transition: "background 0.1s",
        overflow: "hidden",
      }}
    >
      {icon}

      {showLabels && (
        <>
          <span style={{
            flex: 1,
            fontSize: 13,
            fontWeight: isActive ? 600 : 400,
            color: isActive ? "#F0F0F5" : "#9898B0",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 0.12s",
          }}>
            {label}
          </span>

          {badge && (
            <span style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 6, flexShrink: 0,
              background: "rgba(139, 92, 246, 0.12)", color: "#A78BFA", fontWeight: 600,
            }}>
              {badge}
            </span>
          )}
        </>
      )}
    </Link>
  );
}
