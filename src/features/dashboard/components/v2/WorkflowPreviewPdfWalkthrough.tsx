export function WorkflowPreviewPdfWalkthrough() {
  return (
    <svg viewBox="0 0 280 180" fill="none" style={{ width: "100%", height: "100%", display: "block" }}>
      {/* 4 storyboard frames in a 2×2 grid */}
      <g>
        {/* Frame 1 — exterior establishing shot */}
        <rect x="20" y="16" width="112" height="68" rx="6" fill="rgba(26,77,92,0.04)" stroke="var(--rs-rule, rgba(14,18,24,0.07))" strokeWidth="1" />
        <rect x="28" y="40" width="50" height="30" rx="2" fill="rgba(26,77,92,0.06)" />
        <rect x="84" y="50" width="20" height="20" rx="1" fill="rgba(26,77,92,0.04)" />
        <text x="26" y="28" fontFamily="JetBrains Mono, monospace" fontSize="5" fill="var(--rs-blueprint, #1A4D5C)" letterSpacing="1" opacity="0.7">01 — EXT</text>

        {/* Frame 2 — interior living */}
        <rect x="148" y="16" width="112" height="68" rx="6" fill="rgba(26,77,92,0.04)" stroke="var(--rs-rule, rgba(14,18,24,0.07))" strokeWidth="1" />
        <rect x="160" y="44" width="30" height="24" rx="2" fill="rgba(26,77,92,0.05)" />
        <rect x="198" y="48" width="40" height="16" rx="1" fill="rgba(26,77,92,0.04)" />
        <text x="154" y="28" fontFamily="JetBrains Mono, monospace" fontSize="5" fill="var(--rs-blueprint, #1A4D5C)" letterSpacing="1" opacity="0.7">02 — INT</text>

        {/* Frame 3 — kitchen */}
        <rect x="20" y="96" width="112" height="68" rx="6" fill="rgba(26,77,92,0.04)" stroke="var(--rs-rule, rgba(14,18,24,0.07))" strokeWidth="1" />
        <rect x="32" y="116" width="60" height="8" rx="1" fill="rgba(26,77,92,0.05)" />
        <rect x="32" y="128" width="60" height="8" rx="1" fill="rgba(26,77,92,0.04)" />
        <rect x="32" y="140" width="40" height="8" rx="1" fill="rgba(26,77,92,0.03)" />
        <text x="26" y="108" fontFamily="JetBrains Mono, monospace" fontSize="5" fill="var(--rs-blueprint, #1A4D5C)" letterSpacing="1" opacity="0.7">03 — KIT</text>

        {/* Frame 4 — aerial flyover */}
        <rect x="148" y="96" width="112" height="68" rx="6" fill="rgba(26,77,92,0.04)" stroke="var(--rs-rule, rgba(14,18,24,0.07))" strokeWidth="1" />
        <circle cx="204" cy="130" r="18" fill="rgba(26,77,92,0.03)" stroke="rgba(26,77,92,0.08)" strokeWidth="0.8" />
        <polygon points="198,126 214,130 198,134" fill="rgba(26,77,92,0.15)" />
        <text x="154" y="108" fontFamily="JetBrains Mono, monospace" fontSize="5" fill="var(--rs-blueprint, #1A4D5C)" letterSpacing="1" opacity="0.7">04 — FLY</text>
      </g>

      {/* Timeline bar at bottom */}
      <line x1="20" y1="174" x2="260" y2="174" stroke="var(--rs-rule-strong, rgba(14,18,24,0.14))" strokeWidth="1" />
      <circle cx="20" cy="174" r="2.5" fill="var(--rs-blueprint, #1A4D5C)" />
      <circle cx="85" cy="174" r="2" fill="var(--rs-text-mute, #9AA1B0)" opacity="0.5" />
      <circle cx="155" cy="174" r="2" fill="var(--rs-text-mute, #9AA1B0)" opacity="0.5" />
      <circle cx="225" cy="174" r="2" fill="var(--rs-text-mute, #9AA1B0)" opacity="0.5" />
      <rect x="20" y="172.5" width="80" height="3" rx="1.5" fill="var(--rs-blueprint, #1A4D5C)" opacity="0.3" />
      <text x="232" y="176" fontFamily="JetBrains Mono, monospace" fontSize="5" fill="var(--rs-text-mute, #9AA1B0)">0:15</text>
    </svg>
  );
}
