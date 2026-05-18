"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/features/dashboard/components/Sidebar";
import { Header } from "@/features/dashboard/components/Header";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { CommandPaletteLoader } from "@/shared/components/ui/CommandPaletteLoader";
import { BetaBanner } from "@/shared/components/ui/BetaBanner";
import { OnboardingModal } from "@/features/onboarding/components/OnboardingModal";
import { PendingReferralClaimer } from "@/features/referral/components/PendingReferralClaimer";
import { SupportChatLoader } from "@/features/support/components/SupportChatLoader";
import { SubscriptionSelfHeal } from "@/features/billing/components/SubscriptionSelfHeal";
import { SessionGuard } from "@/shared/components/SessionGuard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isImmersive = pathname === "/dashboard";
  // Pages whose top-edge surface is a light cream/white (Phase 4.2 result
  // page redesign + 3D render wizard + light editors + Phase Z.IFC.1 IFC
  // viewer). UserMenu adopts a light-tone trigger so the floating avatar
  // reads cleanly against the cream surface. Dark-surface pages (canvas,
  // immersive landing) keep the dark-tone trigger.
  const isLightSurface =
    pathname === "/dashboard" ||
    pathname === "/dashboard/workflows" ||
    pathname === "/dashboard/feedback" ||
    pathname === "/dashboard/billing" ||
    pathname === "/dashboard/settings" ||
    pathname === "/dashboard/admin/live-chat" ||
    pathname === "/dashboard/3d-render" ||
    pathname === "/dashboard/floor-plan" ||
    pathname === "/dashboard/brief-renders" ||
    pathname === "/dashboard/ifc-viewer" ||
    pathname.startsWith("/dashboard/results/");
  // Canvas page — uses startsWith to handle pathname edge cases (trailing
  // slash, null from usePathname, or future sub-routes under canvas/).
  const isCanvasPage = pathname?.startsWith("/dashboard/canvas") ?? false;

  // BetaBanner: hidden on light surfaces (cream pages stay clean), on the
  // immersive landing, and on the canvas page (focused workspace needs all
  // vertical space — the banner also extends past the workspace when panels
  // are open).
  const hideBetaBanner = isImmersive || isLightSurface || isCanvasPage;

  // Full-bleed: canvas hides sidebar for immersive experience.
  // Deferred to useEffect so the INITIAL render always includes Sidebar
  // (matches SSR output — avoids hydration mismatch from conditional DOM).
  const [isFullBleed, setIsFullBleed] = useState(false);
  useEffect(() => {
    setIsFullBleed(isCanvasPage);
  }, [isCanvasPage]);

  return (
    <div className="flex h-screen overflow-hidden" style={{
      minHeight: "-webkit-fill-available",
      background: isLightSurface ? "#F6F4EE" : "#0a0c10",
    }}>
      {!isFullBleed && <Sidebar />}
      <ErrorBoundary>
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ transition: "flex 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}>
          {!hideBetaBanner && <BetaBanner />}
          {/* Phase 5.2: page content fills the full viewport vertically.
              Header is no longer in this flex flow — it floats fixed
              top-right via the sibling overlay below, same architectural
              pattern as the bottom-right support chat. No more 56px black
              strip reserved at the top of dark pages. */}
          <div className="flex-1 min-h-0 overflow-hidden" style={{ position: "relative" }}>
            {children}
          </div>
        </div>
      </ErrorBoundary>
      {/* Floating chrome overlay — sits OUTSIDE the flex column so it
          reserves zero vertical space. Just an avatar circle in the
          top-right corner. */}
      <Header theme={(isLightSurface || isCanvasPage) ? "light" : "dark"} rightOffset={isCanvasPage ? 64 : 16} />
      <CommandPaletteLoader />
      <SessionGuard />
      <OnboardingModal />
      <PendingReferralClaimer />
      {/* Hide support chat on canvas — canvas has its own AI Chat panel.
          Uses isFullBleed (deferred) so initial render matches SSR. */}
      {!isFullBleed && <SupportChatLoader />}
      <SubscriptionSelfHeal />
    </div>
  );
}
