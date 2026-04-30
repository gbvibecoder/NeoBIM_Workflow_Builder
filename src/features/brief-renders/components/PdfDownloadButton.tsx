/**
 * PdfDownloadButton — terminal CTA when the editorial PDF is ready.
 *
 * Renders nothing unless `pdfUrl` is a non-empty string. The button is
 * a plain `<a download>` so the browser owns the file save dialog —
 * no JS-driven blob trick that could fail in private modes.
 *
 * `disabled` is honoured for the regen-induced re-compile window: when
 * the parent knows a regeneration is in flight, the link is suppressed
 * to keep the user from downloading a stale PDF whose hash no longer
 * matches the latest shots.
 */

"use client";

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
        className="bg-zinc-800 text-zinc-500 cursor-not-allowed px-4 py-2 rounded font-medium text-sm"
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
      className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-medium text-sm"
      data-testid="pdf-download-button"
    >
      <span aria-hidden>⬇</span>
      Get PDF
    </a>
  );
}
