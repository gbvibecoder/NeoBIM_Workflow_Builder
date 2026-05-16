/**
 * Dashboard quick-start card for AI IFC (v3).
 *
 * Renders only when the user's session has `briefToIfcV3Enabled === true`
 * (gated client-side via `useFeatureFlags`; defence-in-depth on top of
 * the server check that already redirects /dashboard/brief-to-ifc/v3/*
 * when canary is off).
 *
 * Visual style mirrors the existing product tile cards but is a single
 * full-width strip — beta surface, not the primary product row.
 */

"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { useFeatureFlags } from "@/hooks/useFeatureFlags";

export function AiIfcDashboardCard(): React.ReactElement | null {
  const { briefToIfcV3Enabled } = useFeatureFlags();
  if (!briefToIfcV3Enabled) return null;

  return (
    <section className="my-4 sm:my-6">
      <Link
        href="/dashboard/brief-to-ifc/v3/new"
        className="group relative block overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-white p-5 transition-colors hover:border-amber-300 sm:p-6"
      >
        <div className="flex items-start gap-4 sm:items-center">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 sm:h-14 sm:w-14">
            <Sparkles className="h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold tracking-tight text-zinc-900 sm:text-lg">
                Generate IFC from a brief
              </h3>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-amber-700">
                Beta
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600 sm:text-base">
              Upload a PDF or paste text. AI builds a BIM model in ~2 min.
            </p>
          </div>
          <div className="hidden shrink-0 items-center text-sm font-medium text-amber-700 transition-transform group-hover:translate-x-1 sm:flex">
            Try it
            <ArrowRight className="ml-1 h-4 w-4" />
          </div>
        </div>
      </Link>
    </section>
  );
}
