import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Demo — Try the AI Workflow Builder",
  description: "Try BuildFlow's AI workflow builder for free. No signup required. Build a concept design from brief to 3D model in minutes.",
  openGraph: {
    title: "Live Demo — Try BuildFlow Free",
    description: "Try BuildFlow's AI workflow builder for free. No signup required.",
  },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
