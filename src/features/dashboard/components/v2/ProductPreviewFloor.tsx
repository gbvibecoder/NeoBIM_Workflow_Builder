export function ProductPreviewFloor() {
  return (
    <svg viewBox="0 0 280 140" fill="none" style={{ width: "100%", height: "100%", display: "block" }}>
      <g stroke="var(--rs-ink, #0E1218)" strokeWidth="1.6" fill="none" opacity="0.7">
        <rect x="40" y="20" width="200" height="100" />
        <line x1="140" y1="20" x2="140" y2="70" />
        <line x1="80" y1="70" x2="240" y2="70" />
        <line x1="140" y1="70" x2="140" y2="120" />
      </g>
      {/* Door arcs */}
      <g stroke="var(--rs-blueprint, #1A4D5C)" strokeWidth="1.4" fill="rgba(26,77,92,0.15)">
        <path d="M 100 20 A 14 14 0 0 1 114 34 L 100 34 Z" />
      </g>
      {/* Dimension callouts */}
      <g stroke="var(--rs-burnt, #C26A3B)" strokeWidth="1.6">
        <line x1="160" y1="20" x2="200" y2="20" />
        <line x1="40" y1="40" x2="40" y2="70" />
      </g>
      {/* Room labels */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="6" fill="var(--rs-text, #5A6478)" letterSpacing="1">
        <text x="84" y="48">LIVING</text>
        <text x="180" y="48">KITCHEN</text>
        <text x="84" y="100">BEDROOM</text>
        <text x="178" y="100">BATH</text>
      </g>
    </svg>
  );
}
