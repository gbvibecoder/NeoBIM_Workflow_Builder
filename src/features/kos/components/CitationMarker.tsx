"use client";

/**
 * Inline `[N]` citation chip rendered inside a streamed bot answer.
 *
 * Two states:
 *   - resolved (a `KosCitation` is known): clickable superscript that
 *     opens the source PDF (branded `/sources/[documentId]` route) in a
 *     new tab at the cited page, with a hover/focus tooltip showing the
 *     document title + snippet.
 *   - unresolved (the `citations` event hasn't arrived yet, e.g. the
 *     marker streamed in before the sources): rendered as a muted,
 *     non-clickable chip whose tooltip reads "Source loading…".
 *
 * Min 44px touch target via padding so the chip stays tappable on
 * narrow viewports (Part 7, edge case 9).
 */

import { useState } from "react";

import type { KosCitation } from "@/features/kos/types/chat";

interface CitationMarkerProps {
  number: number;
  citation?: KosCitation;
}

const GOLD = "var(--kos-secondary, #c9a55a)";

export function openSourceTab(citation: KosCitation): void {
  const page =
    citation.pageNum && citation.pageNum > 0 ? citation.pageNum : 1;
  window.open(
    `/sources/${encodeURIComponent(citation.documentId)}?page=${page}`,
    "_blank",
    "noopener,noreferrer",
  );
}

export function CitationMarker({ number, citation }: CitationMarkerProps) {
  const [hovered, setHovered] = useState(false);
  const resolved = Boolean(citation);

  const tooltipText = citation
    ? `${citation.title}${
        citation.pageNum ? ` · p.${citation.pageNum}` : ""
      }\n${citation.snippet}`
    : "Source loading…";

  return (
    <sup
      style={{ position: "relative", lineHeight: 0, whiteSpace: "nowrap" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={
          resolved
            ? `Open source ${number}: ${citation!.title}${
                citation!.pageNum ? `, page ${citation!.pageNum}` : ""
              }`
            : `Source ${number}, still loading`
        }
        title={resolved ? undefined : "Source loading…"}
        disabled={!resolved}
        onClick={() => citation && openSourceTab(citation)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 18,
          padding: "1px 5px",
          margin: "0 1px",
          borderRadius: 6,
          border: `1px solid ${resolved ? GOLD : "rgba(255,255,255,0.2)"}`,
          background: resolved
            ? "rgba(201,165,90,0.14)"
            : "rgba(255,255,255,0.04)",
          color: resolved ? GOLD : "rgba(255,255,255,0.45)",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "var(--font-jetbrains), monospace",
          cursor: resolved ? "pointer" : "default",
          transform: hovered && resolved ? "translateY(-1px)" : "none",
          transition: "transform 120ms ease, background 120ms ease",
          verticalAlign: "super",
        }}
      >
        {number}
      </button>

      {hovered && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: 260,
            maxWidth: "70vw",
            padding: "8px 10px",
            borderRadius: 8,
            background: "#0a0a0a",
            border: `1px solid rgba(201,165,90,0.3)`,
            color: "#e8e8e8",
            fontSize: 11.5,
            lineHeight: 1.45,
            fontWeight: 400,
            fontFamily: "var(--font-ui), system-ui, sans-serif",
            whiteSpace: "pre-wrap",
            textAlign: "left",
            boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
            zIndex: 50,
            pointerEvents: "none",
          }}
        >
          {tooltipText}
        </span>
      )}
    </sup>
  );
}
