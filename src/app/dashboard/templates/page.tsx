"use client";

import React, { useState } from "react";
import { Search, Filter } from "lucide-react";
import { Header } from "@/components/dashboard/Header";
import { WorkflowCard } from "@/components/community/WorkflowCard";
import { Badge } from "@/components/ui/Badge";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useRouter } from "next/navigation";
import type { WorkflowTemplate } from "@/types/workflow";

const CATEGORIES = ["All", "Concept Design", "Visualization", "BIM Export", "Cost Estimation", "Full Pipeline"];
const COMPLEXITIES = ["All", "simple", "intermediate", "advanced"];

export default function TemplatesPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeComplexity, setActiveComplexity] = useState("All");
  const { loadFromTemplate } = useWorkflowStore();
  const router = useRouter();

  const filtered = PREBUILT_WORKFLOWS.filter((wf) => {
    const matchesSearch =
      !search ||
      wf.name.toLowerCase().includes(search.toLowerCase()) ||
      wf.description.toLowerCase().includes(search.toLowerCase()) ||
      wf.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));

    const matchesCategory =
      activeCategory === "All" || wf.category === activeCategory;

    const matchesComplexity =
      activeComplexity === "All" || wf.complexity === activeComplexity;

    return matchesSearch && matchesCategory && matchesComplexity;
  });

  const handleClone = (workflowId: string) => {
    const template = PREBUILT_WORKFLOWS.find((w) => w.id === workflowId);
    if (!template) return;

    loadFromTemplate(template as WorkflowTemplate);
    toast.success(`"${template.name}" cloned to your workspace!`);
    router.push(`/dashboard/canvas`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Workflow Templates"
        subtitle={`${PREBUILT_WORKFLOWS.length} prebuilt AEC workflows ready to use`}
      />

      <main className="flex-1 overflow-y-auto p-6">
        {/* Filters */}
        <div className="flex flex-col gap-4 mb-6">
          {/* Search */}
          <div className="relative max-w-md">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#55556A]"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="w-full h-9 rounded-lg border border-[#2A2A3E] bg-[#12121A] pl-9 pr-4 text-sm text-[#F0F0F5] placeholder:text-[#55556A] focus:outline-none focus:border-[#4F8AFF] focus:ring-1 focus:ring-[#4F8AFF] transition-colors"
            />
          </div>

          {/* Category filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-[#55556A] mr-2">
              <Filter size={11} />
              Category:
            </div>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  activeCategory === cat
                    ? "bg-[#4F8AFF] text-white"
                    : "bg-[#12121A] border border-[#2A2A3E] text-[#8888A0] hover:text-[#F0F0F5] hover:border-[#3A3A4E]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Complexity filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-[#55556A] mr-2">
              <Filter size={11} />
              Complexity:
            </div>
            {COMPLEXITIES.map((c) => (
              <button
                key={c}
                onClick={() => setActiveComplexity(c)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-all ${
                  activeComplexity === c
                    ? "bg-[#8B5CF6] text-white"
                    : "bg-[#12121A] border border-[#2A2A3E] text-[#8888A0] hover:text-[#F0F0F5] hover:border-[#3A3A4E]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-[#55556A]">
            {filtered.length} template{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-[#55556A]">No templates found</p>
            <button
              onClick={() => { setSearch(""); setActiveCategory("All"); setActiveComplexity("All"); }}
              className="mt-3 text-xs text-[#4F8AFF] hover:text-[#3D7AFF] transition-colors"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((wf, i) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                showCloneButton
                onClone={handleClone}
                index={i}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
