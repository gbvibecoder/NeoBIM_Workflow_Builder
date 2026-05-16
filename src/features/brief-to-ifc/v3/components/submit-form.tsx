/**
 * Brief-to-IFC v3 submit form.
 *
 * Three tabs:
 *   • Text — free-text brief; runs Layer 1 enrichment on the server.
 *   • PDF — file upload; POSTs to a server route that extracts the
 *     text via `pdf-parse` and submits via the existing /runs route.
 *   • JSON — paste a pre-enriched BriefSpec; skips Layer 1.
 *
 * Cost cap slider [$0.50, $5.00]. Submit redirects to
 * /dashboard/brief-to-ifc/v3/runs/<runId>.
 *
 * Mobile-responsive via Tailwind. Tested at 380px width.
 */

"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import { briefSpecSchema } from "@/features/brief-to-ifc/v3/types";
import { SampleBriefs } from "./sample-briefs";
import { CostEstimate } from "./cost-estimate";

type Tab = "text" | "pdf" | "json";

interface RunCreateResponse {
  runId: string;
  status: string;
  statusUrl: string;
  logsUrl: string;
}

interface RunCreateError {
  title?: string;
  message?: string;
  code?: string;
}

const COST_CAP_MIN = 0.5;
const COST_CAP_MAX = 5.0;
const COST_CAP_STEP = 0.1;
const COST_CAP_DEFAULT = 1.5;

