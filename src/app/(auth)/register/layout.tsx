import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Create your free BuildFlow account. Start building AI-powered AEC workflows in minutes.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
