/**
 * Status pill for the documents table. Pure presentational — kept as
 * its own server component so the table page doesn't bloat.
 */

const COLOURS: Record<string, { bg: string; fg: string; border: string }> = {
  UPLOADED:  { bg: "rgba(120,120,140,0.15)", fg: "#cbd5e1", border: "rgba(120,120,140,0.3)" },
  PARSING:   { bg: "rgba(56,189,248,0.12)",  fg: "#7dd3fc", border: "rgba(56,189,248,0.3)" },
  CHUNKING:  { bg: "rgba(168,85,247,0.12)",  fg: "#d8b4fe", border: "rgba(168,85,247,0.3)" },
  EMBEDDING: { bg: "rgba(245,158,11,0.12)",  fg: "#fcd34d", border: "rgba(245,158,11,0.3)" },
  READY:     { bg: "rgba(34,197,94,0.12)",   fg: "#86efac", border: "rgba(34,197,94,0.35)" },
  FAILED:    { bg: "rgba(239,68,68,0.12)",   fg: "#fca5a5", border: "rgba(239,68,68,0.35)" },
};

export default function DocumentStatusBadge({ status }: { status: string }) {
  const c = COLOURS[status] ?? COLOURS.UPLOADED;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
      }}
    >
      {status}
    </span>
  );
}
