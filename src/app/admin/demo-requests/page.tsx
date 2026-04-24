"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar, Mail, Phone, Building2, User as UserIcon, Briefcase,
  MessageSquare, ChevronLeft, ChevronRight, Loader2, Inbox, Search,
  CheckCircle2, Clock, X, ExternalLink,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

// ─── Types ──────────────────────────────────────────────────────────────
type DemoRequestStatus = "NEW" | "CONTACTED" | "SCHEDULED" | "COMPLETED" | "CANCELLED";

interface DemoRequestItem {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string;
  roleTitle: string | null;
  message: string | null;
  status: DemoRequestStatus;
  adminNote: string | null;
  contactedAt: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: DemoRequestItem[];
  total: number;
  page: number;
  totalPages: number;
  statusCounts: Record<string, number>;
}

// ─── Constants ──────────────────────────────────────────────────────────
const STATUS_ORDER: DemoRequestStatus[] = ["NEW", "CONTACTED", "SCHEDULED", "COMPLETED", "CANCELLED"];

const STATUS_COLORS: Record<DemoRequestStatus, string> = {
  NEW:       "#00F5FF",
  CONTACTED: "#4F8AFF",
  SCHEDULED: "#F59E0B",
  COMPLETED: "#34D399",
  CANCELLED: "#6B7280",
};

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

// ─── Helpers ────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .filter(Boolean)
    .join("") || "?";
}

