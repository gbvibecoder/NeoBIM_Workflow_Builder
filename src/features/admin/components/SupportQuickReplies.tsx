"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Loader2,
  MessageSquareText,
  Hash,
  Tag,
  AlertCircle,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────── */

interface QuickReply {
  id: string;
  title: string;
  category: string;
  content: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface QuickReplyForm {
  title: string;
  category: string;
  content: string;
}

/* ── Constants ────────────────────────────────────────────────────── */

const CATEGORY_OPTIONS = [
  "GENERAL",
  "WORKFLOW_HELP",
  "NODE_EXECUTION",
  "BILLING",
  "BUG_REPORT",
  "FEATURE_REQUEST",
  "IFC_PARSING",
  "COST_ESTIMATION",
  "THREE_D_GENERATION",
  "ACCOUNT",
  "TECHNICAL",
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  GENERAL: "#4F8AFF",
  WORKFLOW_HELP: "#06B6D4",
  NODE_EXECUTION: "#8B5CF6",
  BILLING: "#FBBF24",
  BUG_REPORT: "#EF4444",
  FEATURE_REQUEST: "#34D399",
  IFC_PARSING: "#EC4899",
  COST_ESTIMATION: "#F59E0B",
  THREE_D_GENERATION: "#14B8A6",
  ACCOUNT: "#F97316",
  TECHNICAL: "#A78BFA",
};

function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "#6B7280";
}

const EMPTY_FORM: QuickReplyForm = {
  title: "",
  category: "GENERAL",
  content: "",
};

/* ── Main Component ───────────────────────────────────────────────── */

