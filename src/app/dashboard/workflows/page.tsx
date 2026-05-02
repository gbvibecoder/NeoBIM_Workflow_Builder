"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";
import type { WorkflowSummary } from "@/lib/api";
import { getLastRun } from "@/lib/api";
import { toast } from "sonner";
import { STRIPE_PLANS } from "@/features/billing/lib/stripe";
import { sortWorkflows, type SortKey } from "@/features/workflows/lib/sort";
import {
  resolveCategory,
  groupByCategory,
  type WorkflowCategoryKey,
} from "@/features/workflows/lib/categorize";
import { WorkflowsHero } from "@/features/workflows/components/WorkflowsHero";
import { WorkflowsToolbar, type ViewMode, type StatusKey } from "@/features/workflows/components/WorkflowsToolbar";
import { ContinueWorkingStrip } from "@/features/workflows/components/ContinueWorkingStrip";
import { CategorySection } from "@/features/workflows/components/CategorySection";
import { AllWorkflowsGrid } from "@/features/workflows/components/AllWorkflowsGrid";
import { WorkflowsEmptyState } from "@/features/workflows/components/WorkflowsEmptyState";
import { WorkflowsLoading } from "@/features/workflows/components/WorkflowsLoading";
import { WorkflowsBulkBar } from "@/features/workflows/components/WorkflowsBulkBar";
import { BulkDeleteModal } from "@/features/workflows/components/BulkDeleteModal";
import { WorkflowLimitModal } from "@/features/workflows/components/WorkflowLimitModal";
import s from "@/features/workflows/components/page.module.css";

const PAGE_SIZE = 12;

