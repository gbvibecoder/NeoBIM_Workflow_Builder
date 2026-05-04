export function BOQCalculatorIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 180" fill="none" aria-hidden="true" className={className} style={{ width: "100%", height: "100%", display: "block" }}>
      <rect x="40" y="16" width="200" height="148" rx="8" fill="white" stroke="rgba(14,18,24,0.07)" strokeWidth="1" />
      <rect x="40" y="16" width="200" height="28" rx="8" fill="rgba(26,77,92,0.04)" />
      <rect x="40" y="36" width="200" height="8" fill="rgba(26,77,92,0.04)" />
      <text x="52" y="34" fontFamily="JetBrains Mono, monospace" fontSize="6" fill="#1A4D5C" letterSpacing="1.5" fontWeight="600">BILL OF QUANTITIES</text>
      <g fontFamily="JetBrains Mono, monospace" fontSize="5" fill="#9AA1B0" letterSpacing="0.8">
        <text x="52" y="54">ITEM</text>
        <text x="120" y="54">QTY</text>
        <text x="158" y="54">RATE</text>
        <text x="200" y="54">AMOUNT</text>
      </g>
      <line x1="48" y1="58" x2="232" y2="58" stroke="rgba(14,18,24,0.07)" strokeWidth="0.8" />
      <g fontFamily="JetBrains Mono, monospace" fontSize="6">
        <text x="52" y="72" fill="#2A3142">Concrete M25</text>
        <text x="120" y="72" fill="#5A6478">342 m&#xB3;</text>
        <text x="158" y="72" fill="#5A6478">{"\u20B9"}6,200</text>
        <text x="200" y="72" fill="#2A3142">{"\u20B9"}21.2L</text>
        <text x="52" y="88" fill="#2A3142">Brick 230mm</text>
        <text x="120" y="88" fill="#5A6478">1,840 m&#xB2;</text>
        <text x="158" y="88" fill="#5A6478">{"\u20B9"}640</text>
        <text x="200" y="88" fill="#2A3142">{"\u20B9"}11.8L</text>
        <text x="52" y="104" fill="#2A3142">TMT Steel</text>
        <text x="120" y="104" fill="#5A6478">28.4 MT</text>
        <text x="158" y="104" fill="#5A6478">{"\u20B9"}62,000</text>
        <text x="200" y="104" fill="#2A3142">{"\u20B9"}17.6L</text>
        <text x="52" y="120" fill="#2A3142">Plaster</text>
        <text x="120" y="120" fill="#5A6478">2,100 m&#xB2;</text>
        <text x="158" y="120" fill="#5A6478">{"\u20B9"}280</text>
        <text x="200" y="120" fill="#2A3142">{"\u20B9"}5.9L</text>
      </g>
      <line x1="48" y1="130" x2="232" y2="130" stroke="rgba(14,18,24,0.14)" strokeWidth="1" />
      <g fontFamily="Georgia, serif" fontSize="12">
        <text x="52" y="148" fill="#1A4D5C" fontStyle="italic">{"\u20B9"}9.03 Cr</text>
      </g>
      <g fontFamily="JetBrains Mono, monospace" fontSize="5" fill="#9AA1B0" letterSpacing="1">
        <text x="130" y="148">TOTAL ESTIMATED COST</text>
      </g>
    </svg>
  );
}
