export function ProductPreviewBrief() {
  return (
    <svg viewBox="0 0 280 140" fill="none" style={{ width: "100%", height: "100%", display: "block" }}>
      {/* PDF page */}
      <rect x="30" y="20" width="60" height="80" rx="4" fill="white" stroke="var(--rs-rule-strong, rgba(14,18,24,0.14))" strokeWidth="1" />
      <line x1="40" y1="35" x2="80" y2="35" stroke="var(--rs-text-mute, #9AA1B0)" strokeWidth="1" opacity="0.4" />
      <line x1="40" y1="42" x2="75" y2="42" stroke="var(--rs-text-mute, #9AA1B0)" strokeWidth="1" opacity="0.3" />
      <line x1="40" y1="49" x2="78" y2="49" stroke="var(--rs-text-mute, #9AA1B0)" strokeWidth="1" opacity="0.3" />
      <rect x="40" y="58" width="40" height="25" rx="2" fill="rgba(107,69,102,0.08)" stroke="rgba(107,69,102,0.2)" strokeWidth="0.8" />
      <text x="38" y="30" fontFamily="JetBrains Mono, monospace" fontSize="5" fill="rgba(107,69,102,0.7)" letterSpacing="1">PDF</text>

      {/* Arrow */}
      <g stroke="var(--rs-text-mute, #9AA1B0)" strokeWidth="1.2" opacity="0.5">
        <line x1="100" y1="60" x2="118" y2="60" />
        <polyline points="114,56 118,60 114,64" fill="none" />
      </g>

      {/* 4 storyboard frames */}
      <g>
        <rect x="128" y="24" width="56" height="36" rx="3" fill="rgba(107,69,102,0.06)" stroke="rgba(107,69,102,0.15)" strokeWidth="0.8" />
        <rect x="192" y="24" width="56" height="36" rx="3" fill="rgba(107,69,102,0.06)" stroke="rgba(107,69,102,0.15)" strokeWidth="0.8" />
        <rect x="128" y="68" width="56" height="36" rx="3" fill="rgba(107,69,102,0.06)" stroke="rgba(107,69,102,0.15)" strokeWidth="0.8" />
        <rect x="192" y="68" width="56" height="36" rx="3" fill="rgba(107,69,102,0.06)" stroke="rgba(107,69,102,0.15)" strokeWidth="0.8" />
      </g>

      {/* Frame content hints */}
      <g opacity="0.4">
        <circle cx="156" cy="38" r="6" fill="rgba(107,69,102,0.15)" />
        <rect x="205" y="32" width="30" height="3" rx="1" fill="rgba(107,69,102,0.15)" />
        <rect x="205" y="38" width="22" height="3" rx="1" fill="rgba(107,69,102,0.1)" />
        <rect x="138" y="78" width="36" height="16" rx="2" fill="rgba(107,69,102,0.1)" />
        <circle cx="220" cy="82" r="6" fill="rgba(107,69,102,0.15)" />
      </g>

      {/* Frame numbers */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="5" fill="rgba(107,69,102,0.5)">
        <text x="130" y="56">01</text>
        <text x="194" y="56">02</text>
        <text x="130" y="100">03</text>
        <text x="194" y="100">04</text>
      </g>
    </svg>
  );
}
