import type { Metadata, Viewport } from "next";
import { Instrument_Serif, DM_Sans, JetBrains_Mono } from "next/font/google";
import { LightCookieConsent } from "@/features/landing/components/light/LightCookieConsent";

import "./globals-light.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
  preload: true,
  weight: ["400"],
  style: ["normal", "italic"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  weight: ["400", "500", "600"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "500"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL || "https://trybuildflow.in";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "BuildFlow — AI Concept Design for Architects",
  description:
    "Automate BIM workflows for architects. Generate floor plans, 3D massing, IFC models, and BOQ from a project brief in minutes. Free tier, no coding.",
  formatDetection: { telephone: false },
  referrer: "origin-when-cross-origin",
  keywords: [
    "AI architecture tool",
    "concept design automation",
    "BIM workflow builder",
    "architect AI",
    "building design AI",
    "3D massing",
    "concept renders",
  ],
  alternates: {
    canonical: "/light",
    languages: {
      "en-US": "/light",
      "de-DE": "/light",
      "x-default": "/light",
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${siteUrl}/light`,
    siteName: "BuildFlow",
    title: "BuildFlow — AI Concept Design for Architects",
    description:
      "From brief to building in one workflow. AI-powered concept design for AEC professionals.",
    // TODO: Replace og-image-light.png with a dedicated light-theme OG image.
    // Currently a copy of og-image.png — design team should produce a light variant.
    images: [
      {
        url: `${siteUrl}/og-image-light.png`,
        width: 1200,
        height: 630,
        alt: "BuildFlow — Automate BIM workflows. Brief to building in minutes.",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@buildflow",
    creator: "@buildflow",
    title: "BuildFlow — AI Concept Design for Architects",
    description:
      "From brief to building in one workflow. AI-powered concept design for AEC professionals.",
    images: [`${siteUrl}/og-image-light.png`],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#FAFAF7",
  colorScheme: "light",
};

// JSON-LD schemas — duplicated from root layout (Google deduplicates)
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "BuildFlow",
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/buildflow_logo.png`,
        width: 512,
        height: 512,
      },
      description:
        "AI-powered concept design tool for architects. Turn project briefs into 3D massing, renders, and cost estimates in minutes.",
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "BuildFlow",
      description:
        "AI-powered concept design tool for architects.",
    },
    {
      "@type": "SoftwareApplication",
      name: "BuildFlow",
      applicationCategory: "DesignApplication",
      operatingSystem: "Web Browser",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "INR",
        description: "Free tier available",
      },
    },
  ],
};

export default function LightLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className={`light-theme ${instrumentSerif.variable} ${dmSans.variable} ${jetbrains.variable}`}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <a
        href="#main-content"
        className="light-sr-only"
      >
        Skip to main content
      </a>
      {children}
      <LightCookieConsent />
    </div>
  );
}
