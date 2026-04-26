"use client";

import { FileSearch } from "lucide-react";
import { EmptyState } from "@/features/result-page/components/primitives/EmptyState";

export function NotFound({ executionId }: { executionId: string }) {
  return (
    <EmptyState
      icon={<FileSearch size={28} />}
      title="We couldn't find this result"
      description={
        executionId
          ? `The execution ${executionId.slice(0, 10)}… may have been deleted, or it belongs to a different account.`
          : "The execution may have been deleted, or it belongs to a different account."
      }
      primaryHref="/dashboard"
      primaryLabel="Go to dashboard"
    />
  );
}