export default function WorkflowsPage() {
  const router = useRouter();
  const { data: session } = useSession();

  // ── Core state ────────────────────────────────────────────────────
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<WorkflowCategoryKey | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("gallery");
  const [allWorkflowsLimit, setAllWorkflowsLimit] = useState(PAGE_SIZE);

  // ── Modal state ───────────────────────────────────────────────────
  const [showLimitModal, setShowLimitModal] = useState(false);

  // ── Bulk-select state ─────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // ── Plan limits ───────────────────────────────────────────────────
  const userRole = (session?.user as { role?: string })?.role ?? "FREE";
  const planLimits =
    userRole === "TEAM_ADMIN" || userRole === "PLATFORM_ADMIN"
      ? STRIPE_PLANS.TEAM.limits
      : userRole === "PRO"
        ? STRIPE_PLANS.PRO.limits
        : userRole === "STARTER"
          ? STRIPE_PLANS.STARTER.limits
          : userRole === "MINI"
            ? STRIPE_PLANS.MINI.limits
            : STRIPE_PLANS.FREE.limits;
  const maxWorkflows = planLimits.maxWorkflows;
  const isAtLimit =
    (userRole === "FREE" || userRole === "MINI" || userRole === "STARTER") &&
    maxWorkflows > 0 &&
    workflows.length >= maxWorkflows;

  // ── Data loading ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await api.workflows.list({ limit: 100 });
      setWorkflows(res.workflows);
    } catch {
      toast.error("Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived data ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = workflows;
    if (activeFilter !== "all") {
      result = result.filter(wf => resolveCategory(wf).key === activeFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter(wf => {
        const lr = getLastRun(wf);
        if (statusFilter === "never") return wf._count.executions === 0;
        if (statusFilter === "success") return lr.status === "SUCCESS";
        if (statusFilter === "failed") return lr.status === "FAILED";
        if (statusFilter === "running") return lr.status === "RUNNING";
        if (statusFilter === "partial") return lr.status === "PARTIAL";
        return true;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(wf =>
        wf.name.toLowerCase().includes(q) ||
        wf.description?.toLowerCase().includes(q) ||
        wf.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }
    return sortWorkflows(result, sortKey);
  }, [workflows, activeFilter, statusFilter, searchQuery, sortKey]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const wf of workflows) {
      const key = resolveCategory(wf).key;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts as Record<WorkflowCategoryKey, number>;
  }, [workflows]);

  const statusCounts = useMemo(() => {
    const counts = { success: 0, failed: 0, running: 0, partial: 0, never: 0 };
    for (const wf of workflows) {
      if (wf._count.executions === 0) { counts.never++; continue; }
      const lr = getLastRun(wf);
      if (lr.status === "SUCCESS") counts.success++;
      else if (lr.status === "FAILED") counts.failed++;
      else if (lr.status === "RUNNING") counts.running++;
      else if (lr.status === "PARTIAL") counts.partial++;
    }
    return counts;
  }, [workflows]);

  const totalRuns = useMemo(
    () => workflows.reduce((acc, wf) => acc + wf._count.executions, 0),
    [workflows]
  );

  const continueWorking = useMemo(() => filtered.slice(0, 3), [filtered]);
  const categorized = useMemo(() => groupByCategory(filtered), [filtered]);
  const allVisible = useMemo(() => filtered.slice(0, allWorkflowsLimit), [filtered, allWorkflowsLimit]);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleNewWorkflow = useCallback(() => {
    if (isAtLimit) { setShowLimitModal(true); return; }
    router.push("/dashboard/canvas?new=1");
  }, [isAtLimit, router]);

  const handleOpen = useCallback((id: string) => {
    if (selectMode) return;
    router.push(`/dashboard/canvas?id=${id}`);
  }, [selectMode, router]);

  const handleDelete = useCallback(async (id: string) => {
    const wf = workflows.find(w => w.id === id);
    if (!confirm(`Delete "${wf?.name ?? "this workflow"}" permanently?`)) return;
    try {
      await api.workflows.delete(id);
      setWorkflows(prev => prev.filter(w => w.id !== id));
      toast.success("Workflow deleted");
    } catch {
      toast.error("Failed to delete workflow");
    }
  }, [workflows]);

  const handleDuplicate = useCallback(async (id: string) => {
    try {
      const { workflow: source } = await api.workflows.get(id);
      const { workflow: created } = await api.workflows.create({
        name: `${source.name} (copy)`,
        description: source.description ?? undefined,
        tags: source.tags,
        tileGraph: source.tileGraph,
        autoSuffix: true,
      });
      // Reload to get full WorkflowSummary shape
      load();
      toast.success(`Duplicated as "${created.name}"`);
    } catch {
      toast.error("Couldn\u2019t duplicate workflow");
    }
  }, [load]);

  const handleRename = useCallback(async (id: string, newName: string) => {
    try {
      await api.workflows.update(id, { name: newName });
      setWorkflows(prev => prev.map(wf =>
        wf.id === id ? { ...wf, name: newName } : wf
      ));
      toast.success("Renamed");
    } catch {
      toast.error("Couldn\u2019t rename workflow");
    }
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await api.workflows.bulkDelete(ids);
      setWorkflows(prev => prev.filter(wf => !selectedIds.has(wf.id)));
      toast.success(`Deleted ${res.deleted} workflow${res.deleted !== 1 ? "s" : ""} permanently`);
      load();
      setSelectedIds(new Set());
      setSelectMode(false);
      setShowBulkConfirm(false);
    } catch {
      toast.error("Failed to delete workflows. Please try again.");
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedIds, load]);

  const handleBulkDuplicate = useCallback(async () => {
    const ids = Array.from(selectedIds);
    let count = 0;
    for (const id of ids) {
      try {
        const { workflow: source } = await api.workflows.get(id);
        await api.workflows.create({
          name: `${source.name} (copy)`,
          description: source.description ?? undefined,
          tags: source.tags,
          tileGraph: source.tileGraph,
          autoSuffix: true,
        });
        count++;
      } catch { /* skip on error */ }
    }
    if (count > 0) {
      toast.success(`Duplicated ${count} workflow${count !== 1 ? "s" : ""}`);
      load();
    }
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [selectedIds, load]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // ── Render states ─────────────────────────────────────────────────
  if (loading) return <WorkflowsLoading />;
  if (workflows.length === 0) {
    return (
      <WorkflowsEmptyState
        onNewWorkflow={handleNewWorkflow}
        onBrowseTemplates={() => router.push("/dashboard/templates")}
      />
    );
  }

  const isFiltering = searchQuery.trim() !== "" || activeFilter !== "all" || statusFilter !== "all";
  const showNoResults = filtered.length === 0 && isFiltering;

  return (
    <div className={s.page}>
      <WorkflowsHero
        totalCount={workflows.length}
        totalRuns={totalRuns}
        onNewWorkflow={handleNewWorkflow}
        onBrowseTemplates={() => router.push("/dashboard/templates")}
      />

      <WorkflowsToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        sortKey={sortKey}
        onSortChange={setSortKey}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        categoryCounts={categoryCounts}
        totalCount={workflows.length}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        statusCounts={statusCounts}
        onEnterSelectMode={() => setSelectMode(true)}
        selectMode={selectMode}
      />

      {showNoResults ? (
        <div className={s.noResults}>
          <p className={s.noResultsText}>
            No workflows match &ldquo;{searchQuery}&rdquo;
            {activeFilter !== "all" ? ` in ${activeFilter}` : ""}
          </p>
          <button
            className={s.noResultsClear}
            onClick={() => { setSearchQuery(""); setActiveFilter("all"); setStatusFilter("all"); }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {!isFiltering && continueWorking.length >= 1 && (
            <ContinueWorkingStrip workflows={continueWorking} onOpen={handleOpen} />
          )}

          {!isFiltering && categorized.length > 0 && (
            <div className={s.section}>
              <div className={s.sectionHead}>
                <div>
                  <div className={s.sectionEyebrow}>
                    <span className={s.sectionNum}>02 &ndash;</span> By category
                  </div>
                  <h2 className={s.sectionTitle}>
                    Browse <em>by what they make.</em>
                  </h2>
                </div>
              </div>
              {categorized.map(group => (
                <CategorySection
                  key={group.meta.key}
                  category={group.meta}
                  workflows={group.items}
                  onOpen={handleOpen}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onRename={handleRename}
                  selectMode={selectMode}
                  selectedIds={selectedIds}
                  onToggleSelect={handleToggleSelect}
                  viewMode={viewMode}
                />
              ))}
            </div>
          )}

          <AllWorkflowsGrid
            workflows={allVisible}
            totalCount={filtered.length}
            hasMore={allVisible.length < filtered.length}
            onLoadMore={() => setAllWorkflowsLimit(prev => prev + PAGE_SIZE)}
            onOpen={handleOpen}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            onRename={handleRename}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            viewMode={viewMode}
            sectionEyebrow={isFiltering ? "results" : undefined}
            sectionTitle={
              isFiltering
                ? searchQuery
                  ? `Results for \u201C${searchQuery}\u201D`
                  : `All ${activeFilter !== "all" ? activeFilter : statusFilter} workflows`
                : undefined
            }
          />
        </>
      )}

      {/* Floating bulk bar */}
      {selectedIds.size > 0 && (
        <WorkflowsBulkBar
          selectedCount={selectedIds.size}
          onDuplicate={handleBulkDuplicate}
          onDelete={() => setShowBulkConfirm(true)}
          onCancel={exitSelectMode}
        />
      )}

      {/* Modals */}
      {showBulkConfirm && (
        <BulkDeleteModal
          count={selectedIds.size}
          isDeleting={bulkDeleting}
          onCancel={() => setShowBulkConfirm(false)}
          onConfirm={handleBulkDelete}
        />
      )}

      {showLimitModal && (
        <WorkflowLimitModal
          currentCount={workflows.length}
          userRole={userRole}
          onUpgrade={() => { setShowLimitModal(false); router.push("/dashboard/billing"); }}
          onDismiss={() => setShowLimitModal(false)}
        />
      )}
    </div>
  );
}
