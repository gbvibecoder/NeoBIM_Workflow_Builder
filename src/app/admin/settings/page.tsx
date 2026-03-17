"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Shield, Server, Database, Key,
  Users, Crown, LayoutGrid, Play,
  Zap, Upload, Cpu,
  UserPlus, Pencil, Trash2, Eye, EyeOff,
  ChevronLeft, ChevronRight,
  LogIn, LogOut, UserCheck, UserMinus, FileText, Download,
  AlertTriangle, X, Check, Clock,
  ScrollText, RefreshCw,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

// ─── Types ──────────────────────────────────────────────────────────────────
type Tab = "platform" | "accounts" | "auditlog" | "limits" | "session";

interface PlatformStats {
  users: { total: number; byRole: Record<string, number> };
  workflows: { total: number };
  executions: { total: number };
}

interface AdminAccount {
  id: string;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AuditLogEntry {
  id: string;
  adminId: string | null;
  admin: { username: string; displayName: string } | null;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

interface AdminSession {
  id: string;
  username: string;
  displayName: string;
  role: string;
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
  blue: "#3B82F6",
  purple: "#8B5CF6",
} as const;

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

// ─── Role Badge Colors ──────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: COLORS.cyan,
  ADMIN: COLORS.copper,
  VIEWER: COLORS.textMuted,
};

// ─── Audit Action Config ────────────────────────────────────────────────────
const ACTION_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  ADMIN_LOGIN:             { color: COLORS.green,  icon: <LogIn size={13} /> },
  ADMIN_LOGOUT:            { color: COLORS.textMuted, icon: <LogOut size={13} /> },
  ADMIN_CREATED:           { color: COLORS.blue,   icon: <UserPlus size={13} /> },
  ADMIN_UPDATED:           { color: COLORS.amber,  icon: <Pencil size={13} /> },
  ADMIN_DELETED:           { color: COLORS.red,    icon: <Trash2 size={13} /> },
  USER_ROLE_CHANGED:       { color: COLORS.amber,  icon: <UserCheck size={13} /> },
  USER_DELETED:            { color: COLORS.red,    icon: <UserMinus size={13} /> },
  FEEDBACK_STATUS_CHANGED: { color: COLORS.amber,  icon: <FileText size={13} /> },
  DATA_EXPORTED:           { color: COLORS.purple, icon: <Download size={13} /> },
};

// ─── Date Formatting ────────────────────────────────────────────────────────
function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function formatAbsoluteDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

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
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${accentColor}, transparent)`,
        opacity: hovered ? 0.6 : 0.3,
        transition: "opacity 0.25s ease",
      }} />
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

// ─── Role Badge ─────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] || COLORS.textMuted;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 20,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
      textTransform: "uppercase",
      color,
      border: `1px solid ${color}30`,
      background: `${color}10`,
      fontFamily: "var(--font-jetbrains), monospace",
    }}>
      <Shield size={9} />
      {role.replace("_", " ")}
    </span>
  );
}

// ─── Active Status Badge ────────────────────────────────────────────────────
function ActiveBadge({ active, activeLabel, inactiveLabel }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  const color = active ? COLORS.green : COLORS.red;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20,
      fontSize: 10, fontWeight: 600,
      color,
      border: `1px solid ${color}25`,
      background: `${color}0A`,
      fontFamily: "var(--font-jetbrains), monospace",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}50`,
      }} />
      {active ? (activeLabel || "Active") : (inactiveLabel || "Inactive")}
    </span>
  );
}

// ─── Confirm Dialog ─────────────────────────────────────────────────────────
function ConfirmDialog({ title, message, confirmLabel, confirmColor, cancelLabel, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; confirmColor: string;
  cancelLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(8px)",
      }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.2, ease: smoothEase }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0E0F14",
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 16,
          padding: "28px 32px",
          maxWidth: 420,
          width: "90%",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: `${confirmColor}12`,
            border: `1px solid ${confirmColor}20`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: confirmColor,
          }}>
            <AlertTriangle size={18} />
          </div>
          <span style={{
            fontSize: 16, fontWeight: 700, color: COLORS.textPrimary,
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}>
            {title}
          </span>
        </div>
        <p style={{
          fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.6,
          margin: "0 0 24px",
          fontFamily: "var(--font-dm-sans), sans-serif",
        }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "10px 20px", borderRadius: 10,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${COLORS.cardBorder}`,
              color: COLORS.textSecondary, fontSize: 13, fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
          >
            {cancelLabel || "Cancel"}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "10px 20px", borderRadius: 10,
              background: `${confirmColor}15`,
              border: `1px solid ${confirmColor}30`,
              color: confirmColor, fontSize: 13, fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${confirmColor}25`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `${confirmColor}15`; }}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Platform Info Tab ──────────────────────────────────────────────────────
