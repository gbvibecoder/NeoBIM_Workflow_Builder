import Link from "next/link";
import { ArrowRight, Play, Zap, GitFork, Clock, Plus } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { WorkflowCard } from "@/components/community/WorkflowCard";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const featuredWorkflows = PREBUILT_WORKFLOWS.slice(0, 3);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Dashboard"
        subtitle="Your no-code AEC workflow builder"
      />

      <main className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "My Workflows", value: "0", icon: "⬡", color: "#4F8AFF", href: "/dashboard/workflows" },
            { label: "Executions", value: "0", icon: "▶", color: "#10B981", href: "/dashboard/workflows" },
            { label: "Templates", value: `${PREBUILT_WORKFLOWS.length}`, icon: "⊞", color: "#8B5CF6", href: "/dashboard/templates" },
            { label: "Community", value: "500+", icon: "◉", color: "#F59E0B", href: "/dashboard/community" },
          ].map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="group rounded-xl border border-[#1E1E2E] bg-[#12121A] p-4 hover:border-[#2A2A3E] hover:bg-[#1A1A26] transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-lg" style={{ color: stat.color }}>
                  {stat.icon}
                </span>
                <ArrowRight
                  size={12}
                  className="text-[#2A2A3E] group-hover:text-[#4F8AFF] transition-colors"
                />
              </div>
              <div className="text-2xl font-bold text-[#F0F0F5]">{stat.value}</div>
              <div className="text-xs text-[#55556A] mt-0.5">{stat.label}</div>
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-sm font-semibold text-[#F0F0F5] mb-3">Quick Start</h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                title: "New Blank Workflow",
                description: "Drag-and-drop nodes to build from scratch",
                href: "/dashboard/workflows/new",
                icon: <Plus size={18} className="text-[#4F8AFF]" />,
                color: "#4F8AFF",
              },
              {
                title: "Use AI Prompt",
                description: "Describe your workflow in plain English",
                href: "/dashboard/workflows/new?mode=prompt",
                icon: <Zap size={18} className="text-[#8B5CF6]" />,
                color: "#8B5CF6",
              },
              {
                title: "Browse Templates",
                description: "Start from a curated AEC workflow",
                href: "/dashboard/templates",
                icon: <GitFork size={18} className="text-[#10B981]" />,
                color: "#10B981",
              },
            ].map((action) => (
              <Link
                key={action.title}
                href={action.href}
                className="group flex flex-col gap-3 rounded-xl border border-[#1E1E2E] bg-[#12121A] p-4 hover:border-[#2A2A3E] hover:bg-[#1A1A26] transition-all"
              >
                <div
                  className="h-9 w-9 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${action.color}12`, border: `1px solid ${action.color}25` }}
                >
                  {action.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-[#F0F0F5] group-hover:text-[#4F8AFF] transition-colors flex items-center gap-1.5">
                    {action.title}
                    <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="text-xs text-[#55556A] mt-0.5">{action.description}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Featured Templates */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#F0F0F5]">Featured Templates</h2>
              <p className="text-xs text-[#55556A] mt-0.5">Ready-to-use AEC workflows</p>
            </div>
            <Link
              href="/dashboard/templates"
              className="flex items-center gap-1 text-xs text-[#4F8AFF] hover:text-[#3D7AFF] transition-colors"
            >
              View all
              <ArrowRight size={11} />
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
        </div>

        {/* Hero Workflow highlight */}
        <div className="rounded-xl border border-[rgba(79,138,255,0.2)] bg-[rgba(79,138,255,0.04)] p-5">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-5 w-5 rounded bg-[rgba(79,138,255,0.2)] flex items-center justify-center">
                  <Play size={10} className="text-[#4F8AFF]" fill="#4F8AFF" />
                </div>
                <span className="text-xs font-semibold text-[#4F8AFF] uppercase tracking-wider">
                  Hero Workflow
                </span>
              </div>
              <h3 className="text-base font-bold text-[#F0F0F5] mb-1.5">
                PDF Brief → Full Pipeline
              </h3>
              <p className="text-xs text-[#8888A0] max-w-xl leading-relaxed">
                The definitive end-to-end AEC workflow. Upload a project brief PDF and get extracted
                requirements, 3D massing variants, concept renders, and an IFC file — all in one
                automated pipeline.
              </p>
              <div className="flex items-center gap-3 mt-3">
                <div className="flex items-center gap-1 text-[10px] text-[#55556A]">
                  <Clock size={10} />
                  ~3 minutes
                </div>
                <div className="text-[10px] text-[#55556A]">6 nodes</div>
                <div className="text-[10px] text-[#F59E0B]">Advanced</div>
              </div>
            </div>
            <Link
              href="/dashboard/templates"
              className="flex items-center gap-2 rounded-lg bg-[#4F8AFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3D7AFF] transition-all shrink-0 ml-6"
            >
              <Play size={11} fill="white" />
              Try it
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
