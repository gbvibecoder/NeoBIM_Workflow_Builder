"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, SkipForward } from "lucide-react";

interface ResponseRow {
  userId: string;
  userEmail: string | null;
  userName: string | null;
  discovery: string | null;
  discoveryOther: string | null;
  profession: string | null;
  professionOther: string | null;
  teamSize: string | null;
  pricing: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  skippedAtScene: number | null;
  createdAt: string;
  updatedAt: string;
}

interface RecentResponsesTableProps {
  rows: ResponseRow[];
  pageSize?: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

export function RecentResponsesTable({ rows, pageSize = 10 }: RecentResponsesTableProps) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const slice = useMemo(
    () => rows.slice(page * pageSize, (page + 1) * pageSize),
    [rows, page, pageSize]
  );

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 14,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          Recent responses ({rows.length})
        </div>
        {pageCount > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-secondary)" }}>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#E0E7FF", fontSize: 11, cursor: page === 0 ? "not-allowed" : "pointer", opacity: page === 0 ? 0.5 : 1 }}
            >
              ←
            </button>
            <span style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              style={{ padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#E0E7FF", fontSize: 11, cursor: page >= pageCount - 1 ? "not-allowed" : "pointer", opacity: page >= pageCount - 1 ? 0.5 : 1 }}
            >
              →
            </button>
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              <th style={{ padding: "8px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>User</th>
              <th style={{ padding: "8px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Discovery</th>
              <th style={{ padding: "8px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Profession</th>
              <th style={{ padding: "8px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Team</th>
              <th style={{ padding: "8px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Pricing</th>
              <th style={{ padding: "8px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Status</th>
              <th style={{ padding: "8px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--text-disabled)" }}>
                  No responses in this range yet.
                </td>
              </tr>
            )}
            {slice.map((r) => {
              const done = !!r.completedAt;
              const skipped = !!r.skippedAt;
              return (
                <tr key={r.userId} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "10px 8px", color: "var(--text-primary)" }}>
                    <div style={{ fontWeight: 600 }}>{r.userName ?? "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{r.userEmail ?? "—"}</div>
                  </td>
                  <td style={{ padding: "10px 8px", color: "var(--text-secondary)" }}>
                    {r.discovery ?? "—"}
                    {r.discoveryOther && <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontStyle: "italic" }}>"{r.discoveryOther}"</div>}
                  </td>
                  <td style={{ padding: "10px 8px", color: "var(--text-secondary)" }}>
                    {r.profession ?? "—"}
                    {r.professionOther && <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontStyle: "italic" }}>"{r.professionOther}"</div>}
                  </td>
                  <td style={{ padding: "10px 8px", color: "var(--text-secondary)" }}>{r.teamSize ?? "—"}</td>
                  <td style={{ padding: "10px 8px", color: "var(--text-secondary)" }}>{r.pricing ?? "—"}</td>
                  <td style={{ padding: "10px 8px" }}>
                    {done && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#10B981", fontSize: 11, fontWeight: 600 }}>
                        <CheckCircle2 size={12} /> Completed
                      </span>
                    )}
                    {!done && skipped && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#F59E0B", fontSize: 11, fontWeight: 600 }}>
                        <SkipForward size={12} /> Skipped at {r.skippedAtScene ?? "—"}
                      </span>
                    )}
                    {!done && !skipped && (
                      <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>In progress</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 8px", color: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains), monospace", fontSize: 11 }}>
                    {formatDate(r.updatedAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