function PlatformInfoTab({ stats, loading }: {
  stats: PlatformStats | null; loading: boolean;
}) {
  const { t } = useLocale();
  const proUsers = stats?.users?.byRole?.PRO ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="settings-info-grid" style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
      }}>
        <InfoCard
          icon={<Users size={16} />}
          label={t('admin.settings.totalUsers')}
          value={loading ? "" : (stats?.users?.total ?? 0).toLocaleString()}
          accentColor={COLORS.cyan}
          delay={0.05}
          loading={loading}
        />
        <InfoCard
          icon={<Crown size={16} />}
          label={t('admin.settings.proUsers')}
          value={loading ? "" : proUsers.toLocaleString()}
          accentColor={COLORS.amber}
          delay={0.1}
          loading={loading}
        />
        <InfoCard
          icon={<LayoutGrid size={16} />}
          label={t('admin.settings.totalWorkflows')}
          value={loading ? "" : (stats?.workflows?.total ?? 0).toLocaleString()}
          accentColor={COLORS.copper}
          delay={0.15}
          loading={loading}
        />
        <InfoCard
          icon={<Play size={16} />}
          label={t('admin.settings.totalExecutions')}
          value={loading ? "" : (stats?.executions?.total ?? 0).toLocaleString()}
          accentColor={COLORS.green}
          delay={0.2}
          loading={loading}
        />
      </div>

      <div className="settings-env-grid" style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
      }}>
        <SectionCard
          title={t('admin.settings.environment')}
          icon={<Server size={15} />}
          accentColor={COLORS.cyan}
          delay={0.25}
        >
          <DetailRow label="Node.js" value={typeof process !== "undefined" ? process.version || "v20.x" : "v20.x"} />
          <DetailRow label={t('admin.settings.framework')} value="Next.js 16 (App Router)" />
          <DetailRow label={t('admin.settings.runtime')} value="Edge + Node.js" />
          <DetailRow label={t('admin.settings.typescript')} value="5.x (Strict)" />
        </SectionCard>

        <SectionCard
          title={t('admin.settings.infrastructure')}
          icon={<Database size={15} />}
          accentColor={COLORS.green}
          delay={0.3}
        >
          <DetailRow label={t('admin.settings.database')} value={t('admin.settings.connected')} statusColor={COLORS.green} />
          <DetailRow label={t('admin.settings.provider')} value="Neon PostgreSQL" />
          <DetailRow label={t('admin.settings.orm')} value="Prisma 7" />
          <DetailRow label={t('admin.settings.authLabel')} value="NextAuth v5 (Google + Credentials)" />
        </SectionCard>
      </div>
    </div>
  );
}

