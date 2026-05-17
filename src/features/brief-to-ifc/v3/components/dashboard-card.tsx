/**
 * Dashboard quick-start card for AI IFC.
 *
 * v3 is THE IFC pipeline as of 2026-05-17 (v2 retired). The card
 * renders unconditionally — no canary gate. If `BRIEF_TO_IFC_V3_ENABLED`
 * is explicitly disabled the server-side gate on the submit form
 * returns 403; the card click flow handles that path with the standard
 * dashboard redirect.
 */

"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export function AiIfcDashboardCard(): React.ReactElement {
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
            <h3 className="text-base font-semibold tracking-tight text-zinc-900 sm:text-lg">
              Generate IFC from a brief
            </h3>
            <p className="mt-1 text-sm text-zinc-600 sm:text-base">
              Upload a PDF or paste text. AI builds a BIM model in ~1 minute
              for around $0.20.
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
