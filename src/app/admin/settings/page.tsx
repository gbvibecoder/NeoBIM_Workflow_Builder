"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Shield, Server, Database, Key,
  Users, Crown, LayoutGrid, Play,
  Zap, Upload, Cpu, LogOut, RefreshCw,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────
type Tab = "platform" | "limits" | "session";

interface PlatformStats {
  users: { total: number; byRole: Record<string, number> };
  workflows: { total: number };
  executions: { total: number };
}

// ─── Design Tokens ──────────────────────────────────────────────────────────
const COLORS = {
  bg: "#070809",
  card: "rgba(18,18,30,0.6)",
  cardBorder: "rgba(255,255,255,0.06)",
  textPrimary: "#F0F0F5",
  textSecondary: "#9898B0",
  textMuted: "#5C5C78",
  cyan: "#00F5FF",
  copper: "#B87333",
  amber: "#FFBF00",
  green: "#10B981",
  red: "#EF4444",
} as const;

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

// ─── Skeleton Loader ────────────────────────────────────────────────────────
function Skeleton({ width, height = 20 }: { width: number | string; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 6,
        background: "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s ease infinite",
      }}
    />
  );
}

// ─── Tab Button ─────────────────────────────────────────────────────────────
function TabButton({ label, icon, active, onClick }: {
  label: string; icon: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 18px", borderRadius: 10,
        background: active ? "rgba(0,245,255,0.08)" : "transparent",
        border: `1px solid ${active ? "rgba(0,245,255,0.2)" : "rgba(255,255,255,0.04)"}`,
        color: active ? COLORS.cyan : COLORS.textMuted,
        cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 500,
        transition: "all 0.2s ease",
        fontFamily: "var(--font-dm-sans), sans-serif",
        position: "relative",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? "rgba(0,245,255,0.08)" : "transparent"; }}
    >
      {icon}
      {label}
      {active && (
        <motion.div
          layoutId="settings-tab-indicator"
          style={{
            position: "absolute", bottom: -1, left: "20%", right: "20%",
            height: 2, borderRadius: 1,
            background: COLORS.cyan,
          }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
    </button>
  );
}

// ─── Info Card ──────────────────────────────────────────────────────────────
function InfoCard({ icon, label, value, accentColor, delay, loading }: {
  icon: React.ReactNode; label: string; value: string;
  accentColor: string; delay: number; loading?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: smoothEase }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", overflow: "hidden",
        background: COLORS.card,
        backdropFilter: "blur(16px) saturate(1.3)",
        border: `1px solid ${hovered ? `${accentColor}30` : COLORS.cardBorder}`,
        borderRadius: 14,
        padding: "20px 22px",
        transition: "border-color 0.25s ease, transform 0.25s ease",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      {/* Top accent line */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${accentColor}, transparent)`,
        opacity: hovered ? 0.6 : 0.3,
        transition: "opacity 0.25s ease",
      }} />

      {/* Glow */}
      <div style={{
        position: "absolute", top: -20, right: -20, width: 56, height: 56,
        borderRadius: "50%", background: accentColor, opacity: 0.04, filter: "blur(20px)",
      }} />

      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9,
          background: `${accentColor}12`,
          border: `1px solid ${accentColor}20`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: accentColor,
        }}>
          {icon}
        </div>
        <span style={{
          fontSize: 9, fontWeight: 600, color: COLORS.textMuted,
          textTransform: "uppercase", letterSpacing: "1.2px",
          fontFamily: "var(--font-jetbrains), monospace",
        }}>
          {label}
        </span>
      </div>

      {loading ? (
        <Skeleton width={80} height={26} />
      ) : (
        <span style={{
          fontSize: 22, fontWeight: 700, color: COLORS.textPrimary,
          fontFamily: "var(--font-dm-sans), sans-serif",
          letterSpacing: "-0.02em",
        }}>
          {value}
        </span>
      )}
    </motion.div>
  );
}

// ─── Status Dot ─────────────────────────────────────────────────────────────
function StatusDot({ color }: { color: string }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: color,
      boxShadow: `0 0 8px ${color}60`,
      marginRight: 8,
    }} />
  );
}

// ─── Detail Row ─────────────────────────────────────────────────────────────
function DetailRow({ label, value, statusColor }: {
  label: string; value: string; statusColor?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "13px 0",
      borderBottom: "1px solid rgba(255,255,255,0.03)",
    }}>
      <span style={{
        fontSize: 12, color: COLORS.textMuted, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.8px",
        fontFamily: "var(--font-jetbrains), monospace",
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 14, fontWeight: 700, color: COLORS.textPrimary,
        fontFamily: "var(--font-dm-sans), sans-serif",
        display: "flex", alignItems: "center",
      }}>
        {statusColor && <StatusDot color={statusColor} />}
        {value}
      </span>
    </div>
  );
}

// ─── Section Card ───────────────────────────────────────────────────────────
function SectionCard({ title, icon, accentColor, delay, children }: {
  title: string; icon: React.ReactNode; accentColor: string;
  delay: number; children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: smoothEase }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", overflow: "hidden",
        background: COLORS.card,
        backdropFilter: "blur(16px) saturate(1.3)",
        border: `1px solid ${hovered ? `${accentColor}30` : COLORS.cardBorder}`,
        borderRadius: 14,
        padding: "22px 24px",
        transition: "border-color 0.25s ease",
      }}
    >
      {/* Top accent line */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${accentColor}, transparent)`,
        opacity: 0.4,
      }} />

      <div style={{
        position: "absolute", top: -16, right: -16, width: 48, height: 48,
        borderRadius: "50%", background: accentColor, opacity: 0.04, filter: "blur(16px)",
      }} />

      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 18,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${accentColor}12`,
          border: `1px solid ${accentColor}20`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: accentColor,
        }}>
          {icon}
        </div>
        <span style={{
          fontSize: 14, fontWeight: 700, color: COLORS.textPrimary,
          fontFamily: "var(--font-dm-sans), sans-serif",
          letterSpacing: "-0.01em",
        }}>
          {title}
        </span>
      </div>

      {children}
    </motion.div>
  );
}

// ─── Platform Info Tab ──────────────────────────────────────────────────────
function PlatformInfoTab({ stats, loading }: {
  stats: PlatformStats | null; loading: boolean;
}) {
  const proUsers = stats?.users?.byRole?.PRO ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Metric cards */}
      <div className="settings-info-grid" style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
      }}>
        <InfoCard
          icon={<Users size={16} />}
          label="Total Users"
          value={loading ? "" : (stats?.users?.total ?? 0).toLocaleString()}
          accentColor={COLORS.cyan}
          delay={0.05}
          loading={loading}
        />
        <InfoCard
          icon={<Crown size={16} />}
          label="PRO Users"
          value={loading ? "" : proUsers.toLocaleString()}
          accentColor={COLORS.amber}
          delay={0.1}
          loading={loading}
        />
        <InfoCard
          icon={<LayoutGrid size={16} />}
          label="Total Workflows"
          value={loading ? "" : (stats?.workflows?.total ?? 0).toLocaleString()}
          accentColor={COLORS.copper}
          delay={0.15}
          loading={loading}
        />
        <InfoCard
          icon={<Play size={16} />}
          label="Total Executions"
          value={loading ? "" : (stats?.executions?.total ?? 0).toLocaleString()}
          accentColor={COLORS.green}
          delay={0.2}
          loading={loading}
        />
      </div>

      {/* Environment info */}
      <div className="settings-env-grid" style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
      }}>
        <SectionCard
          title="Environment"
          icon={<Server size={15} />}
          accentColor={COLORS.cyan}
          delay={0.25}
        >
          <DetailRow label="Node.js" value={typeof process !== "undefined" ? process.version || "v20.x" : "v20.x"} />
          <DetailRow label="Framework" value="Next.js 16 (App Router)" />
          <DetailRow label="Runtime" value="Edge + Node.js" />
          <DetailRow label="TypeScript" value="5.x (Strict)" />
        </SectionCard>

        <SectionCard
          title="Infrastructure"
          icon={<Database size={15} />}
          accentColor={COLORS.green}
          delay={0.3}
        >
          <DetailRow label="Database" value="Connected" statusColor={COLORS.green} />
          <DetailRow label="Provider" value="Neon PostgreSQL" />
          <DetailRow label="ORM" value="Prisma 7" />
          <DetailRow label="Auth" value="NextAuth v5 (Google + Credentials)" />
        </SectionCard>
      </div>
    </div>
  );
}

// ─── Rate Limits Tab ────────────────────────────────────────────────────────
function RateLimitsTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="settings-limits-grid" style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
      }}>
        <SectionCard
          title="Execution Limits"
          icon={<Zap size={15} />}
          accentColor={COLORS.amber}
          delay={0.05}
        >
          <DetailRow label="FREE Tier" value="3 executions / day" />
          <DetailRow label="PRO Tier" value="100 executions / day" />
          <DetailRow label="Sliding Window" value="Upstash Redis" />
          <DetailRow label="Admin Bypass" value="Enabled" statusColor={COLORS.green} />
        </SectionCard>

        <SectionCard
          title="Upload & API"
          icon={<Upload size={15} />}
          accentColor={COLORS.copper}
          delay={0.1}
        >
          <DetailRow label="Body Limit" value="2 MB" />
          <DetailRow label="AI Provider" value="OpenAI GPT-4o" />
          <DetailRow label="Vision Model" value="Claude Sonnet 4.6" />
          <DetailRow label="3D Generation" value="Meshy API" />
        </SectionCard>
      </div>

      <SectionCard
        title="Tier Comparison"
        icon={<Shield size={15} />}
        accentColor={COLORS.cyan}
        delay={0.15}
      >
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0,
        }}>
          {/* Header row */}
          {["Feature", "FREE", "PRO"].map((h, i) => (
            <div key={h} style={{
              padding: "10px 0",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              fontSize: 10, fontWeight: 600, color: COLORS.textMuted,
              textTransform: "uppercase", letterSpacing: "1px",
              fontFamily: "var(--font-jetbrains), monospace",
              textAlign: i === 0 ? "left" : "center",
            }}>
              {h}
            </div>
          ))}
          {/* Data rows */}
          {[
            ["Daily Executions", "3", "100"],
            ["Workflow Slots", "5", "Unlimited"],
            ["Community Access", "View Only", "Full"],
            ["Priority Support", "—", "Yes"],
          ].map(([feature, free, pro]) => (
            [feature, free, pro].map((cell, i) => (
              <div key={`${feature}-${i}`} style={{
                padding: "11px 0",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                fontSize: 13, fontWeight: i === 0 ? 500 : 700,
                color: i === 0 ? COLORS.textSecondary : COLORS.textPrimary,
                fontFamily: i === 0 ? "var(--font-dm-sans), sans-serif" : "var(--font-jetbrains), monospace",
                textAlign: i === 0 ? "left" : "center",
              }}>
                {cell}
              </div>
            ))
          ))}
        </div>
      </SectionCard>

      {/* Note */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderRadius: 10,
          background: "rgba(255,191,0,0.04)",
          border: "1px solid rgba(255,191,0,0.1)",
        }}
      >
        <Cpu size={14} style={{ color: COLORS.amber, flexShrink: 0 }} />
        <span style={{
          fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.5,
          fontFamily: "var(--font-dm-sans), sans-serif",
        }}>
          Rate limits are configured in code via <code style={{
            fontSize: 11, padding: "1px 6px", borderRadius: 4,
            background: "rgba(255,255,255,0.05)",
            fontFamily: "var(--font-jetbrains), monospace",
            color: COLORS.amber,
          }}>src/lib/rate-limit.ts</code>. Contact engineering to modify.
        </span>
      </motion.div>
    </div>
  );
}

// ─── Admin Session Tab ──────────────────────────────────────────────────────
function AdminSessionTab() {
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const handleEndSession = useCallback(async () => {
    setEnding(true);
    // Clear the admin cookie
    document.cookie = "bf_admin_session=; path=/; max-age=0; samesite=strict";
    await new Promise((r) => setTimeout(r, 600));
    router.push("/login");
  }, [router]);

  const handleRegenerateSession = useCallback(async () => {
    setRegenerating(true);
    // Clear and re-set the cookie by re-authenticating
    document.cookie = "bf_admin_session=; path=/; max-age=0; samesite=strict";
    await new Promise((r) => setTimeout(r, 400));
    document.cookie = `bf_admin_session=bf_admin_authenticated_2026; path=/; max-age=${60 * 60 * 24 * 7}; samesite=strict`;
    setRegenerating(false);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionCard
        title="Current Session"
        icon={<Key size={15} />}
        accentColor={COLORS.cyan}
        delay={0.05}
      >
        <DetailRow label="Authenticated As" value="buildflow_admin" />
        <DetailRow label="Cookie Name" value="bf_admin_session" />
        <DetailRow label="Session Expiry" value="7 days" />
        <DetailRow label="Session Status" value="Active" statusColor={COLORS.green} />
      </SectionCard>

      <SectionCard
        title="Credentials"
        icon={<Shield size={15} />}
        accentColor={COLORS.copper}
        delay={0.1}
      >
        <DetailRow label="Username" value="buildflow_admin" />
        <DetailRow label="Password" value="Admin@***" />
        <DetailRow label="Auth Method" value="Cookie-based (Beta)" />

        {/* Note */}
        <div style={{
          marginTop: 14, padding: "12px 16px", borderRadius: 10,
          background: "rgba(184,115,51,0.06)",
          border: "1px solid rgba(184,115,51,0.12)",
        }}>
          <span style={{
            fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.5,
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}>
            Admin credentials are configured in code at{" "}
            <code style={{
              fontSize: 11, padding: "1px 6px", borderRadius: 4,
              background: "rgba(255,255,255,0.05)",
              fontFamily: "var(--font-jetbrains), monospace",
              color: COLORS.copper,
            }}>src/lib/admin-auth.ts</code>.
            Not production-grade — for internal use during beta only.
          </span>
        </div>
      </SectionCard>

      {/* Action Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4, ease: smoothEase }}
        style={{ display: "flex", gap: 12 }}
      >
        <button
          onClick={handleRegenerateSession}
          disabled={regenerating}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            padding: "14px 24px", borderRadius: 10,
            background: "rgba(0,245,255,0.08)",
            border: "1px solid rgba(0,245,255,0.2)",
            color: COLORS.cyan, fontSize: 13, fontWeight: 600,
            cursor: regenerating ? "not-allowed" : "pointer",
            opacity: regenerating ? 0.6 : 1,
            transition: "all 0.2s ease",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
          onMouseEnter={(e) => { if (!regenerating) e.currentTarget.style.background = "rgba(0,245,255,0.14)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,245,255,0.08)"; }}
        >
          <RefreshCw size={15} style={{
            animation: regenerating ? "spin 0.8s linear infinite" : "none",
          }} />
          {regenerating ? "Regenerating..." : "Regenerate Session"}
        </button>

        <button
          onClick={handleEndSession}
          disabled={ending}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            padding: "14px 24px", borderRadius: 10,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: COLORS.red, fontSize: 13, fontWeight: 600,
            cursor: ending ? "not-allowed" : "pointer",
            opacity: ending ? 0.6 : 1,
            transition: "all 0.2s ease",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
          onMouseEnter={(e) => { if (!ending) e.currentTarget.style.background = "rgba(239,68,68,0.14)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
        >
          <LogOut size={15} />
          {ending ? "Ending Session..." : "End Session"}
        </button>
      </motion.div>
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
      }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{
            background: COLORS.card,
            backdropFilter: "blur(16px) saturate(1.3)",
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 14, padding: "20px 22px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <Skeleton width={34} height={34} />
              <Skeleton width={80} height={12} />
            </div>
            <Skeleton width={100} height={26} />
          </div>
        ))}
      </div>
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
      }}>
        {[0, 1].map((i) => (
          <div key={i} style={{
            background: COLORS.card,
            backdropFilter: "blur(16px) saturate(1.3)",
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 14, padding: "22px 24px",
          }}>
            <Skeleton width={140} height={18} />
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              {[0, 1, 2, 3].map((j) => (
                <div key={j} style={{ display: "flex", justifyContent: "space-between" }}>
                  <Skeleton width={100} height={14} />
                  <Skeleton width={120} height={14} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("platform");
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/admin/stats", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch {
        // Stats unavailable — cards will show 0
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "platform", label: "Platform Info",  icon: <Server size={15} /> },
    { key: "limits",   label: "Rate Limits",    icon: <Shield size={15} /> },
    { key: "session",  label: "Admin Session",  icon: <Key size={15} /> },
  ];

  return (
    <div style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: smoothEase }}
        style={{ marginBottom: 28 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: COLORS.cyan,
            boxShadow: `0 0 8px ${COLORS.cyan}60`,
          }} />
          <span style={{
            fontSize: 9, color: COLORS.cyan, fontWeight: 600,
            letterSpacing: "1.5px", textTransform: "uppercase",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            Configuration
          </span>
        </div>
        <h1 style={{
          fontSize: 24, fontWeight: 700, color: COLORS.textPrimary, margin: 0,
          fontFamily: "var(--font-dm-sans), sans-serif",
          letterSpacing: "-0.02em",
        }}>
          Platform Settings
        </h1>
        <p style={{
          fontSize: 13, color: COLORS.textMuted, margin: "4px 0 0",
          fontFamily: "var(--font-dm-sans), sans-serif",
        }}>
          Platform configuration, rate limits, and admin session management
        </p>
      </motion.div>

      {/* Tab Navigation */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4, ease: smoothEase }}
        className="settings-tabs"
        style={{
          display: "flex", alignItems: "center", gap: 6,
          marginBottom: 24,
          padding: "4px",
          background: "rgba(18,18,30,0.4)",
          borderRadius: 14,
          border: `1px solid ${COLORS.cardBorder}`,
          width: "fit-content",
        }}
      >
        {tabs.map((tab) => (
          <TabButton
            key={tab.key}
            label={tab.label}
            icon={tab.icon}
            active={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
          />
        ))}
      </motion.div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: smoothEase }}
        >
          {activeTab === "platform" && (
            loading ? <LoadingSkeleton /> : <PlatformInfoTab stats={stats} loading={loading} />
          )}
          {activeTab === "limits" && <RateLimitsTab />}
          {activeTab === "session" && <AdminSessionTab />}
        </motion.div>
      </AnimatePresence>

      {/* Responsive + shimmer animation styles */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 1024px) {
          .settings-info-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 768px) {
          .settings-tabs {
            flex-wrap: wrap !important;
            width: 100% !important;
          }
          .settings-info-grid {
            grid-template-columns: 1fr !important;
          }
          .settings-env-grid {
            grid-template-columns: 1fr !important;
          }
          .settings-limits-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