// ─── Create Admin Form ──────────────────────────────────────────────────────
function CreateAdminForm({ onCreated, onCancel }: {
  onCreated: () => void; onCancel: () => void;
}) {
  const { t } = useLocale();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("ADMIN");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = useCallback(async () => {
    if (!username.trim() || !password.trim() || !displayName.trim()) {
      setError("All fields are required");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, displayName: displayName.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create admin account");
        return;
      }
      onCreated();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [username, password, displayName, role, onCreated]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "11px 14px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.03)",
    border: `1px solid ${COLORS.cardBorder}`,
    color: COLORS.textPrimary,
    fontSize: 13,
    fontFamily: "var(--font-dm-sans), sans-serif",
    outline: "none",
    transition: "border-color 0.2s ease",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: COLORS.textMuted,
    textTransform: "uppercase", letterSpacing: "1px",
    fontFamily: "var(--font-jetbrains), monospace",
    marginBottom: 6, display: "block",
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: smoothEase }}
      style={{ overflow: "hidden" }}
    >
      <div style={{
        background: COLORS.card,
        backdropFilter: "blur(16px) saturate(1.3)",
        border: `1px solid rgba(0,245,255,0.12)`,
        borderRadius: 14,
        padding: "24px 24px 20px",
        marginBottom: 14,
        position: "relative",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${COLORS.cyan}, transparent)`,
          opacity: 0.5,
        }} />

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `${COLORS.cyan}12`,
              border: `1px solid ${COLORS.cyan}20`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: COLORS.cyan,
            }}>
              <UserPlus size={15} />
            </div>
            <span style={{
              fontSize: 14, fontWeight: 700, color: COLORS.textPrimary,
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}>
              {t('admin.settings.createAccount')}
            </span>
          </div>
          <button
            onClick={onCancel}
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${COLORS.cardBorder}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: COLORS.textMuted, cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="settings-create-form-grid" style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16,
          marginBottom: 16,
        }}>
          <div>
            <label style={labelStyle}>{t('admin.settings.displayName')}</label>
            <input
              type="text"
              placeholder="e.g. John Admin"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = `${COLORS.cyan}40`; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = COLORS.cardBorder; }}
            />
          </div>
          <div>
            <label style={labelStyle}>{t('admin.settings.usernameField')}</label>
            <input
              type="text"
              placeholder="e.g. john_admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = `${COLORS.cyan}40`; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = COLORS.cardBorder; }}
            />
          </div>
          <div>
            <label style={labelStyle}>{t('admin.settings.passwordField')}</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...inputStyle, paddingRight: 42 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = `${COLORS.cyan}40`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = COLORS.cardBorder; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                  width: 32, height: 32, borderRadius: 8,
                  background: "transparent", border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: COLORS.textMuted, cursor: "pointer",
                }}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t('admin.settings.roleField')}</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{
                ...inputStyle,
                cursor: "pointer",
                appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235C5C78' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 12px center",
              }}
            >
              <option value="ADMIN" style={{ background: "#0E0F14" }}>{t('admin.settings.adminRole')}</option>
              <option value="SUPER_ADMIN" style={{ background: "#0E0F14" }}>{t('admin.settings.superAdmin')}</option>
              <option value="VIEWER" style={{ background: "#0E0F14" }}>{t('admin.settings.viewerRole')}</option>
            </select>
          </div>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              padding: "10px 14px", borderRadius: 8,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.15)",
              marginBottom: 14,
            }}
          >
            <span style={{
              fontSize: 12, color: COLORS.red,
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}>
              {error}
            </span>
          </motion.div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "10px 20px", borderRadius: 10,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${COLORS.cardBorder}`,
              color: COLORS.textSecondary, fontSize: 13, fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
          >
            {t('admin.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: "10px 22px", borderRadius: 10,
              background: "rgba(0,245,255,0.1)",
              border: "1px solid rgba(0,245,255,0.25)",
              color: COLORS.cyan, fontSize: 13, fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
              fontFamily: "var(--font-dm-sans), sans-serif",
              display: "flex", alignItems: "center", gap: 8,
            }}
            onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = "rgba(0,245,255,0.18)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,245,255,0.1)"; }}
          >
            <Check size={14} />
            {submitting ? t('admin.settings.creating') : t('admin.settings.createAccount')}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Edit Admin Inline ──────────────────────────────────────────────────────
