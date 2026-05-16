/**
 * Cost-estimate + quota-remaining panel for the submit form.
 *
 * Two pieces of information the user wants BEFORE clicking Generate:
 *
 *   1. "What will this cost?" — broad estimate based on brief shape
 *      (small/medium/large heuristic). Real cost only known after the
 *      agent loop runs; this is upfront expectation-setting.
 *
 *   2. "How many runs do I have left?" — pulls from GET /quota.
 *      Disabled-with-upgrade-prompt when remaining === 0.
 *
 * The estimate is intentionally a range, not a single figure — real
 * runs cluster at $0.13–$0.55 across our 5 eval briefs.
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface QuotaResponse {
  limit: number;
  used: number;
  remaining: number;
  unlimited: boolean;
  role?: string;
}

interface CostEstimateProps {
  /** True when the user has selected text/PDF/JSON content of any kind. */
  hasInput: boolean;
  /** Receives the "is submission allowed" gate so the parent can disable the button. */
  onQuotaGate: (allowed: boolean) => void;
}

export function CostEstimate({
  hasInput,
  onQuotaGate,
}: CostEstimateProps): React.ReactElement {
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/brief-to-ifc/v3/quota", {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) setQuotaError(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as QuotaResponse;
        if (!cancelled) {
          setQuota(data);
          onQuotaGate(data.unlimited || data.remaining > 0);
        }
      } catch (err) {
        if (!cancelled) {
          setQuotaError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // onQuotaGate is intentionally not in deps — caller passes a fresh
    // arrow each render but we only need the very first reply to gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div>
        <h4 className="text-sm font-medium text-zinc-700">
          Cost estimate
        </h4>
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-600">
          <li>
            Small brief (1 space, &lt;20 elements):{" "}
            <span className="font-mono text-zinc-800">~$0.20</span>
          </li>
          <li>
            Medium brief (1 space, 20–50 elements):{" "}
            <span className="font-mono text-zinc-800">~$0.40</span>
          </li>
          <li>
            Large brief (multiple spaces, &gt;50 elements):{" "}
            <span className="font-mono text-zinc-800">$1.00–$2.00</span>
          </li>
        </ul>
        {!hasInput && (
          <p className="mt-1 text-xs text-zinc-400">
            Add a brief above to see an estimate range scaled to it.
          </p>
        )}
      </div>

      <div className="border-t border-zinc-200 pt-3">
        <h4 className="text-sm font-medium text-zinc-700">
          Your monthly v3 runs
        </h4>
        {quota === null && quotaError === null ? (
          <p className="mt-1 text-xs text-zinc-500">Checking your quota …</p>
        ) : quotaError ? (
          <p className="mt-1 text-xs text-red-600">
            Couldn't load quota: {quotaError}
          </p>
        ) : quota?.unlimited ? (
          <p className="mt-1 text-xs text-emerald-700">
            <span className="font-mono">{quota.used} runs</span> this month —
            unlimited on your plan.
          </p>
        ) : quota && quota.remaining > 0 ? (
          <p className="mt-1 text-xs text-zinc-700">
            <span className="font-mono text-zinc-900">
              {quota.used} / {quota.limit}
            </span>{" "}
            used —{" "}
            <span className="font-mono text-emerald-700">
              {quota.remaining}
            </span>{" "}
            remaining this month.
          </p>
        ) : quota ? (
          <div className="mt-1 space-y-1">
            <p className="text-xs text-red-700">
              You've used {quota.used} / {quota.limit} runs this month.
            </p>
            <Link
              href="/dashboard/billing"
              className="inline-block text-xs font-medium text-amber-700 underline"
            >
              Upgrade to add more runs →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
