"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Download, Users, Filter, Shield, Star, Zap, Trash2, AlertTriangle,
  X, Loader2, CreditCard, FolderKanban, RefreshCw, Smartphone, CheckCircle2,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

// ─── Types ────────────────────────────────────────────────────────────────────
type UserRole = "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | "PLATFORM_ADMIN";

interface ApiUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
  xp: number;
  level: number;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeCurrentPeriodEnd: string | null;
  razorpaySubscriptionId: string | null;
  razorpayPlanId: string | null;
  paymentGateway: string | null;
  createdAt: string;
  _count: { workflows: number; executions: number };
}

interface UsersResponse {
  users: ApiUser[];
  total: number;
  page: number;
  totalPages: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];
const PAGE_SIZE = 20;

const ROLE_BADGE: Record<UserRole, { bg: string; color: string; border: string }> = {
  FREE:           { bg: "rgba(92,92,120,0.12)", color: "#9898B0", border: "rgba(92,92,120,0.15)" },
  MINI:           { bg: "rgba(245,158,11,0.10)", color: "#F59E0B", border: "rgba(245,158,11,0.18)" },
  STARTER:        { bg: "rgba(16,185,129,0.10)", color: "#10B981", border: "rgba(16,185,129,0.18)" },
  PRO:            { bg: "rgba(184,115,51,0.10)", color: "#FFBF00", border: "rgba(184,115,51,0.18)" },
  TEAM_ADMIN:     { bg: "rgba(79,138,255,0.10)", color: "#4F8AFF", border: "rgba(79,138,255,0.18)" },
  PLATFORM_ADMIN: { bg: "rgba(0,245,255,0.08)", color: "#00F5FF", border: "rgba(0,245,255,0.15)" },
};

const ROLE_ICON: Record<UserRole, React.ReactNode> = {
  FREE:           null,
  MINI:           <Star size={9} />,
  STARTER:        <Zap size={9} />,
  PRO:            <Star size={9} />,
  TEAM_ADMIN:     <Users size={9} />,
  PLATFORM_ADMIN: <Shield size={9} />,
};

type SortField = "createdAt" | "name" | "email" | "role" | "xp" | "level" | "workflows" | "executions";
type SortOrder = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getInitial(name: string | null, email: string | null): string {
  if (name && name.trim().length > 0) return name.trim()[0].toUpperCase();
  if (email && email.trim().length > 0) return email.trim()[0].toUpperCase();
  return "?";
}

