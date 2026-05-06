export function IFCViewerIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 140" fill="none" aria-hidden="true" className={className} style={{ width: "100%", height: "100%", display: "block" }}>
      <g stroke="rgba(184,118,45,0.85)" strokeWidth="1.4" fill="none">
        <polygon points="80,110 140,80 200,110 140,130" />
        <polygon points="80,50 140,20 200,50 140,80" />
        <line x1="80" y1="110" x2="80" y2="50" />
        <line x1="200" y1="110" x2="200" y2="50" />
        <line x1="140" y1="130" x2="140" y2="80" />
        <line x1="140" y1="80" x2="140" y2="20" />
        <line x1="80" y1="90" x2="200" y2="90" strokeOpacity="0.5" strokeDasharray="2,3" />
        <line x1="80" y1="70" x2="200" y2="70" strokeOpacity="0.5" strokeDasharray="2,3" />
      </g>
      <g fill="rgba(184,118,45,0.3)">
        <rect x="98" y="56" width="10" height="8" rx="1" />
        <rect x="118" y="56" width="10" height="8" rx="1" />
        <rect x="155" y="56" width="10" height="8" rx="1" />
        <rect x="98" y="76" width="10" height="8" rx="1" />
        <rect x="155" y="76" width="10" height="8" rx="1" />
      </g>
      <g fill="rgba(184,118,45,0.5)">
        <circle cx="80" cy="110" r="2" />
        <circle cx="200" cy="110" r="2" />
        <circle cx="80" cy="50" r="2" />
        <circle cx="200" cy="50" r="2" />
        <circle cx="140" cy="20" r="2" />
        <circle cx="140" cy="130" r="2" />
      </g>
    </svg>
  );
}
