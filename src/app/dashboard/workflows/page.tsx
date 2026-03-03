import Link from "next/link";
import { Plus, Workflow, ArrowRight } from "lucide-react";
import { Header } from "@/components/dashboard/Header";

export const metadata = { title: "My Workflows" };

export default function WorkflowsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="My Workflows"
        subtitle="Your personal workflow workspace"
      />

      <main className="flex-1 overflow-y-auto p-6">
        {/* Empty state — workflows come from the canvas/store */}
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-2xl border border-[#2A2A3E] bg-[#12121A] flex items-center justify-center mb-5">
            <Workflow size={28} className="text-[#3A3A4E]" strokeWidth={1} />
          </div>
          <h3 className="text-base font-semibold text-[#F0F0F5] mb-2">No workflows yet</h3>
          <p className="text-sm text-[#55556A] max-w-sm leading-relaxed mb-6">
            Create your first workflow by building one from scratch or cloning a prebuilt template.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/workflows/new"
              className="flex items-center gap-2 rounded-lg bg-[#4F8AFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3D7AFF] transition-all"
            >
              <Plus size={14} />
              New Workflow
            </Link>
            <Link
              href="/dashboard/templates"
              className="flex items-center gap-2 rounded-lg border border-[#2A2A3E] bg-[#12121A] px-4 py-2.5 text-sm font-medium text-[#F0F0F5] hover:border-[#3A3A4E] hover:bg-[#1A1A26] transition-all"
            >
              Browse Templates
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
