import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your BuildFlow account. Access your AI-powered AEC workflow builder.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
