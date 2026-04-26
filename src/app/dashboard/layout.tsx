"use client";

import React from "react";
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
  // The dashboard landing page is an immersive 3D hero — the header bar
  // should overlay the scene (transparent) instead of reserving 52px of
  // empty black space above it.
  const isImmersive = pathname === "/dashboard";
  // Pages whose top-edge surface is a light cream/white (Phase 4.2 result
  // page redesign + 3D render wizard + light editors). UserMenu adopts a
  // light-tone trigger (white avatar bg, dark text) on these surfaces so
  // it reads cleanly. Dark-surface pages (canvas, IFC viewer, immersive
  // landing, settings dark shell) keep the dark-tone trigger.
  const isLightSurface =
    pathname === "/dashboard/3d-render" ||
    pathname === "/dashboard/floor-plan" ||
    pathname.startsWith("/dashboard/results/");

  return (
    <div className="flex h-screen overflow-hidden" style={{ minHeight: "-webkit-fill-available", background: "#0a0c10" }}>
      <Sidebar />
      <ErrorBoundary>
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ transition: "flex 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}>
          {!isImmersive && !isLightSurface && <BetaBanner />}
          {!isImmersive && <Header theme={isLightSurface ? "light" : "dark"} />}
          <div className="flex-1 min-h-0 overflow-hidden" style={{ position: "relative" }}>
            {isImmersive && <Header floating />}
            {children}
          </div>
        </div>
      </ErrorBoundary>
      <CommandPaletteLoader />
      <SessionGuard />
      <OnboardingModal />
      <PendingReferralClaimer />
      <SupportChatLoader />
      <SubscriptionSelfHeal />
    </div>
  );
}
