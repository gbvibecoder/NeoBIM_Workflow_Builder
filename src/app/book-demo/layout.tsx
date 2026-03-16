import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book a Demo",
  description: "Schedule a personalized demo of BuildFlow. See how AI-powered workflows can transform your AEC design process.",
  openGraph: {
    title: "Book a Demo — BuildFlow",
    description: "Schedule a personalized demo. See how AI workflows transform AEC design.",
  },
};

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
