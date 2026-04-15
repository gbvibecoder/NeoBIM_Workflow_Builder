import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { DM_Sans, DM_Serif_Display, JetBrains_Mono } from "next/font/google";

import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { MobileGate } from "@/shared/components/MobileGate";
import { SessionProvider } from "@/shared/components/providers/SessionProvider";
import { TrackingScripts } from "@/shared/components/TrackingScripts";
import { CookieConsent } from "@/shared/components/CookieConsent";
import { UTMCapture } from "@/shared/components/UTMCapture";
import "./globals.css";
import "@/lib/env-check";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  variable: "--font-dm-serif",
  display: "swap",
  weight: ["400"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});


// 🔍 SEO OPTIMIZATION - Maximum Discoverability
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://buildflow.vercel.app";
const siteName = "BuildFlow";
const siteDescription = "BuildFlow — AI-powered concept design tool for architects. Turn project briefs into 3D massing, renders, and cost estimates in minutes. A complement to Revit and Rhino for schematic design phase.";
const siteKeywords = [
  // Primary keywords
  "AEC workflow builder",
  "AI architecture tool",
  // Secondary keywords
  "BIM automation",
  "building design AI",
  "architecture workflow automation",
  // Long-tail keywords
  "PDF to 3D building",
  "architecture concept renders",
  "no-code BIM tool",
  "AI-powered architecture",
  "generative design tool",
  "AEC automation platform",
  // Related terms
  "architectural design automation",
  "building information modeling AI",
  "construction workflow builder",
  "AEC visualization tool",
  "parametric design platform",
];

export const metadata: Metadata = {
  // Basic Meta
  title: {
    default: "BuildFlow — AI-Powered Workflows for AEC",
    template: "%s | BuildFlow",
  },
  description: siteDescription,
  keywords: siteKeywords,
  
  // Authors & Creator
  authors: [{ name: "BuildFlow Team" }],
  creator: "BuildFlow",
  publisher: "BuildFlow",
  
  // Canonical & Alternates
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
    languages: {
      "en": "/",
      "de": "/",
    },
  },
  
  // Robots
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  
  // Open Graph (Facebook, LinkedIn)
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName,
    title: "BuildFlow — AI-Powered Workflows for AEC",
    description: "Transform AEC workflows with AI. Build visual pipelines from PDF briefs to 3D models to renders in minutes, not weeks. No coding required.",
    images: [
      {
        url: `${siteUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "BuildFlow - AI Workflows for Architecture, Engineering & Construction",
        type: "image/png",
      },
    ],
  },
  
  // Twitter Card
  twitter: {
    card: "summary_large_image",
    site: "@buildflow",
    creator: "@buildflow",
    title: "BuildFlow — AI Workflows for AEC",
    description: "Transform AEC workflows with AI. Build visual pipelines from PDF briefs to 3D models to renders — no code required.",
    images: [`${siteUrl}/twitter-card.png`],
  },
  
  // Additional Meta
  category: "Technology",
  applicationName: siteName,
  referrer: "origin-when-cross-origin",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  
  // Icons
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  
  // Manifest
  manifest: "/site.webmanifest",
};

// 📱 CRITICAL: Viewport configuration for mobile responsiveness
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: "#07070D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 🔍 JSON-LD Structured Data for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      // Organization Schema
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: siteName,
        url: siteUrl,
        logo: {
          "@type": "ImageObject",
          url: `${siteUrl}/buildflow_logo.png`,
          width: 512,
          height: 512,
        },
        description: siteDescription,
        sameAs: [
          "https://www.instagram.com/buildflow_live/",
          "https://www.linkedin.com/in/buildflow/",
        ],
      },
      // WebSite Schema
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: siteName,
        description: siteDescription,
        publisher: {
          "@id": `${siteUrl}/#organization`,
        },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${siteUrl}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      // WebApplication Schema
      {
        "@type": "SoftwareApplication",
        name: siteName,
        applicationCategory: "DesignApplication",
        operatingSystem: "Web Browser",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: "Free tier available",
        },
        description: siteDescription,
        screenshot: `${siteUrl}/screenshots/dashboard.png`,
        featureList: [
          "Visual workflow builder",
          "AI-powered automation",
          "PDF to 3D conversion",
          "Concept rendering",
          "BIM integration",
          "No-code platform",
        ],
      },
      // BreadcrumbList Schema (for navigation)
      {
        "@type": "BreadcrumbList",
        "@id": `${siteUrl}/#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: siteUrl,
          },
        ],
      },
    ],
  };

  return (
    <html lang="en" className="dark">
      <head>
        {/* 🔍 JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Google Consent Mode v2 — defaults to denied BEFORE any tags load.
            When user accepts cookies, cookie-consent.ts pushes a consent update.
            Uses next/script instead of raw <script> so React 19 doesn't try to
            hoist it during reconciliation (which crashes sibling client refs). */}
        <Script id="consent-mode-default" strategy="beforeInteractive">
          {`
            window.dataLayer=window.dataLayer||[];
            function gtag(){dataLayer.push(arguments);}
            gtag('consent','default',{
              'analytics_storage':'denied',
              'ad_storage':'denied',
              'ad_user_data':'denied',
              'ad_personalization':'denied',
              'wait_for_update':500
            });
          `}
        </Script>
        {/* Tracking scripts (GTM + Meta Pixel + GA4 + Clarity) — loaded only after cookie consent */}
        <TrackingScripts />
      </head>
      <body className={`${dmSans.variable} ${dmSerif.variable} ${jetbrains.variable} font-body antialiased`} style={{ background: "#06080C", color: "#F0F4FF" }}>
        {/* Google Tag Manager (noscript) — fallback for users without JS */}
        {process.env.NEXT_PUBLIC_GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${process.env.NEXT_PUBLIC_GTM_ID}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        )}
        {/* Skip-to-content link for keyboard/screen reader accessibility (#39) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[99999] focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
          style={{ background: "#00F5FF", color: "#07070D" }}
        >
          Skip to main content
        </a>
        <SessionProvider>
          <div id="main-content">
            <MobileGate>{children}</MobileGate>
          </div>
        </SessionProvider>
        <Toaster
          position="bottom-right"
          theme="dark"
          duration={4000}
          closeButton
          visibleToasts={3}
          gap={12}
          offset={20}
          toastOptions={{
            style: {
              color: "#F0F0F5",
              fontSize: "13px",
              fontFamily: "var(--font-dm-sans), sans-serif",
              borderRadius: "14px",
              padding: "14px 16px",
              gap: "12px",
            },
          }}
        />
        {/* 🔥 VERCEL ANALYTICS */}
        <Analytics />
        <SpeedInsights />
        <UTMCapture />
        <CookieConsent />
      </body>
    </html>
  );
}
