"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  AlertTriangle,
  Bot,
  Star,
  Loader2,
  BarChart3,
  TrendingUp,
  Calendar,
  List,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────── */

interface KPIData {
  totalConversations: number;
  escalationRate: number;
  aiResolutionRate: number;
  avgSatisfaction: number;
}

interface CategoryStat {
  category: string;
  count: number;
}

interface DailyVolume {
  date: string;
  count: number;
}

interface AnalyticsData {
  kpis: KPIData;
  categoryDistribution: CategoryStat[];
  dailyVolume: DailyVolume[];
  topFirstMessages: string[];
}

/* ── Constants ────────────────────────────────────────────────────── */

const PERIODS = ["7d", "30d", "90d"] as const;
type Period = (typeof PERIODS)[number];

const CATEGORY_COLORS: Record<string, string> = {
  GENERAL: "#4F8AFF",
  BILLING: "#FBBF24",
  TECHNICAL: "#A78BFA",
  FEATURE_REQUEST: "#34D399",
  BUG_REPORT: "#EF4444",
  ACCOUNT: "#F97316",
};

function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "#6B7280";
}

/* ── KPI Card ─────────────────────────────────────────────────────── */

function KPICard({
  icon,
  label,
  value,
  color,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      style={{
        flex: 1,
        minWidth: 180,
        padding: "24px 20px",
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `${color}14`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: "#F0F0F5",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "#8888A0",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </motion.div>
  );
}

/* ── Section Container ────────────────────────────────────────────── */

function Section({
  title,
  icon,
  delay,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      style={{
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        padding: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 20,
          color: "#8888A0",
          fontSize: 13,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {icon}
        {title}
      </div>
      {children}
    </motion.div>
  );
}

/* ── Main Component ───────────────────────────────────────────────── */

export default function SupportAnalytics() {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/support/analytics?period=${p}`);
      if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
      const json: AnalyticsData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics(period);
  }, [period, fetchAnalytics]);

  /* ── Derived values ─────────────────────────────────────────────── */
  const maxCategoryCount = data
    ? Math.max(...data.categoryDistribution.map((c) => c.count), 1)
    : 1;

  const maxDailyCount = data
    ? Math.max(...data.dailyVolume.map((d) => d.count), 1)
    : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Header + Period Selector ───────────────────────────────── */}
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
            Support Analytics
          </h2>
          <p
            style={{
              color: "#666",
              fontSize: 13,
              margin: "4px 0 0",
            }}
          >
            Overview of support conversation metrics
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 4,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 8,
            padding: 3,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
                background:
                  period === p ? "rgba(79,138,255,0.2)" : "transparent",
                color: period === p ? "#4F8AFF" : "#888",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

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
            Loading analytics...
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

      {/* ── Data ───────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {data && !loading && !error && (
          <motion.div
            key={period}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ display: "flex", flexDirection: "column", gap: 24 }}
          >
            {/* ── KPI Cards ──────────────────────────────────────────── */}
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <KPICard
                icon={<MessageSquare size={18} />}
                label="Total Conversations"
                value={data.kpis.totalConversations.toLocaleString()}
                color="#4F8AFF"
                delay={0}
              />
              <KPICard
                icon={<AlertTriangle size={18} />}
                label="Escalation Rate"
                value={`${data.kpis.escalationRate.toFixed(1)}%`}
                color="#FBBF24"
                delay={0.05}
              />
              <KPICard
                icon={<Bot size={18} />}
                label="AI Resolution Rate"
                value={`${data.kpis.aiResolutionRate.toFixed(1)}%`}
                color="#34D399"
                delay={0.1}
              />
              <KPICard
                icon={<Star size={18} />}
                label="Avg Satisfaction"
                value={`${data.kpis.avgSatisfaction.toFixed(1)}/5`}
                color="#A78BFA"
                delay={0.15}
              />
            </div>

            {/* ── Charts Row ─────────────────────────────────────────── */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {/* Category Distribution */}
              <div style={{ flex: 1, minWidth: 300 }}>
                <Section
                  title="Category Distribution"
                  icon={<BarChart3 size={14} />}
                  delay={0.2}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    {data.categoryDistribution.map((cat) => {
                      const pct = (cat.count / maxCategoryCount) * 100;
                      const color = getCategoryColor(cat.category);
                      return (
                        <div key={cat.category}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 6,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                color: "#BBBBD0",
                                fontWeight: 500,
                              }}
                            >
                              {cat.category}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                color: "#888",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {cat.count}
                            </span>
                          </div>
                          <div
                            style={{
                              height: 8,
                              borderRadius: 4,
                              background: "rgba(255,255,255,0.04)",
                              overflow: "hidden",
                            }}
                          >
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{
                                duration: 0.6,
                                delay: 0.25,
                                ease: "easeOut",
                              }}
                              style={{
                                height: "100%",
                                borderRadius: 4,
                                background: color,
                                opacity: 0.8,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {data.categoryDistribution.length === 0 && (
                      <div
                        style={{
                          color: "#555",
                          fontSize: 13,
                          textAlign: "center",
                          padding: 20,
                        }}
                      >
                        No category data
                      </div>
                    )}
                  </div>
                </Section>
              </div>

              {/* Daily Volume Bar Chart */}
              <div style={{ flex: 1.5, minWidth: 400 }}>
                <Section
                  title="Volume by Day"
                  icon={<TrendingUp size={14} />}
                  delay={0.25}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      gap: 3,
                      height: 160,
                      padding: "0 4px",
                    }}
                  >
                    {data.dailyVolume.map((day, i) => {
                      const heightPct = (day.count / maxDailyCount) * 100;
                      const dateObj = new Date(day.date);
                      const dayLabel = dateObj.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      });
                      return (
                        <div
                          key={day.date}
                          style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            height: "100%",
                            justifyContent: "flex-end",
                            position: "relative",
                          }}
                          title={`${dayLabel}: ${day.count}`}
                        >
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{
                              height: `${Math.max(heightPct, 2)}%`,
                            }}
                            transition={{
                              duration: 0.5,
                              delay: 0.3 + i * 0.02,
                              ease: "easeOut",
                            }}
                            style={{
                              width: "100%",
                              maxWidth: 28,
                              background:
                                "linear-gradient(180deg, #4F8AFF 0%, rgba(79,138,255,0.3) 100%)",
                              borderRadius: "4px 4px 2px 2px",
                              minHeight: 2,
                              position: "relative",
                            }}
                          />
                          {/* Date label — show every Nth label to avoid crowding */}
                          {(data.dailyVolume.length <= 14 ||
                            i % Math.ceil(data.dailyVolume.length / 14) ===
                              0) && (
                            <span
                              style={{
                                fontSize: 9,
                                color: "#555",
                                marginTop: 4,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {dateObj.getDate()}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {data.dailyVolume.length === 0 && (
                    <div
                      style={{
                        color: "#555",
                        fontSize: 13,
                        textAlign: "center",
                        padding: 20,
                      }}
                    >
                      No volume data
                    </div>
                  )}

                  {/* Y-axis labels */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <span style={{ fontSize: 10, color: "#555" }}>
                      <Calendar size={10} style={{ marginRight: 4 }} />
                      {data.dailyVolume.length > 0
                        ? new Date(
                            data.dailyVolume[0].date
                          ).toLocaleDateString()
                        : ""}
                    </span>
                    <span style={{ fontSize: 10, color: "#555" }}>
                      Max: {maxDailyCount}
                    </span>
                    <span style={{ fontSize: 10, color: "#555" }}>
                      {data.dailyVolume.length > 0
                        ? new Date(
                            data.dailyVolume[data.dailyVolume.length - 1].date
                          ).toLocaleDateString()
                        : ""}
                    </span>
                  </div>
                </Section>
              </div>
            </div>

            {/* ── Top First Messages ─────────────────────────────────── */}
            <Section
              title="Top First Messages"
              icon={<List size={14} />}
              delay={0.3}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {data.topFirstMessages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      padding: "10px 14px",
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: "rgba(79,138,255,0.12)",
                        color: "#4F8AFF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span
                      style={{
                        color: "#BBBBD0",
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}
                    >
                      {msg}
                    </span>
                  </div>
                ))}
                {data.topFirstMessages.length === 0 && (
                  <div
                    style={{
                      color: "#555",
                      fontSize: 13,
                      textAlign: "center",
                      padding: 20,
                    }}
                  >
                    No messages to display
                  </div>
                )}
              </div>
            </Section>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
