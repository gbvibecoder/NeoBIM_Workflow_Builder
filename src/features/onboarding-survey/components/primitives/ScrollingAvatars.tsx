"use client";

import { useLocale } from "@/hooks/useLocale";

// Curated set lifted from landing page's COMMUNITY_WORKFLOWS — real people,
// real firms. Names fake-but-plausible matches the landing tone.
const BUILDERS = [
  { initials: "SM", name: "Sarah M.", firm: "Arup",                     color: "#3B82F6" },
  { initials: "JT", name: "James T.", firm: "Mace Group",               color: "#8B5CF6" },
  { initials: "PK", name: "Priya K.", firm: "Foster + Partners",        color: "#10B981" },
  { initials: "MW", name: "Marcus W.", firm: "Turner & Townsend",       color: "#F59E0B" },
  { initials: "LH", name: "Lena H.",  firm: "Schüco",                   color: "#EF4444" },
  { initials: "DC", name: "David C.", firm: "Laing O'Rourke",           color: "#06B6D4" },
  { initials: "AO", name: "Amara O.", firm: "BDP",                      color: "#22C55E" },
  { initials: "TR", name: "Tom R.",   firm: "Multiplex",                color: "#A855F7" },
  { initials: "NS", name: "Nina S.",  firm: "Zaha Hadid Architects",    color: "#EC4899" },
  { initials: "GL", name: "George L.",firm: "Gleeds",                   color: "#14B8A6" },
  { initials: "RK", name: "Rachel K.",firm: "Balfour Beatty",           color: "#F97316" },
  { initials: "AB", name: "Ahmed B.", firm: "WSP",                      color: "#0EA5E9" },
];

function hexToRgb(hex: string): string {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return "79, 138, 255";
  return `${parseInt(r[1], 16)}, ${parseInt(r[2], 16)}, ${parseInt(r[3], 16)}`;
}

export function ScrollingAvatars() {
  const { t } = useLocale();
  // Duplicate the list so the marquee can loop seamlessly.
  const row = [...BUILDERS, ...BUILDERS];

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 900,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      <p
        style={{
          fontSize: 12,
          color: "var(--text-tertiary)",
          letterSpacing: "0.05em",
        }}
      >
        {t("survey.scene4.socialProof")}
      </p>
      <div
        style={{
          position: "relative",
          width: "100%",
          overflow: "hidden",
          maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
        }}
      >
        <div
          className="survey-avatar-marquee"
          style={{
            display: "flex",
            gap: 12,
            animation: "survey-marquee 40s linear infinite",
            width: "max-content",
          }}
        >
          {row.map((b, i) => {
            const rgb = hexToRgb(b.color);
            return (
              <div
                key={`${b.initials}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 14px 7px 7px",
                  borderRadius: 999,
                  background: "rgba(18,18,30,0.55)",
                  border: `1px solid rgba(${rgb},0.2)`,
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: `linear-gradient(135deg, rgba(${rgb},0.8), rgba(${rgb},0.4))`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    boxShadow: `0 0 10px rgba(${rgb},0.3)`,
                  }}
                >
                  {b.initials}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-primary)" }}>{b.name}</span>
                  <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-jetbrains), monospace" }}>{b.firm}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <style>{`
        @keyframes survey-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .survey-avatar-marquee { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
