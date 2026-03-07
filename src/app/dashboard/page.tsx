"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Play, Zap, GitFork, Clock, Plus, TrendingUp, Sparkles, Layers, BarChart3, Timer, LayoutGrid } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { WorkflowCard } from "@/components/community/WorkflowCard";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { api } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";

// Skeleton loader for stat cards
function StatCardSkeleton() {
  return (
    <div
      className="rounded-[14px] border border-[rgba(255,255,255,0.05)] p-5 animate-pulse"
      style={{
        background: "linear-gradient(135deg, rgba(18,18,30,0.9) 0%, rgba(15,15,24,0.95) 100%)",
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 bg-[#1A1A2A] rounded-[10px]" />
        <div className="w-3 h-3 bg-[#1A1A2A] rounded" />
      </div>
      <div className="w-20 h-9 bg-[#1A1A2A] rounded-lg mb-2" />
      <div className="w-24 h-3 bg-[#1A1A2A] rounded" />
    </div>
  );
}

// Animated counter component
function AnimatedCounter({ value, suffix = "" }: { value: number | string; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (typeof value === "number") {
      let start = 0;
      const end = value;
      const duration = 1000;
      const stepTime = 30;
      const steps = duration / stepTime;
      const increment = end / steps;

      const timer = setInterval(() => {
        start += increment;
        if (start >= end) {
          setDisplayValue(end);
          clearInterval(timer);
        } else {
          setDisplayValue(Math.floor(start));
        }
      }, stepTime);

      return () => clearInterval(timer);
    }
  }, [value]);

  if (typeof value === "string") return <>{value}{suffix}</>;
  return <>{displayValue}{suffix}</>;
}

const statIcons = [
  <Layers key="layers" size={18} />,
  <BarChart3 key="bar" size={18} />,
  <Timer key="timer" size={18} />,
  <LayoutGrid key="grid" size={18} />,
];

export default function DashboardPage() {
  const { t } = useLocale();
  const featuredWorkflows = PREBUILT_WORKFLOWS.slice(0, 3);
  const [workflowCount, setWorkflowCount] = useState<number | null>(null);
  const [executionCount, setExecutionCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const hoursSaved = executionCount !== null ? Math.round((executionCount * 0.5) * 10) / 10 : 0;

  useEffect(() => {
    Promise.all([
      api.workflows.list().then(({ workflows }) => setWorkflowCount(workflows.length)),
      fetch("/api/executions")
        .then(res => res.json())
        .then(data => {
          if (data.executions && Array.isArray(data.executions)) {
            setExecutionCount(data.executions.length);
          } else {
            setExecutionCount(0);
          }
        })
    ])
      .catch(() => {
        setWorkflowCount(0);
        setExecutionCount(0);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const stats = [
    {
      label: t('dashboard.myWorkflows'),
      value: workflowCount === null ? "..." : workflowCount,
      color: "#4F8AFF",
      gradient: "linear-gradient(135deg, #4F8AFF 0%, #6B9FFF 100%)",
      href: "/dashboard/workflows",
      trend: workflowCount !== null && workflowCount > 0 ? `${workflowCount} ${t('dashboard.total')}` : null
    },
    {
      label: t('dashboard.executions'),
      value: executionCount === null ? "..." : executionCount,
      color: "#10B981",
      gradient: "linear-gradient(135deg, #10B981 0%, #34D399 100%)",
      href: "/dashboard/history",
      trend: executionCount !== null && executionCount > 0 ? `${executionCount} ${t('dashboard.total')}` : null
    },
    {
      label: t('dashboard.hoursSaved'),
      value: hoursSaved === 0 ? "..." : hoursSaved,
      suffix: "h",
      color: "#F59E0B",
      gradient: "linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)",
      href: "/dashboard/history",
      trend: hoursSaved > 0 ? `~${hoursSaved}h ${t('dashboard.estimated')}` : null
    },
    {
      label: t('dashboard.templates'),
      value: PREBUILT_WORKFLOWS.length,
      color: "#8B5CF6",
      gradient: "linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)",
      href: "/dashboard/templates",
      trend: `${PREBUILT_WORKFLOWS.length} available`
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('dashboard.title')}
        subtitle={`${t('dashboard.subtitle')} (${t('dashboard.beta')})`}
      />

      <main className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Stat Cards */}
        <div className="grid grid-cols-4 gap-4">
          {isLoading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <Link
                  href={stat.href}
                  className="group block relative rounded-[14px] border border-[rgba(255,255,255,0.06)] p-6 hover:border-[rgba(255,255,255,0.14)] transition-all duration-300 hover:-translate-y-1"
                  style={{
                    background: "linear-gradient(145deg, rgba(18,18,30,0.95) 0%, rgba(14,14,22,0.98) 100%)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.02) inset",
                  }}
                >
                  {/* Top gradient accent */}
                  <div
                    className="absolute top-0 left-4 right-4 h-[1.5px] rounded-b-full opacity-60 group-hover:opacity-100 transition-opacity"
                    style={{ background: stat.gradient }}
                  />

                  {/* Hover glow */}
                  <div
                    className="absolute inset-0 rounded-[14px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    style={{
                      background: `radial-gradient(ellipse at 50% -10%, ${stat.color}12, transparent 65%)`,
                    }}
                  />

                  <div className="relative">
                    <div className="flex items-start justify-between mb-5">
                      <div
                        className="w-10 h-10 rounded-[10px] flex items-center justify-center transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg"
                        style={{
                          background: `linear-gradient(135deg, ${stat.color}18, ${stat.color}08)`,
                          border: `1px solid ${stat.color}20`,
                          color: stat.color,
                          boxShadow: `0 0 0 0 ${stat.color}00`,
                        }}
                      >
                        {statIcons[index]}
                      </div>
                      <ArrowRight
                        size={13}
                        className="text-[#2A2A3E] group-hover:text-[#5C5C78] group-hover:translate-x-0.5 transition-all duration-300"
                      />
                    </div>

                    <div className="text-[34px] font-bold text-[#F0F0F5] leading-none mb-1.5 tracking-[-0.03em] tabular-nums">
                      <AnimatedCounter value={stat.value} suffix={stat.suffix || ""} />
                    </div>

                    <div className="text-[12.5px] font-medium text-[#6C6C8A] tracking-[-0.005em]">{stat.label}</div>

                    {stat.trend && (
                      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-[rgba(255,255,255,0.04)]">
                        <TrendingUp size={10} className="text-[#3A3A50]" />
                        <span className="text-[10.5px] text-[#4A4A64]">{stat.trend}</span>
                      </div>
                    )}
                  </div>
                </Link>
              </motion.div>
            ))
          )}
        </div>

        {/* Quick Start Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[13px] font-semibold text-[#E0E0EE] tracking-[-0.01em]">{t('dashboard.quickActions')}</h2>
              <p className="text-[11.5px] text-[#4A4A64] mt-0.5">{t('dashboard.getStarted')}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-[#4A4A64]">
              <Sparkles size={10} className="text-[#F59E0B]" />
              <span>{t('dashboard.choosePath')}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3.5">
            {[
              {
                title: t('dashboard.newBlankWorkflow'),
                description: t('dashboard.newBlankDesc'),
                href: "/dashboard/workflows/new",
                icon: <Plus size={19} strokeWidth={2.2} />,
                color: "#4F8AFF",
                badge: null,
              },
              {
                title: t('dashboard.useAiPrompt'),
                description: t('dashboard.useAiPromptDesc'),
                href: "/dashboard/workflows/new?mode=prompt",
                icon: <Zap size={19} />,
                color: "#8B5CF6",
                badge: t('dashboard.ai'),
              },
              {
                title: t('dashboard.browseTemplates'),
                description: t('dashboard.browseTemplatesDesc'),
                href: "/dashboard/templates",
                icon: <GitFork size={19} />,
                color: "#10B981",
                badge: t('dashboard.popular'),
              },
            ].map((action, index) => (
              <motion.div
                key={action.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 + index * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <Link
                  href={action.href}
                  className="group relative flex items-start gap-4 rounded-[13px] border border-[rgba(255,255,255,0.05)] p-5 transition-all duration-300 hover:-translate-y-0.5"
                  style={{
                    background: "linear-gradient(145deg, rgba(18,18,30,0.9) 0%, rgba(14,14,22,0.95) 100%)",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = `${action.color}30`;
                    e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.2), 0 0 0 1px ${action.color}15`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
                    e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.08)";
                  }}
                >
                  {action.badge && (
                    <div className="absolute top-3.5 right-3.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.06em]"
                      style={{
                        background: `${action.color}12`,
                        color: action.color,
                        border: `1px solid ${action.color}20`,
                      }}
                    >
                      {action.badge}
                    </div>
                  )}

                  <div
                    className="h-11 w-11 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:scale-105"
                    style={{
                      background: `linear-gradient(135deg, ${action.color}15, ${action.color}08)`,
                      border: `1px solid ${action.color}20`,
                      color: action.color,
                    }}
                  >
                    {action.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-[#E0E0EE] group-hover:text-white transition-colors flex items-center gap-2 mb-1 tracking-[-0.01em]">
                      {action.title}
                      <ArrowRight size={11} className="opacity-0 -translate-x-1 group-hover:opacity-60 group-hover:translate-x-0 transition-all duration-300" />
                    </div>
                    <div className="text-[12.5px] text-[#6C6C8A] leading-relaxed">{action.description}</div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Featured Templates */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[13px] font-semibold text-[#E0E0EE] tracking-[-0.01em]">{t('dashboard.featuredTemplates')}</h2>
              <p className="text-[11.5px] text-[#4A4A64] mt-0.5">{t('dashboard.readyToUse')}</p>
            </div>
            <Link
              href="/dashboard/templates"
              className="flex items-center gap-1.5 text-[11.5px] text-[#4F8AFF] hover:text-[#6BA0FF] transition-colors group font-medium"
            >
              {t('dashboard.viewAll')}
              <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform duration-300" />
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {featuredWorkflows.map((wf, i) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                href={`/dashboard/templates`}
                showCloneButton
                index={i}
              />
            ))}
          </div>
        </motion.div>

        {/* Hero Workflow CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link
            href="/dashboard/templates"
            className="group block relative rounded-[16px] border border-[rgba(79,138,255,0.15)] p-7 overflow-hidden transition-all duration-500 hover:border-[rgba(79,138,255,0.35)]"
            style={{
              background: "linear-gradient(135deg, rgba(79,138,255,0.04) 0%, rgba(139,92,246,0.04) 50%, rgba(79,138,255,0.02) 100%)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.02)",
            }}
          >
            {/* Atmospheric mesh gradient */}
            <div className="absolute inset-0 opacity-30 group-hover:opacity-60 transition-opacity duration-700 pointer-events-none">
              <div className="absolute inset-0" style={{
                background: "radial-gradient(ellipse at 20% 50%, rgba(79,138,255,0.12), transparent 55%), radial-gradient(ellipse at 80% 80%, rgba(139,92,246,0.08), transparent 50%)",
              }} />
            </div>

            {/* Animated shimmer line on hover */}
            <div
              className="absolute top-0 left-0 right-0 h-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(79,138,255,0.5) 50%, transparent)",
              }}
            />

            <div className="relative flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2.5 mb-3">
                  <div
                    className="h-7 w-7 rounded-[8px] flex items-center justify-center"
                    style={{
                      background: "linear-gradient(135deg, rgba(79,138,255,0.2), rgba(99,102,241,0.15))",
                      border: "1px solid rgba(79,138,255,0.2)",
                    }}
                  >
                    <Play size={10} className="text-[#4F8AFF] ml-0.5" fill="#4F8AFF" />
                  </div>
                  <span className="text-[10.5px] font-bold text-[#4F8AFF] uppercase tracking-[0.08em]">
                    {t('dashboard.heroWorkflow')}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.05em]"
                    style={{
                      background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.08))",
                      color: "#F59E0B",
                      border: "1px solid rgba(245,158,11,0.2)",
                    }}
                  >
                    {t('dashboard.mostPopular')}
                  </span>
                </div>
                <h3 className="text-[18px] font-bold text-[#F0F0F5] mb-2 tracking-[-0.02em]">
                  PDF Brief → Full Pipeline (Beta)
                </h3>
                <p className="text-[13px] text-[#7C7C96] max-w-2xl leading-[1.6] mb-4">
                  The definitive end-to-end AEC workflow. Upload a project brief PDF and get extracted requirements, 3D massing variants, and concept renders in one automated pipeline. (IFC export in development)
                </p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-[#5C5C78]">
                    <Clock size={11} />
                    <span>~3 minutes</span>
                  </div>
                  <div className="text-[11.5px] text-[#5C5C78]">6 nodes</div>
                  <div
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                    style={{
                      background: "rgba(245,158,11,0.08)",
                      color: "#F59E0B",
                      border: "1px solid rgba(245,158,11,0.15)",
                    }}
                  >
                    Advanced
                  </div>
                </div>
              </div>
              <div
                className="flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13px] font-semibold text-white shrink-0 ml-8 transition-all duration-300 group-hover:shadow-[0_0_24px_rgba(79,138,255,0.3)] group-hover:-translate-y-0.5"
                style={{
                  background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
                  boxShadow: "0 2px 8px rgba(79,138,255,0.2), inset 0 1px 0 rgba(255,255,255,0.1)",
                }}
              >
                <Play size={11} fill="white" />
                <span>{t('dashboard.tryItNow')}</span>
              </div>
            </div>
          </Link>
        </motion.div>

        {/* Bottom spacer */}
        <div className="h-2" />
      </main>
    </div>
  );
}
