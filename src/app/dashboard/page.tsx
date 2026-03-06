"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Play, Zap, GitFork, Clock, Plus, TrendingUp, Sparkles } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { WorkflowCard } from "@/components/community/WorkflowCard";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { api } from "@/lib/api";

// Skeleton loader for stat cards
function StatCardSkeleton() {
  return (
    <div className="rounded-[14px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] p-5 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="w-5 h-5 bg-[#1A1A2A] rounded" />
        <div className="w-3 h-3 bg-[#1A1A2A] rounded" />
      </div>
      <div className="w-16 h-8 bg-[#1A1A2A] rounded mb-2" />
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

export default function DashboardPage() {
  const featuredWorkflows = PREBUILT_WORKFLOWS.slice(0, 3);
  const [workflowCount, setWorkflowCount] = useState<number | null>(null);
  const [executionCount, setExecutionCount] = useState<number | null>(null);
  const [hoursSaved, setHoursSaved] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (executionCount !== null) {
      const hours = Math.round((executionCount * 0.5) * 10) / 10;
      setHoursSaved(hours);
    }
  }, [executionCount]);

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
      label: "My Workflows", 
      value: workflowCount === null ? "..." : workflowCount, 
      icon: "⬡", 
      color: "#4F8AFF", 
      gradient: "linear-gradient(135deg, #4F8AFF 0%, #6B9FFF 100%)",
      href: "/dashboard/workflows",
      trend: "+2 this week"
    },
    { 
      label: "Executions", 
      value: executionCount === null ? "..." : executionCount, 
      icon: "▶", 
      color: "#10B981", 
      gradient: "linear-gradient(135deg, #10B981 0%, #34D399 100%)",
      href: "/dashboard/history",
      trend: "+12 today"
    },
    { 
      label: "Hours Saved", 
      value: hoursSaved === 0 ? "..." : hoursSaved, 
      suffix: "h",
      icon: "⏱", 
      color: "#F59E0B", 
      gradient: "linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)",
      href: "/dashboard/history",
      trend: "↑ 24% this month"
    },
    { 
      label: "Templates", 
      value: PREBUILT_WORKFLOWS.length, 
      icon: "⊞", 
      color: "#8B5CF6", 
      gradient: "linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)",
      href: "/dashboard/templates",
      trend: "15 new"
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Dashboard"
        subtitle="Your no-code AEC workflow builder (Beta)"
      />

      <main className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Premium Stat Cards */}
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
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1, duration: 0.4 }}
              >
                <Link
                  href={stat.href}
                  className="group block relative rounded-[16px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] p-6 hover:border-[rgba(255,255,255,0.12)] transition-all hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
                  style={{
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.02) inset",
                  }}
                >
                  {/* Gradient glow on hover */}
                  <div 
                    className="absolute inset-0 rounded-[16px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                    style={{
                      background: `radial-gradient(circle at 50% 0%, ${stat.color}15, transparent 70%)`,
                    }}
                  />
                  
                  {/* Top bar accent */}
                  <div 
                    className="absolute top-0 left-0 right-0 h-[2px] rounded-t-[16px]"
                    style={{ background: stat.gradient }}
                  />
                  
                  <div className="relative">
                    <div className="flex items-start justify-between mb-4">
                      <div 
                        className="w-10 h-10 rounded-[10px] flex items-center justify-center text-lg transition-transform group-hover:scale-110"
                        style={{ 
                          background: `${stat.color}15`,
                          border: `1px solid ${stat.color}25`,
                          color: stat.color
                        }}
                      >
                        {stat.icon}
                      </div>
                      <ArrowRight
                        size={14}
                        className="text-[#2A2A3E] group-hover:text-[#4F8AFF] group-hover:translate-x-1 transition-all"
                      />
                    </div>
                    
                    <div className="text-[36px] font-bold text-[#F0F0F5] leading-none mb-2 tracking-tight">
                      <AnimatedCounter value={stat.value} suffix={stat.suffix || ""} />
                    </div>
                    
                    <div className="text-[13px] font-medium text-[#9898B0]">{stat.label}</div>
                    
                    {stat.trend && (
                      <div className="flex items-center gap-1 mt-2 text-[11px] text-[#5C5C78]">
                        <TrendingUp size={10} />
                        <span>{stat.trend}</span>
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
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#F0F0F5]">Quick Actions</h2>
              <p className="text-xs text-[#5C5C78] mt-0.5">Get started in seconds</p>
            </div>
            <div className="flex items-center gap-1 text-xs text-[#5C5C78]">
              <Sparkles size={11} className="text-[#F59E0B]" />
              <span>Choose your path</span>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                title: "New Blank Workflow",
                description: "Drag-and-drop nodes to build from scratch",
                href: "/dashboard/workflows/new",
                icon: <Plus size={20} className="text-[#4F8AFF]" />,
                color: "#4F8AFF",
                badge: null,
              },
              {
                title: "Use AI Prompt",
                description: "Describe your workflow in plain English",
                href: "/dashboard/workflows/new?mode=prompt",
                icon: <Zap size={20} className="text-[#8B5CF6]" />,
                color: "#8B5CF6",
                badge: "AI",
              },
              {
                title: "Browse Templates",
                description: "Start from a curated AEC workflow",
                href: "/dashboard/templates",
                icon: <GitFork size={20} className="text-[#10B981]" />,
                color: "#10B981",
                badge: "Popular",
              },
            ].map((action, index) => (
              <motion.div
                key={action.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + index * 0.1, duration: 0.4 }}
              >
                <Link
                  href={action.href}
                  className="group relative flex items-start gap-4 rounded-[14px] border border-[rgba(255,255,255,0.06)] bg-[#12121E] p-5 hover:border-[rgba(255,255,255,0.12)] hover:bg-[#1A1A2A] transition-all hover:-translate-y-0.5"
                >
                  {/* Badge */}
                  {action.badge && (
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                      style={{
                        background: `${action.color}15`,
                        color: action.color,
                        border: `1px solid ${action.color}25`,
                      }}
                    >
                      {action.badge}
                    </div>
                  )}
                  
                  <div
                    className="h-11 w-11 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
                    style={{ 
                      backgroundColor: `${action.color}12`, 
                      border: `1px solid ${action.color}25` 
                    }}
                  >
                    {action.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold text-[#F0F0F5] group-hover:text-[#4F8AFF] transition-colors flex items-center gap-2 mb-1">
                      {action.title}
                      <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                    </div>
                    <div className="text-[13px] text-[#9898B0] leading-relaxed">{action.description}</div>
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
          transition={{ delay: 0.8, duration: 0.4 }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#F0F0F5]">Featured Templates</h2>
              <p className="text-xs text-[#5C5C78] mt-0.5">Ready-to-use AEC workflows</p>
            </div>
            <Link
              href="/dashboard/templates"
              className="flex items-center gap-1.5 text-xs text-[#4F8AFF] hover:text-[#3D7AFF] transition-colors group"
            >
              View all
              <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
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
          transition={{ delay: 1, duration: 0.4 }}
          className="relative rounded-[16px] border border-[rgba(79,138,255,0.25)] bg-gradient-to-r from-[rgba(79,138,255,0.06)] to-[rgba(139,92,246,0.06)] p-6 overflow-hidden group hover:border-[rgba(79,138,255,0.4)] transition-all"
        >
          {/* Animated background gradient */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
            <div className="absolute inset-0" style={{
              background: "radial-gradient(circle at 30% 50%, rgba(79,138,255,0.1), transparent 60%)",
            }} />
          </div>
          
          <div className="relative flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-lg bg-[rgba(79,138,255,0.2)] flex items-center justify-center">
                  <Play size={11} className="text-[#4F8AFF]" fill="#4F8AFF" />
                </div>
                <span className="text-xs font-bold text-[#4F8AFF] uppercase tracking-[0.08em]">
                  Hero Workflow
                </span>
                <span className="px-2 py-0.5 rounded-full bg-[rgba(245,158,11,0.15)] text-[#F59E0B] text-[9px] font-bold uppercase tracking-wider border border-[rgba(245,158,11,0.3)]">
                  Most Popular
                </span>
              </div>
              <h3 className="text-lg font-bold text-[#F0F0F5] mb-2">
                PDF Brief → Full Pipeline (Beta)
              </h3>
              <p className="text-sm text-[#9898B0] max-w-2xl leading-relaxed mb-4">
                The definitive end-to-end AEC workflow. Upload a project brief PDF and get extracted requirements, 3D massing variants, and concept renders in one automated pipeline. (IFC export in development)
              </p>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-xs text-[#5C5C78]">
                  <Clock size={12} />
                  <span>~3 minutes</span>
                </div>
                <div className="text-xs text-[#5C5C78]">6 nodes</div>
                <div className="px-2 py-0.5 rounded-full bg-[rgba(245,158,11,0.1)] text-[#F59E0B] text-[10px] font-semibold border border-[rgba(245,158,11,0.2)]">
                  Advanced
                </div>
              </div>
            </div>
            <Link
              href="/dashboard/templates"
              className="flex items-center gap-2 rounded-[10px] bg-gradient-to-r from-[#4F8AFF] to-[#6366F1] px-5 py-2.5 text-sm font-semibold text-white hover:shadow-[0_0_20px_rgba(79,138,255,0.4)] transition-all shrink-0 ml-6 group"
            >
              <Play size={12} fill="white" />
              <span>Try it now</span>
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
