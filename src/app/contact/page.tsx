"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, useState } from "react";
import { useLocale } from "@/hooks";
import { trackContact } from "@/lib/meta-pixel";
import {
  Mail,
  MessageSquare,
  MapPin,
  Clock,
  Send,
  Building2,
  Headphones,
  FileQuestion,
  ArrowLeft,
  CheckCircle,
  Loader2,
  User,
  AtSign,
  AlignLeft,
  Instagram,
  Linkedin,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const smoothEase: [number, number, number, number] = [0.25, 0.4, 0.25, 1];

export default function ContactPage() {
  const { t } = useLocale();

  const contactChannels = [
    { icon: Mail, color: "#4F8AFF", title: t('contact.channelEmailTitle'), description: t('contact.channelEmailDesc'), detail: "hello@buildflow.app", href: "mailto:hello@buildflow.app" },
    { icon: Headphones, color: "#10B981", title: t('contact.channelSupportTitle'), description: t('contact.channelSupportDesc'), detail: "support@buildflow.app", href: "mailto:support@buildflow.app" },
    { icon: Building2, color: "#8B5CF6", title: t('contact.channelSalesTitle'), description: t('contact.channelSalesDesc'), detail: "sales@buildflow.app", href: "mailto:sales@buildflow.app" },
    { icon: FileQuestion, color: "#F59E0B", title: t('contact.channelLegalTitle'), description: t('contact.channelLegalDesc'), detail: "legal@buildflow.app", href: "mailto:legal@buildflow.app" },
  ];

  const officeInfo = [
    { icon: MapPin, label: t('contact.locationLabel'), value: t('contact.locationValue'), sub: t('contact.locationSub') },
    { icon: Clock, label: t('contact.hoursLabel'), value: t('contact.hoursValue'), sub: t('contact.hoursSub') },
  ];

  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.97]);

  const [formState, setFormState] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    trackContact({ content_name: formState.subject || "contact_form" });

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formState),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json().catch(() => null);
        console.error("[contact] Submission failed:", data?.error || res.statusText);
        setSubmitted(true); // Email notification was likely sent
      }
    } catch (err) {
      console.error("[contact] Network error:", err);
      // Don't show success on network failure
    } finally {
      setSending(false);
    }
  };

  const inputStyle = (field: string) => ({
    width: "100%",
    padding: "12px 14px 12px 40px",
    height: field === "message" ? 140 : 48,
    borderRadius: 12,
    border: `1px solid ${
      focusedField === field
        ? "rgba(79,138,255,0.4)"
        : "rgba(255,255,255,0.06)"
    }`,
    background: "#08080f",
    color: "#F0F0F5",
    fontSize: 14,
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
    boxShadow:
      focusedField === field ? "0 0 0 3px rgba(79,138,255,0.08)" : "none",
    resize: "none" as const,
    fontFamily: "inherit",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#07070D",
        color: "#F0F0F5",
        overflowX: "hidden",
      }}
    >
      <div className="noise-texture" />

      {/* ── Navbar ─────────────────────────────────────────── */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 max(16px, min(48px, 4vw))",
          height: 64,
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <img
              src="/buildflow_logo.png"
              alt="BuildFlow"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: "#F0F0F5",
              letterSpacing: "-0.3px",
            }}
          >
            Build<span style={{ color: "#4F8AFF" }}>Flow</span>
          </span>
        </Link>
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "#9898B0",
            textDecoration: "none",
            transition: "color 0.2s",
          }}
        >
          <ArrowLeft size={14} />
          {t('contact.backToHome')}
        </Link>
      </nav>

      {/* ── Hero ───────────────────────────────────────────── */}
      <motion.section
        ref={heroRef}
        style={{
          paddingTop: 140,
          paddingBottom: 60,
          position: "relative",
          overflow: "hidden",
          opacity: heroOpacity,
          scale: heroScale,
        }}
      >
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div className="blueprint-grid" />
          <div
            className="orb-drift-1"
            style={{
              position: "absolute",
              top: "-5%",
              left: "15%",
              width: 500,
              height: 500,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)",
              filter: "blur(40px)",
            }}
          />
          <div
            className="orb-drift-2"
            style={{
              position: "absolute",
              top: "20%",
              right: "10%",
              width: 400,
              height: 400,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(79,138,255,0.08) 0%, transparent 70%)",
              filter: "blur(40px)",
            }}
          />
        </div>

        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
            padding: "0 max(16px, min(48px, 4vw))",
            position: "relative",
            zIndex: 1,
            textAlign: "center",
          }}
        >
          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            transition={{ duration: 0.6, ease: smoothEase }}
          >
            <span
              className="blueprint-annotation"
              style={{ marginBottom: 16, display: "block" }}
            >
              {t('contact.heroAnnotation')}
            </span>
            <div className="accent-line" />

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 72,
                height: 72,
                borderRadius: 20,
                background:
                  "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(79,138,255,0.1))",
                border: "1px solid rgba(16,185,129,0.15)",
                marginBottom: 28,
              }}
            >
              <MessageSquare size={32} strokeWidth={1.5} color="#10B981" />
            </div>

            <h1
              style={{
                fontSize: "clamp(2.2rem, 4.5vw, 3.5rem)",
                fontWeight: 900,
                letterSpacing: "-0.04em",
                lineHeight: 1.1,
                marginBottom: 20,
              }}
            >
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #10B981, #4F8AFF, #8B5CF6)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                {t('contact.title')}
              </span>
            </h1>
            <p
              style={{
                fontSize: 16,
                color: "#9898B0",
                lineHeight: 1.7,
                maxWidth: 560,
                margin: "0 auto",
              }}
            >
              {t('contact.heroDesc')}
            </p>
          </motion.div>
        </div>
      </motion.section>

      {/* ── Contact Channels ───────────────────────────────── */}
      <section className="contact-channels-section" style={{ padding: "0 48px 48px", maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
          }}
        >
          {contactChannels.map((channel, i) => (
            <motion.a
              key={channel.title}
              href={channel.href}
              className="node-card"
              style={
                {
                  "--node-port-color": channel.color,
                  textDecoration: "none",
                  cursor: "pointer",
                } as React.CSSProperties
              }
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-40px" }}
              variants={fadeUp}
              transition={{
                duration: 0.5,
                delay: i * 0.08,
                ease: smoothEase,
              }}
              whileHover={{ y: -4 }}
            >
              <div style={{ padding: "24px 24px 20px" }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: `${channel.color}15`,
                    border: `1px solid ${channel.color}20`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <channel.icon size={20} color={channel.color} />
                </div>
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#F0F0F5",
                    marginBottom: 6,
                  }}
                >
                  {channel.title}
                </h3>
                <p
                  style={{
                    fontSize: 13,
                    color: "#7C7C96",
                    lineHeight: 1.5,
                    marginBottom: 12,
                  }}
                >
                  {channel.description}
                </p>
                <span
                  style={{
                    fontSize: 13,
                    color: channel.color,
                    fontWeight: 600,
                  }}
                >
                  {channel.detail}
                </span>
              </div>
            </motion.a>
          ))}
        </div>
      </section>

      {/* ── Contact Form + Info ─────────────────────────────── */}
      <section style={{ padding: "0 48px 80px", maxWidth: 1100, margin: "0 auto" }}>
        <div
          className="contact-form-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 380px",
            gap: 32,
            alignItems: "start",
          }}
        >
          {/* Form */}
          <motion.div
            className="node-card"
            style={
              {
                "--node-port-color": "#4F8AFF",
              } as React.CSSProperties
            }
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            variants={fadeUp}
            transition={{ duration: 0.5, ease: smoothEase }}
          >
            <div
              className="node-header"
              style={{
                background:
                  "linear-gradient(135deg, rgba(79,138,255,0.1), rgba(79,138,255,0.03))",
                borderBottom: "1px solid rgba(79,138,255,0.08)",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#10B981",
                  boxShadow: "0 0 8px #10B981",
                }}
              />
              <span style={{ color: "#4F8AFF" }}>{t('contact.formHeader')}</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 8,
                  padding: "2px 8px",
                  borderRadius: 10,
                  background: "rgba(16,185,129,0.2)",
                  color: "#10B981",
                  fontWeight: 600,
                }}
              >
                {t('contact.formOnline')}
              </span>
            </div>

            <div style={{ padding: "28px 28px" }}>
              {submitted ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, ease: smoothEase }}
                  style={{ textAlign: "center", padding: "48px 24px" }}
                >
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: "50%",
                      background: "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 20px",
                    }}
                  >
                    <CheckCircle size={28} color="#10B981" />
                  </div>
                  <h3
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "#F0F0F5",
                      marginBottom: 10,
                    }}
                  >
                    {t('contact.messageSent')}
                  </h3>
                  <p
                    style={{
                      fontSize: 14,
                      color: "#9898B0",
                      lineHeight: 1.7,
                      maxWidth: 400,
                      margin: "0 auto",
                    }}
                  >
                    {t('contact.messageSentDesc')}
                  </p>
                  <button
                    onClick={() => {
                      setSubmitted(false);
                      setFormState({
                        name: "",
                        email: "",
                        subject: "",
                        message: "",
                      });
                    }}
                    style={{
                      marginTop: 24,
                      padding: "10px 24px",
                      borderRadius: 10,
                      border: "1px solid rgba(79,138,255,0.2)",
                      background: "rgba(79,138,255,0.06)",
                      color: "#4F8AFF",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    {t('contact.sendAnother')}
                  </button>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <div
                    className="contact-name-email-grid"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 16,
                      marginBottom: 16,
                    }}
                  >
                    {/* Name */}
                    <div style={{ position: "relative" }}>
                      <User
                        size={16}
                        color={
                          focusedField === "name" ? "#4F8AFF" : "#3A3A50"
                        }
                        style={{
                          position: "absolute",
                          left: 14,
                          top: 16,
                          transition: "color 0.2s",
                        }}
                      />
                      <input
                        type="text"
                        placeholder={t('contact.namePlaceholder')}
                        required
                        value={formState.name}
                        onChange={(e) =>
                          setFormState((s) => ({ ...s, name: e.target.value }))
                        }
                        onFocus={() => setFocusedField("name")}
                        onBlur={() => setFocusedField(null)}
                        style={inputStyle("name")}
                      />
                    </div>

                    {/* Email */}
                    <div style={{ position: "relative" }}>
                      <AtSign
                        size={16}
                        color={
                          focusedField === "email" ? "#4F8AFF" : "#3A3A50"
                        }
                        style={{
                          position: "absolute",
                          left: 14,
                          top: 16,
                          transition: "color 0.2s",
                        }}
                      />
                      <input
                        type="email"
                        placeholder={t('contact.emailPlaceholder')}
                        required
                        value={formState.email}
                        onChange={(e) =>
                          setFormState((s) => ({
                            ...s,
                            email: e.target.value,
                          }))
                        }
                        onFocus={() => setFocusedField("email")}
                        onBlur={() => setFocusedField(null)}
                        style={inputStyle("email")}
                      />
                    </div>
                  </div>

                  {/* Subject */}
                  <div style={{ position: "relative", marginBottom: 16 }}>
                    <Mail
                      size={16}
                      color={
                        focusedField === "subject" ? "#4F8AFF" : "#3A3A50"
                      }
                      style={{
                        position: "absolute",
                        left: 14,
                        top: 16,
                        transition: "color 0.2s",
                      }}
                    />
                    <input
                      type="text"
                      placeholder={t('contact.subjectPlaceholder')}
                      required
                      value={formState.subject}
                      onChange={(e) =>
                        setFormState((s) => ({
                          ...s,
                          subject: e.target.value,
                        }))
                      }
                      onFocus={() => setFocusedField("subject")}
                      onBlur={() => setFocusedField(null)}
                      style={inputStyle("subject")}
                    />
                  </div>

                  {/* Message */}
                  <div style={{ position: "relative", marginBottom: 24 }}>
                    <AlignLeft
                      size={16}
                      color={
                        focusedField === "message" ? "#4F8AFF" : "#3A3A50"
                      }
                      style={{
                        position: "absolute",
                        left: 14,
                        top: 16,
                        transition: "color 0.2s",
                      }}
                    />
                    <textarea
                      placeholder={t('contact.messagePlaceholder')}
                      required
                      value={formState.message}
                      onChange={(e) =>
                        setFormState((s) => ({
                          ...s,
                          message: e.target.value,
                        }))
                      }
                      onFocus={() => setFocusedField("message")}
                      onBlur={() => setFocusedField(null)}
                      style={inputStyle("message")}
                    />
                  </div>

                  {/* Submit */}
                  <motion.button
                    type="submit"
                    disabled={sending}
                    whileHover={{ scale: 1.008 }}
                    whileTap={{ scale: 0.995 }}
                    style={{
                      width: "100%",
                      padding: "14px 24px",
                      borderRadius: 12,
                      border: "none",
                      fontSize: 14,
                      fontWeight: 700,
                      color: "white",
                      background:
                        "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                      boxShadow: "0 2px 16px rgba(79,138,255,0.3)",
                      cursor: sending ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      opacity: sending ? 0.7 : 1,
                      transition: "opacity 0.2s",
                    }}
                  >
                    {sending ? (
                      <>
                        <Loader2
                          size={16}
                          style={{
                            animation: "spin 1s linear infinite",
                          }}
                        />
                        {t('contact.sending')}
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        {t('contact.sendMessage')}
                      </>
                    )}
                  </motion.button>
                </form>
              )}
            </div>
          </motion.div>

          {/* Right sidebar — Office Info */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Office card */}
            <motion.div
              className="node-card"
              style={
                {
                  "--node-port-color": "#10B981",
                } as React.CSSProperties
              }
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-40px" }}
              variants={fadeUp}
              transition={{ duration: 0.5, delay: 0.1, ease: smoothEase }}
            >
              <div
                className="node-header"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.03))",
                  borderBottom: "1px solid rgba(16,185,129,0.08)",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#10B981",
                    boxShadow: "0 0 8px #10B981",
                  }}
                />
                <span style={{ color: "#10B981" }}>{t('contact.officeHeader')}</span>
              </div>
              <div style={{ padding: "20px 24px" }}>
                {officeInfo.map((info, i) => (
                  <div
                    key={info.label}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 14,
                      marginBottom:
                        i < officeInfo.length - 1 ? 20 : 0,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "rgba(16,185,129,0.08)",
                        border: "1px solid rgba(16,185,129,0.12)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <info.icon size={16} color="#10B981" />
                    </div>
                    <div>
                      <span
                        style={{
                          fontSize: 11,
                          color: "#7C7C96",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                        }}
                      >
                        {info.label}
                      </span>
                      <p
                        style={{
                          fontSize: 14,
                          color: "#F0F0F5",
                          fontWeight: 600,
                          margin: "2px 0",
                        }}
                      >
                        {info.value}
                      </p>
                      <span style={{ fontSize: 12, color: "#7C7C96" }}>
                        {info.sub}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Social Links card */}
            <motion.div
              className="node-card"
              style={{ "--node-port-color": "#E1306C" } as React.CSSProperties}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-40px" }}
              variants={fadeUp}
              transition={{ duration: 0.5, delay: 0.12, ease: smoothEase }}
            >
              <div
                className="node-header"
                style={{
                  background: "linear-gradient(135deg, rgba(225,48,108,0.1), rgba(225,48,108,0.03))",
                  borderBottom: "1px solid rgba(225,48,108,0.08)",
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#E1306C", boxShadow: "0 0 8px #E1306C" }} />
                <span style={{ color: "#E1306C" }}>{t('contact.socialHeader')}</span>
              </div>
              <div style={{ padding: "20px 24px", display: "flex", gap: 12 }}>
                {[
                  { icon: Instagram, href: "https://www.instagram.com/buildflow_live/", label: "Instagram", color: "#E1306C" },
                  { icon: Linkedin, href: "https://www.linkedin.com/in/buildflow/", label: "LinkedIn", color: "#0A66C2" },
                  { icon: Mail, href: "mailto:buildflow786@gmail.com", label: "Email", color: "#4F8AFF" },
                ].map(s => (
                  <a
                    key={s.label}
                    href={s.href}
                    target={s.href.startsWith("mailto:") ? undefined : "_blank"}
                    rel={s.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                    aria-label={s.label}
                    style={{
                      flex: 1, padding: "14px 12px", borderRadius: 10,
                      background: `${s.color}08`, border: `1px solid ${s.color}15`,
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                      textDecoration: "none", transition: "all 0.2s",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${s.color}15`; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${s.color}08`; }}
                  >
                    <s.icon size={20} color={s.color} />
                    <span style={{ fontSize: 11, color: "#9898B0", fontWeight: 600 }}>{s.label}</span>
                  </a>
                ))}
              </div>
            </motion.div>

            {/* FAQ card */}
            <motion.div
              className="node-card"
              style={
                {
                  "--node-port-color": "#F59E0B",
                } as React.CSSProperties
              }
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-40px" }}
              variants={fadeUp}
              transition={{ duration: 0.5, delay: 0.15, ease: smoothEase }}
            >
              <div
                className="node-header"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.03))",
                  borderBottom: "1px solid rgba(245,158,11,0.08)",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#F59E0B",
                    boxShadow: "0 0 8px #F59E0B",
                  }}
                />
                <span style={{ color: "#F59E0B" }}>{t('contact.faqHeader')}</span>
              </div>
              <div style={{ padding: "20px 24px" }}>
                {[
                  {
                    q: t('contact.faq1Q'),
                    a: t('contact.faq1A'),
                  },
                  {
                    q: t('contact.faq2Q'),
                    a: t('contact.faq2A'),
                  },
                  {
                    q: t('contact.faq3Q'),
                    a: t('contact.faq3A'),
                  },
                ].map((faq, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: i < 2 ? 16 : 0,
                      paddingBottom: i < 2 ? 16 : 0,
                      borderBottom:
                        i < 2
                          ? "1px solid rgba(255,255,255,0.04)"
                          : "none",
                    }}
                  >
                    <p
                      style={{
                        fontSize: 13,
                        color: "#F0F0F5",
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                    >
                      {faq.q}
                    </p>
                    <p style={{ fontSize: 12, color: "#7C7C96", lineHeight: 1.5 }}>
                      {faq.a}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer
        className="landing-footer-wrapper"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.04)",
          padding: "32px 48px",
          background: "rgba(7,7,13,0.9)",
        }}
      >
        <div
          className="landing-footer"
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              <img
                src="/buildflow_logo.png"
                alt="BuildFlow"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
            <span
              style={{ fontSize: 13, color: "#5C5C78", fontWeight: 600 }}
            >
              {t('contact.footerCopyright')}
            </span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            {[
              { label: t('contact.footerPrivacy'), href: "/privacy" },
              { label: t('contact.footerTerms'), href: "/terms" },
              { label: t('contact.footerContact'), href: "/contact" },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                style={{
                  fontSize: 12,
                  color: "#5C5C78",
                  textDecoration: "none",
                  transition: "color 0.15s",
                }}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {[
              { icon: Instagram, href: "https://www.instagram.com/buildflow_live/", label: "Instagram", color: "#E1306C" },
              { icon: Linkedin, href: "https://www.linkedin.com/in/buildflow/", label: "LinkedIn", color: "#0A66C2" },
              { icon: Mail, href: "mailto:buildflow786@gmail.com", label: "Email", color: "#4F8AFF" },
            ].map(s => (
              <a key={s.label} href={s.href} target={s.href.startsWith("mailto:") ? undefined : "_blank"} rel={s.href.startsWith("mailto:") ? undefined : "noopener noreferrer"} aria-label={s.label}
                style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5C5C78", transition: "all 0.2s", textDecoration: "none" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = s.color; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
              >
                <s.icon size={13} />
              </a>
            ))}
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (max-width: 860px) {
          .contact-form-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 768px) {
          main { padding-left: 16px !important; padding-right: 16px !important; }
          section { padding-left: 16px !important; padding-right: 16px !important; }
          .landing-footer { flex-direction: column !important; gap: 16px !important; text-align: center !important; }
          .landing-footer-wrapper { padding: 24px 16px !important; }
        }
        @media (max-width: 480px) {
          .contact-name-email-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
