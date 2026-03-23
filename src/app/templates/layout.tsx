import type { Metadata } from "next";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://trybuildflow.in";

export const metadata: Metadata = {
  title: "BIM Workflow Templates — Free AEC Automation",
  description:
    "Free workflow templates for architects and engineers. IFC cost estimation, AI floor plans, 3D massing, concept renders, and more. No code required.",
  openGraph: {
    title: "BIM Workflow Templates | BuildFlow",
    description:
      "Free BIM automation templates for architects and engineers. Start building in 60 seconds.",
    url: `${siteUrl}/templates`,
  },
};

export default function TemplatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
