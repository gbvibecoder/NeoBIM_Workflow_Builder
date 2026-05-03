export function WorkflowPreviewRenovation() {
  return (
    <svg viewBox="0 0 280 180" fill="none" style={{ width: "100%", height: "100%", display: "block" }}>
      {/* Before side */}
      <rect x="10" y="20" width="125" height="140" rx="8" fill="rgba(14,18,24,0.03)" stroke="var(--rs-rule, rgba(14,18,24,0.07))" strokeWidth="1" />
      {/* Before building — plain facade */}
      <rect x="30" y="60" width="85" height="80" fill="rgba(14,18,24,0.06)" rx="2" />
      <rect x="40" y="72" width="14" height="18" rx="1" fill="rgba(14,18,24,0.04)" stroke="rgba(14,18,24,0.1)" strokeWidth="0.8" />
      <rect x="60" y="72" width="14" height="18" rx="1" fill="rgba(14,18,24,0.04)" stroke="rgba(14,18,24,0.1)" strokeWidth="0.8" />
      <rect x="80" y="72" width="14" height="18" rx="1" fill="rgba(14,18,24,0.04)" stroke="rgba(14,18,24,0.1)" strokeWidth="0.8" />
      <rect x="40" y="100" width="14" height="18" rx="1" fill="rgba(14,18,24,0.04)" stroke="rgba(14,18,24,0.1)" strokeWidth="0.8" />
      <rect x="60" y="100" width="14" height="18" rx="1" fill="rgba(14,18,24,0.04)" stroke="rgba(14,18,24,0.1)" strokeWidth="0.8" />
      <rect x="80" y="100" width="14" height="18" rx="1" fill="rgba(14,18,24,0.04)" stroke="rgba(14,18,24,0.1)" strokeWidth="0.8" />
      <rect x="60" y="124" width="20" height="16" rx="1" fill="rgba(14,18,24,0.06)" stroke="rgba(14,18,24,0.12)" strokeWidth="0.8" />
      <text x="42" y="34" fontFamily="JetBrains Mono, monospace" fontSize="6" fill="var(--rs-text-mute, #9AA1B0)" letterSpacing="1">BEFORE</text>

      {/* Arrow divider */}
      <g stroke="var(--rs-text-mute, #9AA1B0)" strokeWidth="1.2" opacity="0.4">
        <line x1="138" y1="90" x2="148" y2="90" />
        <polyline points="145,86 149,90 145,94" fill="none" />
      </g>

      {/* After side */}
      <rect x="155" y="20" width="115" height="140" rx="8" fill="rgba(194,106,59,0.03)" stroke="rgba(194,106,59,0.12)" strokeWidth="1" />
      {/* After building — renovated facade */}
      <rect x="170" y="60" width="85" height="80" fill="rgba(194,106,59,0.06)" rx="2" />
      <rect x="180" y="72" width="14" height="18" rx="1.5" fill="rgba(229,168,120,0.15)" stroke="rgba(194,106,59,0.25)" strokeWidth="0.8" />
      <rect x="200" y="72" width="14" height="18" rx="1.5" fill="rgba(229,168,120,0.15)" stroke="rgba(194,106,59,0.25)" strokeWidth="0.8" />
      <rect x="220" y="72" width="14" height="18" rx="1.5" fill="rgba(229,168,120,0.15)" stroke="rgba(194,106,59,0.25)" strokeWidth="0.8" />
      <rect x="180" y="100" width="14" height="18" rx="1.5" fill="rgba(229,168,120,0.15)" stroke="rgba(194,106,59,0.25)" strokeWidth="0.8" />
      <rect x="200" y="100" width="14" height="18" rx="1.5" fill="rgba(229,168,120,0.15)" stroke="rgba(194,106,59,0.25)" strokeWidth="0.8" />
      <rect x="220" y="100" width="14" height="18" rx="1.5" fill="rgba(229,168,120,0.15)" stroke="rgba(194,106,59,0.25)" strokeWidth="0.8" />
      <rect x="200" y="124" width="20" height="16" rx="2" fill="rgba(194,106,59,0.1)" stroke="rgba(194,106,59,0.3)" strokeWidth="0.8" />
      {/* Greenery accent */}
      <circle cx="178" cy="136" r="6" fill="rgba(61,92,64,0.15)" />
      <circle cx="240" cy="136" r="5" fill="rgba(61,92,64,0.12)" />
      <text x="183" y="34" fontFamily="JetBrains Mono, monospace" fontSize="6" fill="var(--rs-burnt, #C26A3B)" letterSpacing="1">AFTER</text>
    </svg>
  );
}
