import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome to BuildFlow",
  description: "A quick hello before you start building.",
};

export default function OnboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