function getAvatarColor(id: string): string {
  const colors = ["#B87333", "#4F8AFF", "#00F5FF", "#FFBF00", "#34D399", "#F87171", "#A78BFA"];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// ─── Sort Header ──────────────────────────────────────────────────────────────
function SortHeader({ field, label, align, sortField, sortDir, onSort }: {
  field: SortField; label: string; align?: "right";
  sortField: SortField; sortDir: SortOrder; onSort: (f: SortField) => void;
}) {
  const isActive = sortField === field;
  return (
    <button
      onClick={() => onSort(field)}
      style={{
        background: "none", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 4,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        width: "100%", padding: 0,
        fontSize: 9, fontWeight: 600, textTransform: "uppercase" as const,
        letterSpacing: "2.5px", color: isActive ? "#F0F0F5" : "#5C5C78",
        fontFamily: "var(--font-jetbrains), monospace",
        transition: "color 0.15s ease",
      }}
    >
      {label}
      <span style={{ display: "flex", flexDirection: "column", gap: 0, lineHeight: 0 }}>
        <ChevronUp size={9} style={{ color: isActive && sortDir === "asc" ? "#00F5FF" : "#5C5C78", marginBottom: -2, opacity: isActive && sortDir === "asc" ? 1 : 0.3 }} />
        <ChevronDown size={9} style={{ color: isActive && sortDir === "desc" ? "#00F5FF" : "#5C5C78", marginTop: -2, opacity: isActive && sortDir === "desc" ? 1 : 0.3 }} />
      </span>
    </button>
  );
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────────
function SkeletonRow({ index }: { index: number }) {
  return (
    <tr style={{
      borderBottom: "1px solid rgba(255,255,255,0.03)",
      animation: "pulse 1.8s ease-in-out infinite",
      animationDelay: `${index * 60}ms`,
    }}>
      <td style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.04)", flexShrink: 0 }} />
          <div>
            <div style={{ width: 120, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.05)", marginBottom: 6 }} />
            <div style={{ width: 160, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.03)" }} />
          </div>
        </div>
      </td>
      <td style={{ padding: "14px 12px" }}>
        <div style={{ width: 60, height: 20, borderRadius: 6, background: "rgba(255,255,255,0.04)" }} />
      </td>
      <td style={{ padding: "14px 12px", textAlign: "right" }} className="col-workflows">
        <div style={{ width: 28, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.04)", marginLeft: "auto" }} />
      </td>
      <td style={{ padding: "14px 12px", textAlign: "right" }} className="col-executions">
        <div style={{ width: 28, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.04)", marginLeft: "auto" }} />
      </td>
      <td style={{ padding: "14px 12px", textAlign: "right" }} className="col-xp">
        <div style={{ width: 50, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.04)", marginLeft: "auto" }} />
      </td>
      <td style={{ padding: "14px 12px" }} className="col-sub">
        <div style={{ width: 80, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.04)" }} />
      </td>
      <td style={{ padding: "14px 12px" }} className="col-joined">
        <div style={{ width: 80, height: 10, borderRadius: 4, background: "rgba(255,255,255,0.04)" }} />
      </td>
      <td style={{ padding: "14px 12px" }}>
        <div style={{ width: 60, height: 26, borderRadius: 6, background: "rgba(255,255,255,0.03)" }} />
      </td>
    </tr>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function DeleteConfirmModal({ user, onConfirm, onCancel, isDeleting, t }: {
  user: ApiUser;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
  t: (key: string) => string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) onCancel(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.25, ease: smoothEase }}
        style={{
          width: 420, maxWidth: "90vw",
          background: "rgba(18,18,30,0.95)",
          backdropFilter: "blur(24px) saturate(1.3)",
          border: "1px solid rgba(248,113,113,0.15)",
          borderRadius: 14, padding: 28,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 1px rgba(248,113,113,0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <AlertTriangle size={18} style={{ color: "#F87171" }} />
          </div>
          <div>
            <h3 style={{
              fontSize: 16, fontWeight: 700, color: "#F0F0F5", margin: 0,
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}>
              {t('admin.users.deleteTitle')}
            </h3>
            <p style={{
              fontSize: 12, color: "#9898B0", margin: "2px 0 0",
            }}>
              {t('admin.users.deleteWarning')}
            </p>
          </div>
        </div>

        <div style={{
          padding: "14px 16px", borderRadius: 10,
          background: "rgba(248,113,113,0.05)",
          border: "1px solid rgba(248,113,113,0.08)",
          marginBottom: 24,
        }}>
          <p style={{ fontSize: 13, color: "#9898B0", margin: 0, lineHeight: 1.6 }}>
            {t('admin.users.deleteConfirmText')}{" "}
            <strong style={{ color: "#F0F0F5" }}>{user.name || user.email || "this user"}</strong>
            {user.email && user.name && (
              <span style={{ color: "#5C5C78" }}> ({user.email})</span>
            )}
            {t('admin.users.deleteDataWarning')}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            disabled={isDeleting}
            style={{
              padding: "9px 20px", borderRadius: 10,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#9898B0", fontSize: 13, fontWeight: 500,
              cursor: isDeleting ? "not-allowed" : "pointer",
              fontFamily: "var(--font-dm-sans), sans-serif",
              transition: "all 0.15s ease",
              opacity: isDeleting ? 0.5 : 1,
            }}
          >
            {t('admin.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            style={{
              padding: "9px 20px", borderRadius: 10,
              background: isDeleting ? "rgba(248,113,113,0.15)" : "rgba(248,113,113,0.12)",
              border: "1px solid rgba(248,113,113,0.2)",
              color: "#F87171", fontSize: 13, fontWeight: 600,
              cursor: isDeleting ? "not-allowed" : "pointer",
              fontFamily: "var(--font-dm-sans), sans-serif",
              transition: "all 0.15s ease",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            {isDeleting ? (
              <>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                {t('admin.users.deleting')}
              </>
            ) : (
              <>
                <Trash2 size={14} />
                {t('admin.users.deleteTitle')}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Orphan Card (with inline Bind-to-user form) ─────────────────────────────
interface OrphanOutcome {
  gateway?: string;
  subscriptionId?: string;
  customerId?: string;
  customerEmail?: string | null;
  subscriptionStatus?: string;
  priceId?: string | null;
  planId?: string | null;
  notes?: Record<string, unknown>;
  paymentEmails?: string[];
  paymentContacts?: string[];
  attempted?: Record<string, string | null>;
  hint?: string;
}

function OrphanCard({
  entry,
  onBound,
}: {
  entry: { userId?: string; email: string | null; outcome: unknown };
  onBound: () => void | Promise<void>;
}) {
  const o = entry.outcome as OrphanOutcome;
  const [email, setEmail] = useState<string>(
    o.customerEmail ||
      entry.email ||
      (typeof o.notes?.email === "string" ? (o.notes.email as string) : "") ||
      (Array.isArray(o.paymentEmails) ? o.paymentEmails[0] ?? "" : "") ||
      "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleBind() {
    if (!email.trim() || !o.gateway || !o.subscriptionId || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/subscriptions/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway: o.gateway,
          subscriptionId: o.subscriptionId,
          userEmail: email.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: data.error || `Bind failed (${res.status})` });
      } else if (data.bound) {
        setResult({
          ok: true,
          message: `Bound → ${data.user?.email ?? email} · ${data.previousRole} → ${data.newRole}`,
        });
        await onBound();
      } else {
        setResult({ ok: false, message: data.message || `Not bound (${data.reason})` });
      }
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li style={{
      padding: "10px 12px", borderRadius: 8,
      background: "rgba(167,139,250,0.05)",
      border: "1px solid rgba(167,139,250,0.12)",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#F0F0F5", fontWeight: 700, fontFamily: "var(--font-jetbrains), monospace" }}>
          {o.gateway?.toUpperCase()} · {o.subscriptionId}
        </span>
        <span style={{ fontSize: 10, color: "#A78BFA", fontFamily: "var(--font-jetbrains), monospace", textTransform: "uppercase", letterSpacing: 1 }}>
          {o.subscriptionStatus}
        </span>
        {(o.priceId || o.planId) && (
          <span style={{ fontSize: 10, color: "#9898B0", fontFamily: "var(--font-jetbrains), monospace" }}>
            plan/price: {o.priceId || o.planId}
          </span>
        )}
      </div>

      {o.attempted && (
        <div style={{
          fontSize: 10, color: "#9898B0",
          fontFamily: "var(--font-jetbrains), monospace",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.04)",
          borderRadius: 6, padding: "6px 8px",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <div style={{ color: "#5C5C78", fontSize: 9, letterSpacing: 1 }}>TRIED:</div>
          {Object.entries(o.attempted).map(([k, v]) => (
            <div key={k}><span style={{ color: "#5C5C78" }}>{k}</span> = <span style={{ color: v ? "#F0F0F5" : "#5C5C78" }}>{v || "—"}</span></div>
          ))}
        </div>
      )}

      {o.notes && Object.keys(o.notes).length > 0 && (
        <div style={{
          fontSize: 10, color: "#9898B0",
          fontFamily: "var(--font-jetbrains), monospace",
          wordBreak: "break-all",
        }}>
          <span style={{ color: "#5C5C78" }}>notes:</span> {JSON.stringify(o.notes)}
        </div>
      )}

      {(o.paymentEmails?.length || o.paymentContacts?.length) && (
        <div style={{
          fontSize: 10, color: "#9898B0",
          fontFamily: "var(--font-jetbrains), monospace",
          wordBreak: "break-all",
          background: "rgba(16,185,129,0.04)",
          border: "1px solid rgba(16,185,129,0.08)",
          borderRadius: 6, padding: "6px 8px",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <div style={{ color: "#34D399", fontSize: 9, letterSpacing: 1 }}>FROM PAYMENTS:</div>
          {o.paymentEmails && o.paymentEmails.length > 0 && (
            <div><span style={{ color: "#5C5C78" }}>email:</span> {o.paymentEmails.join(", ")}</div>
          )}
          {o.paymentContacts && o.paymentContacts.length > 0 && (
            <div><span style={{ color: "#5C5C78" }}>contact:</span> {o.paymentContacts.join(", ")}</div>
          )}
        </div>
      )}

      {/* Bind-to-user form */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <input
          type="email"
          placeholder="User email in DB (case-insensitive)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          style={{
            flex: "1 1 220px",
            padding: "7px 10px", borderRadius: 7,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#F0F0F5", fontSize: 12, outline: "none",
            fontFamily: "var(--font-dm-sans), sans-serif",
          }}
        />
        <button
          onClick={handleBind}
          disabled={!email.trim() || submitting}
          style={{
            padding: "7px 14px", borderRadius: 7,
            background: submitting ? "rgba(167,139,250,0.08)" : "rgba(167,139,250,0.15)",
            border: "1px solid rgba(167,139,250,0.25)",
            color: "#A78BFA", fontSize: 11, fontWeight: 700,
            cursor: !email.trim() || submitting ? "not-allowed" : "pointer",
            opacity: !email.trim() || submitting ? 0.5 : 1,
            fontFamily: "var(--font-dm-sans), sans-serif",
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          {submitting ? (
            <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <CheckCircle2 size={12} />
          )}
          Bind to user
        </button>
      </div>

      {result && (
        <div style={{
          fontSize: 11,
          color: result.ok ? "#34D399" : "#F87171",
          fontFamily: "var(--font-dm-sans), sans-serif",
        }}>
          {result.ok ? "✓ " : "✗ "}{result.message}
        </div>
      )}
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AdminUsersPage() {
  const { t } = useLocale();

  // ── State ─────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "ALL">("ALL");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);

  const [deleteTarget, setDeleteTarget] = useState<ApiUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  // ── Reconcile state ─────────────────────────────────────────────────────
  const [reconcilingUserId, setReconcilingUserId] = useState<string | null>(null);
  const [bulkReconciling, setBulkReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<{
    title: string;
    subtitle?: string;
    counts: { reconciled: number; unresolved: number; orphans?: number; errors: number; skipped: number };
    reconciled: { userId?: string; email: string | null; outcome: unknown }[];
    unresolved: { userId?: string; email: string | null; outcome: unknown }[];
    orphans?: { userId?: string; email: string | null; outcome: unknown }[];
    errors: { userId?: string; email: string | null; outcome: unknown }[];
  } | null>(null);
  const [stuckCount, setStuckCount] = useState<number | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounced search ────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  // ── Fetch users ─────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        search: debouncedSearch,
        role: roleFilter === "ALL" ? "" : roleFilter,
        page: String(page),
        limit: String(PAGE_SIZE),
        sort: sortField,
        order: sortDir,
      });
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch users (${res.status})`);
      }
      const data: UsersResponse = await res.json();
      setUsers(data.users);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, roleFilter, page, sortField, sortDir]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── Sort handler ────────────────────────────────────────────────────────
  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(1);
  }

  // ── Role change ─────────────────────────────────────────────────────────
  async function handleRoleChange(userId: string, newRole: UserRole) {
    setChangingRoleId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update role");
      }
      await fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setChangingRoleId(null);
    }
  }

  // ── Reconcile: load count of stuck users ────────────────────────────────
  const fetchStuckCount = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/reconcile-subscriptions");
      if (!res.ok) return;
      const data = await res.json();
      setStuckCount(typeof data.total === "number" ? data.total : null);
    } catch {
      // non-critical; banner just won't appear
    }
  }, []);

  useEffect(() => {
    fetchStuckCount();
  }, [fetchStuckCount]);

  // ── Reconcile: bulk backfill via provider-first DEEP SCAN ───────────────
  // Discovers paid users even when no subscription ID was ever written to the
  // DB (webhook never fired, verify call died mid-redirect). Queries Stripe
  // and Razorpay directly and matches live subscriptions back to users.
  async function handleBulkReconcile() {
    if (bulkReconciling) return;
    const confirmed = window.confirm(
      "Run a DEEP SCAN of Stripe and Razorpay?\n\n" +
        "This lists every live subscription in your payment accounts and matches them back to users — " +
        "fixing cases where a user paid but nothing was ever written to our DB.\n\n" +
        "Subscriptions that don't match any user are reported as 'orphans'. " +
        "Subscriptions whose plan_id / price_id don't map to any env var are reported as 'unresolved'.",
    );
    if (!confirmed) return;
    setBulkReconciling(true);
    try {
      const res = await fetch("/api/admin/reconcile-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Reconcile failed (${res.status})`);
      const s = data.summary || {};
      setReconcileReport({
        title: `Deep scan complete`,
        subtitle: `Stripe: ${s.stripeSubsSeen ?? 0} live subs · Razorpay: ${s.razorpaySubsSeen ?? 0} subs (${s.razorpaySubsLive ?? 0} live)`,
        counts: data.counts,
        reconciled: data.reconciled || [],
        unresolved: data.unresolved || [],
        orphans: data.orphans || [],
        errors: data.errors || [],
      });
      await Promise.all([fetchUsers(), fetchStuckCount()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to run reconcile");
    } finally {
      setBulkReconciling(false);
    }
  }

  // ── Reconcile: single user force re-sync ────────────────────────────────
  async function handleReconcileUser(userId: string, email: string | null) {
    if (reconcilingUserId) return;
    setReconcilingUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Reconcile failed (${res.status})`);
      const outcome = data.outcome;
      const status = outcome?.status ?? "unknown";
      if (status === "reconciled") {
        setReconcileReport({
          title: `Reconciled ${email || userId}`,
          counts: { reconciled: 1, unresolved: 0, errors: 0, skipped: 0 },
          reconciled: [{ userId, email, outcome }],
          unresolved: [],
          errors: [],
        });
      } else if (status === "unresolved") {
        setReconcileReport({
          title: `Could not resolve ${email || userId}`,
          counts: { reconciled: 0, unresolved: 1, errors: 0, skipped: 0 },
          reconciled: [],
          unresolved: [{ userId, email, outcome }],
          errors: [],
        });
      } else if (status === "error") {
        setReconcileReport({
          title: `Error reconciling ${email || userId}`,
          counts: { reconciled: 0, unresolved: 0, errors: 1, skipped: 0 },
          reconciled: [],
          unresolved: [],
          errors: [{ userId, email, outcome }],
        });
      } else {
        setReconcileReport({
          title: `${email || userId}: ${status}`,
          counts: { reconciled: 0, unresolved: 0, errors: 0, skipped: 1 },
          reconciled: [],
          unresolved: [],
          errors: [],
        });
      }
      await Promise.all([fetchUsers(), fetchStuckCount()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reconcile user");
    } finally {
      setReconcilingUserId(null);
    }
  }

  // ── Delete user ─────────────────────────────────────────────────────────
  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete user");
      }
      setDeleteTarget(null);
      await fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setIsDeleting(false);
    }
  }

  // ── CSV Export ──────────────────────────────────────────────────────────
  async function exportCSV() {
    // Fetch all matching users for export (up to 10000)
    try {
      const params = new URLSearchParams({
        search: debouncedSearch,
        role: roleFilter === "ALL" ? "" : roleFilter,
        page: "1",
        limit: "10000",
        sort: sortField,
        order: sortDir,
      });
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch users for export");
      const data: UsersResponse = await res.json();

      const header = "Name,Email,Role,Workflows,Executions,XP,Level,Subscription,Gateway,StripeSubId,RazorpaySubId,RazorpayPlanId,Joined";
      const csv = [
        header,
        ...data.users.map(u => {
          const hasSub = Boolean(u.stripeSubscriptionId || u.razorpaySubscriptionId);
          return [
            `"${(u.name || "").replace(/"/g, '""')}"`,
            `"${(u.email || "").replace(/"/g, '""')}"`,
            u.role,
            u._count.workflows,
            u._count.executions,
            u.xp,
            u.level,
            hasSub ? "Active" : "None",
            u.paymentGateway || "",
            u.stripeSubscriptionId || "",
            u.razorpaySubscriptionId || "",
            u.razorpayPlanId || "",
            formatDate(u.createdAt),
          ].join(",");
        }),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `buildflow-users-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export CSV. Please try again.");
    }
  }

  // ── Pagination range ───────────────────────────────────────────────────
  function getPageNumbers(): (number | "...")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "...")[] = [1];
    if (page > 3) pages.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push("...");
    if (totalPages > 1) pages.push(totalPages);
    return pages;
  }

  // ── Computed ────────────────────────────────────────────────────────────
  const showingStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="admin-users-page" style={{ padding: "24px 28px 48px", maxWidth: 1400, margin: "0 auto" }}>
      {/* ── Delete confirm modal ──────────────────────────────────────── */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteConfirmModal
            user={deleteTarget}
            onConfirm={handleDeleteConfirm}
            onCancel={() => { if (!isDeleting) setDeleteTarget(null); }}
            isDeleting={isDeleting}
            t={t as (key: string) => string}
          />
        )}
      </AnimatePresence>

      {/* ── Reconcile Report Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {reconcileReport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              position: "fixed", inset: 0, zIndex: 9999,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
              padding: 16,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setReconcileReport(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.25, ease: smoothEase }}
              style={{
                width: 640, maxWidth: "100%", maxHeight: "80vh",
                background: "rgba(18,18,30,0.96)",
                backdropFilter: "blur(24px) saturate(1.3)",
                border: "1px solid rgba(0,245,255,0.15)",
                borderRadius: 14, padding: 24,
                display: "flex", flexDirection: "column", gap: 16,
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: "rgba(0,245,255,0.08)",
                  border: "1px solid rgba(0,245,255,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <CheckCircle2 size={16} style={{ color: "#00F5FF" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{
                    fontSize: 15, fontWeight: 700, color: "#F0F0F5", margin: 0,
                    fontFamily: "var(--font-dm-sans), sans-serif",
                  }}>
                    {reconcileReport.title}
                  </h3>
                  {reconcileReport.subtitle && (
                    <p style={{ fontSize: 11, color: "#9898B0", margin: "2px 0 0", fontFamily: "var(--font-dm-sans), sans-serif" }}>
                      {reconcileReport.subtitle}
                    </p>
                  )}
                  <p style={{ fontSize: 11, color: "#5C5C78", margin: "2px 0 0", fontFamily: "var(--font-jetbrains), monospace" }}>
                    RECONCILED {reconcileReport.counts.reconciled} · UNRESOLVED {reconcileReport.counts.unresolved}
                    {typeof reconcileReport.counts.orphans === "number" && <> · ORPHANS {reconcileReport.counts.orphans}</>}
                    {' '}· ERRORS {reconcileReport.counts.errors} · SKIPPED {reconcileReport.counts.skipped}
                  </p>
                </div>
                <button
                  onClick={() => setReconcileReport(null)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "#5C5C78", display: "flex", padding: 4,
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Reconciled */}
              {reconcileReport.reconciled.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "#34D399", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 6, fontFamily: "var(--font-jetbrains), monospace" }}>
                    FIXED ({reconcileReport.reconciled.length})
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 160, overflowY: "auto" }}>
                    {reconcileReport.reconciled.map((entry) => {
                      const o = entry.outcome as { previousRole?: string; newRole?: string; gateway?: string; subscriptionId?: string };
                      return (
                        <li key={entry.userId} style={{
                          padding: "6px 10px", borderRadius: 6,
                          background: "rgba(16,185,129,0.05)",
                          border: "1px solid rgba(16,185,129,0.08)",
                          marginBottom: 4,
                          display: "flex", flexDirection: "column", gap: 2,
                        }}>
                          <span style={{ fontSize: 12, color: "#F0F0F5", fontWeight: 500 }}>{entry.email || entry.userId}</span>
                          <span style={{ fontSize: 10, color: "#9898B0", fontFamily: "var(--font-jetbrains), monospace" }}>
                            {o.gateway?.toUpperCase()} · {o.previousRole} → {o.newRole}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Unresolved */}
              {reconcileReport.unresolved.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "#F59E0B", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 6, fontFamily: "var(--font-jetbrains), monospace" }}>
                    NEEDS ATTENTION ({reconcileReport.unresolved.length})
                  </div>
                  <p style={{ fontSize: 11, color: "#9898B0", margin: "0 0 6px", lineHeight: 1.5 }}>
                    Live subscription found, but the plan / price ID couldn&apos;t be mapped to a role. Likely env-var drift — cross-check each <code style={{ background: "rgba(255,255,255,0.05)", padding: "1px 4px", borderRadius: 4 }}>planId</code> below against <code style={{ background: "rgba(255,255,255,0.05)", padding: "1px 4px", borderRadius: 4 }}>RAZORPAY_*_PLAN_ID</code> / <code style={{ background: "rgba(255,255,255,0.05)", padding: "1px 4px", borderRadius: 4 }}>STRIPE_*_PRICE_ID</code> in Vercel.
                  </p>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 200, overflowY: "auto" }}>
                    {reconcileReport.unresolved.map((entry) => {
                      const o = entry.outcome as { reason?: string; gateway?: string; details?: Record<string, unknown> };
                      return (
                        <li key={entry.userId} style={{
                          padding: "6px 10px", borderRadius: 6,
                          background: "rgba(245,158,11,0.05)",
                          border: "1px solid rgba(245,158,11,0.08)",
                          marginBottom: 4,
                          display: "flex", flexDirection: "column", gap: 2,
                        }}>
                          <span style={{ fontSize: 12, color: "#F0F0F5", fontWeight: 500 }}>{entry.email || entry.userId}</span>
                          <span style={{ fontSize: 10, color: "#9898B0", fontFamily: "var(--font-jetbrains), monospace" }}>
                            {o.gateway?.toUpperCase()} · {o.reason} · {JSON.stringify(o.details || {})}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Orphans — live sub exists on provider but no matching user.
                  Each card has a diagnostic trail + an inline "Bind to user"
                  form so you can paste the paying user's DB email and attach
                  the orphan subscription to them directly. */}
              {reconcileReport.orphans && reconcileReport.orphans.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: "#A78BFA", fontWeight: 700, letterSpacing: "1.5px", fontFamily: "var(--font-jetbrains), monospace" }}>
                      ORPHAN SUBSCRIPTIONS ({reconcileReport.orphans.length})
                    </div>
                    <button
                      onClick={async () => {
                        if (!reconcileReport.orphans) return;
                        const candidates = reconcileReport.orphans
                          .map((entry) => {
                            const o = entry.outcome as OrphanOutcome;
                            const notesEmail = typeof o.notes?.email === "string" ? (o.notes.email as string) : "";
                            const paymentEmail = Array.isArray((o as { paymentEmails?: string[] }).paymentEmails)
                              ? (o as { paymentEmails?: string[] }).paymentEmails?.[0] ?? ""
                              : "";
                            const email = o.customerEmail || entry.email || notesEmail || paymentEmail || "";
                            return { entry, o, email };
                          })
                          .filter((c) => c.email && c.o.gateway && c.o.subscriptionId);
                        if (candidates.length === 0) {
                          alert("No orphans with an auto-detectable email. Bind each one manually.");
                          return;
                        }
                        const confirmed = window.confirm(
                          `Auto-match ${candidates.length} orphan(s) using the email we detected from notes / customer / payment records?`,
                        );
                        if (!confirmed) return;
                        let ok = 0, fail = 0;
                        for (const { o, email } of candidates) {
                          try {
                            const res = await fetch("/api/admin/subscriptions/bind", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                gateway: o.gateway,
                                subscriptionId: o.subscriptionId,
                                userEmail: email,
                              }),
                            });
                            const data = await res.json();
                            if (res.ok && data.bound) ok++; else fail++;
                          } catch { fail++; }
                        }
                        alert(`Auto-match complete — ${ok} bound, ${fail} failed.`);
                        await Promise.all([fetchUsers(), fetchStuckCount()]);
                        setReconcileReport(null);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "6px 12px", borderRadius: 8,
                        background: "rgba(167,139,250,0.12)",
                        border: "1px solid rgba(167,139,250,0.25)",
                        color: "#A78BFA", fontSize: 11, fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "var(--font-dm-sans), sans-serif",
                      }}
                    >
                      Auto-match all
                    </button>
                  </div>
                  <p style={{ fontSize: 11, color: "#9898B0", margin: "0 0 8px", lineHeight: 1.5 }}>
                    These live subscriptions exist on Stripe / Razorpay but couldn&apos;t be matched to any user in the DB. <strong>Auto-match all</strong> tries to bind each one using the email we detected (notes, customer, or payment record). Otherwise use the inline <strong>Bind to user</strong> input to assign manually.
                  </p>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 400, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    {reconcileReport.orphans.map((entry, idx) => (
                      <OrphanCard
                        key={`${idx}`}
                        entry={entry}
                        onBound={async () => {
                          await Promise.all([fetchUsers(), fetchStuckCount()]);
                        }}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {/* Errors */}
              {reconcileReport.errors.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: "#F87171", fontWeight: 700, letterSpacing: "1.5px", marginBottom: 6, fontFamily: "var(--font-jetbrains), monospace" }}>
                    ERRORS ({reconcileReport.errors.length})
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 160, overflowY: "auto" }}>
                    {reconcileReport.errors.map((entry) => {
                      const o = entry.outcome as { error?: string; gateway?: string };
                      return (
                        <li key={entry.userId} style={{
                          padding: "6px 10px", borderRadius: 6,
                          background: "rgba(248,113,113,0.05)",
                          border: "1px solid rgba(248,113,113,0.08)",
                          marginBottom: 4,
                          display: "flex", flexDirection: "column", gap: 2,
                        }}>
                          <span style={{ fontSize: 12, color: "#F0F0F5", fontWeight: 500 }}>{entry.email || entry.userId}</span>
                          <span style={{ fontSize: 10, color: "#F87171", fontFamily: "var(--font-jetbrains), monospace" }}>
                            {o.gateway?.toUpperCase()} · {o.error}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => setReconcileReport(null)}
                  style={{
                    padding: "8px 18px", borderRadius: 10,
                    background: "rgba(0,245,255,0.08)",
                    border: "1px solid rgba(0,245,255,0.15)",
                    color: "#00F5FF", fontSize: 12, fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "var(--font-dm-sans), sans-serif",
                  }}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Page Header ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: smoothEase }}
        style={{ marginBottom: 24 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Users size={14} style={{ color: "#00F5FF" }} />
          <span style={{
            fontSize: 9, color: "#00F5FF", fontWeight: 600,
            letterSpacing: "2.5px", textTransform: "uppercase",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            {t('admin.users.sectionLabel')}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 style={{
            fontSize: 24, fontWeight: 700, color: "#F0F0F5", margin: 0,
            fontFamily: "var(--font-dm-sans), sans-serif", letterSpacing: "-0.02em",
          }}>
            {t('admin.users.title')}
          </h1>
          <span style={{
            display: "inline-flex", alignItems: "center",
            padding: "3px 10px", borderRadius: 8,
            background: "rgba(0,245,255,0.06)",
            border: "1px solid rgba(0,245,255,0.1)",
            fontSize: 11, fontWeight: 700,
            color: "#00F5FF",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            {loading ? "..." : total.toLocaleString()}
          </span>
        </div>
        <p style={{ fontSize: 13, color: "#5C5C78", margin: "4px 0 0", fontFamily: "var(--font-dm-sans), sans-serif" }}>
          {t('admin.users.subtitle')}
        </p>
      </motion.div>

      {/* ── Toolbar: Search + Filters + Actions ──────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.45, ease: smoothEase }}
        style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
          marginBottom: 16,
        }}
        className="users-toolbar"
      >
        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px", borderRadius: 10,
          background: "rgba(18,18,30,0.6)",
          backdropFilter: "blur(16px) saturate(1.3)",
          border: "1px solid rgba(255,255,255,0.06)",
          flex: "1 1 260px", maxWidth: 380, minWidth: 200,
        }}>
          <Search size={14} style={{ color: "#5C5C78", flexShrink: 0 }} />
          <input
            placeholder={t('admin.users.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: "none", border: "none", outline: "none",
              color: "#F0F0F5", fontSize: 12, width: "100%",
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#5C5C78", display: "flex", padding: 2, flexShrink: 0,
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Role filter dropdown */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 10,
            background: "rgba(18,18,30,0.6)",
            backdropFilter: "blur(16px) saturate(1.3)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <Filter size={12} style={{ color: "#5C5C78" }} />
            <select
              value={roleFilter}
              onChange={e => { setRoleFilter(e.target.value as UserRole | "ALL"); setPage(1); }}
              style={{
                background: "none", border: "none", outline: "none",
                color: "#F0F0F5", fontSize: 12, cursor: "pointer",
                fontFamily: "var(--font-dm-sans), sans-serif",
                appearance: "none", paddingRight: 16,
              }}
            >
              <option value="ALL" style={{ background: "#070809" }}>{t('admin.users.allRoles')}</option>
              <option value="FREE" style={{ background: "#070809" }}>FREE</option>
              <option value="MINI" style={{ background: "#070809" }}>MINI</option>
              <option value="STARTER" style={{ background: "#070809" }}>STARTER</option>
              <option value="PRO" style={{ background: "#070809" }}>PRO</option>
              <option value="TEAM_ADMIN" style={{ background: "#070809" }}>TEAM_ADMIN</option>
              <option value="PLATFORM_ADMIN" style={{ background: "#070809" }}>PLATFORM_ADMIN</option>
            </select>
            <ChevronDown size={10} style={{ color: "#5C5C78", position: "absolute", right: 12, pointerEvents: "none" }} />
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Deep Scan — provider-first subscription reconcile */}
        <button
          onClick={handleBulkReconcile}
          disabled={bulkReconciling}
          title="Lists every live subscription in Stripe + Razorpay, matches them back to users, and writes role + subscription IDs into the DB. Use this to recover paid users whose webhook never landed or whose verify call failed mid-redirect."
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 10,
            cursor: bulkReconciling ? "wait" : "pointer",
            background: "rgba(245,158,11,0.12)",
            border: "1px solid rgba(245,158,11,0.25)",
            color: "#F59E0B",
            fontSize: 12, fontWeight: 600,
            fontFamily: "var(--font-dm-sans), sans-serif",
            transition: "all 0.15s ease",
            opacity: bulkReconciling ? 0.6 : 1,
          }}
        >
          {bulkReconciling ? (
            <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <RefreshCw size={13} />
          )}
          Deep Scan Subs
          {typeof stuckCount === "number" && stuckCount > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minWidth: 18, height: 18, padding: "0 6px", borderRadius: 9,
              background: "rgba(245,158,11,0.25)",
              fontSize: 10, fontWeight: 700, color: "#F59E0B",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {stuckCount}
            </span>
          )}
        </button>

        {/* Export CSV */}
        <button
          onClick={exportCSV}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: 10, cursor: "pointer",
            background: "rgba(0,245,255,0.08)",
            border: "1px solid rgba(0,245,255,0.12)",
            color: "#00F5FF",
            fontSize: 12, fontWeight: 600,
            fontFamily: "var(--font-dm-sans), sans-serif",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,245,255,0.14)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,245,255,0.08)"; }}
        >
          <Download size={13} />
          {t('admin.users.exportCsv')}
        </button>
      </motion.div>

      {/* ── Error Banner ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 16px", marginBottom: 16, borderRadius: 10,
              background: "rgba(248,113,113,0.06)",
              border: "1px solid rgba(248,113,113,0.12)",
            }}
          >
            <AlertTriangle size={14} style={{ color: "#F87171", flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#F87171", flex: 1 }}>{error}</span>
            <button
              onClick={fetchUsers}
              style={{
                padding: "5px 12px", borderRadius: 6,
                background: "rgba(248,113,113,0.1)", border: "none",
                color: "#F87171", fontSize: 11, fontWeight: 600,
                cursor: "pointer", fontFamily: "var(--font-dm-sans), sans-serif",
              }}
            >
              Retry
            </button>
            <button
              onClick={() => setError(null)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#F87171", display: "flex", padding: 2,
              }}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Table Card ───────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5, ease: smoothEase }}
        style={{
          background: "rgba(18,18,30,0.6)",
          backdropFilter: "blur(16px) saturate(1.3)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {/* Table header accent */}
        <div style={{
          position: "relative", height: 2,
          background: "linear-gradient(90deg, #00F5FF, #B87333, transparent)",
          opacity: 0.35,
        }} />

        <div style={{ overflowX: "auto" }}>
          <table style={{
            width: "100%", borderCollapse: "collapse",
            fontFamily: "var(--font-dm-sans), sans-serif",
            minWidth: 960,
          }} className="users-table">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <th style={{ padding: "14px 16px", textAlign: "left" }}>
                  <SortHeader field="name" label={t('admin.users.name')} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th style={{ padding: "14px 12px", textAlign: "left" }}>
                  <SortHeader field="role" label={t('admin.users.role')} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th style={{ padding: "14px 12px", textAlign: "right" }} className="col-workflows">
                  <SortHeader field="workflows" label={t('admin.users.workflows')} align="right" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th style={{ padding: "14px 12px", textAlign: "right" }} className="col-executions">
                  <SortHeader field="executions" label={t('admin.users.executions')} align="right" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th style={{ padding: "14px 12px", textAlign: "right" }} className="col-xp">
                  <SortHeader field="xp" label={t('admin.users.xpLevel')} align="right" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th style={{ padding: "14px 12px", textAlign: "left" }} className="col-sub">
                  <span style={{
                    fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: "2.5px", color: "#5C5C78",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    {t('admin.users.subscription')}
                  </span>
                </th>
                <th style={{ padding: "14px 12px", textAlign: "left" }} className="col-joined">
                  <SortHeader field="createdAt" label={t('admin.users.joined')} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th style={{ padding: "14px 16px", textAlign: "center" }}>
                  <span style={{
                    fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: "2.5px", color: "#5C5C78",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    {t('admin.users.actions')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} index={i} />)
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div style={{
                      padding: "56px 24px", textAlign: "center",
                    }}>
                      <Users size={36} style={{ color: "#5C5C78", marginBottom: 14, opacity: 0.4 }} />
                      <div style={{ fontSize: 15, color: "#9898B0", fontWeight: 600, fontFamily: "var(--font-dm-sans), sans-serif" }}>
                        {t('admin.users.noUsers')}
                      </div>
                      <div style={{ fontSize: 12, color: "#5C5C78", marginTop: 4 }}>
                        {t('admin.users.adjustFilters')}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((user, i) => (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.04 + i * 0.025, duration: 0.35, ease: smoothEase }}
                    className="user-row"
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                      transition: "background 0.15s ease",
                    }}
                  >
                    {/* User (avatar + name + email) */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                        {user.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={user.image}
                            alt=""
                            width={34}
                            height={34}
                            style={{
                              borderRadius: 10, background: "rgba(255,255,255,0.05)",
                              flexShrink: 0, objectFit: "cover",
                              border: "1px solid rgba(255,255,255,0.06)",
                            }}
                          />
                        ) : (
                          <div style={{
                            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                            background: `${getAvatarColor(user.id)}18`,
                            border: `1px solid ${getAvatarColor(user.id)}30`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 700, color: getAvatarColor(user.id),
                            fontFamily: "var(--font-dm-sans), sans-serif",
                          }}>
                            {getInitial(user.name, user.email)}
                          </div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 600, color: "#F0F0F5",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            maxWidth: 200, lineHeight: 1.3,
                          }}>
                            {user.name || t('admin.users.unnamed')}
                          </div>
                          <div style={{
                            fontSize: 10, color: "#5C5C78",
                            fontFamily: "var(--font-jetbrains), monospace",
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            maxWidth: 200,
                          }}>
                            {user.email || t('admin.users.noEmail')}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Role badge */}
                    <td style={{ padding: "12px 12px" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "4px 10px", borderRadius: 7,
                        background: ROLE_BADGE[user.role].bg,
                        border: `1px solid ${ROLE_BADGE[user.role].border}`,
                        color: ROLE_BADGE[user.role].color,
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.5px",
                        fontFamily: "var(--font-jetbrains), monospace",
                      }}>
                        {ROLE_ICON[user.role]}
                        {user.role}
                      </span>
                    </td>

                    {/* Workflows */}
                    <td style={{ padding: "12px 12px", textAlign: "right" }} className="col-workflows">
                      <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                        <FolderKanban size={11} style={{ color: "#A78BFA" }} />
                        <span style={{
                          fontSize: 13, color: "#F0F0F5", fontWeight: 500,
                          fontFamily: "var(--font-jetbrains), monospace",
                        }}>
                          {user._count.workflows}
                        </span>
                      </div>
                    </td>

                    {/* Executions */}
                    <td style={{ padding: "12px 12px", textAlign: "right" }} className="col-executions">
                      <span style={{
                        fontSize: 13, color: "#F0F0F5", fontWeight: 500,
                        fontFamily: "var(--font-jetbrains), monospace",
                      }}>
                        {user._count.executions}
                      </span>
                    </td>

                    {/* XP / Level */}
                    <td style={{ padding: "12px 12px", textAlign: "right" }} className="col-xp">
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <Zap size={10} style={{ color: "#FFBF00" }} />
                          <span style={{
                            fontSize: 12, color: "#F0F0F5", fontWeight: 600,
                            fontFamily: "var(--font-jetbrains), monospace",
                          }}>
                            {user.xp.toLocaleString()}
                          </span>
                        </div>
                        <span style={{
                          fontSize: 9, color: "#5C5C78",
                          fontFamily: "var(--font-jetbrains), monospace",
                        }}>
                          {t('admin.users.level')} {user.level}
                        </span>
                      </div>
                    </td>

                    {/* Subscription — shows BOTH Stripe and Razorpay. Highlights
                        "STUCK" (has a sub ID but role=FREE) so admins can
                        force-reconcile in one click via the actions column. */}
                    <td style={{ padding: "12px 12px" }} className="col-sub">
                      {(() => {
                        const hasStripe = Boolean(user.stripeSubscriptionId);
                        const hasRazorpay = Boolean(user.razorpaySubscriptionId);
                        const hasAny = hasStripe || hasRazorpay;
                        const isStuck = hasAny && user.role === "FREE";

                        if (!hasAny) {
                          return (
                            <span style={{
                              fontSize: 11, color: "#5C5C78",
                              fontFamily: "var(--font-jetbrains), monospace",
                            }}>
                              {t('admin.users.none')}
                            </span>
                          );
                        }

                        const gatewayIcon = hasRazorpay
                          ? <Smartphone size={10} style={{ color: isStuck ? "#F59E0B" : "#34D399" }} />
                          : <CreditCard size={10} style={{ color: isStuck ? "#F59E0B" : "#34D399" }} />;
                        const gatewayLabel = user.paymentGateway
                          ? user.paymentGateway.toUpperCase()
                          : hasRazorpay ? "RAZORPAY" : "STRIPE";

                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              {gatewayIcon}
                              <span style={{
                                fontSize: 11,
                                color: isStuck ? "#F59E0B" : "#34D399",
                                fontWeight: 700,
                                fontFamily: "var(--font-jetbrains), monospace",
                              }}>
                                {isStuck ? "STUCK — PAID BUT FREE" : gatewayLabel}
                              </span>
                            </div>
                            {isStuck && (
                              <span style={{
                                fontSize: 9, color: "#F59E0B", opacity: 0.85,
                                fontFamily: "var(--font-jetbrains), monospace",
                              }}>
                                Click ⟳ in actions to re-sync
                              </span>
                            )}
                            {!isStuck && user.stripeCurrentPeriodEnd && (
                              <span style={{
                                fontSize: 9, color: "#5C5C78",
                                fontFamily: "var(--font-jetbrains), monospace",
                              }}>
                                Until {formatDate(user.stripeCurrentPeriodEnd)}
                              </span>
                            )}
                            {hasRazorpay && user.razorpayPlanId && (
                              <span
                                title="Razorpay plan_id — cross-check against RAZORPAY_*_PLAN_ID env vars if stuck"
                                style={{
                                  fontSize: 9, color: "#5C5C78",
                                  fontFamily: "var(--font-jetbrains), monospace",
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                  maxWidth: 160,
                                }}
                              >
                                {user.razorpayPlanId}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    {/* Joined */}
                    <td style={{ padding: "12px 12px" }} className="col-joined">
                      <span style={{
                        fontSize: 11, color: "#9898B0",
                        fontFamily: "var(--font-jetbrains), monospace",
                        whiteSpace: "nowrap",
                      }}>
                        {formatDate(user.createdAt)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                        {/* Role change dropdown */}
                        <div style={{ position: "relative" }}>
                          <select
                            value={user.role}
                            disabled={changingRoleId === user.id}
                            onChange={e => handleRoleChange(user.id, e.target.value as UserRole)}
                            style={{
                              padding: "5px 24px 5px 8px", borderRadius: 7,
                              background: changingRoleId === user.id ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.03)",
                              border: "1px solid rgba(184,115,51,0.08)",
                              color: changingRoleId === user.id ? "#5C5C78" : "#9898B0",
                              fontSize: 10, fontWeight: 600,
                              fontFamily: "var(--font-jetbrains), monospace",
                              cursor: changingRoleId === user.id ? "wait" : "pointer",
                              appearance: "none",
                              outline: "none",
                              opacity: changingRoleId === user.id ? 0.6 : 1,
                              transition: "all 0.15s ease",
                            }}
                          >
                            <option value="FREE" style={{ background: "#070809" }}>FREE</option>
                            <option value="MINI" style={{ background: "#070809" }}>MINI</option>
                            <option value="STARTER" style={{ background: "#070809" }}>STARTER</option>
                            <option value="PRO" style={{ background: "#070809" }}>PRO</option>
                            <option value="TEAM_ADMIN" style={{ background: "#070809" }}>TEAM_ADMIN</option>
                            <option value="PLATFORM_ADMIN" style={{ background: "#070809" }}>PLATFORM_ADMIN</option>
                          </select>
                          <ChevronDown size={9} style={{
                            position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
                            color: "#5C5C78", pointerEvents: "none",
                          }} />
                          {changingRoleId === user.id && (
                            <Loader2
                              size={10}
                              style={{
                                position: "absolute", right: -18, top: "50%", transform: "translateY(-50%)",
                                color: "#00F5FF", animation: "spin 1s linear infinite",
                              }}
                            />
                          )}
                        </div>

                        {/* Reconcile (force re-sync from payment provider) —
                            only shown when the user has any subscription ID.
                            Glows amber when the user looks stuck (has sub but role=FREE). */}
                        {(user.stripeSubscriptionId || user.razorpaySubscriptionId) && (
                          <button
                            onClick={() => handleReconcileUser(user.id, user.email)}
                            disabled={reconcilingUserId === user.id}
                            title={
                              user.role === "FREE"
                                ? "User has an active subscription but is on FREE — click to force re-sync from the payment provider"
                                : "Force re-sync subscription from the payment provider"
                            }
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "center",
                              width: 28, height: 28, borderRadius: 7,
                              background: user.role === "FREE"
                                ? "rgba(245,158,11,0.12)"
                                : "rgba(255,255,255,0.02)",
                              border: user.role === "FREE"
                                ? "1px solid rgba(245,158,11,0.22)"
                                : "1px solid rgba(184,115,51,0.08)",
                              color: user.role === "FREE" ? "#F59E0B" : "#5C5C78",
                              cursor: reconcilingUserId === user.id ? "wait" : "pointer",
                              transition: "all 0.15s ease",
                              opacity: reconcilingUserId === user.id ? 0.6 : 1,
                            }}
                          >
                            {reconcilingUserId === user.id ? (
                              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                            ) : (
                              <RefreshCw size={13} />
                            )}
                          </button>
                        )}

                        {/* Delete button */}
                        <button
                          onClick={() => setDeleteTarget(user)}
                          title="Delete user"
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            width: 28, height: 28, borderRadius: 7,
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(184,115,51,0.08)",
                            color: "#5C5C78", cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = "rgba(248,113,113,0.1)";
                            e.currentTarget.style.borderColor = "rgba(248,113,113,0.2)";
                            e.currentTarget.style.color = "#F87171";
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                            e.currentTarget.style.borderColor = "rgba(184,115,51,0.08)";
                            e.currentTarget.style.color = "#5C5C78";
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ─────────────────────────────────────────────── */}
        {!loading && totalPages > 0 && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 18px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
          className="users-pagination"
          >
            <span style={{
              fontSize: 11, color: "#5C5C78",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {total === 0 ? t('admin.users.noResults') : (
                <>{t('admin.users.showing')} {showingStart}&ndash;{showingEnd} {t('admin.of')} {total.toLocaleString()} {t('admin.users.users')}</>
              )}
            </span>

            {totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {/* Prev */}
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, borderRadius: 8,
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                    color: page === 1 ? "#5C5C78" : "#9898B0",
                    cursor: page === 1 ? "not-allowed" : "pointer",
                    opacity: page === 1 ? 0.4 : 1,
                    transition: "all 0.15s ease",
                  }}
                >
                  <ChevronLeft size={14} />
                </button>

                {/* Page numbers */}
                {getPageNumbers().map((pn, idx) =>
                  pn === "..." ? (
                    <span key={`ellipsis-${idx}`} style={{
                      fontSize: 11, color: "#5C5C78", padding: "0 4px",
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}>
                      ...
                    </span>
                  ) : (
                    <button
                      key={pn}
                      onClick={() => setPage(pn)}
                      style={{
                        width: 32, height: 32, borderRadius: 8,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: page === pn ? "rgba(0,245,255,0.08)" : "transparent",
                        border: page === pn ? "1px solid rgba(0,245,255,0.15)" : "1px solid transparent",
                        color: page === pn ? "#00F5FF" : "#9898B0",
                        fontSize: 12, fontWeight: page === pn ? 700 : 500, cursor: "pointer",
                        fontFamily: "var(--font-jetbrains), monospace",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {pn}
                    </button>
                  )
                )}

                {/* Next */}
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, borderRadius: 8,
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                    color: page === totalPages ? "#5C5C78" : "#9898B0",
                    cursor: page === totalPages ? "not-allowed" : "pointer",
                    opacity: page === totalPages ? 0.4 : 1,
                    transition: "all 0.15s ease",
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* ── Responsive Styles + Animations ────────────────────────────── */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .user-row:hover {
          background: rgba(255,255,255,0.02) !important;
        }

        @media (max-width: 1100px) {
          .col-xp,
          .col-sub {
            display: none !important;
          }
          .users-table {
            min-width: 720px !important;
          }
        }

        @media (max-width: 768px) {
          .admin-users-page {
            padding: 16px 14px 32px !important;
          }
          .col-workflows,
          .col-executions,
          .col-joined,
          .col-xp,
          .col-sub {
            display: none !important;
          }
          .users-table {
            min-width: 0 !important;
          }
          .users-toolbar {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .users-toolbar > div:first-child {
            max-width: 100% !important;
          }
          .users-pagination {
            flex-direction: column !important;
            gap: 10px !important;
          }
        }

        @media (max-width: 640px) {
          .users-toolbar {
            flex-wrap: wrap !important;
          }
          .users-toolbar > * {
            flex: 1 1 auto !important;
          }
          .users-toolbar > div:first-child {
            max-width: 100% !important;
            width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}
