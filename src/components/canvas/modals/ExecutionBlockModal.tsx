"use client";

import React, { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ArrowRight, X, Zap, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";

interface RateLimitInfo {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

interface ExecutionBlockModalProps {
  rateLimitHit: RateLimitInfo | null;
  onDismiss: () => void;
}

export function ExecutionBlockModal({ rateLimitHit, onDismiss }: ExecutionBlockModalProps) {
  const { t } = useLocale();
  const [emailSent, setEmailSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Detect the type of block for styling
  const isEmailVerification = rateLimitHit?.title?.toLowerCase().includes("verify");
  // Color scheme based on block type
  const accentColor = isEmailVerification ? "#4F8AFF" : "#F59E0B";
  const gradientStart = isEmailVerification ? "#4F8AFF" : "#F59E0B";
  const gradientEnd = isEmailVerification ? "#6366F1" : "#EF4444";
  const iconBgColor = isEmailVerification ? "rgba(79,138,255,0.1)" : "rgba(245,158,11,0.1)";
  const iconBorderColor = isEmailVerification ? "rgba(79,138,255,0.2)" : "rgba(245,158,11,0.2)";
  const borderColor = isEmailVerification ? "rgba(79,138,255,0.15)" : "rgba(245,158,11,0.15)";

  const handleSendVerification = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/send-verification", { method: "POST" });
        if (res.ok) {
          setEmailSent(true);
        }
      } catch {
        // silent
      }
    });
  };

  const handleDismiss = () => {
    setEmailSent(false);
    onDismiss();
  };

  return (
    <AnimatePresence>
      {rateLimitHit && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleDismiss}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)",
              zIndex: 9990,
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            style={{
              position: "fixed",
              top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 9991,
              width: "100%",
              maxWidth: 440,
              borderRadius: 16,
              background: "linear-gradient(180deg, #12121E 0%, #0D0D18 100%)",
              border: `1px solid ${borderColor}`,
              boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 40px ${isEmailVerification ? "rgba(79,138,255,0.05)" : "rgba(245,158,11,0.05)"}`,
              overflow: "hidden",
            }}
          >
            {/* Top accent bar */}
            <div style={{
              height: 3,
              background: `linear-gradient(90deg, ${gradientStart}, ${gradientEnd}, ${gradientStart})`,
            }} />

            {/* Close button */}
            <button
              onClick={handleDismiss}
              aria-label="Close"
              style={{
                position: "absolute", top: 12, right: 12,
                width: 32, height: 32, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#5C5C78", cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#9898B0"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#5C5C78"; }}
            >
              <X size={14} />
            </button>

            {/* Content */}
            <div style={{ padding: "28px 28px 24px" }}>
              {/* Icon + Title */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: iconBgColor,
                  border: `1px solid ${iconBorderColor}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {isEmailVerification ? (
                    <Mail size={20} style={{ color: accentColor }} />
                  ) : (
                    <AlertTriangle size={20} style={{ color: accentColor }} />
                  )}
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F5", margin: 0, lineHeight: 1.3 }}>
                    {rateLimitHit.title}
                  </h3>
                </div>
              </div>

              {/* Message */}
              <p style={{
                fontSize: 13, color: "#9898B0", lineHeight: 1.6,
                margin: "0 0 20px",
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}>
                {rateLimitHit.message}
              </p>

              {/* Email verification: show resend button + settings link */}
              {isEmailVerification && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {emailSent ? (
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      padding: "14px 20px", borderRadius: 12,
                      background: "rgba(16,185,129,0.08)",
                      border: "1px solid rgba(16,185,129,0.15)",
                    }}>
                      <ShieldCheck size={16} style={{ color: "#10B981" }} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#10B981" }}>
                        Verification email sent! Check your inbox.
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={handleSendVerification}
                      disabled={isPending}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", padding: "14px 20px",
                        borderRadius: 12,
                        background: `linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%)`,
                        color: "#fff", fontSize: 14, fontWeight: 700,
                        border: "none", cursor: isPending ? "wait" : "pointer",
                        boxShadow: `0 4px 20px ${isEmailVerification ? "rgba(79,138,255,0.3)" : "rgba(245,158,11,0.3)"}`,
                        transition: "all 0.2s",
                        opacity: isPending ? 0.7 : 1,
                      }}
                    >
                      <Mail size={16} />
                      {isPending ? "Sending..." : "Send Verification Email"}
                    </button>
                  )}

                  <Link
                    href="/dashboard/settings"
                    onClick={handleDismiss}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      width: "100%", padding: "12px 20px",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: "#9898B0", fontSize: 13, fontWeight: 600,
                      textDecoration: "none",
                      transition: "all 0.15s",
                    }}
                  >
                    Go to Settings
                    <ArrowRight size={14} />
                  </Link>
                </div>
              )}

              {/* Plan limit / Node limit: show upgrade CTA */}
              {!isEmailVerification && rateLimitHit.action && rateLimitHit.actionUrl && (
                <Link
                  href={rateLimitHit.actionUrl}
                  onClick={handleDismiss}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "100%", padding: "14px 20px",
                    borderRadius: 12,
                    background: `linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%)`,
                    color: isEmailVerification ? "#fff" : "#0D0D18",
                    fontSize: 14, fontWeight: 700,
                    textDecoration: "none",
                    boxShadow: `0 4px 20px ${isEmailVerification ? "rgba(79,138,255,0.3)" : "rgba(245,158,11,0.3)"}`,
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 30px ${isEmailVerification ? "rgba(79,138,255,0.4)" : "rgba(245,158,11,0.4)"}`; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 20px ${isEmailVerification ? "rgba(79,138,255,0.3)" : "rgba(245,158,11,0.3)"}`; (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
                >
                  <Zap size={16} />
                  {rateLimitHit.action}
                  <ArrowRight size={14} />
                </Link>
              )}

              {/* View all plans link (for plan/node limits) */}
              {!isEmailVerification && (
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <Link
                    href="/dashboard/billing"
                    onClick={handleDismiss}
                    style={{
                      fontSize: 12, color: "#5C5C78", textDecoration: "none",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
                  >
                    {t('rateLimit.viewAllPlans')}
                  </Link>
                </div>
              )}

              {/* Reassurance */}
              <p style={{ fontSize: 11, color: "#3A3A50", textAlign: "center", marginTop: 12, marginBottom: 0 }}>
                {isEmailVerification
                  ? "Your workflows and data are safe. Verify to continue building."
                  : t('rateLimit.upgradeReassurance')
                }
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
