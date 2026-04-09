import React from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPaletteLoader } from "@/components/ui/CommandPaletteLoader";
import { OnboardingModal } from "@/components/dashboard/OnboardingModal";
import { PendingReferralClaimer } from "@/components/referral/PendingReferralClaimer";
import { SupportChatLoader } from "@/features/support/components/SupportChatLoader";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden" style={{ minHeight: "-webkit-fill-available", background: "#0a0c10" }}>
      <Sidebar />
      <ErrorBoundary>
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ transition: "flex 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}>
          <Header />
          <div className="flex-1 min-h-0 overflow-hidden">
            {children}
          </div>
        </div>
      </ErrorBoundary>
      <CommandPaletteLoader />
      <OnboardingModal />
      <PendingReferralClaimer />
      <SupportChatLoader />
    </div>
  );
}
