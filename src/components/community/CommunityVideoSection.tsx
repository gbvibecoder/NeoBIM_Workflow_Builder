"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import {
  Play, Pause, X, Volume2, VolumeX, Maximize,
  Upload, Heart, Eye, Clock, Film, Trash2,
  CloudUpload, CheckCircle, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

// ─── Design Tokens (matching page tokens) ────────────────────────────────────

const C = {
  bg:      "#07070D",
  surface: "#0B0B13",
  card:    "#0A0A14",
  elevated:"#111120",
  cyan:    "#00F5FF",
  blue:    "#4F8AFF",
  purple:  "#8B5CF6",
  violet:  "#6366F1",
  green:   "#10B981",
  amber:   "#F59E0B",
  teal:    "#06B6D4",
  rose:    "#F43F5E",
  text:    "#F0F0F5",
  muted:   "#8898AA",
  dim:     "#4A5568",
  faint:   "#2D3748",
  border:  "rgba(255,255,255,0.06)",
};

const CAT_COLORS: Record<string, string> = {
  "Concept Design": C.blue,
  "Visualization":  C.purple,
  "Data & Export":   C.amber,
  "Floor Plans":    C.teal,
  "Full Pipeline":  C.cyan,
  "Walkthrough":    C.green,
  "Tutorial":       C.violet,
  "General":        C.muted,
};

const CATEGORIES = [
  "Concept Design", "Floor Plans", "Visualization",
  "Data & Export", "Full Pipeline", "Walkthrough", "Tutorial", "General",
];

const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];

function rgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "79,138,255";
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

