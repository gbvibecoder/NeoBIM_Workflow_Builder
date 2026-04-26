"use client";

import { Lock } from "lucide-react";
import { EmptyState } from "@/features/result-page/components/empty/EmptyState";

export function Forbidden() {
  return (
    <EmptyState
      icon={<Lock size={28} />}
      title="You don't have access to this result"
      description="This execution belongs to a different account. Sign in with the right account, or open one of your own runs from the dashboard."
      primaryHref="/dashboard"
      primaryLabel="Go to dashboard"
      secondaryHref="/login"
      secondaryLabel="Sign in"
    />
  );
}