export function SubmitForm(): ReactElement {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("text");
  const [text, setText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [costCap, setCostCap] = useState(COST_CAP_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<RunCreateError | null>(null);
  // null = quota check still in flight (allow submit optimistically — the
  // server-side check is authoritative). true/false = gate respected.
  const [quotaAllowed, setQuotaAllowed] = useState<boolean | null>(null);

  const hasInput =
    (tab === "text" && text.trim().length >= 40) ||
    (tab === "pdf" && Boolean(pdfFile)) ||
    (tab === "json" && json.trim().length > 0);

  function validateJson(value: string) {
    if (!value.trim()) {
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(value);
      const result = briefSpecSchema.safeParse(parsed);
      if (!result.success) {
        setJsonError(
          result.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
            .join("; "),
        );
      } else {
        setJsonError(null);
      }
    } catch (err) {
      setJsonError(
        err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON",
      );
    }
  }

  function handlePdfFile(file: File) {
    setPdfError(null);
    if (file.size > 10 * 1024 * 1024) {
      setPdfError("PDF too large (max 10 MB).");
      setPdfFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPdfError("File must be a PDF.");
      setPdfFile(null);
      return;
    }
    setPdfFile(file);
  }

  async function submitPdf(): Promise<RunCreateResponse | null> {
    if (!pdfFile) {
      setSubmitError({ title: "No file", message: "Choose a PDF first." });
      return null;
    }
    const form = new FormData();
    form.append("pdf", pdfFile);
    form.append("cost_cap_usd", String(costCap));
    const res = await fetch("/api/brief-to-ifc/v3/runs/from-pdf", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const errPayload = (await res.json().catch(() => ({}))) as {
        error?: RunCreateError;
      };
      setSubmitError(
        errPayload.error ?? {
          title: "PDF submit failed",
          message: `HTTP ${res.status}`,
        },
      );
      return null;
    }
    return (await res.json()) as RunCreateResponse;
  }

  async function submitText(): Promise<RunCreateResponse | null> {
    if (text.trim().length < 40) {
      setSubmitError({
        title: "Brief too short",
        message: "Write at least ~40 characters describing the project.",
      });
      return null;
    }
    const res = await fetch("/api/brief-to-ifc/v3/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: text.trim(),
        cost_cap_usd: costCap,
      }),
    });
    if (!res.ok) {
      const errPayload = (await res.json().catch(() => ({}))) as {
        error?: RunCreateError;
      };
      setSubmitError(
        errPayload.error ?? {
          title: "Submit failed",
          message: `HTTP ${res.status}`,
        },
      );
      return null;
    }
    return (await res.json()) as RunCreateResponse;
  }

  async function submitJson(): Promise<RunCreateResponse | null> {
    if (jsonError) {
      setSubmitError({
        title: "Invalid BriefSpec JSON",
        message: jsonError,
      });
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      setSubmitError({
        title: "Invalid JSON",
        message: err instanceof Error ? err.message : "Could not parse JSON.",
      });
      return null;
    }
    const validate = briefSpecSchema.safeParse(parsed);
    if (!validate.success) {
      setSubmitError({
        title: "BriefSpec validation failed",
        message: validate.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
          .join("; "),
      });
      return null;
    }
    const res = await fetch("/api/brief-to-ifc/v3/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        briefSpec: validate.data,
        cost_cap_usd: costCap,
      }),
    });
    if (!res.ok) {
      const errPayload = (await res.json().catch(() => ({}))) as {
        error?: RunCreateError;
      };
      setSubmitError(
        errPayload.error ?? {
          title: "Submit failed",
          message: `HTTP ${res.status}`,
        },
      );
      return null;
    }
    return (await res.json()) as RunCreateResponse;
  }

  async function handleSubmit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      let result: RunCreateResponse | null = null;
      if (tab === "text") result = await submitText();
      else if (tab === "pdf") result = await submitPdf();
      else if (tab === "json") result = await submitJson();
      if (result) {
        router.push(`/dashboard/brief-to-ifc/v3/runs/${result.runId}`);
      }
    } catch (err) {
      setSubmitError({
        title: "Network error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {/* Tabs */}
      <div role="tablist" className="flex border-b border-zinc-200">
        {(["text", "pdf", "json"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={
              "flex-1 px-4 py-3 text-sm font-medium transition-colors " +
              (tab === t
                ? "border-b-2 border-amber-500 text-amber-700"
                : "text-zinc-500 hover:text-zinc-700")
            }
          >
            {t === "text" ? "Text brief" : t === "pdf" ? "PDF upload" : "BriefSpec JSON"}
          </button>
        ))}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <SampleBriefs
          onSelect={(json) => {
            setJson(json);
            setJsonError(null);
            setTab("json");
          }}
        />

        {tab === "text" && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Describe the building
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder={
                'e.g. "Sketch a 5 x 5 m open-plan office at the BKC site. Open ceiling, one phone booth, polished concrete floor, four hot desks, a small coffee bar..."'
              }
              className="block w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Min 40 characters. Layer 1 (enrichment) runs automatically — it
              turns this text into a structured BriefSpec before generation.
            </span>
          </label>
        )}

        {tab === "pdf" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Upload a brief PDF
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files?.[0];
                if (file) handlePdfFile(file);
              }}
              className="flex min-h-32 flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 p-6 text-center"
            >
              <input
                id="pdf-input"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePdfFile(file);
                }}
                className="hidden"
              />
              <label
                htmlFor="pdf-input"
                className="cursor-pointer rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
              >
                Choose PDF
              </label>
              <p className="mt-2 text-xs text-zinc-500">or drag and drop here</p>
              {pdfFile && (
                <p className="mt-3 text-sm text-zinc-700">
                  {pdfFile.name}
                  <span className="ml-2 text-xs text-zinc-500">
                    ({Math.round(pdfFile.size / 1024).toLocaleString()} KB)
                  </span>
                </p>
              )}
            </div>
            {pdfError && (
              <p className="mt-2 text-sm text-red-600">{pdfError}</p>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              Text is extracted server-side. Scanned/image PDFs aren't
              supported — paste their contents into the Text tab instead.
            </p>
          </div>
        )}

        {tab === "json" && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-zinc-700">
              Pre-enriched BriefSpec JSON
            </span>
            <textarea
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
                if (jsonError) validateJson(e.target.value);
              }}
              onBlur={(e) => validateJson(e.target.value)}
              rows={14}
              placeholder='{ "project": { ... }, "site": { ... }, "spaces": [...], "elements": [...], "materials": [...], "brand_language": { ... } }'
              className={
                "block w-full resize-y rounded-lg border px-3 py-2 font-mono text-xs shadow-sm focus:outline-none focus:ring-2 " +
                (jsonError
                  ? "border-red-300 focus:border-red-400 focus:ring-red-200"
                  : "border-zinc-300 focus:border-amber-400 focus:ring-amber-200")
              }
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Validated client-side against the `briefSpecSchema`. JSON
              submissions skip Layer 1 enrichment.
            </span>
            {jsonError && (
              <span className="mt-1 block text-xs text-red-600">{jsonError}</span>
            )}
          </label>
        )}

        <CostEstimate hasInput={hasInput} onQuotaGate={setQuotaAllowed} />

        {/* Cost cap slider */}
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center justify-between">
            <label htmlFor="cost-cap" className="text-sm font-medium text-zinc-700">
              Cost cap
            </label>
            <span className="font-mono text-sm text-amber-700">
              ${costCap.toFixed(2)}
            </span>
          </div>
          <input
            id="cost-cap"
            type="range"
            min={COST_CAP_MIN}
            max={COST_CAP_MAX}
            step={COST_CAP_STEP}
            value={costCap}
            onChange={(e) => setCostCap(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
          <div className="flex justify-between text-xs text-zinc-500">
            <span>${COST_CAP_MIN.toFixed(2)}</span>
            <span>${COST_CAP_MAX.toFixed(2)}</span>
          </div>
          <p className="text-xs text-zinc-500">
            Hard ceiling on Anthropic spend per run. The generator halts when
            cumulative cost crosses this, even if more turns remain.
          </p>
        </div>

        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
            <p className="font-medium text-red-700">
              {submitError.title ?? "Submit failed"}
            </p>
            {submitError.message && (
              <p className="mt-1 text-red-600">{submitError.message}</p>
            )}
            {submitError.code && (
              <p className="mt-1 font-mono text-xs text-red-500">
                {submitError.code}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || quotaAllowed === false}
          className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? "Submitting…"
            : quotaAllowed === false
              ? "Monthly quota reached"
              : "Generate IFC"}
        </button>
      </div>
    </div>
  );
}
