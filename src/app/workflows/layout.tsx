import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared Workflows",
  description: "Explore community-shared AEC workflows. Find ready-made pipelines for concept design, BIM analysis, cost estimation, and more.",
  openGraph: {
    title: "Shared Workflows — BuildFlow",
    description: "Explore community-shared AEC workflows and ready-made design pipelines.",
  },
};

export default function WorkflowsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
