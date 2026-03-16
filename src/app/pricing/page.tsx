import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Pricing — Free, Pro & Enterprise Plans",
  description: "BuildFlow pricing plans. Start free with 3 AI executions per day, upgrade to Pro for $29/month with unlimited workflows, or contact us for Enterprise.",
  openGraph: {
    title: "BuildFlow Pricing — Plans for Every Team",
    description: "Start free, upgrade when you need more. Pro plan at $29/month with unlimited workflows and priority support.",
  },
};

export default function PricingPage() {
  redirect("/#pricing");
}
