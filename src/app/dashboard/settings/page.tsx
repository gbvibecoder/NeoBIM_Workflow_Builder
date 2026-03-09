"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  User, Key, Shield, Save, Loader2, AlertCircle,
  CheckCircle2, Info, Crown, Star, Lock, Unlock,
  Fingerprint, ScanLine, Cpu, Activity, Camera, Trash2, Pencil,
} from "lucide-react";
import { PageBackground } from "@/components/dashboard/PageBackground";
import { useLocale } from "@/hooks/useLocale";
import { useAvatar } from "@/hooks/useAvatar";

type SettingsTab = "profile" | "api-keys" | "plan";

// ---- Hex ring scanner animation for profile ----
function HexRing({ size = 88, color = "#1B4FFF" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute", inset: -12 }}>
      <circle
        cx="50" cy="50" r="46"
        fill="none"
        stroke={color}
        strokeWidth="0.5"
        strokeDasharray="4 6"
        opacity={0.3}
        style={{ animation: "dp-scanRotate 12s linear infinite" }}
      />
      <circle
        cx="50" cy="50" r="42"
        fill="none"
        stroke={color}
        strokeWidth="0.8"
        strokeDasharray="12 8"
        opacity={0.15}
        style={{ animation: "dp-scanRotate 8s linear infinite reverse" }}
      />
      {/* Scanner sweep */}
      <line
        x1="50" y1="4" x2="50" y2="20"
        stroke={color}
        strokeWidth="1.5"
        opacity={0.4}
        style={{
          transformOrigin: "50px 50px",
          animation: "dp-scanRotate 4s linear infinite",
        }}
      />
    </svg>
  );
}

// ---- Typing text effect ----
function TypeWriter({ text, delay = 0 }: { text: string; delay?: number }) {
  const [displayed, setDisplayed] = useState("");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t1);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, 30);
    return () => clearInterval(interval);
  }, [text, started]);

  return (
    <span>
      {displayed}
      {displayed.length < text.length && (
        <span style={{ animation: "dp-blink 1s infinite", color: "#4F8AFF" }}>|</span>
      )}
    </span>
  );
}

// ---- Security Status Bar ----
function SecurityBar() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16,
      padding: "8px 16px", borderRadius: 8,
      background: "rgba(16,185,129,0.04)",
      border: "1px solid rgba(16,185,129,0.1)",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#10B981",
          boxShadow: "0 0 8px rgba(16,185,129,0.5)",
          animation: "dp-statusPulse 2s ease-in-out infinite",
          color: "#10B981",
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontFamily: "var(--font-jetbrains), monospace",
          color: "#10B981",
        }}>
          SECURE SESSION
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Lock size={10} style={{ color: "rgba(255,255,255,0.2)" }} />
        <span style={{
          fontSize: 9, color: "rgba(255,255,255,0.2)",
          fontFamily: "var(--font-jetbrains), monospace",
        }}>
          AES-256 | TLS 1.3
        </span>
      </div>
    </div>
  );
}

// ---- Save Status Indicator ----
function SaveStatus({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null;
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        fontSize: 11, fontWeight: 600,
        color: status === "saving" ? "#8888A0" : "#10B981",
      }}
    >
      {status === "saving" ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <CheckCircle2 size={12} />
      )}
      {status === "saving" ? "Encrypting..." : "Vault sealed"}
    </motion.div>
  );
}

