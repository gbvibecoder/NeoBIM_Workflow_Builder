export function WorkflowPreviewBoq() {
  return (
    <svg viewBox="0 0 280 180" fill="none" style={{ width: "100%", height: "100%", display: "block" }}>
      {/* Spreadsheet card */}
      <rect x="40" y="16" width="200" height="148" rx="8" fill="white" stroke="var(--rs-rule, rgba(14,18,24,0.07))" strokeWidth="1" />

      {/* Header */}
      <rect x="40" y="16" width="200" height="28" rx="8" fill="rgba(26,77,92,0.04)" />
      <rect x="40" y="36" width="200" height="8" fill="rgba(26,77,92,0.04)" />
      <text x="52" y="34" fontFamily="JetBrains Mono, monospace" fontSize="6" fill="var(--rs-blueprint, #1A4D5C)" letterSpacing="1.5" fontWeight="600">BILL OF QUANTITIES</text>

      {/* Column headers */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="5" fill="var(--rs-text-mute, #9AA1B0)" letterSpacing="0.8">
        <text x="52" y="54">ITEM</text>
        <text x="120" y="54">QTY</text>
        <text x="158" y="54">RATE</text>
        <text x="200" y="54">AMOUNT</text>
      </g>
      <line x1="48" y1="58" x2="232" y2="58" stroke="var(--rs-rule, rgba(14,18,24,0.07))" strokeWidth="0.8" />

      {/* Row data */}
      <g fontFamily="JetBrains Mono, monospace" fontSize="6">
        <text x="52" y="72" fill="var(--rs-ink-soft, #2A3142)">Concrete M25</text>
        <text x="120" y="72" fill="var(--rs-text, #5A6478)">342 m³</text>
        <text x="158" y="72" fill="var(--rs-text, #5A6478)">₹6,200</text>
        <text x="200" y="72" fill="var(--rs-ink-soft, #2A3142)">₹21.2L</text>

        <text x="52" y="88" fill="var(--rs-ink-soft, #2A3142)">Brick 230mm</text>
        <text x="120" y="88" fill="var(--rs-text, #5A6478)">1,840 m²</text>
        <text x="158" y="88" fill="var(--rs-text, #5A6478)">₹640</text>
        <text x="200" y="88" fill="var(--rs-ink-soft, #2A3142)">₹11.8L</text>

        <text x="52" y="104" fill="var(--rs-ink-soft, #2A3142)">TMT Steel</text>
        <text x="120" y="104" fill="var(--rs-text, #5A6478)">28.4 MT</text>
        <text x="158" y="104" fill="var(--rs-text, #5A6478)">₹62,000</text>
        <text x="200" y="104" fill="var(--rs-ink-soft, #2A3142)">₹17.6L</text>

        <text x="52" y="120" fill="var(--rs-ink-soft, #2A3142)">Plaster</text>
        <text x="120" y="120" fill="var(--rs-text, #5A6478)">2,100 m²</text>
        <text x="158" y="120" fill="var(--rs-text, #5A6478)">₹280</text>
        <text x="200" y="120" fill="var(--rs-ink-soft, #2A3142)">₹5.9L</text>
      </g>

      {/* Separator */}
      <line x1="48" y1="130" x2="232" y2="130" stroke="var(--rs-rule-strong, rgba(14,18,24,0.14))" strokeWidth="1" />

      {/* Total */}
      <g fontFamily="Georgia, serif" fontSize="12">
        <text x="52" y="148" fill="var(--rs-blueprint, #1A4D5C)" fontStyle="italic">₹9.03 Cr</text>
      </g>
      <g fontFamily="JetBrains Mono, monospace" fontSize="5" fill="var(--rs-text-mute, #9AA1B0)" letterSpacing="1">
        <text x="130" y="148">TOTAL ESTIMATED COST</text>
      </g>
    </svg>
  );
}
