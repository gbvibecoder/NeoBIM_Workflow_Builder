import React from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPaletteLoader } from "@/components/ui/CommandPaletteLoader";

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
          {children}
        </div>
      </ErrorBoundary>
      <CommandPaletteLoader />
    </div>
  );
}