function timeAgo(date: string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  if (s < 2592000) return `${Math.floor(s / 604800)}w ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function avatarColor(name: string | null): string {
  if (!name) return C.dim;
  const hash = name.split("").reduce((a, c) => c.charCodeAt(0) + ((a << 5) - a), 0);
  const colors = [C.blue, C.purple, C.green, C.teal, C.amber, C.cyan, C.violet, C.rose];
  return colors[Math.abs(hash) % colors.length];
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommunityVideoData {
  id: string;
  title: string;
  description: string | null;
  category: string;
  videoUrl: string;
  duration: string | null;
  views: number;
  likes: number;
  createdAt: string;
  author: {
    id: string;
    name: string | null;
    image: string | null;
  };
}

// ─── Corner Marks ────────────────────────────────────────────────────────────

function CornerMarks({ color }: { color: string }) {
  const o = 0.2;
  return (
    <>
      <svg style={{ position: "absolute", top: -1, left: -1, pointerEvents: "none" }} width={12} height={12}>
        <path d="M0 12 L0 0 L12 0" stroke={color} strokeWidth={1.2} fill="none" opacity={o} />
      </svg>
      <svg style={{ position: "absolute", top: -1, right: -1, pointerEvents: "none" }} width={12} height={12}>
        <path d="M0 0 L12 0 L12 12" stroke={color} strokeWidth={1.2} fill="none" opacity={o} />
      </svg>
      <svg style={{ position: "absolute", bottom: -1, left: -1, pointerEvents: "none" }} width={12} height={12}>
        <path d="M0 0 L0 12 L12 12" stroke={color} strokeWidth={1.2} fill="none" opacity={o} />
      </svg>
      <svg style={{ position: "absolute", bottom: -1, right: -1, pointerEvents: "none" }} width={12} height={12}>
        <path d="M12 0 L12 12 L0 12" stroke={color} strokeWidth={1.2} fill="none" opacity={o} />
      </svg>
    </>
  );
}

// ─── Community Video Card ────────────────────────────────────────────────────

function CommunityVideoCard({
  video,
  onPlay,
  currentUserId,
  onDelete,
}: {
  video: CommunityVideoData;
  onPlay: (v: CommunityVideoData) => void;
  currentUserId: string | null;
  onDelete: (id: string) => void;
}) {
  const isOwner = currentUserId === video.author.id;
  const color = CAT_COLORS[video.category] || C.muted;
  const r = rgb(color);
  const [hovered, setHovered] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(video.likes);
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inView = useInView(cardRef, { once: false, margin: "-10%" });

  // Check localStorage for existing like
  useEffect(() => {
    try {
      const likes: string[] = JSON.parse(localStorage.getItem("cv-likes") || "[]");
      setLiked(likes.includes(video.id));
    } catch { /* ignore */ }
  }, [video.id]);

  // Hover-to-play
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (hovered && inView) {
      v.currentTime = 0;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [hovered, inView]);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const isUnlike = liked;
      const likes: string[] = JSON.parse(localStorage.getItem("cv-likes") || "[]");

      // Optimistic UI update
      if (isUnlike) {
        localStorage.setItem("cv-likes", JSON.stringify(likes.filter(id => id !== video.id)));
        setLiked(false);
        setLikeCount(c => c - 1);
      } else {
        likes.push(video.id);
        localStorage.setItem("cv-likes", JSON.stringify(likes));
        setLiked(true);
        setLikeCount(c => c + 1);
      }

      fetch(`/api/community-videos/${video.id}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: isUnlike ? "unlike" : "like" }),
      }).then(res => {
        if (res.status === 401) {
          // Revert optimistic update
          if (isUnlike) { setLiked(true); setLikeCount(c => c + 1); }
          else {
            setLiked(false); setLikeCount(c => c - 1);
            try {
              localStorage.setItem("cv-likes", JSON.stringify(
                JSON.parse(localStorage.getItem("cv-likes") || "[]").filter((id: string) => id !== video.id)
              ));
            } catch { /* ignore corrupted localStorage */ }
          }
          toast("Sign in to like videos", { duration: 3000 });
        }
      }).catch(() => {});
    } catch { /* ignore */ }
  };

  return (
    <motion.div
      ref={cardRef}
      layout
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.5, ease }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onPlay(video)}
      className="cv-card"
      style={{
        position: "relative",
        borderRadius: 6,
        overflow: "hidden",
        background: C.card,
        border: `1px solid ${hovered ? `rgba(${r}, 0.2)` : C.border}`,
        cursor: "pointer",
        transition: "border-color 0.3s, box-shadow 0.3s, transform 0.3s",
        boxShadow: hovered
          ? `0 12px 40px rgba(0,0,0,0.4), 0 0 30px rgba(${r}, 0.06)`
          : "0 2px 8px rgba(0,0,0,0.2)",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      <CornerMarks color={color} />

      {/* ── Video Viewport ── */}
      <div style={{
        position: "relative",
        aspectRatio: "16/9",
        overflow: "hidden",
        background: "#000",
      }}>
        {/* Blueprint grid overlay */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          opacity: hovered ? 0 : 0.15,
          transition: "opacity 0.4s",
          backgroundImage: `
            linear-gradient(rgba(${r}, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(${r}, 0.06) 1px, transparent 1px)
          `,
          backgroundSize: "24px 24px",
        }} />

        {/* Cross-hair center */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 2, pointerEvents: "none",
          opacity: hovered ? 0 : 0.12,
          transition: "opacity 0.4s",
        }}>
          <svg width={24} height={24} viewBox="0 0 24 24">
            <line x1={12} y1={0} x2={12} y2={10} stroke={color} strokeWidth={0.5} />
            <line x1={12} y1={14} x2={12} y2={24} stroke={color} strokeWidth={0.5} />
            <line x1={0} y1={12} x2={10} y2={12} stroke={color} strokeWidth={0.5} />
            <line x1={14} y1={12} x2={24} y2={12} stroke={color} strokeWidth={0.5} />
            <circle cx={12} cy={12} r={3} stroke={color} strokeWidth={0.5} fill="none" />
          </svg>
        </div>

        <video
          ref={videoRef}
          src={video.videoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            transition: "transform 0.6s ease",
            transform: hovered ? "scale(1.02)" : "scale(1)",
          }}
        />

        {/* Play button overlay */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 3,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: hovered ? "transparent" : "rgba(0,0,0,0.3)",
          transition: "background 0.4s",
          pointerEvents: "none",
        }}>
          {!hovered && (
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: `rgba(${r}, 0.15)`, backdropFilter: "blur(8px)",
              border: `1.5px solid rgba(${r}, 0.3)`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Play size={20} fill={color} color={color} style={{ marginLeft: 2 }} />
            </div>
          )}
        </div>

        {/* Category badge */}
        <div style={{
          position: "absolute", top: 8, left: 8, zIndex: 4,
          padding: "3px 8px", borderRadius: 3,
          fontSize: 8, fontWeight: 700, letterSpacing: "1px",
          textTransform: "uppercase",
          fontFamily: "var(--font-jetbrains), monospace",
          color, background: `rgba(${r}, 0.12)`,
          border: `1px solid rgba(${r}, 0.2)`,
          backdropFilter: "blur(8px)",
        }}>
          {video.category}
        </div>

        {/* Duration badge */}
        {video.duration && (
          <div style={{
            position: "absolute", bottom: 8, right: 8, zIndex: 4,
            padding: "2px 6px", borderRadius: 3,
            fontSize: 9, fontWeight: 600,
            fontFamily: "var(--font-jetbrains), monospace",
            color: C.text, background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", gap: 3,
          }}>
            <Clock size={8} /> {video.duration}
          </div>
        )}
      </div>

      {/* ── Card Content ── */}
      <div style={{ padding: "10px 12px 8px" }}>
        <h4 style={{
          fontSize: 13, fontWeight: 700, color: C.text,
          margin: "0 0 4px",
          fontFamily: "var(--font-syne), sans-serif",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {video.title}
        </h4>
        {video.description && (
          <p style={{
            fontSize: 11, color: C.muted, margin: "0 0 8px",
            lineHeight: 1.4,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {video.description}
          </p>
        )}

        {/* Author row */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderTop: `1px solid ${C.border}`, paddingTop: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {/* Avatar */}
            <div style={{
              width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
              background: `linear-gradient(135deg, ${avatarColor(video.author.name)}, ${C.elevated})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 8, fontWeight: 700, color: C.text,
              border: `1px solid rgba(255,255,255,0.1)`,
            }}>
              {video.author.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={video.author.image} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
              ) : initials(video.author.name)}
            </div>
            <span style={{
              fontSize: 10, color: C.muted, fontWeight: 500,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {video.author.name || "Anonymous"} <span style={{ color: C.dim }}>&middot;</span> {timeAgo(video.createdAt)}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Like button */}
            <button
              onClick={handleLike}
              style={{
                display: "flex", alignItems: "center", gap: 3,
                background: "none", border: "none", cursor: "pointer",
                color: liked ? C.rose : C.dim,
                fontSize: 10, fontWeight: 600, padding: "2px 4px",
                transition: "color 0.2s, transform 0.2s",
                transform: liked ? "scale(1.05)" : "scale(1)",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              <Heart size={12} fill={liked ? C.rose : "none"} />
              {likeCount > 0 && likeCount}
            </button>

            {/* Delete button — only for owner */}
            {isOwner && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm("Delete this video? This cannot be undone.")) {
                    onDelete(video.id);
                  }
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 3,
                  background: "none", border: "none", cursor: "pointer",
                  color: C.dim, fontSize: 10, padding: "2px 4px",
                  transition: "color 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = C.rose; }}
                onMouseLeave={e => { e.currentTarget.style.color = C.dim; }}
                title="Delete your video"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Upload Modal ────────────────────────────────────────────────────────────

function UploadModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [duration, setDuration] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get video duration when file is selected
  useEffect(() => {
    if (!file) { setDuration(null); return; }
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const min = Math.floor(v.duration / 60);
      const sec = Math.floor(v.duration % 60);
      setDuration(`${min}:${String(sec).padStart(2, "0")}`);
      URL.revokeObjectURL(url);
    };
    v.src = url;
  }, [file]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("video/")) {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    }
  }, [title]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    }
  };

  const handleSubmit = async () => {
    if (!file || !title.trim() || uploading) return;

    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per chunk (under Vercel 4.5MB limit)

    setUploading(true);
    setUploadStatus("idle");
    setErrorMsg("");
    setUploadProgress(0);

    try {
      // Step 1: Init chunked upload
      const initRes = await fetch("/api/community-videos/upload-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, fileSize: file.size }),
      });

      if (initRes.status === 401) {
        setErrorMsg("Please sign in to upload. Redirecting...");
        setUploadStatus("error");
        setTimeout(() => {
          window.location.href = `/login?callbackUrl=${encodeURIComponent("/workflows")}`;
        }, 1500);
        return;
      }

      if (!initRes.ok) {
        const data = await initRes.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Init failed (${initRes.status})`);
      }

      const { uploadId } = await initRes.json();

      // Step 2: Upload file in chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const chunkRes = await fetch("/api/community-videos/upload-chunk", {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-upload-id": uploadId,
            "x-chunk-index": String(i),
          },
          body: chunk,
        });

        if (!chunkRes.ok) {
          const data = await chunkRes.json().catch(() => ({}));
          throw new Error(data?.error?.message || `Chunk ${i + 1}/${totalChunks} failed`);
        }

        setUploadProgress(Math.round(((i + 1) / totalChunks) * 75));
      }

      // Step 3: Assemble on server
      setUploadProgress(80);
      const completeRes = await fetch("/api/community-videos/upload-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, totalChunks, filename: file.name }),
      });

      if (!completeRes.ok) {
        const data = await completeRes.json().catch(() => ({}));
        throw new Error(data?.error?.message || `Assembly failed (${completeRes.status})`);
      }

      const { publicUrl } = await completeRes.json();
      setUploadProgress(90);

      // Step 4: Create DB record
      const res = await fetch("/api/community-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: publicUrl,
          title: title.trim(),
          description: description.trim() || null,
          category,
          duration: duration || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || data?.details || `Save failed (${res.status})`);
      }

      setUploadProgress(100);
      setUploadStatus("success");
      setTimeout(() => {
        onUploaded();
        onClose();
      }, 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setErrorMsg(msg);
      setUploadStatus("error");
    } finally {
      setUploading(false);
    }
  };

  const fileSizeMB = file ? (file.size / (1024 * 1024)).toFixed(1) : null;
  const gr = rgb(C.green);
  const cr = rgb(C.cyan);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(8px)",
        padding: 16,
      }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 20 }}
        transition={{ duration: 0.4, ease }}
        onClick={e => e.stopPropagation()}
        className="cv-upload-modal"
        style={{
          width: "100%", maxWidth: 520,
          borderRadius: 8,
          background: C.surface,
          border: `1px solid rgba(${gr}, 0.12)`,
          boxShadow: `0 40px 100px rgba(0,0,0,0.5), 0 0 60px rgba(${gr}, 0.04)`,
          position: "relative",
          overflow: "hidden",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <CornerMarks color={C.green} />

        {/* Blueprint grid background */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: `
            linear-gradient(rgba(${gr}, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(${gr}, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: "32px 32px",
        }} />

        <div style={{ position: "relative", padding: "24px 24px 20px" }}>
          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              position: "absolute", top: 12, right: 12,
              width: 32, height: 32, borderRadius: 6,
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${C.border}`,
              cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center",
              color: C.dim, transition: "color 0.2s",
            }}
          >
            <X size={14} />
          </button>

          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 8, fontWeight: 700, letterSpacing: "3px",
              color: C.dim, textTransform: "uppercase",
              fontFamily: "var(--font-jetbrains), monospace",
              marginBottom: 6,
            }}>
              SEC. C &middot; COMMUNITY UPLOAD
            </div>
            <h3 style={{
              fontSize: 20, fontWeight: 800, margin: 0,
              fontFamily: "var(--font-syne), sans-serif",
              color: C.text,
            }}>
              Share Your{" "}
              <span style={{
                background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>Work</span>
            </h3>
            <p style={{
              fontSize: 12, color: C.muted, margin: "4px 0 0",
              lineHeight: 1.5,
            }}>
              Upload a workflow demo to inspire architects &amp; engineers worldwide.
            </p>
          </div>

          {/* Drag & Drop Zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? C.cyan : file ? C.green : `rgba(${cr}, 0.2)`}`,
              borderRadius: 6,
              padding: file ? "12px 16px" : "28px 16px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver
                ? `rgba(${cr}, 0.04)`
                : file
                  ? `rgba(${gr}, 0.03)`
                  : "rgba(255,255,255,0.01)",
              transition: "all 0.3s",
              marginBottom: 16,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Inner blueprint grid */}
            {!file && (
              <div style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                backgroundImage: `
                  linear-gradient(rgba(${cr}, 0.04) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(${cr}, 0.04) 1px, transparent 1px)
                `,
                backgroundSize: "16px 16px",
                opacity: dragOver ? 1 : 0.5,
                transition: "opacity 0.3s",
              }} />
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />

            {file ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                position: "relative",
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 6,
                  background: `rgba(${gr}, 0.1)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <Film size={16} color={C.green} />
                </div>
                <div style={{ textAlign: "left", minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: C.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {file.name}
                  </div>
                  <div style={{
                    fontSize: 10, color: C.muted,
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}>
                    {fileSizeMB}MB{duration ? ` · ${duration}` : ""}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setFile(null); setDuration(null); }}
                  style={{
                    marginLeft: "auto", background: "none", border: "none",
                    cursor: "pointer", color: C.dim, padding: 4,
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <CloudUpload
                  size={32}
                  color={dragOver ? C.cyan : C.dim}
                  style={{ marginBottom: 8, transition: "color 0.3s" }}
                />
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: dragOver ? C.cyan : C.text,
                  marginBottom: 4, transition: "color 0.3s",
                }}>
                  Drop MP4 here or click to browse
                </div>
                <div style={{
                  fontSize: 10, color: C.dim,
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  MP4 · WebM · MOV · Max 50MB
                </div>
              </div>
            )}
          </div>

          {/* Form Fields */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
            {/* Title */}
            <div>
              <label style={{
                fontSize: 10, fontWeight: 700, color: C.dim,
                letterSpacing: "1.5px", textTransform: "uppercase",
                fontFamily: "var(--font-jetbrains), monospace",
                display: "block", marginBottom: 4,
              }}>
                TITLE <span style={{ color: C.rose }}>*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g., Concept Massing from Text Brief"
                maxLength={120}
                style={{
                  width: "100%", padding: "8px 12px",
                  borderRadius: 4, fontSize: 13,
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${C.border}`,
                  color: C.text, outline: "none",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => { e.currentTarget.style.borderColor = `rgba(${gr}, 0.3)`; }}
                onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
              />
            </div>

            {/* Description */}
            <div>
              <label style={{
                fontSize: 10, fontWeight: 700, color: C.dim,
                letterSpacing: "1.5px", textTransform: "uppercase",
                fontFamily: "var(--font-jetbrains), monospace",
                display: "block", marginBottom: 4,
              }}>
                DESCRIPTION
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description of your workflow demo..."
                maxLength={500}
                rows={2}
                style={{
                  width: "100%", padding: "8px 12px",
                  borderRadius: 4, fontSize: 13,
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${C.border}`,
                  color: C.text, outline: "none", resize: "vertical",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s",
                  minHeight: 48,
                }}
                onFocus={e => { e.currentTarget.style.borderColor = `rgba(${gr}, 0.3)`; }}
                onBlur={e => { e.currentTarget.style.borderColor = C.border; }}
              />
            </div>

            {/* Category */}
            <div>
              <label style={{
                fontSize: 10, fontWeight: 700, color: C.dim,
                letterSpacing: "1.5px", textTransform: "uppercase",
                fontFamily: "var(--font-jetbrains), monospace",
                display: "block", marginBottom: 4,
              }}>
                CATEGORY
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                style={{
                  width: "100%", padding: "8px 12px",
                  borderRadius: 4, fontSize: 13,
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${C.border}`,
                  color: C.text, outline: "none",
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  boxSizing: "border-box",
                  cursor: "pointer",
                  appearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%234A5568' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 12px center",
                }}
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat} style={{ background: C.surface, color: C.text }}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Error message */}
          {uploadStatus === "error" && errorMsg && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 12px", borderRadius: 4,
              background: "rgba(244,63,94,0.08)",
              border: "1px solid rgba(244,63,94,0.15)",
              marginBottom: 12,
            }}>
              <AlertCircle size={14} color={C.rose} />
              <span style={{ fontSize: 11, color: C.rose }}>{errorMsg}</span>
            </div>
          )}

          {/* Success message */}
          {uploadStatus === "success" && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 12px", borderRadius: 4,
              background: `rgba(${gr}, 0.08)`,
              border: `1px solid rgba(${gr}, 0.15)`,
              marginBottom: 12,
            }}>
              <CheckCircle size={14} color={C.green} />
              <span style={{ fontSize: 11, color: C.green }}>Video uploaded successfully!</span>
            </div>
          )}

          {/* Upload progress bar */}
          {uploading && uploadProgress > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 10, color: C.muted, marginBottom: 4,
              }}>
                <span>{uploadProgress < 75 ? "Uploading chunks…" : uploadProgress < 90 ? "Assembling…" : "Saving…"}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div style={{
                width: "100%", height: 4, borderRadius: 2,
                background: "rgba(255,255,255,0.06)", overflow: "hidden",
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${uploadProgress}%` }}
                  transition={{ duration: 0.3 }}
                  style={{
                    height: "100%", borderRadius: 2,
                    background: `linear-gradient(90deg, ${C.cyan}, ${C.green})`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={!file || !title.trim() || uploading || uploadStatus === "success"}
            style={{
              width: "100%", padding: "11px 20px",
              borderRadius: 6, fontSize: 13, fontWeight: 700,
              border: "none", cursor: file && title.trim() && !uploading ? "pointer" : "not-allowed",
              color: file && title.trim() ? "#000" : C.dim,
              background: file && title.trim()
                ? `linear-gradient(135deg, ${C.green}, ${C.cyan})`
                : "rgba(255,255,255,0.04)",
              boxShadow: file && title.trim()
                ? `0 4px 20px rgba(${gr}, 0.25)`
                : "none",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontFamily: "var(--font-dm-sans), sans-serif",
              transition: "all 0.3s",
              opacity: uploading ? 0.7 : 1,
            }}
          >
            {uploading ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                  <Upload size={14} />
                </motion.div>
                Uploading...
              </>
            ) : uploadStatus === "success" ? (
              <>
                <CheckCircle size={14} />
                Done!
              </>
            ) : (
              <>
                <Upload size={14} />
                Share with Community
              </>
            )}
          </button>

          {/* Size hint */}
          <div style={{
            fontSize: 9, color: C.dim, textAlign: "center",
            fontFamily: "var(--font-jetbrains), monospace",
            marginTop: 8, letterSpacing: "0.5px",
          }}>
            BY UPLOADING YOU AGREE TO COMMUNITY GUIDELINES
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Community Video Player Modal ────────────────────────────────────────────

function CommunityVideoModal({
  video,
  onClose,
}: {
  video: CommunityVideoData;
  onClose: () => void;
}) {
  const color = CAT_COLORS[video.category] || C.muted;
  const r = rgb(color);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showUI, setShowUI] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowUI(true);
    hideTimer.current = setTimeout(() => { if (playing) setShowUI(false); }, 3000);
  }, [playing]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); scheduleHide(); }
    else { v.pause(); setPlaying(false); setShowUI(true); }
  }, [scheduleHide]);

  const seek = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const v = videoRef.current;
    const bar = e.currentTarget as HTMLElement;
    if (!v || !bar) return;
    const rect = bar.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    setProgress(pct * 100);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      onMouseMove={scheduleHide}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(20px)",
        padding: 16,
      }}
    >
      {/* Title bar */}
      <motion.div
        className="cv-modal-title"
        animate={{ opacity: showUI ? 1 : 0 }}
        style={{
          position: "fixed", top: 16, left: 16, right: 80, zIndex: 10001,
          display: "flex", alignItems: "center", gap: 10,
        }}
      >
        <div style={{
          padding: "3px 8px", borderRadius: 3,
          fontSize: 8, fontWeight: 700, letterSpacing: "1px",
          textTransform: "uppercase", color,
          background: `rgba(${r}, 0.12)`,
          border: `1px solid rgba(${r}, 0.2)`,
          fontFamily: "var(--font-jetbrains), monospace",
        }}>
          {video.category}
        </div>
        <span style={{
          fontSize: 14, fontWeight: 600, color: C.text,
          fontFamily: "var(--font-syne), sans-serif",
        }}>
          {video.title}
        </span>
      </motion.div>

      {/* Close button */}
      <motion.button
        animate={{ opacity: showUI ? 1 : 0 }}
        onClick={onClose}
        style={{
          position: "fixed", top: 16, right: 16, zIndex: 10001,
          width: 40, height: 40, borderRadius: 8,
          background: "rgba(255,255,255,0.06)",
          backdropFilter: "blur(16px)",
          border: `1px solid ${C.border}`,
          color: C.text, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <X size={16} />
      </motion.button>

      {/* Video container */}
      <motion.div
        className="cv-modal-container"
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.5, ease }}
        onClick={e => e.stopPropagation()}
        style={{
          width: "88vw", maxWidth: 1100,
          borderRadius: 4, overflow: "hidden",
          border: `1px solid rgba(${r}, 0.12)`,
          boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 80px rgba(${r}, 0.05)`,
          position: "relative",
        }}
      >
        <CornerMarks color={color} />
        <video
          ref={videoRef}
          src={video.videoUrl}
          muted={muted}
          playsInline
          onClick={toggle}
          onTimeUpdate={() => {
            const v = videoRef.current;
            if (v && v.duration) setProgress((v.currentTime / v.duration) * 100);
          }}
          onEnded={() => setPlaying(false)}
          style={{
            width: "100%", maxHeight: "78vh",
            display: "block", background: "#000",
            cursor: "pointer", objectFit: "contain",
          }}
        />

        {/* Play overlay */}
        <AnimatePresence>
          {!playing && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={toggle}
              style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(0,0,0,0.25)", cursor: "pointer",
              }}
            >
              <div style={{
                width: 72, height: 72, borderRadius: "50%",
                background: `rgba(${r}, 0.15)`, backdropFilter: "blur(16px)",
                border: `2px solid rgba(${r}, 0.35)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: `0 0 50px rgba(${r}, 0.3)`,
              }}>
                <Play size={30} fill={color} color={color} style={{ marginLeft: 3 }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls */}
        <motion.div
          animate={{ opacity: showUI ? 1 : 0 }}
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
            padding: "28px 16px 10px",
          }}
        >
          <div onClick={seek} onTouchStart={seek} style={{
            height: 6, borderRadius: 3, cursor: "pointer",
            background: "rgba(255,255,255,0.12)", marginBottom: 10,
          }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${color}, ${C.cyan})`,
              transition: "width 0.1s linear",
            }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={toggle} style={{ background: "none", border: "none", cursor: "pointer", color: C.text, display: "flex", padding: 4 }}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => { if (videoRef.current) { videoRef.current.muted = !muted; setMuted(!muted); } }}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.text, display: "flex", padding: 4 }}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            {video.duration && (
              <span style={{ fontSize: 10, color: C.dim, fontFamily: "var(--font-jetbrains), monospace" }}>
                {video.duration}
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => videoRef.current?.requestFullscreen?.()}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.text, display: "flex", padding: 4 }}
            >
              <Maximize size={16} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ─── AEC Background Scene ────────────────────────────────────────────────────

