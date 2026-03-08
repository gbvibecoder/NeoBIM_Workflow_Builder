"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useSession } from "next-auth/react";
import {
  LayoutDashboard,
  Workflow,
  History,
  BarChart3,
  BookOpen,
  Globe,
  CreditCard,
  Settings,
  Plus,
} from "lucide-react";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { useLocale } from "@/hooks/useLocale";

const NAV_CONFIG = [
  { href: "/dashboard",            icon: LayoutDashboard, labelKey: "nav.dashboard",   exact: true },
  { href: "/dashboard/workflows",  icon: Workflow,        labelKey: "nav.myWorkflows" },
  { href: "/dashboard/history",    icon: History,         labelKey: "nav.history" },
  { href: "/dashboard/analytics",  icon: BarChart3,       labelKey: "nav.analytics" },
  { href: "/dashboard/templates",  icon: BookOpen,        labelKey: "nav.templates",  badge: String(PREBUILT_WORKFLOWS.length) },
  { href: "/dashboard/community",  icon: Globe,           labelKey: "nav.community" },
  { href: "/dashboard/billing",    icon: CreditCard,      labelKey: "nav.billing" },
  { href: "/dashboard/settings",   icon: Settings,        labelKey: "nav.settings" },
];

export function FloatingNav() {
  const { t } = useLocale();
  const pathname = usePathname();
  const { data: session } = useSession();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, type: "spring", stiffness: 200, damping: 20 }}
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "6px 8px",
        borderRadius: 100,
        background: "rgba(10, 12, 20, 0.75)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: `1px solid ${scrolled ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.08)"}`,
        boxShadow: scrolled
          ? "0 12px 40px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.05) inset, 0 0 0 1px rgba(0,0,0,0.2)"
          : "0 8px 32px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05) inset, 0 0 0 1px rgba(0,0,0,0.2)",
        transition: "border-color 300ms ease, box-shadow 300ms ease",
      }}
    >
      {/* Logo mark */}
      <Link
        href="/dashboard"
        style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          overflow: "hidden",
          marginRight: 4,
          textDecoration: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/buildflow_logo.png" alt="BuildFlow" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </Link>

      {/* Nav items */}
      {NAV_CONFIG.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const Icon = item.icon;
        const label = t(item.labelKey as Parameters<typeof t>[0]);

        return (
          <FloatingNavItem
            key={item.href}
            href={item.href}
            icon={Icon}
            label={label}
            isActive={isActive}
            badge={item.badge}
          />
        );
      })}

      {/* User avatar */}
      <Link
        href="/dashboard/settings"
        style={{
          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, #1B4FFF, #8B5CF6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 700, color: "#fff",
          marginLeft: 4,
          textDecoration: "none",
          overflow: "hidden",
        }}
      >
        {session?.user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          (session?.user?.name ?? session?.user?.email ?? "U")[0].toUpperCase()
        )}
      </Link>

      {/* + New button */}
      <Link
        href="/dashboard/workflows/new"
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "6px 12px",
          borderRadius: 100,
          background: "linear-gradient(135deg, #1B4FFF 0%, #0EA5E9 100%)",
          color: "white", fontWeight: 600, fontSize: 12,
          textDecoration: "none",
          marginLeft: 2,
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(27,79,255,0.3)",
          transition: "all 200ms ease",
        }}
      >
        <Plus size={13} strokeWidth={2.5} />
        <span>New</span>
      </Link>
    </motion.nav>
  );
}

// ─── FloatingNavItem ─────────────────────────────────────────────────────────

interface FloatingNavItemProps {
  href: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  isActive: boolean;
  badge?: string;
}

function FloatingNavItem({ href, icon: Icon, label, isActive, badge }: FloatingNavItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      title={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "8px 14px",
        borderRadius: 100,
        background: isActive
          ? "rgba(27,79,255,0.15)"
          : (hovered ? "rgba(255,255,255,0.06)" : "transparent"),
        border: isActive ? "1px solid rgba(27,79,255,0.25)" : "1px solid transparent",
        textDecoration: "none",
        transition: "all 180ms ease",
        position: "relative",
      }}
    >
      <Icon
        size={16}
        style={{
          color: isActive ? "#4F8AFF" : (hovered ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.45)"),
          transition: "color 180ms ease",
          flexShrink: 0,
        }}
      />
      {isActive && (
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: "white",
          whiteSpace: "nowrap",
        }}>
          {label}
        </span>
      )}
      {badge && !isActive && (
        <span style={{
          position: "absolute",
          top: 4, right: 8,
          width: 6, height: 6,
          borderRadius: "50%",
          background: "#A78BFA",
        }} />
      )}
      {badge && isActive && (
        <span style={{
          fontSize: 9, fontWeight: 700,
          padding: "1px 5px", borderRadius: 8,
          background: "rgba(139,92,246,0.3)",
          color: "#A78BFA",
          fontFamily: "var(--font-jetbrains), monospace",
        }}>
          {badge}
        </span>
      )}
    </Link>
  );
}
