import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PREBUILT_WORKFLOWS } from "@/features/workflows/constants/prebuilt-workflows";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://trybuildflow.in";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[→+]/g, "to")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function findTemplateBySlug(slug: string) {
  return PREBUILT_WORKFLOWS.find((w) => slugify(w.name) === slug);
}

export async function generateStaticParams() {
  return PREBUILT_WORKFLOWS.map((w) => ({
    slug: slugify(w.name),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const template = findTemplateBySlug(slug);
  if (!template) return { title: "Template Not Found" };

  const title = `${template.name} — Free BIM Workflow Template`;
  const description = `${template.description} Try this ${template.complexity} ${template.category.toLowerCase()} workflow template for free on BuildFlow.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${siteUrl}/templates/${slug}`,
      type: "article",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const template = findTemplateBySlug(slug);
  if (!template) notFound();

  const nodeCount = template.tileGraph.nodes.length;
  const edgeCount = template.tileGraph.edges.length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `BuildFlow — ${template.name}`,
    applicationCategory: "DesignApplication",
    description: template.description,
    operatingSystem: "Web Browser",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "INR",
      description: "Free to use",
    },
  };

  return (
    <div style={{ minHeight: "100vh", background: "#07070D", color: "#F0F0F5" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "80px 24px 60px" }}>
        {/* Breadcrumb */}
        <nav style={{ fontSize: 13, color: "#5C5C78", marginBottom: 32, display: "flex", gap: 8 }}>
          <Link href="/" style={{ color: "#5C5C78", textDecoration: "none" }}>Home</Link>
          <span>/</span>
          <Link href="/templates" style={{ color: "#5C5C78", textDecoration: "none" }}>Templates</Link>
          <span>/</span>
          <span style={{ color: "#9898B0" }}>{template.name}</span>
        </nav>

        {/* Category + Complexity */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "1.5px", color: "#4F8AFF", fontFamily: "monospace",
          }}>
            {template.category}
          </span>
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 6,
            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)",
            color: "#10B981", textTransform: "capitalize",
          }}>
            {template.complexity}
          </span>
          {template.estimatedRunTime && (
            <span style={{ fontSize: 11, color: "#5C5C78" }}>
              {template.estimatedRunTime}
            </span>
          )}
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: "clamp(1.8rem, 3.5vw, 2.5rem)",
          fontWeight: 900, letterSpacing: "-0.03em",
          lineHeight: 1.15, marginBottom: 16,
        }}>
          {template.name}
        </h1>

        {/* Description */}
        <p style={{ fontSize: 16, color: "#9898B0", lineHeight: 1.7, marginBottom: 32 }}>
          {template.description}
        </p>

        {/* CTA */}
        <div style={{ display: "flex", gap: 12, marginBottom: 40, flexWrap: "wrap" }}>
          <Link
            href="/register"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "14px 28px", borderRadius: 12,
              background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              color: "white", fontSize: 15, fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 4px 20px rgba(79,138,255,0.3)",
            }}
          >
            Use This Template Free →
          </Link>
          <Link
            href="/demo"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "14px 24px", borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
              color: "#9898B0", fontSize: 14, fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Try Demo First
          </Link>
        </div>

        {/* Details */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          gap: 16, marginBottom: 40,
        }}>
          {/* Pipeline Info */}
          <div style={{
            padding: "20px", borderRadius: 12,
            background: "#12121E", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: "#5C5C78", marginBottom: 12, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>
              Pipeline
            </h3>
            <div style={{ fontSize: 13, color: "#9898B0", lineHeight: 1.8 }}>
              <div>{nodeCount} nodes · {edgeCount} connections</div>
              <div>Complexity: {template.complexity}</div>
              <div>Run time: {template.estimatedRunTime}</div>
            </div>
          </div>

          {/* Tags */}
          <div style={{
            padding: "20px", borderRadius: 12,
            background: "#12121E", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: "#5C5C78", marginBottom: 12, textTransform: "uppercase", letterSpacing: "1.5px", fontFamily: "monospace" }}>
              Tags
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {template.tags.map((tag) => (
                <span key={tag} style={{
                  fontSize: 11, padding: "3px 10px", borderRadius: 6,
                  background: "rgba(79,138,255,0.06)", border: "1px solid rgba(79,138,255,0.12)",
                  color: "#7C7C96",
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Inputs & Outputs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 40 }}>
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F5", marginBottom: 10 }}>
              Required Inputs
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {template.requiredInputs.map((input) => (
                <li key={input} style={{ fontSize: 13, color: "#9898B0", marginBottom: 6, display: "flex", gap: 8 }}>
                  <span style={{ color: "#4F8AFF" }}>→</span> {input}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#F0F0F5", marginBottom: 10 }}>
              Expected Outputs
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {template.expectedOutputs.map((output) => (
                <li key={output} style={{ fontSize: 13, color: "#9898B0", marginBottom: 6, display: "flex", gap: 8 }}>
                  <span style={{ color: "#10B981" }}>←</span> {output}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom CTA */}
        <div style={{
          textAlign: "center", padding: "32px 24px",
          borderRadius: 14, background: "rgba(79,138,255,0.04)",
          border: "1px solid rgba(79,138,255,0.1)",
        }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            Ready to try this workflow?
          </h3>
          <p style={{ fontSize: 14, color: "#7C7C96", marginBottom: 16 }}>
            Sign up free and run this template in under 60 seconds.
          </p>
          <Link
            href="/register"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "12px 24px", borderRadius: 10,
              background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              color: "white", fontSize: 14, fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Sign Up Free →
          </Link>
        </div>
      </div>
    </div>
  );
}