export default function SupportQuickReplies() {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Form state ─────────────────────────────────────────────────── */
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<QuickReplyForm>({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* ── Delete state ───────────────────────────────────────────────── */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* ── Fetch replies ──────────────────────────────────────────────── */
  const fetchReplies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/support/quick-replies");
      if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
      const data = await res.json();
      setReplies(data.replies ?? data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReplies();
  }, [fetchReplies]);

  /* ── Open form for new reply ────────────────────────────────────── */
  const handleAdd = () => {
    setFormData({ ...EMPTY_FORM });
    setEditingId(null);
    setFormError(null);
    setShowForm(true);
  };

  /* ── Open form for editing ──────────────────────────────────────── */
  const handleEdit = (reply: QuickReply) => {
    setFormData({
      title: reply.title,
      category: reply.category,
      content: reply.content,
    });
    setEditingId(reply.id);
    setFormError(null);
    setShowForm(true);
  };

  /* ── Cancel form ────────────────────────────────────────────────── */
  const handleCancel = () => {
    setShowForm(false);
    setFormData({ ...EMPTY_FORM });
    setEditingId(null);
    setFormError(null);
  };

  /* ── Save (create or update) ────────────────────────────────────── */
  const handleSave = async () => {
    if (!formData.title.trim()) {
      setFormError("Title is required");
      return;
    }
    if (!formData.content.trim()) {
      setFormError("Content is required");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/admin/support/quick-replies/${editingId}`
        : "/api/admin/support/quick-replies";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.title.trim(),
          category: formData.category,
          content: formData.content.trim(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(
          errData?.message ?? `Failed to save (${res.status})`
        );
      }

      setShowForm(false);
      setFormData({ ...EMPTY_FORM });
      setEditingId(null);
      await fetchReplies();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  /* ── Delete ─────────────────────────────────────────────────────── */
  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }

    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/support/quick-replies/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to delete (${res.status})`);
      setConfirmDeleteId(null);
      if (editingId === id) handleCancel();
      await fetchReplies();
    } catch {
      // silent
    } finally {
      setDeletingId(null);
    }
  };

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2
            style={{
              color: "#F0F0F5",
              fontSize: 20,
              fontWeight: 700,
              margin: 0,
            }}
          >
            Quick Reply Templates
          </h2>
          <p style={{ color: "#666", fontSize: 13, margin: "4px 0 0" }}>
            Manage reusable response templates for support conversations
          </p>
        </div>

        <button
          onClick={handleAdd}
          disabled={showForm && editingId === null}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 18px",
            background:
              showForm && editingId === null
                ? "rgba(79,138,255,0.2)"
                : "#4F8AFF",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor:
              showForm && editingId === null ? "not-allowed" : "pointer",
            transition: "background 0.15s",
          }}
        >
          <Plus size={14} />
          Add Quick Reply
        </button>
      </div>

      {/* ── Inline Form ────────────────────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(79,138,255,0.2)",
                borderRadius: 12,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#F0F0F5",
                }}
              >
                {editingId ? "Edit Quick Reply" : "New Quick Reply"}
              </div>

              {/* Title + Category row */}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 2 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: "#888",
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Title
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    placeholder="e.g. Billing explanation"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      color: "#E0E0F0",
                      fontSize: 13,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                    onFocus={(e) =>
                      (e.currentTarget.style.borderColor =
                        "rgba(79,138,255,0.4)")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.borderColor =
                        "rgba(255,255,255,0.1)")
                    }
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: "#888",
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value })
                    }
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      color: "#E0E0F0",
                      fontSize: 13,
                      outline: "none",
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option
                        key={c}
                        value={c}
                        style={{ background: "#1A1A2E" }}
                      >
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Content textarea */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "#888",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Content
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) =>
                    setFormData({ ...formData, content: e.target.value })
                  }
                  placeholder="Write the reply template content..."
                  rows={5}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#E0E0F0",
                    fontSize: 13,
                    lineHeight: 1.6,
                    resize: "vertical",
                    outline: "none",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor =
                      "rgba(79,138,255,0.4)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor =
                      "rgba(255,255,255,0.1)")
                  }
                />
              </div>

              {/* Error */}
              {formError && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "#EF4444",
                    fontSize: 12,
                  }}
                >
                  <AlertCircle size={14} />
                  {formError}
                </div>
              )}

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={handleCancel}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 16px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#AAA",
                    fontSize: 13,
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.08)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.05)")
                  }
                >
                  <X size={14} />
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 20px",
                    background: saving
                      ? "rgba(79,138,255,0.3)"
                      : "#4F8AFF",
                    border: "none",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: saving ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                  }}
                >
                  {saving ? (
                    <Loader2
                      size={14}
                      style={{ animation: "spin 1s linear infinite" }}
                    />
                  ) : (
                    <Save size={14} />
                  )}
                  {editingId ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Loading ────────────────────────────────────────────────── */}
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 60,
            color: "#666",
          }}
        >
          <Loader2
            size={24}
            style={{ animation: "spin 1s linear infinite" }}
          />
          <span style={{ marginLeft: 10, fontSize: 14 }}>
            Loading templates...
          </span>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && !loading && (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "#EF4444",
            fontSize: 14,
            background: "rgba(239,68,68,0.05)",
            borderRadius: 12,
            border: "1px solid rgba(239,68,68,0.15)",
          }}
        >
          {error}
        </div>
      )}

      {/* ── Reply List ─────────────────────────────────────────────── */}
      {!loading && !error && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {replies.length === 0 && (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#555",
                fontSize: 13,
                background: "rgba(255,255,255,0.02)",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <MessageSquareText
                size={32}
                style={{ margin: "0 auto 12px", opacity: 0.3 }}
              />
              <div>No quick reply templates yet</div>
              <div style={{ fontSize: 12, marginTop: 4, opacity: 0.6 }}>
                Click &ldquo;Add Quick Reply&rdquo; to create one
              </div>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {replies.map((reply, index) => (
              <motion.div
                key={reply.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                style={{
                  background: "rgba(255,255,255,0.025)",
                  border:
                    editingId === reply.id
                      ? "1px solid rgba(79,138,255,0.3)"
                      : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  padding: "16px 20px",
                  transition: "border-color 0.15s",
                }}
              >
                {/* Top row: title, category, usage, actions */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  {/* Title */}
                  <div
                    style={{
                      flex: 1,
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#F0F0F5",
                    }}
                  >
                    {reply.title}
                  </div>

                  {/* Category badge */}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 10px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      color: getCategoryColor(reply.category),
                      background: `${getCategoryColor(reply.category)}14`,
                      border: `1px solid ${getCategoryColor(reply.category)}30`,
                    }}
                  >
                    <Tag size={10} />
                    {reply.category}
                  </span>

                  {/* Usage count */}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "#666",
                    }}
                  >
                    <Hash size={12} />
                    {reply.usageCount} uses
                  </span>

                  {/* Edit button */}
                  <button
                    onClick={() => handleEdit(reply)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 30,
                      height: 30,
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 6,
                      color: "#888",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "rgba(79,138,255,0.15)";
                      e.currentTarget.style.color = "#4F8AFF";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.05)";
                      e.currentTarget.style.color = "#888";
                    }}
                    title="Edit"
                  >
                    <Pencil size={13} />
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDelete(reply.id)}
                    disabled={deletingId === reply.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 30,
                      height: 30,
                      background:
                        confirmDeleteId === reply.id
                          ? "rgba(239,68,68,0.15)"
                          : "rgba(255,255,255,0.05)",
                      border:
                        confirmDeleteId === reply.id
                          ? "1px solid rgba(239,68,68,0.3)"
                          : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 6,
                      color:
                        confirmDeleteId === reply.id ? "#EF4444" : "#888",
                      cursor:
                        deletingId === reply.id
                          ? "not-allowed"
                          : "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (confirmDeleteId !== reply.id) {
                        e.currentTarget.style.background =
                          "rgba(239,68,68,0.1)";
                        e.currentTarget.style.color = "#EF4444";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (confirmDeleteId !== reply.id) {
                        e.currentTarget.style.background =
                          "rgba(255,255,255,0.05)";
                        e.currentTarget.style.color = "#888";
                      }
                    }}
                    title={
                      confirmDeleteId === reply.id
                        ? "Click again to confirm"
                        : "Delete"
                    }
                  >
                    {deletingId === reply.id ? (
                      <Loader2
                        size={13}
                        style={{ animation: "spin 1s linear infinite" }}
                      />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                </div>

                {/* Confirm delete warning */}
                <AnimatePresence>
                  {confirmDeleteId === reply.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      style={{
                        overflow: "hidden",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          background: "rgba(239,68,68,0.06)",
                          border: "1px solid rgba(239,68,68,0.15)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "#EF4444",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <AlertCircle size={13} />
                          Click delete again to confirm
                        </span>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#888",
                            cursor: "pointer",
                            padding: 2,
                            display: "flex",
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Content preview */}
                <div
                  style={{
                    color: "#8888A0",
                    fontSize: 12,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    maxHeight: 80,
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  {reply.content}
                  {reply.content.length > 200 && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 30,
                        background:
                          "linear-gradient(transparent, rgba(10,10,20,0.95))",
                      }}
                    />
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Footer count */}
          {replies.length > 0 && (
            <div
              style={{
                textAlign: "center",
                fontSize: 11,
                color: "#555",
                padding: "8px 0",
              }}
            >
              {replies.length} template{replies.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
