"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ArrowRight, X, Zap } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";

interface RateLimitInfo {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

interface RateLimitUpgradeModalProps {
  rateLimitHit: RateLimitInfo | null;
  onDismiss: () => void;
}

export function RateLimitUpgradeModal({ rateLimitHit, onDismiss }: RateLimitUpgradeModalProps) {
  const { t } = useLocale();

  return (
    <AnimatePresence>
      {rateLimitHit && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onDismiss}
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
              maxWidth: 420,
              borderRadius: 16,
              background: "linear-gradient(180deg, #12121E 0%, #0D0D18 100%)",
              border: "1px solid rgba(245,158,11,0.15)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 40px rgba(245,158,11,0.05)",
              overflow: "hidden",
            }}
          >
            {/* Top accent bar */}
            <div style={{
              height: 3,
              background: "linear-gradient(90deg, #F59E0B, #EF4444, #F59E0B)",
            }} />

            {/* Close button */}
            <button
              onClick={onDismiss}
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
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <AlertTriangle size={20} style={{ color: "#F59E0B" }} />
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

              {/* Upgrade CTA */}
              {rateLimitHit.action && rateLimitHit.actionUrl && (
                <Link
                  href={rateLimitHit.actionUrl}
                  onClick={onDismiss}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    width: "100%", padding: "14px 20px",
                    borderRadius: 12,
                    background: "linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)",
                    color: "#0D0D18", fontSize: 14, fontWeight: 700,
                    textDecoration: "none",
                    boxShadow: "0 4px 20px rgba(245,158,11,0.3)",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 30px rgba(245,158,11,0.4)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(245,158,11,0.3)"; (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
                >
                  <Zap size={16} />
                  {rateLimitHit.action}
                  <ArrowRight size={14} />
                </Link>
              )}

              {/* View all plans link */}
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <Link
                  href="/dashboard/billing"
                  onClick={onDismiss}
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

              {/* Reassurance */}
              <p style={{ fontSize: 11, color: "#3A3A50", textAlign: "center", marginTop: 12, marginBottom: 0 }}>
                {t('rateLimit.upgradeReassurance')}
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
