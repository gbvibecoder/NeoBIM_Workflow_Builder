"use client";

import React, { useState } from "react";
import { Search, Star, GitFork, TrendingUp, Clock, Filter } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { WorkflowCard } from "@/components/community/WorkflowCard";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { toast } from "sonner";
import type { WorkflowTemplate } from "@/types/workflow";

// Mock community data extending the prebuilt workflows
const COMMUNITY_WORKFLOWS = PREBUILT_WORKFLOWS.map((wf, i) => ({
  ...wf,
  ratingAvg: 4.2 + (i % 3) * 0.2,
  cloneCount: 42 + i * 17,
  authorName: ["Maria Chen", "James Hartley", "Sophia Kalvari", "Noah Bergström", "Aisha Patel"][i % 5],
}));

const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular", icon: <TrendingUp size={11} /> },
  { value: "rating", label: "Highest Rated", icon: <Star size={11} /> },
  { value: "clones", label: "Most Cloned", icon: <GitFork size={11} /> },
  { value: "newest", label: "Newest", icon: <Clock size={11} /> },
];

export default function CommunityPage() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("popular");

  const filtered = COMMUNITY_WORKFLOWS.filter((wf) =>
    !search ||
    wf.name.toLowerCase().includes(search.toLowerCase()) ||
    wf.description.toLowerCase().includes(search.toLowerCase()) ||
    wf.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => {
    if (sortBy === "rating") return b.ratingAvg - a.ratingAvg;
    if (sortBy === "clones") return b.cloneCount - a.cloneCount;
    return b.cloneCount - a.cloneCount;
  });

  const handleClone = (id: string) => {
    const wf = COMMUNITY_WORKFLOWS.find((w) => w.id === id);
    if (wf) toast.success(`"${wf.name}" cloned to your workspace!`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Community"
        subtitle="Discover and clone workflows from the NeoBIM community"
      />

      <main className="flex-1 overflow-y-auto p-6">
        {/* Hero stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Published Workflows", value: "500+", icon: "⬡" },
            { label: "Community Members", value: "5,200+", icon: "◉" },
            { label: "Total Clones", value: "28,400+", icon: "↗" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[#1E1E2E] bg-[#12121A] p-4 flex items-center gap-4"
            >
              <span className="text-2xl text-[#4F8AFF]">{stat.icon}</span>
              <div>
                <div className="text-xl font-bold text-[#F0F0F5]">{stat.value}</div>
                <div className="text-xs text-[#55556A]">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search
              size={12}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#55556A]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search community workflows..."
              className="w-full h-9 rounded-lg border border-[#2A2A3E] bg-[#12121A] pl-9 pr-4 text-sm text-[#F0F0F5] placeholder:text-[#55556A] focus:outline-none focus:border-[#4F8AFF] focus:ring-1 focus:ring-[#4F8AFF] transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[#55556A] ml-2">
            <Filter size={11} />
            Sort:
          </div>
          <div className="flex items-center gap-1">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                  sortBy === opt.value
                    ? "bg-[#4F8AFF] text-white"
                    : "border border-[#2A2A3E] bg-[#12121A] text-[#8888A0] hover:text-[#F0F0F5] hover:border-[#3A3A4E]"
                }`}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((wf, i) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf as WorkflowTemplate}
              showCloneButton
              onClone={handleClone}
              ratingAvg={wf.ratingAvg}
              cloneCount={wf.cloneCount}
              index={i}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
