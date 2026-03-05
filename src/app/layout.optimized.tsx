import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import dynamic from "next/dynamic";
import { MobileGate } from "@/components/MobileGate";
import { SessionProvider } from "@/components/providers/SessionProvider";
import "./globals.css";

// ─── Font Optimization: Load only needed weights + subsets ────────
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"], // Only needed weights
  preload: true,
});

// ─── Lazy Load Analytics (not critical for initial render) ────────
const Analytics = dynamic(
  () => import("@vercel/analytics/react").then((m) => ({ default: m.Analytics })),
  { ssr: false }
);

const SpeedInsights = dynamic(
  () => import("@vercel/speed-insights/next").then((m) => ({ default: m.SpeedInsights })),
  { ssr: false }
);

export const metadata: Metadata = {
  title: {
    default: "NeoBIM — No-Code Generative Workflow Builder for AEC",
    template: "%s | NeoBIM",
  },
  description:
    "Build AI-powered AEC workflows visually. Drag-and-drop nodes to create pipelines from PDF briefs to 3D massing to IFC export — without writing a single line of code.",
  keywords: [
    "AEC",
    "BIM",
    "workflow",
    "AI",
    "no-code",
    "architecture",
    "engineering",
    "construction",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://neobim.com",
    siteName: "NeoBIM",
    title: "NeoBIM — No-Code Generative Workflow Builder for AEC",
    description:
      "Build AI-powered AEC workflows visually. Drag-and-drop nodes to create pipelines from PDF briefs to 3D massing to IFC export.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Preconnect to external domains */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://vitals.vercel-insights.com" />
      </head>
      <body
        className={`${inter.variable} font-body antialiased bg-[#07070D] text-[#F0F0F5]`}
      >
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
              boxShadow:
                "0 16px 48px rgba(0,0,0,0.35), 0 4px 16px rgba(0,0,0,0.25)",
              padding: "12px 14px",
              gap: "10px",
            },
          }}
        />
        {/* Analytics loaded lazily (non-blocking) */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
