/**
 * LightHeroPipeline — Animated isometric pipeline visual for the /light hero.
 *
 * 5 nodes (Brief → Floor Plan → IFC → 3D Model → BOQ) connected by bezier
 * curves with sage dots traveling between them. Pure SVG + CSS animations.
 * No framer-motion. No Three.js. No JS runtime cost.
 *
 * 12-second infinite loop. prefers-reduced-motion shows static final state.
 * Hidden below 768px.
 */
export function LightHeroPipeline() {
  /* ── Connector bezier paths (between card edges, gentle upward arcs) ── */
  const C1 = "M140,90 C155,73 171,73 186,90";
  const C2 = "M316,90 C331,73 347,73 362,90";
  const C3 = "M492,90 C507,73 523,73 538,90";
  const C4 = "M668,90 C683,73 699,73 714,90";

  /* ── Isometric cube vertices (local to Node 3 card at x=362) ── */
  const n3 = { Ax: 384, Ay: 78, Bx: 434, By: 78, Cx: 434, Cy: 116, Dx: 384, Dy: 116, Ex: 409, Ey: 63, Fx: 459, Fy: 63, Gx: 459, Gy: 101, Hx: 409, Hy: 101 };
  /* Same cube shifted +176px for Node 4 at x=538 */
  const n4 = { Ax: 560, Ay: 78, Bx: 610, By: 78, Cx: 610, Cy: 116, Dx: 560, Dy: 116, Ex: 585, Ey: 63, Fx: 635, Fy: 63, Gx: 635, Gy: 101, Hx: 585, Hy: 101 };

  const css = `
/* ── Base ── */
.lhp-a{animation-duration:12s;animation-timing-function:ease-out;animation-iteration-count:infinite;animation-fill-mode:both}
.lhp-ld{stroke-dasharray:200;stroke-dashoffset:200}

/* ── Node fade ── */
@keyframes n1f{0%{opacity:0}3%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes n2f{0%,16%{opacity:0}20%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes n3f{0%,37%{opacity:0}41%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes n4f{0%,57%{opacity:0}61%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes n5f{0%,78%{opacity:0}82%{opacity:1}96%{opacity:1}100%{opacity:0}}
.lhp-n1{animation-name:n1f}.lhp-n2{animation-name:n2f}.lhp-n3{animation-name:n3f}.lhp-n4{animation-name:n4f}.lhp-n5{animation-name:n5f}

/* ── Connector fade ── */
@keyframes c1f{0%,10%{opacity:0}13%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes c2f{0%,31%{opacity:0}34%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes c3f{0%,52%{opacity:0}55%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes c4f{0%,73%{opacity:0}76%{opacity:1}96%{opacity:1}100%{opacity:0}}
.lhp-c1{animation-name:c1f}.lhp-c2{animation-name:c2f}.lhp-c3{animation-name:c3f}.lhp-c4{animation-name:c4f}

/* ── Line draw (stroke-dashoffset 200→0) ── */
@keyframes d1{0%,3%{stroke-dashoffset:200}10%{stroke-dashoffset:0}96%{stroke-dashoffset:0}100%{stroke-dashoffset:200}}
@keyframes d2{0%,19%{stroke-dashoffset:200}30%{stroke-dashoffset:0}96%{stroke-dashoffset:0}100%{stroke-dashoffset:200}}
@keyframes d3{0%,40%{stroke-dashoffset:200}50%{stroke-dashoffset:0}96%{stroke-dashoffset:0}100%{stroke-dashoffset:200}}
@keyframes d4{0%,60%{stroke-dashoffset:200}68%{stroke-dashoffset:0}96%{stroke-dashoffset:0}100%{stroke-dashoffset:200}}
.lhp-d1{animation-name:d1}.lhp-d2{animation-name:d2}.lhp-d3{animation-name:d3}.lhp-d4{animation-name:d4}

/* ── N4 surface fills (per-face shading) ── */
@keyframes sf-top{0%,62%{fill-opacity:0}72%{fill-opacity:0.18}96%{fill-opacity:0.18}100%{fill-opacity:0}}
@keyframes sf-front{0%,62%{fill-opacity:0}72%{fill-opacity:0.12}96%{fill-opacity:0.12}100%{fill-opacity:0}}
@keyframes sf-right{0%,62%{fill-opacity:0}72%{fill-opacity:0.07}96%{fill-opacity:0.07}100%{fill-opacity:0}}
.lhp-sf-top{animation-name:sf-top}.lhp-sf-front{animation-name:sf-front}.lhp-sf-right{animation-name:sf-right}

/* ── N5 table row stagger + highlight ── */
@keyframes r1{0%,82%{opacity:0}84%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes r2{0%,84%{opacity:0}86%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes r3{0%,86%{opacity:0}88%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes r4{0%,87%{opacity:0}89%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes r5{0%,88%{opacity:0}91%{opacity:1}96%{opacity:1}100%{opacity:0}}
@keyframes hl{0%,89%{opacity:0}92%{opacity:1}96%{opacity:1}100%{opacity:0}}
.lhp-r1{animation-name:r1}.lhp-r2{animation-name:r2}.lhp-r3{animation-name:r3}.lhp-r4{animation-name:r4}.lhp-r5{animation-name:r5}.lhp-hl{animation-name:hl}
`;

  return (
    <div
      className="lhp-wrap"
      aria-hidden="true"
      style={{ maxWidth: 880, margin: "64px auto 0", width: "100%", padding: "0 24px" }}
    >
      <svg
        viewBox="0 0 880 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <style>{css}</style>
        <defs>
          <filter id="cs" x="-6%" y="-6%" width="112%" height="120%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
            <feOffset dy="2" />
            <feComponentTransfer><feFuncA type="linear" slope="0.07" /></feComponentTransfer>
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ═══ Connectors (behind nodes) ═══ */}
        <path className="lhp-a lhp-c1" d={C1} stroke="rgba(26,31,46,0.15)" strokeWidth={1.5} strokeDasharray="6 4" />
        <path className="lhp-a lhp-c2" d={C2} stroke="rgba(26,31,46,0.15)" strokeWidth={1.5} strokeDasharray="6 4" />
        <path className="lhp-a lhp-c3" d={C3} stroke="rgba(26,31,46,0.15)" strokeWidth={1.5} strokeDasharray="6 4" />
        <path className="lhp-a lhp-c4" d={C4} stroke="rgba(26,31,46,0.15)" strokeWidth={1.5} strokeDasharray="6 4" />

        {/* ═══ Travelling dots (SMIL — only reliable way to follow SVG paths) ═══ */}
        {[
          { path: C1, oKt: "0;0.124;0.125;0.166;0.167;1", mKt: "0;0.125;0.167;1" },
          { path: C2, oKt: "0;0.332;0.333;0.374;0.375;1", mKt: "0;0.333;0.375;1" },
          { path: C3, oKt: "0;0.541;0.542;0.582;0.583;1", mKt: "0;0.542;0.583;1" },
          { path: C4, oKt: "0;0.749;0.75;0.791;0.792;1",  mKt: "0;0.75;0.792;1" },
        ].map((dot, i) => (
          <circle key={i} className="lhp-dot" r={3.5} fill="#4A6B4D" opacity={0}>
            <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes={dot.oKt} dur="12s" repeatCount="indefinite" />
            <animateMotion dur="12s" repeatCount="indefinite" calcMode="linear" path={dot.path} {...{ keyTimes: dot.mKt, keyPoints: "0;0;1;1" }} />
          </circle>
        ))}

        {/* ═══ NODE 1 — TEXT BRIEF ═══ */}
        <g className="lhp-a lhp-n1">
          <text x={75} y={40} textAnchor="middle" fontSize={9} fontWeight={500} letterSpacing="0.12em" fill="#5A6478" fontFamily="var(--font-jetbrains), monospace">BRIEF</text>
          <rect x={10} y={48} width={130} height={84} rx={8} fill="#FAFAF7" stroke="rgba(26,31,46,0.12)" strokeWidth={1} filter="url(#cs)" />
          {/* AI sparkle glyph — 4-point star */}
          <path className="lhp-a lhp-d1" d="M28,67 L30,63 L32,67 L36,69 L32,71 L30,75 L28,71 L24,69 Z" fill="#4A6B4D" fillOpacity={0.55} />
          <line className="lhp-ld lhp-a lhp-d1" x1={26} y1={80} x2={124} y2={80} stroke="#1A1F2E" strokeWidth={1.2} strokeLinecap="round" />
          <line className="lhp-ld lhp-a lhp-d1" x1={26} y1={94} x2={98}  y2={94} stroke="#1A1F2E" strokeWidth={1.2} strokeLinecap="round" />
          <line className="lhp-ld lhp-a lhp-d1" x1={26} y1={108} x2={70} y2={108} stroke="#1A1F2E" strokeWidth={1.2} strokeLinecap="round" />
        </g>

        {/* ═══ NODE 2 — FLOOR PLAN ═══ */}
        <g className="lhp-a lhp-n2">
          <text x={251} y={40} textAnchor="middle" fontSize={9} fontWeight={500} letterSpacing="0.12em" fill="#5A6478" fontFamily="var(--font-jetbrains), monospace">FLOOR PLAN</text>
          <rect x={186} y={48} width={130} height={84} rx={8} fill="#FAFAF7" stroke="rgba(26,31,46,0.12)" strokeWidth={1} filter="url(#cs)" />
          {/* Outer boundary (4 edges) */}
          <line className="lhp-ld lhp-a lhp-d2" x1={200} y1={62}  x2={302} y2={62}  stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d2" x1={302} y1={62}  x2={302} y2={118} stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d2" x1={302} y1={118} x2={200} y2={118} stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d2" x1={200} y1={118} x2={200} y2={62}  stroke="#1A1F2E" strokeWidth={1} />
          {/* Internal walls */}
          <line className="lhp-ld lhp-a lhp-d2" x1={200} y1={88}  x2={264} y2={88}  stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d2" x1={264} y1={62}  x2={264} y2={118} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d2" x1={264} y1={100} x2={302} y2={100} stroke="#1A1F2E" strokeWidth={0.6} />
          {/* Door arc */}
          <path className="lhp-ld lhp-a lhp-d2" d="M248,88 A7,7 0 0,1 248,81" stroke="#1A1F2E" strokeWidth={0.6} />
        </g>

        {/* ═══ NODE 3 — IFC WIREFRAME ═══ */}
        <g className="lhp-a lhp-n3">
          <text x={427} y={40} textAnchor="middle" fontSize={9} fontWeight={500} letterSpacing="0.12em" fill="#5A6478" fontFamily="var(--font-jetbrains), monospace">IFC</text>
          <rect x={362} y={48} width={130} height={84} rx={8} fill="#FAFAF7" stroke="rgba(26,31,46,0.12)" strokeWidth={1} filter="url(#cs)" />
          {/* Front face */}
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Ax} y1={n3.Ay} x2={n3.Bx} y2={n3.By} stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Bx} y1={n3.By} x2={n3.Cx} y2={n3.Cy} stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Cx} y1={n3.Cy} x2={n3.Dx} y2={n3.Dy} stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Dx} y1={n3.Dy} x2={n3.Ax} y2={n3.Ay} stroke="#1A1F2E" strokeWidth={1} />
          {/* Right face */}
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Bx} y1={n3.By} x2={n3.Fx} y2={n3.Fy} stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Fx} y1={n3.Fy} x2={n3.Gx} y2={n3.Gy} stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Gx} y1={n3.Gy} x2={n3.Cx} y2={n3.Cy} stroke="#1A1F2E" strokeWidth={1} />
          {/* Top face */}
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Ax} y1={n3.Ay} x2={n3.Ex} y2={n3.Ey} stroke="#1A1F2E" strokeWidth={1} />
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Ex} y1={n3.Ey} x2={n3.Fx} y2={n3.Fy} stroke="#1A1F2E" strokeWidth={1} />
          {/* Hidden edges */}
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Ex} y1={n3.Ey} x2={n3.Hx} y2={n3.Hy} stroke="#1A1F2E" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Hx} y1={n3.Hy} x2={n3.Dx} y2={n3.Dy} stroke="#1A1F2E" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />
          <line className="lhp-ld lhp-a lhp-d3" x1={n3.Hx} y1={n3.Hy} x2={n3.Gx} y2={n3.Gy} stroke="#1A1F2E" strokeWidth={0.5} strokeDasharray="3 3" opacity={0.4} />
        </g>

        {/* ═══ NODE 4 — 3D MODEL (wireframe + sage fills) ═══ */}
        <g className="lhp-a lhp-n4">
          <text x={603} y={40} textAnchor="middle" fontSize={9} fontWeight={500} letterSpacing="0.12em" fill="#5A6478" fontFamily="var(--font-jetbrains), monospace">3D MODEL</text>
          <rect x={538} y={48} width={130} height={84} rx={8} fill="#FAFAF7" stroke="rgba(26,31,46,0.12)" strokeWidth={1} filter="url(#cs)" />
          {/* Filled surfaces — rendered BEFORE wireframe so edges stay on top */}
          <polygon className="lhp-a lhp-sf-front" points={`${n4.Dx},${n4.Dy} ${n4.Ax},${n4.Ay} ${n4.Bx},${n4.By} ${n4.Cx},${n4.Cy}`} fill="#4A6B4D" fillOpacity={0} />
          <polygon className="lhp-a lhp-sf-right" points={`${n4.Bx},${n4.By} ${n4.Fx},${n4.Fy} ${n4.Gx},${n4.Gy} ${n4.Cx},${n4.Cy}`} fill="#4A6B4D" fillOpacity={0} />
          <polygon className="lhp-a lhp-sf-top" points={`${n4.Ax},${n4.Ay} ${n4.Ex},${n4.Ey} ${n4.Fx},${n4.Fy} ${n4.Bx},${n4.By}`} fill="#4A6B4D" fillOpacity={0} />
          {/* Wireframe edges */}
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Ax} y1={n4.Ay} x2={n4.Bx} y2={n4.By} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Bx} y1={n4.By} x2={n4.Cx} y2={n4.Cy} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Cx} y1={n4.Cy} x2={n4.Dx} y2={n4.Dy} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Dx} y1={n4.Dy} x2={n4.Ax} y2={n4.Ay} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Bx} y1={n4.By} x2={n4.Fx} y2={n4.Fy} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Fx} y1={n4.Fy} x2={n4.Gx} y2={n4.Gy} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Gx} y1={n4.Gy} x2={n4.Cx} y2={n4.Cy} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Ax} y1={n4.Ay} x2={n4.Ex} y2={n4.Ey} stroke="#1A1F2E" strokeWidth={0.8} />
          <line className="lhp-ld lhp-a lhp-d4" x1={n4.Ex} y1={n4.Ey} x2={n4.Fx} y2={n4.Fy} stroke="#1A1F2E" strokeWidth={0.8} />
        </g>

        {/* ═══ NODE 5 — BOQ TABLE ═══ */}
        <g className="lhp-a lhp-n5">
          <text x={779} y={40} textAnchor="middle" fontSize={9} fontWeight={500} letterSpacing="0.12em" fill="#5A6478" fontFamily="var(--font-jetbrains), monospace">BOQ</text>
          <rect x={714} y={48} width={130} height={84} rx={8} fill="#FAFAF7" stroke="rgba(26,31,46,0.12)" strokeWidth={1} filter="url(#cs)" />
          {/* Highlight bar (last row) */}
          <rect className="lhp-a lhp-hl" x={720} y={108} width={118} height={14} rx={3} fill="#4A6B4D" fillOpacity={0.1} />
          {/* Table rows: left label bar + right value bar + divider */}
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} className={`lhp-a lhp-r${i + 1}`}>
              <rect x={726} y={62 + i * 13} width={28 + (4 - i) * 3} height={3.5} rx={1.5} fill="#1A1F2E" opacity={i === 4 ? 0.5 : 0.2} />
              <rect x={790} y={62 + i * 13} width={16 + i * 3} height={3.5} rx={1.5} fill="#1A1F2E" opacity={i === 4 ? 0.6 : 0.35} />
              {i < 4 && <line x1={726} y1={71 + i * 13} x2={832} y2={71 + i * 13} stroke="rgba(26,31,46,0.06)" strokeWidth={0.5} />}
            </g>
          ))}
        </g>
      </svg>

      <style>{`
        @media (max-width: 768px) {
          .lhp-wrap { display: none !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lhp-a { animation: none !important; }
          .lhp-ld { stroke-dashoffset: 0 !important; }
          .lhp-sf-top { fill-opacity: 0.18 !important; }
          .lhp-sf-front { fill-opacity: 0.12 !important; }
          .lhp-sf-right { fill-opacity: 0.07 !important; }
          .lhp-dot { display: none; }
          .lhp-n1,.lhp-n2,.lhp-n3,.lhp-n4,.lhp-n5,
          .lhp-c1,.lhp-c2,.lhp-c3,.lhp-c4,
          .lhp-r1,.lhp-r2,.lhp-r3,.lhp-r4,.lhp-r5,.lhp-hl { opacity: 1 !important; }
        }
      `}</style>
    </div>
  );
}
