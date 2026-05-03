export function ProductPreviewRender() {
  return (
    <svg viewBox="0 0 280 140" fill="none" style={{ width: "100%", height: "100%", display: "block" }}>
      {/* Dark cinematic frame */}
      <defs>
        <linearGradient id="ppRenderSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(229,168,120,0.5)" />
          <stop offset="100%" stopColor="rgba(194,106,59,0.2)" />
        </linearGradient>
      </defs>
      <rect width="280" height="140" fill="url(#ppRenderSky)" />

      {/* City skyline */}
      <path
        d="M0 95 L30 95 L30 75 L60 75 L60 90 L100 90 L100 60 L140 60 L140 85 L180 85 L180 70 L220 70 L220 92 L280 92 L280 140 L0 140 Z"
        fill="rgba(15,24,34,0.72)"
      />

      {/* Tower accent */}
      <rect x="96" y="45" width="12" height="15" fill="rgba(229,168,120,0.2)" />

      {/* REC indicator */}
      <g>
        <circle cx="22" cy="16" r="4" fill="rgba(220,53,69,0.7)" />
        <text x="30" y="19" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="rgba(255,255,255,0.6)" letterSpacing="1">REC</text>
      </g>

      {/* Timecode */}
      <text x="230" y="19" fontFamily="JetBrains Mono, monospace" fontSize="6" fill="rgba(255,255,255,0.4)" letterSpacing="0.5">00:14:22</text>

      {/* Corner brackets */}
      <g stroke="rgba(255,255,255,0.25)" strokeWidth="1" fill="none">
        <path d="M10,10 L10,20 M10,10 L20,10" />
        <path d="M270,10 L270,20 M270,10 L260,10" />
        <path d="M10,130 L10,120 M10,130 L20,130" />
        <path d="M270,130 L270,120 M270,130 L260,130" />
      </g>
    </svg>
  );
}
