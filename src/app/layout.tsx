import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { MobileGate } from "@/components/MobileGate";
import { SessionProvider } from "@/components/providers/SessionProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "NeoBIM — No-Code Generative Workflow Builder for AEC",
    template: "%s | NeoBIM",
  },
  description:
    "Build AI-powered AEC workflows visually. Drag-and-drop nodes to create pipelines from PDF briefs to 3D massing to IFC export — without writing a single line of code.",
  keywords: ["AEC", "BIM", "workflow", "AI", "no-code", "architecture", "engineering", "construction"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jetbrains.variable} font-body antialiased bg-[#07070D] text-[#F0F0F5]`}>
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
      </body>
    </html>
  );
}
