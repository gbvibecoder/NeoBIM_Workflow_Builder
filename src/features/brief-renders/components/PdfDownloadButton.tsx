/**
 * PdfDownloadButton — terminal CTA when the editorial PDF is ready.
 *
 * Renders nothing unless `pdfUrl` is a non-empty string. The button is
 * a plain `<a download>` so the browser owns the file save dialog —
 * no JS-driven blob trick that could fail in private modes.
 *
 * `disabled` is honoured for the regen-induced re-compile window: when
 * the parent knows a regeneration is in flight, the link is suppressed
 * to keep the user from downloading a stale PDF.
 */

"use client";

import s from "@/app/dashboard/brief-renders/page.module.css";

export interface PdfDownloadButtonProps {
  pdfUrl: string | null;
  disabled?: boolean;
  /** Display name in the download attribute — purely a hint to the browser. */
  fileName?: string;
}

export function PdfDownloadButton({
  pdfUrl,
  disabled = false,
  fileName = "brief-renders.pdf",
}: PdfDownloadButtonProps) {
  if (!pdfUrl) return null;

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className={s.btnPdfDisabled}
        data-testid="pdf-download-disabled"
        aria-label="Download is unavailable while a regeneration is in flight"
      >
        Re-compiling PDF…
      </button>
    );
  }

  return (
    <a
      href={pdfUrl}
      download={fileName}
      target="_blank"
      rel="noopener noreferrer"
      className={s.btnPdf}
      data-testid="pdf-download-button"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Get the PDF
    </a>
  );
}
