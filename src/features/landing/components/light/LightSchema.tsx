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
    serviceType: "AI-powered architectural design automation: floor plan generation, IFC viewer, concept rendering, 3D walkthrough video, BOQ estimation",
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
  // ── Product Reviews schema ─────────────────────────────────────────────
  {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "BuildFlow",
    review: [
      {
        "@type": "Review",
        author: {
          "@type": "Person",
          name: "Rekha Gupta",
          jobTitle: "Senior Architect",
          address: {
            "@type": "PostalAddress",
            addressLocality: "Pune",
            addressCountry: "IN",
          },
        },
        reviewBody:
          "Earlier my team would spend 2\u20133 days preparing BOQ from drawings. With BuildFlow we upload the IFC and have itemized quantities with INR costs in minutes. Every project this saves us a full work-week.",
        reviewRating: {
          "@type": "Rating",
          ratingValue: "5",
          bestRating: "5",
        },
      },
      {
        "@type": "Review",
        author: {
          "@type": "Person",
          name: "Shailesh Kumar",
          jobTitle: "Principal Architect",
          address: {
            "@type": "PostalAddress",
            addressLocality: "Mumbai",
            addressCountry: "IN",
          },
        },
        reviewBody:
          "The 3D rendering and video walkthrough quality is genuinely client-presentation ready. We used to outsource visualizations \u2014 now we generate them in-house from the same brief in 90 seconds.",
        reviewRating: {
          "@type": "Rating",
          ratingValue: "5",
          bestRating: "5",
        },
      },
      {
        "@type": "Review",
        author: {
          "@type": "Person",
          name: "Raj Mohite",
          jobTitle: "Founder, Studio M & Associates",
          address: {
            "@type": "PostalAddress",
            addressLocality: "Nashik",
            addressCountry: "IN",
          },
        },
        reviewBody:
          "Drop a project PDF, get back floor plans, 3D massing and renders. Honestly the first AEC tool that actually does what it promises \u2014 start to finish, no jumping between five different software.",
        reviewRating: {
          "@type": "Rating",
          ratingValue: "5",
          bestRating: "5",
        },
      },
    ],
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