function EditAdminRow({ account, onSaved, onCancel }: {
  account: AdminAccount; onSaved: () => void; onCancel: () => void;
}) {
  const { t } = useLocale();
  const [role, setRole] = useState(account.role);
  const [isActive, setIsActive] = useState(account.isActive);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, isActive }),
      });
      if (res.ok) {
        onSaved();
      }
    } catch {
      // error ignored
    } finally {
      setSaving(false);
    }
  }, [account.id, role, isActive, onSaved]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px",
        background: "rgba(0,245,255,0.03)",
        borderRadius: 10,
        border: "1px solid rgba(0,245,255,0.1)",
      }}
    >
      <span style={{
        fontSize: 13, color: COLORS.textPrimary, fontWeight: 600,
        fontFamily: "var(--font-dm-sans), sans-serif",
        minWidth: 100,
      }}>
        {account.displayName}
      </span>

      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        style={{
          padding: "6px 28px 6px 10px", borderRadius: 8,
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${COLORS.cardBorder}`,
          color: COLORS.textPrimary, fontSize: 12,
          fontFamily: "var(--font-jetbrains), monospace",
          cursor: "pointer", outline: "none",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%235C5C78' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        <option value="SUPER_ADMIN" style={{ background: "#0E0F14" }}>{t('admin.settings.superAdmin')}</option>
        <option value="ADMIN" style={{ background: "#0E0F14" }}>{t('admin.settings.adminRole')}</option>
        <option value="VIEWER" style={{ background: "#0E0F14" }}>{t('admin.settings.viewerRole')}</option>
      </select>

      <button
        onClick={() => setIsActive(!isActive)}
        style={{
          padding: "6px 12px", borderRadius: 8,
          background: isActive ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
          border: `1px solid ${isActive ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
          color: isActive ? COLORS.green : COLORS.red,
          fontSize: 11, fontWeight: 600, cursor: "pointer",
          fontFamily: "var(--font-jetbrains), monospace",
        }}
      >
        {isActive ? t('admin.settings.activeLabel') : t('admin.settings.inactiveLabel')}
      </button>

      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            padding: "6px 14px", borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${COLORS.cardBorder}`,
            color: COLORS.textMuted, fontSize: 12, fontWeight: 600,
            cursor: "pointer",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        >
          {t('admin.cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "6px 14px", borderRadius: 8,
            background: "rgba(0,245,255,0.1)",
            border: "1px solid rgba(0,245,255,0.2)",
            color: COLORS.cyan, fontSize: 12, fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
            fontFamily: "var(--font-dm-sans), sans-serif",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <Check size={12} />
          {saving ? t('admin.settings.saving') : t('admin.save')}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Admin Accounts Tab ─────────────────────────────────────────────────────
function AdminAccountsTab({ session }: { session: AdminSession | null }) {
  const { t } = useLocale();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isSuperAdmin = session?.role === "SUPER_ADMIN";

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounts", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch {
      // fetch error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/accounts/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setDeleteTarget(null);
        fetchAccounts();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to delete account");
      }
    } catch {
      // delete error
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, fetchAccounts]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            background: COLORS.card,
            backdropFilter: "blur(16px) saturate(1.3)",
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 14, padding: "18px 22px",
            display: "flex", alignItems: "center", gap: 16,
          }}>
            <Skeleton width={36} height={36} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton width={160} height={14} />
              <Skeleton width={100} height={10} />
            </div>
            <Skeleton width={80} height={24} />
            <Skeleton width={60} height={24} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: smoothEase }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontSize: 13, fontWeight: 600, color: COLORS.textSecondary,
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}>
            {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
          </span>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "9px 18px", borderRadius: 10,
              background: "rgba(0,245,255,0.08)",
              border: "1px solid rgba(0,245,255,0.2)",
              color: COLORS.cyan, fontSize: 13, fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--font-dm-sans), sans-serif",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,245,255,0.14)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,245,255,0.08)"; }}
          >
            <UserPlus size={14} />
            {t('admin.settings.createAccount')}
          </button>
        )}
      </motion.div>

      {/* Create Form */}
      <AnimatePresence>
        {showCreateForm && (
          <CreateAdminForm
            onCreated={() => { setShowCreateForm(false); fetchAccounts(); }}
            onCancel={() => setShowCreateForm(false)}
          />
        )}
      </AnimatePresence>

      {/* Account Rows */}
      {accounts.map((account, index) => (
        <motion.div
          key={account.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05, duration: 0.35, ease: smoothEase }}
        >
          <AnimatePresence mode="wait">
            {editingId === account.id ? (
              <EditAdminRow
                key="edit"
                account={account}
                onSaved={() => { setEditingId(null); fetchAccounts(); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <motion.div
                key="view"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                  background: COLORS.card,
                  backdropFilter: "blur(16px) saturate(1.3)",
                  border: `1px solid ${COLORS.cardBorder}`,
                  borderRadius: 14,
                  padding: "16px 20px",
                  display: "flex", alignItems: "center", gap: 14,
                  transition: "border-color 0.2s ease",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.cardBorder; }}
              >
                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: `${ROLE_COLORS[account.role] || COLORS.textMuted}10`,
                  border: `1px solid ${ROLE_COLORS[account.role] || COLORS.textMuted}20`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: ROLE_COLORS[account.role] || COLORS.textMuted,
                  flexShrink: 0,
                }}>
                  <Shield size={17} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 14, fontWeight: 700, color: COLORS.textPrimary,
                      fontFamily: "var(--font-dm-sans), sans-serif",
                    }}>
                      {account.displayName}
                    </span>
                    <RoleBadge role={account.role} />
                    <ActiveBadge active={account.isActive} activeLabel={t('admin.settings.activeLabel')} inactiveLabel={t('admin.settings.inactiveLabel')} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{
                      fontSize: 11, color: COLORS.textMuted,
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}>
                      @{account.username}
                    </span>
                    <span style={{
                      fontSize: 11, color: COLORS.textMuted,
                      fontFamily: "var(--font-jetbrains), monospace",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <Clock size={10} />
                      {account.lastLoginAt
                        ? formatRelativeDate(account.lastLoginAt)
                        : t('admin.settings.neverLoggedIn')
                      }
                    </span>
                  </div>
                </div>

                {/* Actions */}
                {isSuperAdmin && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => setEditingId(account.id)}
                      title="Edit account"
                      style={{
                        width: 34, height: 34, borderRadius: 8,
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${COLORS.cardBorder}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: COLORS.textMuted, cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(255,191,0,0.08)";
                        e.currentTarget.style.borderColor = "rgba(255,191,0,0.2)";
                        e.currentTarget.style.color = COLORS.amber;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.borderColor = COLORS.cardBorder;
                        e.currentTarget.style.color = COLORS.textMuted;
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(account)}
                      title="Delete account"
                      style={{
                        width: 34, height: 34, borderRadius: 8,
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${COLORS.cardBorder}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: COLORS.textMuted, cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                        e.currentTarget.style.borderColor = "rgba(239,68,68,0.2)";
                        e.currentTarget.style.color = COLORS.red;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.borderColor = COLORS.cardBorder;
                        e.currentTarget.style.color = COLORS.textMuted;
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}

      {accounts.length === 0 && !loading && (
        <div style={{
          padding: "40px 20px", textAlign: "center",
          color: COLORS.textMuted, fontSize: 13,
          fontFamily: "var(--font-dm-sans), sans-serif",
        }}>
          {t('admin.settings.noAccounts')}
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <AnimatePresence>
        {deleteTarget && (
          <ConfirmDialog
            title={t('admin.delete')}
            message={t('admin.settings.confirmDeleteAdmin')}
            confirmLabel={deleting ? t('admin.delete') + "..." : t('admin.delete')}
            confirmColor={COLORS.red}
            cancelLabel={t('admin.cancel')}
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Audit Log Tab ──────────────────────────────────────────────────────────
function AuditLogTab() {
  const { t } = useLocale();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const fetchRef = useRef(false);

  const ACTION_LABELS: Record<string, string> = {
    ADMIN_LOGIN: t('admin.settings.login'),
    ADMIN_LOGOUT: t('admin.settings.logout'),
    ADMIN_CREATED: t('admin.settings.accountCreated'),
    ADMIN_UPDATED: t('admin.settings.accountUpdated'),
    ADMIN_DELETED: t('admin.settings.accountDeleted'),
    USER_ROLE_CHANGED: t('admin.settings.roleChanged'),
    USER_DELETED: t('admin.settings.userDeleted'),
    FEEDBACK_STATUS_CHANGED: t('admin.settings.statusChanged'),
    DATA_EXPORTED: t('admin.settings.dataExported'),
  };

  const AUDIT_ACTIONS = [
    { value: "", label: t('admin.settings.allActions') },
    { value: "ADMIN_LOGIN", label: ACTION_LABELS.ADMIN_LOGIN },
    { value: "ADMIN_LOGOUT", label: ACTION_LABELS.ADMIN_LOGOUT },
    { value: "ADMIN_CREATED", label: ACTION_LABELS.ADMIN_CREATED },
    { value: "ADMIN_UPDATED", label: ACTION_LABELS.ADMIN_UPDATED },
    { value: "ADMIN_DELETED", label: ACTION_LABELS.ADMIN_DELETED },
    { value: "USER_ROLE_CHANGED", label: ACTION_LABELS.USER_ROLE_CHANGED },
    { value: "USER_DELETED", label: ACTION_LABELS.USER_DELETED },
    { value: "FEEDBACK_STATUS_CHANGED", label: ACTION_LABELS.FEEDBACK_STATUS_CHANGED },
    { value: "DATA_EXPORTED", label: ACTION_LABELS.DATA_EXPORTED },
  ];

  const fetchLogs = useCallback(async (p: number, action?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20" });
      if (action) params.set("action", action);
      const res = await fetch(`/api/admin/audit-log?${params.toString()}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);
        setPage(data.page || 1);
      }
    } catch {
      // fetch error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetchRef.current) {
      fetchRef.current = true;
      fetchLogs(1, actionFilter);
    }
  }, [fetchLogs, actionFilter]);

  const handleFilterChange = useCallback((value: string) => {
    setActionFilter(value);
    fetchRef.current = false;
    setTimeout(() => {
      fetchRef.current = true;
      fetchLogs(1, value);
    }, 0);
  }, [fetchLogs]);

  const getActionConfig = useCallback((action: string) => {
    const config = ACTION_CONFIG[action] || {
      color: COLORS.textMuted,
      icon: <FileText size={13} />,
    };
    return {
      ...config,
      label: ACTION_LABELS[action] || action.replace(/_/g, " "),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const formatDetails = useCallback((entry: AuditLogEntry): string => {
    const d = entry.details;
    if (!d || Object.keys(d).length === 0) return "";

    const parts: string[] = [];

    if (d.username) parts.push(`@${d.username}`);
    if (d.role) parts.push(`role: ${String(d.role)}`);
    if (d.changes && Array.isArray(d.changes)) {
      parts.push(`changed: ${(d.changes as string[]).join(", ")}`);
    }
    if (typeof d.success === "boolean") {
      parts.push(d.success ? "success" : "failed");
    }
    if (d.newRole) parts.push(`new role: ${String(d.newRole)}`);
    if (d.email) parts.push(String(d.email));
    if (d.format) parts.push(`format: ${String(d.format)}`);

    return parts.join(" / ");
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 12, padding: "14px 18px",
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <Skeleton width={30} height={30} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton width={200} height={12} />
              <Skeleton width={140} height={10} />
            </div>
            <Skeleton width={80} height={10} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header with filter */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: smoothEase }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <span style={{
          fontSize: 13, fontWeight: 600, color: COLORS.textSecondary,
          fontFamily: "var(--font-dm-sans), sans-serif",
        }}>
          {total.toLocaleString()} {total === 1 ? "entry" : "entries"}
        </span>
        <select
          value={actionFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
          style={{
            padding: "8px 36px 8px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${COLORS.cardBorder}`,
            color: COLORS.textPrimary,
            fontSize: 12,
            fontFamily: "var(--font-dm-sans), sans-serif",
            outline: "none",
            cursor: "pointer",
            appearance: "none" as const,
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235C5C78' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 12px center",
            minWidth: 180,
            transition: "border-color 0.2s ease",
          }}
        >
          {AUDIT_ACTIONS.map((a) => (
            <option key={a.value} value={a.value} style={{ background: "#0E0F14" }}>
              {a.label}
            </option>
          ))}
        </select>
      </motion.div>

      {/* Log Entries */}
      <div style={{
        background: COLORS.card,
        backdropFilter: "blur(16px) saturate(1.3)",
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 14,
        overflow: "hidden",
      }}>
        {logs.length === 0 ? (
          <div style={{
            padding: "40px 20px", textAlign: "center",
            color: COLORS.textMuted, fontSize: 13,
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}>
            {t('admin.settings.noAuditLogs')}
          </div>
        ) : (
          logs.map((entry, index) => {
            const config = getActionConfig(entry.action);
            const details = formatDetails(entry);

            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.02, duration: 0.25 }}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "14px 20px",
                  borderBottom: index < logs.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.015)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {/* Action Icon */}
                <div style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: `${config.color}10`,
                  border: `1px solid ${config.color}18`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: config.color,
                  flexShrink: 0,
                }}>
                  {config.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {/* Action badge */}
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      padding: "2px 8px", borderRadius: 6,
                      fontSize: 10, fontWeight: 700,
                      color: config.color,
                      background: `${config.color}10`,
                      border: `1px solid ${config.color}18`,
                      fontFamily: "var(--font-jetbrains), monospace",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}>
                      {config.label}
                    </span>

                    {/* Admin name */}
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: COLORS.textPrimary,
                      fontFamily: "var(--font-dm-sans), sans-serif",
                    }}>
                      {entry.admin?.displayName || t('admin.settings.system')}
                    </span>

                    {/* Target info */}
                    {entry.targetType && (
                      <span style={{
                        fontSize: 11, color: COLORS.textMuted,
                        fontFamily: "var(--font-jetbrains), monospace",
                      }}>
                        {entry.targetType}{entry.targetId ? `:${entry.targetId.slice(0, 8)}` : ""}
                      </span>
                    )}
                  </div>

                  {/* Details */}
                  {details && (
                    <div style={{
                      fontSize: 11, color: COLORS.textMuted, marginTop: 4,
                      fontFamily: "var(--font-jetbrains), monospace",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {details}
                    </div>
                  )}
                </div>

                {/* Timestamp */}
                <div style={{
                  flexShrink: 0, textAlign: "right",
                  display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: COLORS.textSecondary,
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    {formatRelativeDate(entry.createdAt)}
                  </span>
                  <span style={{
                    fontSize: 9, color: COLORS.textMuted,
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    {formatAbsoluteDate(entry.createdAt)}
                  </span>
                </div>

                {/* IP address */}
                {entry.ipAddress && (
                  <span style={{
                    fontSize: 9, color: COLORS.textMuted,
                    fontFamily: "var(--font-jetbrains), monospace",
                    flexShrink: 0,
                    padding: "2px 6px", borderRadius: 4,
                    background: "rgba(255,255,255,0.03)",
                  }}>
                    {entry.ipAddress}
                  </span>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}
        >
          <button
            onClick={() => { if (page > 1) fetchLogs(page - 1, actionFilter); }}
            disabled={page <= 1}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${COLORS.cardBorder}`,
              color: page <= 1 ? COLORS.textMuted : COLORS.textSecondary,
              fontSize: 12, fontWeight: 600,
              cursor: page <= 1 ? "not-allowed" : "pointer",
              opacity: page <= 1 ? 0.4 : 1,
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
          >
            <ChevronLeft size={14} />
          </button>

          <div style={{
            display: "flex", alignItems: "center", gap: 4,
          }}>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }

              return (
                <button
                  key={pageNum}
                  onClick={() => fetchLogs(pageNum, actionFilter)}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: pageNum === page ? "rgba(0,245,255,0.1)" : "transparent",
                    border: `1px solid ${pageNum === page ? "rgba(0,245,255,0.2)" : "transparent"}`,
                    color: pageNum === page ? COLORS.cyan : COLORS.textMuted,
                    fontSize: 12, fontWeight: pageNum === page ? 700 : 500,
                    cursor: "pointer",
                    fontFamily: "var(--font-jetbrains), monospace",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => { if (page < totalPages) fetchLogs(page + 1, actionFilter); }}
            disabled={page >= totalPages}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${COLORS.cardBorder}`,
              color: page >= totalPages ? COLORS.textMuted : COLORS.textSecondary,
              fontSize: 12, fontWeight: 600,
              cursor: page >= totalPages ? "not-allowed" : "pointer",
              opacity: page >= totalPages ? 0.4 : 1,
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
          >
            <ChevronRight size={14} />
          </button>
        </motion.div>
      )}
    </div>
  );
}

// ─── Rate Limits Tab ────────────────────────────────────────────────────────
function RateLimitsTab() {
  const { t } = useLocale();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="settings-limits-grid" style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
      }}>
        <SectionCard
          title={t('admin.settings.executionLimits')}
          icon={<Zap size={15} />}
          accentColor={COLORS.amber}
          delay={0.05}
        >
          <DetailRow label={t('admin.settings.freeTier')} value={t('admin.settings.freeExecDay')} />
          <DetailRow label={t('admin.settings.proTier')} value={t('admin.settings.proExecDay')} />
          <DetailRow label={t('admin.settings.slidingWindow')} value="Upstash Redis" />
          <DetailRow label={t('admin.settings.adminBypass')} value={t('admin.settings.enabled')} statusColor={COLORS.green} />
        </SectionCard>

        <SectionCard
          title={t('admin.settings.uploadApi')}
          icon={<Upload size={15} />}
          accentColor={COLORS.copper}
          delay={0.1}
        >
          <DetailRow label={t('admin.settings.bodyLimit')} value="2 MB" />
          <DetailRow label={t('admin.settings.aiProvider')} value="OpenAI GPT-4o" />
          <DetailRow label={t('admin.settings.visionModel')} value="Claude Sonnet 4.6" />
          <DetailRow label={t('admin.settings.threeDGen')} value="Meshy API" />
        </SectionCard>
      </div>

      <SectionCard
        title={t('admin.settings.tierComparison')}
        icon={<Shield size={15} />}
        accentColor={COLORS.cyan}
        delay={0.15}
      >
        <div className="settings-tier-table" style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0,
        }}>
          {[t('admin.settings.featureCol'), "FREE", "PRO"].map((h, i) => (
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
          {[
            [t('admin.settings.dailyExec'), "3", "100"],
            [t('admin.settings.wfSlots'), "5", t('admin.settings.unlimited')],
            [t('admin.settings.communityAccess'), t('admin.settings.viewOnly'), t('admin.settings.fullAccess')],
            [t('admin.settings.prioritySupport'), "\u2014", "Yes"],
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
          {t('admin.settings.rateLimitNote')} <code style={{
            fontSize: 11, padding: "1px 6px", borderRadius: 4,
            background: "rgba(255,255,255,0.05)",
            fontFamily: "var(--font-jetbrains), monospace",
            color: COLORS.amber,
          }}>src/lib/rate-limit.ts</code>. {t('admin.settings.contactEng')}
        </span>
      </motion.div>
    </div>
  );
}

// ─── Admin Session Tab ──────────────────────────────────────────────────────
function AdminSessionTab() {
  const { t } = useLocale();
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const handleEndSession = useCallback(async () => {
    setEnding(true);
    document.cookie = "bf_admin_session=; path=/; max-age=0; samesite=strict";
    await new Promise((r) => setTimeout(r, 600));
    router.push("/login");
  }, [router]);

  const handleRegenerateSession = useCallback(async () => {
    setRegenerating(true);
    document.cookie = "bf_admin_session=; path=/; max-age=0; samesite=strict";
    await new Promise((r) => setTimeout(r, 400));
    document.cookie = `bf_admin_session=bf_admin_authenticated_2026; path=/; max-age=${60 * 60 * 24 * 7}; samesite=strict`;
    setRegenerating(false);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionCard
        title={t('admin.settings.currentSession')}
        icon={<Key size={15} />}
        accentColor={COLORS.cyan}
        delay={0.05}
      >
        <DetailRow label={t('admin.settings.authenticatedAs')} value="buildflow_admin" />
        <DetailRow label={t('admin.settings.cookieName')} value="bf_admin_session" />
        <DetailRow label={t('admin.settings.sessionExpiry')} value={t('admin.settings.sevenDays')} />
        <DetailRow label={t('admin.settings.sessionStatus')} value={t('admin.settings.activeStatus')} statusColor={COLORS.green} />
      </SectionCard>

      <SectionCard
        title={t('admin.settings.credentialsSection')}
        icon={<Shield size={15} />}
        accentColor={COLORS.copper}
        delay={0.1}
      >
        <DetailRow label={t('admin.settings.username')} value="buildflow_admin" />
        <DetailRow label={t('admin.settings.password')} value="Admin@***" />
        <DetailRow label={t('admin.settings.authMethod')} value={t('admin.settings.cookieBased')} />

        <div style={{
          marginTop: 14, padding: "12px 16px", borderRadius: 10,
          background: "rgba(184,115,51,0.06)",
          border: "1px solid rgba(184,115,51,0.12)",
        }}>
          <span style={{
            fontSize: 12, color: COLORS.textSecondary, lineHeight: 1.5,
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}>
            {t('admin.settings.credentialNote')}{" "}
            <code style={{
              fontSize: 11, padding: "1px 6px", borderRadius: 4,
              background: "rgba(255,255,255,0.05)",
              fontFamily: "var(--font-jetbrains), monospace",
              color: COLORS.copper,
            }}>src/lib/admin-auth.ts</code>.
            {" "}{t('admin.settings.betaNote')}
          </span>
        </div>
      </SectionCard>

      {/* Action Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4, ease: smoothEase }}
        className="settings-session-actions"
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
          {regenerating ? t('admin.settings.regenerating') : t('admin.settings.regenerateSession')}
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
          {ending ? t('admin.settings.endingSession') : t('admin.settings.endSession')}
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
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<Tab>("platform");
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AdminSession | null>(null);

  useEffect(() => {
    async function fetchInitialData() {
      try {
        const [statsRes, sessionRes] = await Promise.all([
          fetch("/api/admin/stats", { credentials: "include" }),
          fetch("/api/admin", { credentials: "include" }),
        ]);
        if (statsRes.ok) {
          const data = await statsRes.json();
          setStats(data);
        }
        if (sessionRes.ok) {
          const data = await sessionRes.json();
          setSession(data.admin || null);
        }
      } catch {
        // Data unavailable
      } finally {
        setLoading(false);
      }
    }
    fetchInitialData();
  }, []);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "platform",  label: t('admin.settings.tabPlatform'),    icon: <Server size={15} /> },
    { key: "accounts",  label: t('admin.settings.tabAccounts'),    icon: <Users size={15} /> },
    { key: "auditlog",  label: t('admin.settings.tabAuditLog'),    icon: <ScrollText size={15} /> },
    { key: "limits",    label: t('admin.settings.tabRateLimits'),  icon: <Shield size={15} /> },
    { key: "session",   label: t('admin.settings.tabSession'),     icon: <Key size={15} /> },
  ];

  return (
    <div className="admin-settings-page" style={{ padding: "24px 28px 48px", maxWidth: 1100, margin: "0 auto" }}>
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
            {t('admin.settings.sectionLabel')}
          </span>
        </div>
        <h1 style={{
          fontSize: 24, fontWeight: 700, color: COLORS.textPrimary, margin: 0,
          fontFamily: "var(--font-dm-sans), sans-serif",
          letterSpacing: "-0.02em",
        }}>
          {t('admin.settings.title')}
        </h1>
        <p style={{
          fontSize: 13, color: COLORS.textMuted, margin: "4px 0 0",
          fontFamily: "var(--font-dm-sans), sans-serif",
        }}>
          {t('admin.settings.subtitle')}
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
          {activeTab === "accounts" && <AdminAccountsTab session={session} />}
          {activeTab === "auditlog" && <AuditLogTab />}
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
          .admin-settings-page {
            padding: 16px 14px 32px !important;
          }
          .settings-tabs {
            flex-wrap: wrap !important;
            width: 100% !important;
          }
          .settings-tabs button {
            flex: 1 1 auto !important;
            min-width: 0 !important;
            padding: 8px 12px !important;
            font-size: 11px !important;
            justify-content: center !important;
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
          .settings-create-form-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 640px) {
          .settings-session-actions {
            flex-direction: column !important;
          }
        }
        @media (max-width: 480px) {
          .settings-tabs button {
            font-size: 10px !important;
            padding: 7px 8px !important;
          }
          .settings-tier-table {
            font-size: 11px !important;
          }
        }
      `}</style>
    </div>
  );
}
