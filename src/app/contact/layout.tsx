import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Get in touch with the BuildFlow team. We'd love to hear from you — whether you have questions, feedback, or partnership inquiries.",
  openGraph: {
    title: "Contact BuildFlow",
    description: "Get in touch with the BuildFlow team for questions, feedback, or partnerships.",
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
