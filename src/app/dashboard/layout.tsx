import React from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPaletteLoader } from "@/components/ui/CommandPaletteLoader";
import { OnboardingModal } from "@/components/dashboard/OnboardingModal";
import { PendingReferralClaimer } from "@/components/referral/PendingReferralClaimer";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ minHeight: "-webkit-fill-available", background: "#0a0c10" }}>
      <Sidebar />
      <ErrorBoundary>
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Header />
          {children}
        </div>
      </ErrorBoundary>
      <CommandPaletteLoader />
      <OnboardingModal />
      <PendingReferralClaimer />
    </div>
  );
}