// ─── Status Badge ───────────────────────────────────────────────────────
function StatusBadge({ status }: { status: DemoRequestStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 9px", borderRadius: 6,
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
        background: `${color}18`, color, border: `1px solid ${color}30`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}80` }} />
      {status}
    </span>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function AdminDemoRequestsPage() {
  const { t } = useLocale();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DemoRequestStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/admin/demo-requests?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const json = (await res.json()) as ListResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  // Debounce search re-fetch — wait 300ms after user stops typing.
  useEffect(() => {
    const t = setTimeout(() => { void fetchList(); }, 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => data?.items.find((i) => i.id === selectedId) ?? null,
    [data, selectedId],
  );

  useEffect(() => {
    setNoteDraft(selected?.adminNote ?? "");
  }, [selected?.id, selected?.adminNote]);

  const updateStatus = useCallback(async (newStatus: DemoRequestStatus) => {
    if (!selected) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/admin/demo-requests/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Update failed");
      await fetchList();
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingStatus(false);
    }
  }, [selected, fetchList]);

  const saveNote = useCallback(async () => {
    if (!selected) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/admin/demo-requests/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNote: noteDraft }),
      });
      if (!res.ok) throw new Error("Save failed");
      await fetchList();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingNote(false);
    }
  }, [selected, noteDraft, fetchList]);

  const totalCount = data?.total ?? 0;
  const counts = data?.statusCounts ?? {};

  return (
    <div className="dr-page" style={{ padding: "28px 32px 48px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, rgba(79,138,255,0.18), rgba(99,102,241,0.12))",
            border: "1px solid rgba(79,138,255,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#A5B4FC",
          }}>
            <Calendar size={18} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#F0F0F5", margin: 0 }}>
            {t("admin.demoRequests.title")}
          </h1>
          <span style={{ fontSize: 12, color: "#7C7C96", marginLeft: 6 }}>
            {totalCount} {totalCount === 1 ? t("admin.demoRequests.recordOne") : t("admin.demoRequests.recordMany")}
          </span>
        </div>
        <p style={{ fontSize: 13, color: "#9898B0", margin: 0, maxWidth: 640, lineHeight: 1.55 }}>
          {t("admin.demoRequests.subtitle")}
        </p>
      </div>

      {/* Filter bar */}
      <div className="dr-filter-bar" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <StatusTab
          label={t("admin.demoRequests.all")}
          active={statusFilter === ""}
          count={totalCount}
          onClick={() => { setStatusFilter(""); setPage(1); }}
          color="#8898AA"
        />
        {STATUS_ORDER.map((s) => (
          <StatusTab
            key={s}
            label={t(`admin.demoRequests.status.${s}` as TranslationKey)}
            active={statusFilter === s}
            count={counts[s] ?? 0}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            color={STATUS_COLORS[s]}
          />
        ))}

        <div className="dr-filter-spacer" style={{ flex: 1, minWidth: 180 }} />

        {/* Search */}
        <div className="dr-search" style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
          minWidth: 240,
        }}>
          <Search size={13} style={{ color: "#6B7280" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("admin.demoRequests.searchPlaceholder")}
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              color: "#F0F0F5", fontSize: 12.5, fontFamily: "inherit",
            }}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear"
              style={{ background: "transparent", border: "none", color: "#6B7280", cursor: "pointer", padding: 0, display: "flex" }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 16,
          background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)",
          color: "#FCA5A5", fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div style={{ padding: 60, textAlign: "center", color: "#6B7280" }}>
          <Loader2 size={20} className="spin-anim" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 13 }}>{t("admin.demoRequests.loading")}</div>
        </div>
      )}

      {/* Empty */}
      {!loading && data && data.items.length === 0 && (
        <div style={{
          padding: "48px 24px", textAlign: "center",
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
          borderRadius: 14, color: "#6B7280",
        }}>
          <Inbox size={28} style={{ marginBottom: 12, opacity: 0.6 }} />
          <div style={{ fontSize: 14, color: "#9898B0", marginBottom: 4 }}>
            {t("admin.demoRequests.emptyTitle")}
          </div>
          <div style={{ fontSize: 12 }}>
            {t("admin.demoRequests.emptyBody")}
          </div>
        </div>
      )}

      {/* List */}
      {data && data.items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.items.map((item) => (
            <RequestRow
              key={item.id}
              item={item}
              onClick={() => setSelectedId(item.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 24 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={paginationBtnStyle(page <= 1)}
          >
            <ChevronLeft size={14} /> {t("admin.prev")}
          </button>
          <span style={{ fontSize: 12, color: "#9898B0" }}>
            {t("admin.page")} {page} / {data.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            style={paginationBtnStyle(page >= data.totalPages)}
          >
            {t("admin.next")} <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSelectedId(null)}
            className="dr-modal-backdrop"
            style={{
              position: "fixed", inset: 0, zIndex: 120,
              background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 24,
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: 0.25, ease: smoothEase }}
              onClick={(e) => e.stopPropagation()}
              className="dr-modal-card"
              style={{
                width: "100%", maxWidth: 640, maxHeight: "85vh", overflow: "auto",
                borderRadius: 18, background: "#0B0B14",
                border: "1px solid rgba(255,255,255,0.06)",
                boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
              }}
            >
              <DetailCard
                item={selected}
                noteDraft={noteDraft}
                setNoteDraft={setNoteDraft}
                onSaveNote={saveNote}
                savingNote={savingNote}
                onStatusChange={updateStatus}
                updatingStatus={updatingStatus}
                onClose={() => setSelectedId(null)}
                t={t}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Responsive layout — tuned for the admin shell which itself already
          collapses the sidebar on mobile, so my breakpoints are relative to
          the *content area* width, not the viewport. */}
      <style jsx global>{`
        /* Loader spinner (shared between list loading + inline note save). */
        @keyframes drSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin-anim { animation: drSpin 0.9s linear infinite; }

        /* Tablet (≤ 960px) — hide the flex spacer so the search box falls
           in line next to the filter chips rather than getting pushed to
           its own row with a huge gap on its left. */
        @media (max-width: 960px) {
          .dr-page { padding: 24px 22px 40px; }
          .dr-filter-spacer { display: none; }
          .dr-search { flex: 1 1 260px; min-width: 0 !important; }
        }

        /* Phone (≤ 640px) — tighten everything, let the request row
           stack vertically (title row 1, meta row 2, contact row 3),
           collapse the detail modal's info grid to 1 column, and
           reduce modal + page padding so nothing feels cramped. */
        @media (max-width: 640px) {
          .dr-page { padding: 18px 14px 32px; }
          .dr-filter-bar { gap: 8px; }
          .dr-search { flex: 1 1 100%; }

          .dr-row { grid-template-columns: 36px 1fr !important; }
          /* Reset avatar's 2-row span so meta/contact can sit right below
             the title without leaving an empty col-2 cell in row 2. */
          .dr-row > *:first-child { grid-row: 1 / span 1 !important; }
          .dr-row-meta {
            grid-column: 1 / span 2 !important;
            justify-content: flex-start !important;
            padding-left: 46px; /* align under title (avatar 36 + gap 10) */
          }
          .dr-row-contact {
            grid-column: 1 / span 2 !important;
            gap: 10px !important;
            padding-left: 46px;
          }

          .dr-modal-backdrop { padding: 10px !important; }
          .dr-modal-card { max-height: 92vh !important; }
          .dr-detail { padding: 18px 16px 18px !important; }
          .dr-info-grid { grid-template-columns: 1fr !important; }
          .dr-detail-actions { justify-content: stretch !important; }
          .dr-detail-actions > a { flex: 1; justify-content: center; }
        }

        /* Very narrow (≤ 380px — iPhone SE / older Androids) —
           extra squeeze on tab chip padding so all five status tabs
           plus "All" can wrap to two rows instead of overflowing. */
        @media (max-width: 380px) {
          .dr-filter-bar button { padding: 6px 10px !important; font-size: 11.5px !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Status filter tab ──────────────────────────────────────────────────
function StatusTab({
  label, active, count, onClick, color,
}: {
  label: string; active: boolean; count: number; onClick: () => void; color: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        padding: "7px 13px", borderRadius: 10,
        background: active ? `${color}1A` : "rgba(255,255,255,0.02)",
        border: `1px solid ${active ? `${color}50` : "rgba(255,255,255,0.06)"}`,
        color: active ? color : "#9898B0",
        fontSize: 12, fontWeight: 600, cursor: "pointer",
        transition: "all 160ms ease",
      }}
    >
      {label}
      <span style={{
        padding: "1px 7px", borderRadius: 6,
        background: active ? `${color}25` : "rgba(255,255,255,0.04)",
        fontSize: 10.5, fontWeight: 700, letterSpacing: "0.02em",
      }}>{count}</span>
    </button>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────
function RequestRow({ item, onClick }: { item: DemoRequestItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="dr-row"
      style={{
        textAlign: "left", padding: "14px 18px", borderRadius: 12,
        background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)",
        color: "#F0F0F5", cursor: "pointer",
        transition: "all 160ms ease",
        display: "grid", gap: 4,
        gridTemplateColumns: "36px 1fr auto",
        alignItems: "center",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(79,138,255,0.2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.025)";
        (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)";
      }}
    >
      <div style={{
        gridRow: "1 / span 2",
        width: 36, height: 36, borderRadius: 10,
        background: "linear-gradient(135deg, rgba(79,138,255,0.2), rgba(99,102,241,0.14))",
        border: "1px solid rgba(79,138,255,0.25)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 800, color: "#C7D2FE", letterSpacing: "-0.01em",
      }}>
        {initials(item.name)}
      </div>

      <div className="dr-row-title" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#F0F0F5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
          {item.name}
        </span>
        <span style={{ fontSize: 12, color: "#7C7C96", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          · {item.company}
        </span>
      </div>

      <div className="dr-row-meta" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <StatusBadge status={item.status} />
        <span style={{ fontSize: 11, color: "#6B7280", fontVariantNumeric: "tabular-nums" }}>
          {timeAgo(item.createdAt)}
        </span>
      </div>

      <div className="dr-row-contact" style={{ gridColumn: "2 / span 2", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#9898B0", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Mail size={11} /> {item.email}
        </span>
        {item.roleTitle && (
          <span style={{ fontSize: 12, color: "#9898B0", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Briefcase size={11} /> {item.roleTitle}
          </span>
        )}
        {item.phone && (
          <span style={{ fontSize: 12, color: "#9898B0", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Phone size={11} /> {item.phone}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Detail card ────────────────────────────────────────────────────────
function DetailCard({
  item, noteDraft, setNoteDraft, onSaveNote, savingNote,
  onStatusChange, updatingStatus, onClose, t,
}: {
  item: DemoRequestItem;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  onSaveNote: () => void;
  savingNote: boolean;
  onStatusChange: (s: DemoRequestStatus) => void;
  updatingStatus: boolean;
  onClose: () => void;
  t: (key: TranslationKey) => string;
}) {
  const mailtoHref = `mailto:${item.email}?subject=${encodeURIComponent(
    `BuildFlow demo — ${item.name}`,
  )}&body=${encodeURIComponent(
    `Hi ${item.name.split(" ")[0] || item.name},\n\nThanks for your demo request${item.company ? ` (${item.company})` : ""}. I'd love to find 20 minutes this week to walk you through BuildFlow tailored to your practice.\n\nHere are a few times that work on my end — let me know which one fits, or reply with your own slot:\n\n• [time 1]\n• [time 2]\n• [time 3]\n\nBest,\nThe BuildFlow team`,
  )}`;

  return (
    <div className="dr-detail" style={{ padding: "22px 24px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: "linear-gradient(135deg, rgba(79,138,255,0.22), rgba(99,102,241,0.14))",
          border: "1px solid rgba(79,138,255,0.28)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, fontWeight: 800, color: "#C7D2FE",
        }}>
          {initials(item.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#F0F0F5", margin: 0 }}>{item.name}</h2>
            <StatusBadge status={item.status} />
          </div>
          <div style={{ fontSize: 12.5, color: "#9898B0" }}>
            {item.company}
            {item.roleTitle && <span> · {item.roleTitle}</span>}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
            color: "#9898B0", cursor: "pointer", padding: 6, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Contact */}
      <div className="dr-info-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
        <InfoCell icon={<Mail size={12} />} label={t("admin.demoRequests.email" as TranslationKey)} value={item.email} href={mailtoHref} external />
        {item.phone && <InfoCell icon={<Phone size={12} />} label={t("admin.demoRequests.phone" as TranslationKey)} value={item.phone} href={`tel:${item.phone}`} />}
        <InfoCell icon={<Building2 size={12} />} label={t("admin.demoRequests.company" as TranslationKey)} value={item.company} />
        {item.roleTitle && <InfoCell icon={<UserIcon size={12} />} label={t("admin.demoRequests.role" as TranslationKey)} value={item.roleTitle} />}
      </div>

      {/* Message */}
      {item.message && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#7C7C96", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <MessageSquare size={11} /> {t("admin.demoRequests.message" as TranslationKey)}
          </div>
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "rgba(79,138,255,0.04)", border: "1px solid rgba(79,138,255,0.1)",
            fontSize: 13, color: "#D0D0DC", lineHeight: 1.55, whiteSpace: "pre-wrap",
          }}>
            {item.message}
          </div>
        </div>
      )}

      {/* Status transitions */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#7C7C96", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
          {t("admin.demoRequests.updateStatus" as TranslationKey)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => onStatusChange(s)}
              disabled={updatingStatus || item.status === s}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "6px 11px", borderRadius: 8,
                background: item.status === s ? `${STATUS_COLORS[s]}22` : "rgba(255,255,255,0.03)",
                border: `1px solid ${item.status === s ? `${STATUS_COLORS[s]}55` : "rgba(255,255,255,0.06)"}`,
                color: item.status === s ? STATUS_COLORS[s] : "#9898B0",
                fontSize: 11.5, fontWeight: 600,
                cursor: item.status === s || updatingStatus ? "default" : "pointer",
                opacity: updatingStatus && item.status !== s ? 0.5 : 1,
                transition: "all 140ms ease",
              }}
            >
              {s === item.status && <CheckCircle2 size={11} />}
              {t(`admin.demoRequests.status.${s}` as TranslationKey)}
            </button>
          ))}
        </div>
        {/* Timestamps */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "#6B7280" }}>
          <TimestampLine icon={<Inbox size={11} />} label={t("admin.demoRequests.submitted" as TranslationKey)} iso={item.createdAt} />
          {item.contactedAt && <TimestampLine icon={<Mail size={11} />} label={t("admin.demoRequests.contactedAt" as TranslationKey)} iso={item.contactedAt} />}
          {item.scheduledAt && <TimestampLine icon={<Calendar size={11} />} label={t("admin.demoRequests.scheduledAt" as TranslationKey)} iso={item.scheduledAt} />}
          {item.completedAt && <TimestampLine icon={<CheckCircle2 size={11} />} label={t("admin.demoRequests.completedAt" as TranslationKey)} iso={item.completedAt} />}
        </div>
      </div>

      {/* Admin notes */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#7C7C96", textTransform: "uppercase", letterSpacing: 1.2 }}>
            {t("admin.demoRequests.adminNotes" as TranslationKey)}
          </div>
          <button
            onClick={onSaveNote}
            disabled={savingNote || noteDraft === (item.adminNote ?? "")}
            style={{
              padding: "4px 10px", borderRadius: 7,
              background: noteDraft === (item.adminNote ?? "") ? "rgba(255,255,255,0.04)" : "rgba(52,211,153,0.14)",
              border: `1px solid ${noteDraft === (item.adminNote ?? "") ? "rgba(255,255,255,0.06)" : "rgba(52,211,153,0.3)"}`,
              color: noteDraft === (item.adminNote ?? "") ? "#6B7280" : "#6EE7B7",
              fontSize: 11, fontWeight: 700, cursor: savingNote || noteDraft === (item.adminNote ?? "") ? "default" : "pointer",
              display: "inline-flex", alignItems: "center", gap: 5,
              opacity: savingNote ? 0.6 : 1,
            }}
          >
            {savingNote ? <Loader2 size={10} className="spin-anim" /> : null}
            {savingNote ? t("admin.demoRequests.saving" as TranslationKey) : t("admin.demoRequests.save" as TranslationKey)}
          </button>
        </div>
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder={t("admin.demoRequests.notesPlaceholder" as TranslationKey)}
          rows={3}
          style={{
            width: "100%", padding: "10px 12px", borderRadius: 10,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
            color: "#F0F0F5", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5,
            resize: "vertical",
          }}
        />
      </div>

      {/* Attribution (collapsed) */}
      {(item.utmSource || item.referrer) && (
        <div style={{
          padding: "10px 12px", borderRadius: 10,
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
          fontSize: 11, color: "#6B7280", display: "flex", gap: 12, flexWrap: "wrap",
        }}>
          {item.utmSource && <span><strong style={{ color: "#9898B0" }}>utm_source</strong>: {item.utmSource}</span>}
          {item.utmMedium && <span><strong style={{ color: "#9898B0" }}>utm_medium</strong>: {item.utmMedium}</span>}
          {item.utmCampaign && <span><strong style={{ color: "#9898B0" }}>utm_campaign</strong>: {item.utmCampaign}</span>}
          {item.referrer && <span><strong style={{ color: "#9898B0" }}>referrer</strong>: {item.referrer.slice(0, 60)}{item.referrer.length > 60 ? "…" : ""}</span>}
        </div>
      )}

      {/* Primary action: send the calendar invite via email */}
      <div className="dr-detail-actions" style={{ marginTop: 18, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#6B7280", alignSelf: "center", marginRight: "auto" }}>
          <Clock size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
          {formatDate(item.createdAt)}
        </span>
        <a
          href={mailtoHref}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "9px 16px", borderRadius: 10,
            background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 12.5, fontWeight: 700, textDecoration: "none",
            boxShadow: "0 4px 18px rgba(79,138,255,0.25)",
          }}
        >
          <Mail size={12} /> {t("admin.demoRequests.replyEmail" as TranslationKey)}
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

function InfoCell({
  icon, label, value, href, external,
}: {
  icon: React.ReactNode; label: string; value: string; href?: string; external?: boolean;
}) {
  const body = (
    <>
      <div style={{ fontSize: 10, color: "#7C7C96", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3, display: "inline-flex", alignItems: "center", gap: 5 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 13, color: href ? "#A5B4FC" : "#F0F0F5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
        {value}
        {href && external && <ExternalLink size={10} style={{ flexShrink: 0, opacity: 0.7 }} />}
      </div>
    </>
  );
  const cellStyle: React.CSSProperties = {
    padding: "9px 12px", borderRadius: 10,
    background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)",
    textDecoration: "none",
  };
  if (href) return <a href={href} style={cellStyle}>{body}</a>;
  return <div style={cellStyle}>{body}</div>;
}

function TimestampLine({ icon, label, iso }: { icon: React.ReactNode; label: string; iso: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {icon} <span style={{ color: "#9898B0" }}>{label}</span> {timeAgo(iso)}
    </span>
  );
}

function paginationBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "7px 12px", borderRadius: 9,
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
    color: disabled ? "#4B5563" : "#9898B0",
    fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
