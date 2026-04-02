"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MousePointer2, Sparkles, GitMerge, ArrowRight, ArrowLeft } from "lucide-react";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { CreationMode } from "@/types/workflow";
import { generateId } from "@/lib/utils";
import { useLocale } from "@/hooks/useLocale";

export default function NewWorkflowPage() {
  const [selectedMode, setSelectedMode] = useState<CreationMode>("prompt");
  const { setCreationMode, resetCanvas, setCurrentWorkflow } = useWorkflowStore();
  const router = useRouter();
  const { t } = useLocale();

  const MODES = useMemo<{
    id: CreationMode;
    title: string;
    description: string;
    details: string[];
    icon: React.ReactNode;
    color: string;
    recommended?: boolean;
  }[]>(() => [
    {
      id: "manual",
      title: t('newWorkflow.manualTitle'),
      description: t('newWorkflow.manualDesc'),
      details: [
        t('newWorkflow.manualDetail1'),
        t('newWorkflow.manualDetail2'),
        t('newWorkflow.manualDetail3'),
        t('newWorkflow.manualDetail4'),
      ],
      icon: <MousePointer2 size={24} strokeWidth={1.5} />,
      color: "#4F8AFF",
    },
    {
      id: "prompt",
      title: t('newWorkflow.promptTitle'),
      description: t('newWorkflow.promptDesc'),
      details: [
        t('newWorkflow.promptDetail1'),
        t('newWorkflow.promptDetail2'),
        t('newWorkflow.promptDetail3'),
        t('newWorkflow.promptDetail4'),
      ],
      icon: <Sparkles size={24} strokeWidth={1.5} />,
      color: "#8B5CF6",
      recommended: true,
    },
    {
      id: "hybrid",
      title: t('newWorkflow.hybridTitle'),
      description: t('newWorkflow.hybridDesc'),
      details: [
        t('newWorkflow.hybridDetail1'),
        t('newWorkflow.hybridDetail2'),
        t('newWorkflow.hybridDetail3'),
        t('newWorkflow.hybridDetail4'),
      ],
      icon: <GitMerge size={24} strokeWidth={1.5} />,
      color: "#10B981",
    },
  ], [t]);

  const handleCreate = () => {
    resetCanvas();
    setCreationMode(selectedMode);
    setCurrentWorkflow({
      id: generateId(),
      ownerId: "",
      name: t('newWorkflow.untitledWorkflow'),
      description: "",
      tags: [],
      tileGraph: { nodes: [], edges: [] },
      version: 1,
      isPublished: false,
      isTemplate: false,
      complexity: "simple",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    router.push("/dashboard/canvas");
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          {/* Back button */}
          <Link
            href="/dashboard/workflows"
            className="flex items-center gap-1.5 text-xs text-[#55556A] hover:text-[#F0F0F5] transition-colors mb-8"
          >
            <ArrowLeft size={12} />
            {t('newWorkflow.backToWorkflows')}
          </Link>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[#F0F0F5] mb-2">
              {t('newWorkflow.howToStart')}
            </h2>
            <p className="text-sm text-[#55556A]">
              {t('newWorkflow.switchModes')}
            </p>
          </div>

          {/* Mode cards */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            {MODES.map((mode) => (
              <motion.button
                key={mode.id}
                onClick={() => setSelectedMode(mode.id)}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className={`relative text-left rounded-xl border p-5 transition-all ${
                  selectedMode === mode.id
                    ? "border-opacity-80 bg-opacity-5"
                    : "border-[#1E1E2E] bg-[#12121A] hover:border-[#2A2A3E]"
                }`}
                style={{
                  borderColor:
                    selectedMode === mode.id
                      ? `${mode.color}60`
                      : undefined,
                  backgroundColor:
                    selectedMode === mode.id
                      ? `${mode.color}06`
                      : undefined,
                }}
              >
                {mode.recommended && (
                  <div
                    className="absolute -top-2.5 right-3 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: mode.color, color: "white" }}
                  >
                    {t('newWorkflow.recommended')}
                  </div>
                )}

                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    backgroundColor: `${mode.color}12`,
                    border: `1px solid ${mode.color}25`,
                    color: mode.color,
                  }}
                >
                  {mode.icon}
                </div>

                <h3 className="text-sm font-bold text-[#F0F0F5] mb-1.5">
                  {mode.title}
                </h3>
                <p className="text-xs text-[#55556A] mb-3 leading-relaxed">
                  {mode.description}
                </p>

                <ul className="space-y-1">
                  {mode.details.map((detail) => (
                    <li
                      key={detail}
                      className="flex items-center gap-1.5 text-[11px] text-[#8888A0]"
                    >
                      <div
                        className="h-1 w-1 rounded-full shrink-0"
                        style={{ backgroundColor: mode.color }}
                      />
                      {detail}
                    </li>
                  ))}
                </ul>

                {selectedMode === mode.id && (
                  <div
                    className="absolute bottom-3 right-3 h-5 w-5 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: mode.color }}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M1 4L3 6L7 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
              </motion.button>
            ))}
          </div>

          {/* Create button */}
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 rounded-xl bg-[#4F8AFF] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#3D7AFF] active:scale-[0.99] transition-all shadow-sm"
          >
            {t('newWorkflow.createWorkflow')}
            <ArrowRight size={15} />
          </button>
        </div>
      </main>
    </div>
  );
}