// ---- Profile Section — Identity Card (Editable) ----
function ProfileSection({
  user, initials, saveStatus, onSaveStatusChange, onSessionUpdate,
}: {
  user: { name?: string | null; email?: string | null; image?: string | null } | undefined;
  initials: string;
  saveStatus: "idle" | "saving" | "saved";
  onSaveStatusChange: (s: "idle" | "saving" | "saved") => void;
  onSessionUpdate: () => Promise<unknown>;
}) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(0); // generation counter to prevent race conditions
  const [editName, setEditName] = useState(user?.name ?? "");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isHoveringAvatar, setIsHoveringAvatar] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch actual avatar (handles "uploaded" sentinel)
  const loadedImage = useAvatar(user?.image);

  // Sync name from session
  useEffect(() => {
    if (user?.name && !isEditingName) setEditName(user.name);
  }, [user?.name, isEditingName]);

  // The displayed image: preview (pending upload) > loaded (from API/session)
  const displayImage = previewImage ?? loadedImage;
  const hasImageToRemove = !!(previewImage || loadedImage);

  const nameChanged = editName.trim() !== (user?.name ?? "");
  const hasChanges = nameChanged || previewImage !== null;

  function processImage(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('settings.imageTooLarge'));
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(t('settings.invalidImageType'));
      return;
    }
    // Increment generation counter — only the latest selection wins
    const generation = ++processingRef.current;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (processingRef.current !== generation) return; // stale
      const img = new Image();
      img.onload = () => {
        if (processingRef.current !== generation) return; // stale
        const canvas = document.createElement("canvas");
        const TARGET = 200;
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        canvas.width = TARGET;
        canvas.height = TARGET;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, TARGET, TARGET);
        setPreviewImage(canvas.toDataURL("image/jpeg", 0.8));
        setIsProcessing(false);
      };
      img.onerror = () => {
        if (processingRef.current !== generation) return;
        setIsProcessing(false);
        toast.error(t('settings.invalidImageType'));
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      if (processingRef.current !== generation) return;
      setIsProcessing(false);
      toast.error(t('settings.profileSaveFailed'));
    };
    reader.readAsDataURL(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processImage(file);
    e.target.value = "";
  }

  async function handleRemoveAvatar() {
    onSaveStatusChange("saving");
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: null }),
      });
      if (!res.ok) {
        let msg = t('settings.profileSaveFailed');
        try { const d = await res.json(); msg = d?.error?.message ?? msg; } catch { /* non-JSON response */ }
        throw new Error(msg);
      }
      setPreviewImage(null);
      await onSessionUpdate();
      onSaveStatusChange("saved");
      toast.success(t('settings.profileSaved'));
      setTimeout(() => onSaveStatusChange("idle"), 2000);
    } catch (err) {
      onSaveStatusChange("idle");
      toast.error(err instanceof Error ? err.message : t('settings.profileSaveFailed'));
    }
  }

  async function handleSave() {
    onSaveStatusChange("saving");
    try {
      const payload: { name?: string; image?: string | null } = {};
      if (nameChanged) payload.name = editName.trim();
      if (previewImage) payload.image = previewImage;
      if (Object.keys(payload).length === 0) {
        onSaveStatusChange("idle");
        return;
      }

      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = t('settings.profileSaveFailed');
        try { const d = await res.json(); msg = d?.error?.message ?? msg; } catch { /* non-JSON response */ }
        throw new Error(msg);
      }

      setPreviewImage(null);
      setIsEditingName(false);
      await onSessionUpdate();
      onSaveStatusChange("saved");
      toast.success(t('settings.profileSaved'));
      setTimeout(() => onSaveStatusChange("idle"), 2000);
    } catch (err) {
      onSaveStatusChange("idle");
      toast.error(err instanceof Error ? err.message : t('settings.profileSaveFailed'));
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      {/* Identity Card */}
      <div
        className="dp-glass-card"
        data-accent="blue"
        style={{ padding: 0, overflow: "hidden" }}
      >
        {/* Card header stripe */}
        <div style={{
          padding: "14px 24px",
          background: "rgba(27,79,255,0.04)",
          borderBottom: "1px solid rgba(27,79,255,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Fingerprint size={14} style={{ color: "#4F8AFF" }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "#4F8AFF",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              IDENTITY VERIFIED
            </span>
          </div>
          <div style={{
            padding: "2px 8px", borderRadius: 4,
            background: "rgba(16,185,129,0.1)",
            border: "1px solid rgba(16,185,129,0.2)",
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700, color: "#10B981",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              ACTIVE
            </span>
          </div>
        </div>

        <div style={{ padding: "28px 24px", display: "flex", alignItems: "center", gap: 24 }}>
          {/* Avatar with scan ring — clickable */}
          <div
            style={{ position: "relative", flexShrink: 0, cursor: "pointer" }}
            onMouseEnter={() => setIsHoveringAvatar(true)}
            onMouseLeave={() => setIsHoveringAvatar(false)}
            onClick={() => fileInputRef.current?.click()}
            title={t('settings.changeAvatar')}
          >
            <HexRing />
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "linear-gradient(135deg, #1B4FFF, #8B5CF6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, fontWeight: 700, color: "#fff",
              overflow: "hidden", position: "relative",
              boxShadow: "0 0 32px rgba(27,79,255,0.2)",
              transition: "box-shadow 0.2s",
              ...(isHoveringAvatar ? { boxShadow: "0 0 48px rgba(27,79,255,0.4)" } : {}),
            }}>
              {displayImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                initials
              )}
              {/* Hover overlay */}
              <div style={{
                position: "absolute", inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: isHoveringAvatar ? 1 : 0,
                transition: "opacity 0.2s",
                borderRadius: "50%",
              }}>
                <Camera size={20} style={{ color: "#fff" }} />
              </div>
            </div>
          </div>

          {/* Identity info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Editable name */}
            {isEditingName ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { setIsEditingName(false); setEditName(user?.name ?? ""); } }}
                  maxLength={100}
                  autoFocus
                  style={{
                    fontSize: 20, fontWeight: 700, color: "#F0F0F5",
                    letterSpacing: "-0.02em", lineHeight: 1.2,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(79,138,255,0.3)",
                    borderRadius: 8, padding: "6px 12px",
                    outline: "none", width: "100%",
                  }}
                />
              </div>
            ) : (
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  fontSize: 22, fontWeight: 700, color: "#F0F0F5",
                  letterSpacing: "-0.02em", lineHeight: 1.2,
                }}
                onClick={() => setIsEditingName(true)}
                title="Click to edit name"
              >
                {editName || user?.name || t('settings.user')}
                <Pencil size={14} style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }} />
              </div>
            )}
            <div style={{
              fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4,
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {user?.email ?? "\u2014"}
            </div>

            {/* Action buttons row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              {/* Clearance badge */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 12px", borderRadius: 6,
                background: "rgba(139,92,246,0.08)",
                border: "1px solid rgba(139,92,246,0.15)",
              }}>
                <Shield size={11} style={{ color: "#A78BFA" }} />
                <span style={{
                  fontSize: 10, fontWeight: 700, color: "#A78BFA",
                  letterSpacing: "0.08em",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  AUTHORIZED OPERATOR
                </span>
              </div>

              {/* Remove avatar button */}
              {hasImageToRemove && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveAvatar(); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", borderRadius: 6,
                    background: "rgba(239,68,68,0.06)",
                    border: "1px solid rgba(239,68,68,0.15)",
                    color: "rgba(239,68,68,0.6)", fontSize: 10, fontWeight: 600,
                    cursor: "pointer", transition: "all 0.2s",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.12)";
                    e.currentTarget.style.color = "#EF4444";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.06)";
                    e.currentTarget.style.color = "rgba(239,68,68,0.6)";
                  }}
                >
                  <Trash2 size={10} />
                  {t('settings.removeAvatar')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Card footer — session info + save */}
        <div style={{
          padding: "10px 24px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", gap: 24 }}>
            {[
              { label: "SESSION", value: "Encrypted" },
              { label: "PROTOCOL", value: "OAuth 2.0" },
              { label: "STATUS", value: "Online", color: "#10B981" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  fontSize: 9, color: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  letterSpacing: "0.05em",
                }}>
                  {item.label}:
                </span>
                <span style={{
                  fontSize: 9, color: item.color ?? "rgba(255,255,255,0.4)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontWeight: 600,
                }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          {/* Save button */}
          {hasChanges && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleSave}
              disabled={saveStatus === "saving" || isProcessing}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 16px", borderRadius: 8,
                background: "linear-gradient(135deg, #1B4FFF, #4F8AFF)",
                border: "1px solid rgba(79,138,255,0.3)",
                color: "#fff", fontSize: 11, fontWeight: 700,
                cursor: (saveStatus === "saving" || isProcessing) ? "wait" : "pointer",
                fontFamily: "var(--font-jetbrains), monospace",
                letterSpacing: "0.05em",
                opacity: (saveStatus === "saving" || isProcessing) ? 0.7 : 1,
                transition: "opacity 0.2s",
              }}
            >
              {saveStatus === "saving" ? (
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
              ) : (
                <Save size={12} />
              )}
              {t('settings.saveProfile')}
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ---- API Keys Section — Access Vault ----
function ApiKeysSection({ saveStatus, onSaveStatusChange }: {
  saveStatus: "idle" | "saving" | "saved";
  onSaveStatusChange: (s: "idle" | "saving" | "saved") => void;
}) {
  const { t } = useLocale();
  const [openAiKey, setOpenAiKey] = useState("");
  const [stabilityKey, setStabilityKey] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    fetch("/api/user/api-keys", { signal: controller.signal })
      .then(r => {
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then(({ apiKeys }) => {
        if (apiKeys?.openai) setOpenAiKey(apiKeys.openai);
        if (apiKeys?.stability) setStabilityKey(apiKeys.stability);
        setLoadError(null);
      })
      .catch((err) => {
        const errorMsg = err instanceof Error && err.name === 'AbortError'
          ? t('toast.requestTimeout')
          : t('toast.loadKeysFailed');
        setLoadError(errorMsg);
        toast.error(errorMsg);
      })
      .finally(() => setLoadingKeys(false));

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveKeys() {
    if (!openAiKey.trim() && !stabilityKey.trim()) {
      toast.error(t('settings.enterAtLeastOne'));
      return;
    }
    onSaveStatusChange("saving");
    try {
      const apiKeys: Record<string, string> = {};
      if (openAiKey.trim()) apiKeys.openai = openAiKey.trim();
      if (stabilityKey.trim()) apiKeys.stability = stabilityKey.trim();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch("/api/user/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeys }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        onSaveStatusChange("saved");
        toast.success(t('settings.saveSuccess'));
        setTimeout(() => onSaveStatusChange("idle"), 2000);
      } else {
        throw new Error(`API returned ${res.status}`);
      }
    } catch (err) {
      onSaveStatusChange("idle");
      const errorMsg = err instanceof Error && err.name === 'AbortError'
        ? t('toast.requestTimeout')
        : t('settings.saveFailed');
      toast.error(errorMsg);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {/* Vault Header */}
      <div
        className="dp-glass-card"
        data-accent="purple"
        style={{ padding: 0, overflow: "hidden" }}
      >
        <div style={{
          padding: "14px 24px",
          background: "rgba(139,92,246,0.04)",
          borderBottom: "1px solid rgba(139,92,246,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lock size={14} style={{ color: "#A78BFA" }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "#A78BFA",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              ACCESS VAULT
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ScanLine size={12} style={{ color: "rgba(255,255,255,0.15)" }} />
            <span style={{
              fontSize: 9, color: "rgba(255,255,255,0.2)",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              ENCRYPTED STORAGE
            </span>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {/* Security notice */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(27,79,255,0.04)",
            border: "1px solid rgba(27,79,255,0.1)",
            marginBottom: 24,
          }}>
            <Shield size={13} style={{ color: "#4F8AFF", flexShrink: 0 }} />
            <span style={{
              fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5,
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              <TypeWriter text="Keys encrypted at rest with AES-256-GCM. Zero-knowledge architecture." delay={300} />
            </span>
          </div>

          {loadingKeys ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              color: "#55556A", fontSize: 12, padding: "20px 0",
            }}>
              <Loader2 size={14} className="animate-spin" />
              <span style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
                {t('settings.loadingKeys')}
              </span>
            </div>
          ) : loadError ? (
            <div style={{
              padding: 16, borderRadius: 10,
              border: "1px solid rgba(239,68,68,0.2)",
              background: "rgba(239,68,68,0.05)",
              marginBottom: 20,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <AlertCircle size={14} style={{ color: "#F87171" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#F87171" }}>{loadError}</span>
              </div>
              <p style={{ fontSize: 11, color: "#8888A0", margin: "0 0 8px" }}>
                {t('settings.loadError')}
              </p>
              <button
                onClick={() => window.location.reload()}
                style={{
                  fontSize: 11, color: "#4F8AFF", background: "none",
                  border: "none", cursor: "pointer", padding: 0,
                }}
              >
                {t('settings.tryAgain')}
              </button>
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Access Code: OpenAI */}
            <AccessCodeField
              label={t('settings.openaiKey')}
              value={openAiKey}
              onChange={setOpenAiKey}
              placeholder="sk-..."
              disabled={loadingKeys}
              hint={t('settings.openaiUsage')}
              icon={<Cpu size={13} style={{ color: "#4F8AFF" }} />}
              slotLabel="SLOT A"
            />

            {/* Access Code: Stability */}
            <AccessCodeField
              label={t('settings.stabilityKey')}
              value={stabilityKey}
              onChange={setStabilityKey}
              placeholder="sk-..."
              disabled={loadingKeys}
              hint={t('settings.stabilityUsage')}
              icon={<Activity size={13} style={{ color: "#8B5CF6" }} />}
              slotLabel="SLOT B"
            />

            {/* Seal Vault button */}
            <motion.button
              onClick={handleSaveKeys}
              disabled={saveStatus === "saving" || loadingKeys}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 10, alignSelf: "flex-start",
                padding: "12px 28px", borderRadius: 10, border: "none",
                background: saveStatus === "saved"
                  ? "linear-gradient(135deg, #10B981, #059669)"
                  : "linear-gradient(135deg, #1B4FFF, #8B5CF6)",
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                letterSpacing: "0.03em",
                boxShadow: saveStatus === "saved"
                  ? "0 4px 20px rgba(16,185,129,0.3)"
                  : "0 4px 20px rgba(27,79,255,0.3)",
                transition: "all 200ms ease",
                opacity: (saveStatus === "saving" || loadingKeys) ? 0.6 : 1,
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              {saveStatus === "saving" ? (
                <><Loader2 size={14} className="animate-spin" /> ENCRYPTING...</>
              ) : saveStatus === "saved" ? (
                <><Lock size={14} /> VAULT SEALED</>
              ) : (
                <><Unlock size={14} /> {t('settings.saveApiKeys').toUpperCase()}</>
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ---- Access Code Field ----
function AccessCodeField({ label, value, onChange, placeholder, disabled, hint, icon, slotLabel }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled: boolean;
  hint: string;
  icon: React.ReactNode;
  slotLabel: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon}
          <label style={{
            fontSize: 11, fontWeight: 700, color: "#8888A0",
            textTransform: "uppercase", letterSpacing: "0.06em",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            {label}
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 9, color: "rgba(255,255,255,0.15)",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            {slotLabel}
          </span>
          {value ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              style={{
                width: 16, height: 16, borderRadius: 4,
                background: "rgba(16,185,129,0.15)",
                border: "1px solid rgba(16,185,129,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <CheckCircle2 size={10} style={{ color: "#10B981" }} />
            </motion.div>
          ) : (
            <div style={{
              width: 16, height: 16, borderRadius: 4,
              border: "1px dashed rgba(255,255,255,0.1)",
            }} />
          )}
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <input
          type="password"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          className="dp-settings-input"
          style={{
            paddingLeft: 40,
            borderColor: focused ? "rgba(139,92,246,0.4)" : undefined,
            boxShadow: focused ? "0 0 0 3px rgba(139,92,246,0.08)" : undefined,
          }}
        />
        <Key size={13} style={{
          position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
          color: focused ? "#A78BFA" : "rgba(255,255,255,0.15)",
          transition: "color 200ms ease",
        }} />
      </div>
      <p style={{
        fontSize: 10, color: "#3A3A50", marginTop: 6,
        fontFamily: "var(--font-jetbrains), monospace",
      }}>
        {hint}
      </p>
    </div>
  );
}

// ---- Plan Section — Clearance Level ----
function PlanSection({ userRole }: { userRole: string }) {
  const { t } = useLocale();

  const clearanceLevel = userRole === "FREE" ? "LEVEL 1" : userRole === "PRO" ? "LEVEL 2" : "LEVEL 3";
  const clearanceColor = userRole === "FREE" ? "#F59E0B" : userRole === "PRO" ? "#4F8AFF" : "#A78BFA";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {/* Clearance Card */}
      <div
        className="dp-glass-card"
        style={{
          padding: 0, overflow: "hidden",
          borderColor: `${clearanceColor}22`,
        }}
      >
        {/* Clearance header */}
        <div style={{
          padding: "14px 24px",
          background: `${clearanceColor}08`,
          borderBottom: `1px solid ${clearanceColor}15`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Crown size={14} style={{
              color: "#FFB800",
              filter: "drop-shadow(0 0 6px rgba(255,184,0,0.3))",
            }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: clearanceColor,
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              CLEARANCE {clearanceLevel}
            </span>
          </div>
          <div style={{
            padding: "2px 8px", borderRadius: 4,
            background: userRole !== "FREE" ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
            border: `1px solid ${userRole !== "FREE" ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: userRole !== "FREE" ? "#10B981" : "#F59E0B",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {userRole !== "FREE" ? "GRANTED" : "RESTRICTED"}
            </span>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {/* Plan info */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{
                fontSize: 24, fontWeight: 700, color: "#F0F0F5",
                letterSpacing: "-0.02em",
              }}>
                {userRole === "FREE" ? t('settings.freePlan') : userRole === "PRO" ? t('settings.proPlan') : t('settings.teamPlan')}
              </div>
              <p style={{
                fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4, marginBottom: 0,
              }}>
                {userRole === "FREE" ? t('settings.threeRunsPerDay') : t('settings.unlimitedRuns')}
              </p>
            </div>

            {/* Decorative star */}
            <div style={{ opacity: 0.12 }}>
              <Star size={44} style={{ color: "#FFB800" }} />
            </div>
          </div>

          {/* Usage metrics */}
          {userRole !== "FREE" && (
            <div style={{ marginTop: 24 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 8,
              }}>
                <span style={{
                  fontSize: 10, color: "rgba(255,255,255,0.3)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  letterSpacing: "0.05em",
                }}>
                  API CAPACITY THIS CYCLE (SAMPLE)
                </span>
                <span style={{
                  fontSize: 10, color: clearanceColor,
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontWeight: 700,
                }}>
                  --
                </span>
              </div>
              <div style={{
                width: "100%", height: 6, borderRadius: 3,
                background: "rgba(255,255,255,0.04)",
                overflow: "hidden",
                position: "relative",
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "0%" }}
                  transition={{ delay: 0.5, duration: 1.2, ease: "easeOut" }}
                  style={{
                    height: "100%", borderRadius: 3,
                    background: `linear-gradient(90deg, ${clearanceColor}, ${clearanceColor}88)`,
                    boxShadow: `0 0 12px ${clearanceColor}40`,
                  }}
                />
              </div>

              {/* Sub-metrics */}
              <div style={{
                display: "flex", gap: 24, marginTop: 16,
              }}>
                {[
                  { label: "CALLS", value: "--", max: "10,000" },
                  { label: "TOKENS", value: "--", max: "2M" },
                  { label: "UPTIME", value: "99.9%", max: null },
                ].map((m) => (
                  <div key={m.label}>
                    <div style={{
                      fontSize: 9, color: "rgba(255,255,255,0.2)",
                      fontFamily: "var(--font-jetbrains), monospace",
                      letterSpacing: "0.05em", marginBottom: 4,
                    }}>
                      {m.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span style={{
                        fontSize: 16, fontWeight: 700, color: "#F0F0F5",
                        fontFamily: "var(--font-jetbrains), monospace",
                      }}>
                        {m.value}
                      </span>
                      {m.max && (
                        <span style={{
                          fontSize: 10, color: "rgba(255,255,255,0.15)",
                          fontFamily: "var(--font-jetbrains), monospace",
                        }}>
                          / {m.max}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upgrade / Status */}
          <div style={{ marginTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {userRole === "FREE" ? (
              <Link
                href="/dashboard/billing"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "11px 24px", borderRadius: 10,
                  background: "linear-gradient(135deg, #4F8AFF, #8B5CF6)",
                  color: "#fff", fontSize: 12, fontWeight: 700,
                  textDecoration: "none",
                  boxShadow: "0 4px 20px rgba(79,138,255,0.3)",
                  transition: "all 200ms ease",
                  letterSpacing: "0.05em",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                REQUEST HIGHER CLEARANCE
              </Link>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={13} style={{ color: "#10B981" }} />
                <span style={{
                  fontSize: 11, color: "rgba(255,255,255,0.3)",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  Maximum clearance granted
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ---- Page ----
export default function SettingsPage() {
  const { t } = useLocale();
  const { data: session, update: updateSession } = useSession();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const user = session?.user;
  const userRole = (user as { role?: string } | undefined)?.role || "FREE";
  const initials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : (user?.email?.[0] ?? "U").toUpperCase();

  const tabs: Array<{ key: SettingsTab; label: string; icon: React.ReactNode; desc: string }> = [
    { key: "profile",  label: t('settings.profile'),   icon: <Fingerprint size={16} />, desc: "Identity" },
    { key: "api-keys", label: t('settings.apiKeys'),   icon: <Key size={16} />, desc: "Vault" },
    { key: "plan",     label: t('settings.planUsage'),  icon: <Shield size={16} />, desc: "Clearance" },
  ];

  return (
    <div className="dp-page-bg" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <PageBackground />

      {/* Header */}
      <header
        className="flex items-center justify-between px-6 dashboard-header"
        style={{
          minHeight: 56,
          background: "rgba(7,7,13,0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(79,138,255,0.06)",
          position: "relative", zIndex: 2,
        }}
      >
        <div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", letterSpacing: "-0.02em" }}>
              {t('settings.title')}
            </h1>
            <span style={{
              padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase" as const,
              color: "#F59E0B", border: "1px solid rgba(245,158,11,0.25)",
              background: "rgba(245,158,11,0.06)",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              BETA
            </span>
          </div>
          <p style={{ fontSize: 11, color: "#5C5C78", marginTop: 2, letterSpacing: "0.02em" }}>
            {t('settings.subtitle')}
          </p>
        </div>
        <AnimatePresence>
          <SaveStatus status={saveStatus} />
        </AnimatePresence>
      </header>

      <main style={{ flex: 1, overflowY: "auto", padding: "28px 32px", position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <SecurityBar />

          <div style={{ display: "flex", gap: 24 }}>
            {/* Tab Navigation — Control Panel Selector */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4 }}
              className="dp-glass-card"
              style={{
                width: 220, flexShrink: 0, padding: 8,
                display: "flex", flexDirection: "column", gap: 2,
                alignSelf: "flex-start", position: "sticky", top: 0,
              }}
            >
              {/* Panel label */}
              <div style={{
                padding: "8px 14px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                marginBottom: 4,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
                  color: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  CONTROL PANEL
                </span>
              </div>

              {tabs.map((tab, i) => (
                <motion.button
                  key={tab.key}
                  className="dp-settings-tab"
                  data-active={activeTab === tab.key ? "true" : "false"}
                  onClick={() => setActiveTab(tab.key)}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "12px 14px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    {tab.icon}
                    <span>{tab.label}</span>
                  </div>
                  <span style={{
                    fontSize: 9, color: "rgba(255,255,255,0.15)",
                    fontFamily: "var(--font-jetbrains), monospace",
                    paddingLeft: 24,
                  }}>
                    {tab.desc}
                  </span>
                </motion.button>
              ))}
            </motion.div>

            {/* Content Panel */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <AnimatePresence mode="wait">
                {activeTab === "profile" && (
                  <motion.div key="profile" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                    <ProfileSection user={user} initials={initials} saveStatus={saveStatus} onSaveStatusChange={setSaveStatus} onSessionUpdate={updateSession} />
                  </motion.div>
                )}
                {activeTab === "api-keys" && (
                  <motion.div key="api-keys" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                    <ApiKeysSection saveStatus={saveStatus} onSaveStatusChange={setSaveStatus} />
                  </motion.div>
                )}
                {activeTab === "plan" && (
                  <motion.div key="plan" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                    <PlanSection userRole={userRole} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
