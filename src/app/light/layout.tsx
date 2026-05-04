import type { Metadata, Viewport } from "next";
import { Instrument_Serif, DM_Sans, JetBrains_Mono } from "next/font/google";

import "./globals-light.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
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
  process.env.NEXT_PUBLIC_APP_URL || "https://buildflow.vercel.app";

export const metadata: Metadata = {
  title: "BuildFlow — AI Concept Design for Architects",
  description:
    "Upload a project brief. Get 3D massing, concept renders, and cost estimates in minutes. AI-powered workflows for architects and AEC teams.",
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
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: `${siteUrl}/light`,
    siteName: "BuildFlow",
    title: "BuildFlow — AI Concept Design for Architects",
    description:
      "From brief to building in one workflow. AI-powered concept design for AEC professionals.",
    images: [
      {
        url: `${siteUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "BuildFlow — AI Concept Design for Architects",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BuildFlow — AI Concept Design for Architects",
    description:
      "From brief to building in one workflow. AI-powered concept design for AEC professionals.",
    images: [`${siteUrl}/og-image.png`],
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
    </div>
  );
}
