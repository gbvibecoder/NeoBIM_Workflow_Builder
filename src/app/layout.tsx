import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono, Syne } from "next/font/google";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { MobileGate } from "@/components/MobileGate";
import { SessionProvider } from "@/components/providers/SessionProvider";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

// 🔍 SEO OPTIMIZATION - Maximum Discoverability
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://buildflow.vercel.app";
const siteName = "BuildFlow";
const siteDescription = "Build AI-powered AEC workflows visually. Drag-and-drop nodes to create pipelines from PDF briefs to 3D massing to concept renders — without writing code. Beta platform.";
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
          // Add your social media profiles here
          // "https://twitter.com/buildflow",
          // "https://linkedin.com/company/buildflow",
          // "https://github.com/buildflow",
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
      </head>
      <body className={`${dmSans.variable} ${jetbrains.variable} ${syne.variable} font-body antialiased`} style={{ background: "#06080C", color: "#F0F4FF" }}>
        <SessionProvider>
          <MobileGate>{children}</MobileGate>
        </SessionProvider>
        <Toaster
          position="bottom-right"
          theme="dark"
          duration={4000}
          toastOptions={{
            style: {
              background: "#12121E",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              color: "#F0F0F5",
              fontSize: "12.5px",
              fontFamily: "var(--font-inter), sans-serif",
              borderRadius: "12px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.35), 0 4px 16px rgba(0,0,0,0.25)",
              padding: "12px 14px",
              gap: "10px",
            },
          }}
        />
        {/* 🔥 VERCEL ANALYTICS */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