function CommunityBG() {
  const gr = rgb(C.green);
  const cr = rgb(C.cyan);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* Blueprint grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `
          linear-gradient(rgba(${gr}, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(${gr}, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }} />
      {/* Radial glow */}
      <div style={{
        position: "absolute", inset: 0,
        background: `
          radial-gradient(ellipse 60% 50% at 50% 0%, rgba(${gr}, 0.04), transparent 70%),
          radial-gradient(ellipse 40% 40% at 80% 80%, rgba(${cr}, 0.03), transparent 60%)
        `,
      }} />
      {/* Dimension lines */}
      <svg style={{ position: "absolute", top: 40, left: 24, opacity: 0.08 }} width={60} height={200}>
        <line x1={30} y1={0} x2={30} y2={200} stroke={C.green} strokeWidth={0.5} />
        <line x1={20} y1={0} x2={40} y2={0} stroke={C.green} strokeWidth={0.8} />
        <line x1={20} y1={200} x2={40} y2={200} stroke={C.green} strokeWidth={0.8} />
        <text x={5} y={105} fill={C.green} fontSize={6} fontFamily="monospace" transform="rotate(-90,5,105)">COMMUNITY</text>
      </svg>
      {/* Right dimension */}
      <svg style={{ position: "absolute", top: 60, right: 24, opacity: 0.06 }} width={40} height={140}>
        <line x1={20} y1={0} x2={20} y2={140} stroke={C.cyan} strokeWidth={0.5} strokeDasharray="4 4" />
        <circle cx={20} cy={0} r={2} fill={C.cyan} />
        <circle cx={20} cy={140} r={2} fill={C.cyan} />
      </svg>
    </div>
  );
}

// ─── Main Section ────────────────────────────────────────────────────────────

export default function CommunityVideoSection() {
  const [videos, setVideos] = useState<CommunityVideoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [activeVideo, setActiveVideo] = useState<CommunityVideoData | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, margin: "-100px" });

  // Fetch current session to know who's logged in
  useEffect(() => {
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(data => { setCurrentUserId(data?.user?.id || null); })
      .catch(() => {});
  }, []);

  const fetchVideos = useCallback((bustCache = false) => {
    setLoading(true);
    const url = bustCache
      ? `/api/community-videos?t=${Date.now()}`
      : "/api/community-videos";
    fetch(url, bustCache ? { cache: "no-store" } : undefined)
      .then(r => r.json())
      .then(data => {
        setVideos(data.videos || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  const handleDelete = useCallback(async (id: string) => {
    // Optimistic removal
    setVideos(prev => prev.filter(v => v.id !== id));
    try {
      const res = await fetch(`/api/community-videos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        // Revert on failure
        fetchVideos();
      }
    } catch {
      fetchVideos();
    }
  }, [fetchVideos]);

  const totalLikes = videos.reduce((sum, v) => sum + v.likes, 0);
  const gr = rgb(C.green);
  const cr = rgb(C.cyan);

  return (
    <>
      <section
        id="community"
        ref={sectionRef}
        style={{
          position: "relative",
          overflow: "hidden",
          padding: "80px 24px 80px",
          borderTop: `1px solid ${C.border}`,
          background: C.bg,
        }}
      >
        <CommunityBG />

        <div style={{
          position: "relative", zIndex: 1,
          maxWidth: 1200, margin: "0 auto",
        }}>
          {/* ── Section Header ── */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, ease }}
            style={{ textAlign: "center", marginBottom: 48 }}
          >
            {/* Section marker */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 12, marginBottom: 20,
            }}>
              <div style={{ width: 60, height: 1, background: `rgba(${gr}, 0.2)` }} />
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: C.green, boxShadow: `0 0 8px ${C.green}`,
                }} />
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "3px",
                  color: C.dim, textTransform: "uppercase",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  SEC. C &middot; COMMUNITY
                </span>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: C.green, boxShadow: `0 0 8px ${C.green}`,
                }} />
              </div>
              <div style={{ width: 60, height: 1, background: `rgba(${gr}, 0.2)` }} />
            </div>

            {/* Title */}
            <h2 style={{
              fontSize: "clamp(1.5rem, 3vw, 2.4rem)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              margin: "0 0 10px",
              fontFamily: "var(--font-syne), sans-serif",
            }}>
              Built by the{" "}
              <span style={{
                background: `linear-gradient(135deg, ${C.green} 0%, ${C.cyan} 50%, ${C.teal} 100%)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                display: "inline-block",
              }}>
                Community
              </span>
            </h2>

            <p style={{
              fontSize: "clamp(0.85rem, 1.2vw, 1rem)",
              color: C.muted, lineHeight: 1.7,
              margin: "0 auto 24px", maxWidth: 480,
            }}>
              Workflow demos from architects, engineers, and designers around the world.
              Share yours and inspire the AEC community.
            </p>

            {/* Stats + Upload button */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 16, flexWrap: "wrap",
            }}>
              <button
                onClick={() => {
                  if (!currentUserId) {
                    window.location.href = `/login?callbackUrl=${encodeURIComponent("/workflows")}`;
                    return;
                  }
                  setShowUpload(true);
                }}
                style={{
                  padding: "10px 24px", borderRadius: 6,
                  fontSize: 13, fontWeight: 700,
                  border: "none", cursor: "pointer",
                  color: "#000",
                  background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`,
                  boxShadow: `0 4px 20px rgba(${gr}, 0.25)`,
                  display: "flex", alignItems: "center", gap: 8,
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  transition: "transform 0.2s, box-shadow 0.2s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = `0 6px 24px rgba(${gr}, 0.35)`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = `0 4px 20px rgba(${gr}, 0.25)`;
                }}
              >
                <Upload size={14} />
                Share Your Work
              </button>

              {videos.length > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 12,
                  fontSize: 10, color: C.dim,
                  fontFamily: "var(--font-jetbrains), monospace",
                  letterSpacing: "1px",
                }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Film size={10} /> {videos.length} VIDEO{videos.length !== 1 ? "S" : ""}
                  </span>
                  <span style={{ color: `rgba(${gr}, 0.3)` }}>&middot;</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Heart size={10} /> {totalLikes} LIKE{totalLikes !== 1 ? "S" : ""}
                  </span>
                </div>
              )}
            </div>
          </motion.div>

          {/* ── Video Grid ── */}
          {loading ? (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
            }}
              className="cv-grid"
            >
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  borderRadius: 6,
                  overflow: "hidden",
                  background: C.card,
                  border: `1px solid ${C.border}`,
                }}>
                  <div style={{
                    aspectRatio: "16/9",
                    background: `linear-gradient(135deg, ${C.card}, ${C.elevated})`,
                    position: "relative",
                  }}>
                    <motion.div
                      animate={{ opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      style={{
                        position: "absolute", inset: 0,
                        background: `linear-gradient(90deg, transparent, rgba(${cr}, 0.03), transparent)`,
                      }}
                    />
                  </div>
                  <div style={{ padding: "10px 12px" }}>
                    <div style={{ height: 12, width: "70%", borderRadius: 2, background: C.elevated, marginBottom: 6 }} />
                    <div style={{ height: 10, width: "40%", borderRadius: 2, background: C.elevated }} />
                  </div>
                </div>
              ))}
            </div>
          ) : videos.length > 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ duration: 0.6, delay: 0.3, ease }}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
              }}
              className="cv-grid"
            >
              <AnimatePresence mode="popLayout">
                {videos.map(video => (
                  <CommunityVideoCard
                    key={video.id}
                    video={video}
                    onPlay={setActiveVideo}
                    currentUserId={currentUserId}
                    onDelete={handleDelete}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          ) : (
            /* ── Empty State ── */
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.3, ease }}
              style={{
                textAlign: "center",
                padding: "48px 24px",
                borderRadius: 8,
                background: `rgba(${gr}, 0.02)`,
                border: `1px dashed rgba(${gr}, 0.12)`,
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Blueprint grid inside empty state */}
              <div style={{
                position: "absolute", inset: 0, pointerEvents: "none",
                backgroundImage: `
                  linear-gradient(rgba(${gr}, 0.03) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(${gr}, 0.03) 1px, transparent 1px)
                `,
                backgroundSize: "24px 24px",
              }} />

              {/* Architectural illustration */}
              <div style={{ position: "relative", marginBottom: 20 }}>
                <svg width={80} height={80} viewBox="0 0 80 80" style={{ opacity: 0.25 }}>
                  {/* Building */}
                  <rect x={20} y={20} width={40} height={50} fill="none" stroke={C.green} strokeWidth={0.8} />
                  <rect x={25} y={30} width={10} height={8} fill="none" stroke={C.green} strokeWidth={0.5} rx={1} />
                  <rect x={45} y={30} width={10} height={8} fill="none" stroke={C.green} strokeWidth={0.5} rx={1} />
                  <rect x={25} y={45} width={10} height={8} fill="none" stroke={C.green} strokeWidth={0.5} rx={1} />
                  <rect x={45} y={45} width={10} height={8} fill="none" stroke={C.green} strokeWidth={0.5} rx={1} />
                  <rect x={33} y={58} width={14} height={12} fill="none" stroke={C.green} strokeWidth={0.5} rx={1} />
                  {/* Roof triangle */}
                  <path d="M18 20 L40 5 L62 20" fill="none" stroke={C.green} strokeWidth={0.8} />
                  {/* Film reel */}
                  <circle cx={65} cy={15} r={10} fill="none" stroke={C.cyan} strokeWidth={0.5} />
                  <circle cx={65} cy={15} r={3} fill="none" stroke={C.cyan} strokeWidth={0.5} />
                  {[0, 60, 120, 180, 240, 300].map((a, i) => (
                    <circle
                      key={i}
                      cx={65 + 7 * Math.cos(a * Math.PI / 180)}
                      cy={15 + 7 * Math.sin(a * Math.PI / 180)}
                      r={1.5} fill={C.cyan} opacity={0.3}
                    />
                  ))}
                </svg>
              </div>

              <h3 style={{
                fontSize: 18, fontWeight: 700, color: C.text,
                fontFamily: "var(--font-syne), sans-serif",
                margin: "0 0 8px", position: "relative",
              }}>
                Be the First to Share
              </h3>
              <p style={{
                fontSize: 12, color: C.muted, lineHeight: 1.6,
                margin: "0 auto 20px", maxWidth: 360, position: "relative",
              }}>
                Upload your workflow demo and inspire the global AEC community.
                Show how you use BuildFlow to turn briefs into buildings.
              </p>
              <button
                onClick={() => {
                  if (!currentUserId) {
                    window.location.href = `/login?callbackUrl=${encodeURIComponent("/workflows")}`;
                    return;
                  }
                  setShowUpload(true);
                }}
                style={{
                  padding: "10px 24px", borderRadius: 6,
                  fontSize: 13, fontWeight: 700,
                  border: "none", cursor: "pointer",
                  color: "#000",
                  background: `linear-gradient(135deg, ${C.green}, ${C.cyan})`,
                  boxShadow: `0 4px 20px rgba(${gr}, 0.25)`,
                  display: "inline-flex", alignItems: "center", gap: 8,
                  fontFamily: "var(--font-dm-sans), sans-serif",
                  position: "relative",
                }}
              >
                <Upload size={14} />
                Upload First Video
              </button>
            </motion.div>
          )}

          {/* ── Section closing marker ── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 12, marginTop: 40,
          }}>
            <div style={{ width: 40, height: 1, background: `rgba(${gr}, 0.1)` }} />
            <span style={{
              fontSize: 8, color: C.dim, letterSpacing: "2px",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              END SEC. C
            </span>
            <div style={{ width: 40, height: 1, background: `rgba(${gr}, 0.1)` }} />
          </div>
        </div>
      </section>

      {/* ── Modals ── */}
      <AnimatePresence>
        {showUpload && (
          <UploadModal
            onClose={() => setShowUpload(false)}
            onUploaded={() => fetchVideos(true)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeVideo && (
          <CommunityVideoModal
            video={activeVideo}
            onClose={() => setActiveVideo(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Responsive styles ── */}
      <style>{`
        @media (max-width: 1024px) {
          .cv-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          .cv-grid {
            grid-template-columns: 1fr !important;
            gap: 14px !important;
          }
          .cv-upload-modal {
            max-width: 100% !important;
          }
          .cv-modal-container {
            width: 96vw !important;
            max-width: none !important;
          }
          .cv-modal-title > span {
            font-size: 12px !important;
            max-width: 50vw;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }
        @media (max-width: 480px) {
          .cv-card .cv-card-desc {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}
