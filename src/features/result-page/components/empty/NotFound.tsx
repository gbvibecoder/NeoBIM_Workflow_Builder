"use client";

import { FileSearch } from "lucide-react";
import { EmptyState } from "@/features/result-page/components/empty/EmptyState";

export function NotFound({ executionId }: { executionId: string }) {
  return (
    <EmptyState
      icon={<FileSearch size={28} />}
      title="Nothing under this address"
      description={
        executionId
          ? `Run ${executionId.slice(0, 10)}… isn't on the books — deleted, or it belongs to a different account.`
          : "This result either no longer exists, or it belongs to a different account."
      }
      primaryHref="/dashboard"
      primaryLabel="Back to dashboard"
    />
  );
}
