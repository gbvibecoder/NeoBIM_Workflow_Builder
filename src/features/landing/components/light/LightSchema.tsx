/**
 * Additional JSON-LD structured data for /light.
 * Emits Product, WebPage, and BreadcrumbList schemas.
 * Server component — renders only invisible <script> tags.
 */

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://trybuildflow.in";

const schemas = [
  // ── Product schema ──────────────────────────────────────────────────────
  {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "BuildFlow",
    description:
      "AI-powered no-code workflow builder for architects and AEC teams. Generate floor plans, 3D massing, IFC models, and BOQ from a project brief.",
    brand: { "@type": "Brand", name: "BuildFlow" },
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "INR",
      },
      {
        "@type": "Offer",
        name: "Mini",
        price: "99",
        priceCurrency: "INR",
      },
      {
        "@type": "Offer",
        name: "Starter",
        price: "799",
        priceCurrency: "INR",
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: "1999",
        priceCurrency: "INR",
      },
      {
        "@type": "Offer",
        name: "Team",
        price: "4999",
        priceCurrency: "INR",
      },
    ],
  },
  // ── WebPage schema ──────────────────────────────────────────────────────
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "BuildFlow — AI Concept Design for Architects",
    url: `${siteUrl}/light`,
    description: "Automate BIM workflows. Brief to building in minutes.",
    isPartOf: { "@type": "WebSite", name: "BuildFlow" },
    // TODO: Replace with /og-image-light.png once a dedicated light OG image is designed
    primaryImageOfPage: `${siteUrl}/og-image-light.png`,
  },
  // ── BreadcrumbList schema ───────────────────────────────────────────────
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${siteUrl}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "BIM Automation",
        item: `${siteUrl}/light`,
      },
    ],
  },
  // ── Service schema ─────────────────────────────────────────────────────
  {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "BuildFlow — AI Concept Design",
    serviceType: "AI-powered architectural design automation",
    provider: {
      "@type": "Organization",
      name: "BuildFlow",
      url: siteUrl,
    },
    areaServed: {
      "@type": "Country",
      name: "India",
    },
    audience: {
      "@type": "Audience",
      audienceType: "Architects, AEC professionals, BIM managers",
    },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "BuildFlow Plans",
      itemListElement: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "INR" },
        { "@type": "Offer", name: "Mini", price: "99", priceCurrency: "INR" },
        {
          "@type": "Offer",
          name: "Starter",
          price: "799",
          priceCurrency: "INR",
        },
        {
          "@type": "Offer",
          name: "Pro",
          price: "1999",
          priceCurrency: "INR",
        },
        {
          "@type": "Offer",
          name: "Team",
          price: "4999",
          priceCurrency: "INR",
        },
      ],
    },
    description:
      "Automate BIM workflows for architects. Generate floor plans, 3D massing, IFC models, and BOQ from a project brief in minutes — no coding required.",
  },
];

export function LightSchema() {
  return (
    <>
      {schemas.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}
