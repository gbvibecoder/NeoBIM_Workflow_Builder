"use client";

/**
 * Phase 3 page background — replaces the BOQ visualizer's
 * `InteractiveDotGrid` (mouse-following) with a static drafting-paper
 * texture. The static version reads as architectural craft; an interactive
 * dot grid on a result page would compete with hover affordances on cards.
 *
 * Pure CSS background — no canvas, no RAF, no IntersectionObserver.
 * Pointer-events: none so it never intercepts clicks.
 */
export function PageBackground() {
  return (
    <div
      aria-hidden="true"
      className="page-bg-pattern"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    >
      <style>{`
        .page-bg-pattern {
          background-color: #FAFAF8;
          background-image:
            /* Major grid — every 96px, very faint */
            linear-gradient(to right, rgba(13,148,136,0.04) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(13,148,136,0.04) 1px, transparent 1px),
            /* Minor dot grid — every 24px, near-invisible */
            radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 0.6px, transparent 1px);
          background-size:
            96px 96px,
            96px 96px,
            24px 24px;
          background-position:
            0 0,
            0 0,
            0 0;
        }
        @media (prefers-reduced-motion: no-preference) {
          .page-bg-pattern {
            animation: drafting-drift 90s linear infinite;
          }
          @keyframes drafting-drift {
            from { background-position: 0 0, 0 0, 0 0; }
            to   { background-position: 96px 96px, 96px 96px, 24px 24px; }
          }
        }
      `}</style>
    </div>
  );
}
