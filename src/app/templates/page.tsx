"use client";

import Link from "next/link";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[→+]/g, "to")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const COMPLEXITY_COLORS: Record<string, string> = {
  simple: "#10B981",
  intermediate: "#F59E0B",
  advanced: "#EF4444",
};

export default function TemplatesPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#07070D",
        color: "#F0F0F5",
        padding: "80px 24px 60px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <Link
            href="/"
            style={{
              fontSize: 14,
              color: "#5C5C78",
              textDecoration: "none",
              marginBottom: 16,
              display: "inline-block",
            }}
          >
            ← Back to BuildFlow
          </Link>
          <h1
            style={{
              fontSize: "clamp(2rem, 4vw, 3rem)",
              fontWeight: 900,
              letterSpacing: "-0.04em",
              lineHeight: 1.1,
              marginBottom: 12,
            }}
          >
            BIM Workflow{" "}
            <span
              style={{
                background:
                  "linear-gradient(135deg, #4F8AFF, #A78BFA)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Templates
            </span>
          </h1>
          <p
            style={{
              fontSize: 16,
              color: "#7C7C96",
              maxWidth: 520,
              margin: "0 auto",
            }}
          >
            Free automation templates for architects and engineers. Pick one, hit Run, and see results in seconds.
          </p>
        </div>

        {/* Template Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320, 1fr))",
            gap: 20,
          }}
        >
          {PREBUILT_WORKFLOWS.map((t) => {
            const slug = slugify(t.name);
            const nodeCount = t.tileGraph.nodes.length;
            const cColor =
              COMPLEXITY_COLORS[t.complexity] || "#5C5C78";

            return (
              <Link
                key={t.id}
                href={`/templates/${slug}`}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  borderRadius: 14,
                  background: "#12121E",
                  border: "1px solid rgba(255,255,255,0.06)",
                  overflow: "hidden",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                  display: "flex",
                  flexDirection: "column",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "rgba(79,138,255,0.2)";
                  (e.currentTarget as HTMLElement).style.boxShadow =
                    "0 8px 32px rgba(79,138,255,0.06)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "rgba(255,255,255,0.06)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
              >
                {/* Header */}
                <div
                  style={{
                    padding: "14px 18px 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "1.5px",
                      color: "#4F8AFF",
                      fontFamily: "monospace",
                    }}
                  >
                    {t.category}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: `${cColor}15`,
                      border: `1px solid ${cColor}30`,
                      color: cColor,
                      textTransform: "capitalize",
                    }}
                  >
                    {t.complexity}
                  </span>
                </div>

                {/* Body */}
                <div style={{ padding: "14px 18px 18px", flex: 1 }}>
                  <h2
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      marginBottom: 6,
                      lineHeight: 1.3,
                    }}
                  >
                    {t.name}
                  </h2>
                  <p
                    style={{
                      fontSize: 13,
                      color: "#7C7C96",
                      lineHeight: 1.6,
                      marginBottom: 14,
                    }}
                  >
                    {t.description}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      fontSize: 11,
                      color: "#5C5C78",
                    }}
                  >
                    <span>{nodeCount} nodes</span>
                    <span>·</span>
                    <span>{t.estimatedRunTime}</span>
                  </div>
                </div>

                {/* CTA */}
                <div
                  style={{
                    padding: "12px 18px",
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#4F8AFF",
                  }}
                >
                  Use Template Free →
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
