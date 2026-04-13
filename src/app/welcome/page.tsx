"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Sparkles, LayoutGrid, Globe, Share2, Copy, Check,
  ArrowRight, Mail, CheckCircle2,
} from "lucide-react";
import { pushToDataLayer } from "@/lib/gtm";

export default function WelcomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  // Redirect unauthenticated users
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/register");
  }, [status, router]);

  // Fire conversion event on mount (dedicated URL for GTM trigger)
  useEffect(() => {
    if (session?.user) {
      pushToDataLayer("sign_up_complete", {
        method: session.user.image ? "google" : "credentials",
      });
    }
  }, [session]);

  // Fetch referral code
  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/referral", { method: "POST" })
      .then(r => r.json())
      .then(d => { if (d.code) setReferralCode(d.code); })
      .catch(() => {});
  }, [session]);

  const handleCopyReferral = () => {
    if (!referralCode) return;
    const url = `${window.location.origin}/register?ref=${referralCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (status === "loading" || !session?.user) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#06080C" }}>
        <div style={{ width: 24, height: 24, border: "2px solid rgba(99,102,241,0.3)", borderTopColor: "#6366F1", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const user = session.user;
  const emailVerified = (user as { emailVerified?: boolean }).emailVerified;
  const firstName = user.name?.split(" ")[0] || "there";

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.08) 0%, #06080C 60%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 20px",
    }}>
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{
          maxWidth: 560, width: "100%",
          background: "rgba(15,16,25,0.95)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 20,
          boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 60px rgba(99,102,241,0.04)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "32px 36px 24px",
          background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(16,185,129,0.05))",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            style={{
              width: 56, height: 56, borderRadius: 16,
              background: "linear-gradient(135deg, #4F8AFF, #6366F1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 20,
              boxShadow: "0 8px 24px rgba(99,102,241,0.3)",
            }}
          >
            <Sparkles size={28} color="#fff" />
          </motion.div>
          <h1 style={{
            fontSize: 28, fontWeight: 800, marginBottom: 8,
            background: "linear-gradient(135deg, #FFFFFF 0%, #E0E7FF 60%, #A5B4FC 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text", letterSpacing: "-0.03em",
          }}>
            Welcome, {firstName}!
          </h1>
          <p style={{ fontSize: 15, color: "#A8A8C4", lineHeight: 1.6 }}>
            Your account is ready. Here&apos;s how to get the most out of BuildFlow.
          </p>
        </div>

        <div style={{ padding: "24px 36px 32px" }}>
          {/* Email verification prompt */}
          {!emailVerified && (
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 16px", borderRadius: 12, marginBottom: 20,
                background: "rgba(245,158,11,0.06)",
                border: "1px solid rgba(245,158,11,0.12)",
              }}
            >
              <Mail size={18} style={{ color: "#F59E0B", flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 13, color: "#FCD34D", fontWeight: 600, marginBottom: 2 }}>
                  Verify your email
                </p>
                <p style={{ fontSize: 12, color: "#A8A8C4", lineHeight: 1.4 }}>
                  Check your inbox for a verification link to unlock all features.
                </p>
              </div>
            </motion.div>
          )}

          {emailVerified && (
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 12, marginBottom: 20,
                background: "rgba(16,185,129,0.06)",
                border: "1px solid rgba(16,185,129,0.12)",
              }}
            >
              <CheckCircle2 size={16} style={{ color: "#10B981", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "#6EE7B7", fontWeight: 500 }}>
                Email verified
              </span>
            </motion.div>
          )}

          {/* Quick action cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {[
              {
                icon: <LayoutGrid size={18} />,
                title: "Create your first workflow",
                desc: "Drag and drop AI nodes onto the canvas",
                href: "/dashboard",
                color: "#4F8AFF",
                delay: 0.35,
              },
              {
                icon: <Globe size={18} />,
                title: "Explore templates",
                desc: "Clone a proven workflow in one click",
                href: "/dashboard/templates",
                color: "#10B981",
                delay: 0.4,
              },
              {
                icon: <Sparkles size={18} />,
                title: "Try the live demo",
                desc: "See BuildFlow in action — no setup needed",
                href: "/demo",
                color: "#8B5CF6",
                delay: 0.45,
              },
            ].map((action) => (
              <motion.div
                key={action.title}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: action.delay, ease: [0.22, 1, 0.36, 1] }}
              >
                <Link
                  href={action.href}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "14px 16px", borderRadius: 12,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    textDecoration: "none",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = `rgba(${action.color === "#4F8AFF" ? "79,138,255" : action.color === "#10B981" ? "16,185,129" : "139,92,246"},0.06)`;
                    e.currentTarget.style.borderColor = `rgba(${action.color === "#4F8AFF" ? "79,138,255" : action.color === "#10B981" ? "16,185,129" : "139,92,246"},0.15)`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: `${action.color}15`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: action.color, flexShrink: 0,
                  }}>
                    {action.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#E8E8F0", marginBottom: 2 }}>
                      {action.title}
                    </p>
                    <p style={{ fontSize: 12, color: "#7C7C96" }}>
                      {action.desc}
                    </p>
                  </div>
                  <ArrowRight size={16} style={{ color: "#5C5C78" }} />
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Referral section */}
          {referralCode && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              style={{
                padding: "16px 18px", borderRadius: 12,
                background: "rgba(16,185,129,0.04)",
                border: "1px solid rgba(16,185,129,0.1)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Share2 size={15} style={{ color: "#10B981" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#6EE7B7" }}>
                  Invite a colleague
                </span>
              </div>
              <p style={{ fontSize: 12, color: "#A8A8C4", marginBottom: 12, lineHeight: 1.5 }}>
                Share your link — you both get a bonus execution.
              </p>
              <button
                onClick={handleCopyReferral}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 14px", borderRadius: 8,
                  background: copied ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${copied ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`,
                  color: copied ? "#6EE7B7" : "#C0C0D0",
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                  transition: "all 0.2s ease",
                  width: "100%", justifyContent: "center",
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Link copied!" : "Copy referral link"}
              </button>
            </motion.div>
          )}

          {/* Skip link */}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <Link
              href="/dashboard"
              style={{
                fontSize: 13, color: "#7C7C96", textDecoration: "none",
                transition: "color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#A8A8C4"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#7C7C96"; }}
            >
              Skip to dashboard
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
