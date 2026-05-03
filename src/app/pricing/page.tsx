import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Pricing — Free, Pro & Enterprise Plans",
  description: "BuildFlow pricing plans. Start free with 3 AI executions, upgrade for more runs, video walkthroughs, and 3D models.",
  openGraph: {
    title: "BuildFlow Pricing — Plans for Every Team",
    description: "Start free, upgrade when you need more. Plans from ₹99/month with AI renders, video walkthroughs, and priority support.",
  },
};

export default function PricingPage() {
  redirect("/#pricing");
}
