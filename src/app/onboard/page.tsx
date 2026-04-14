import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SurveyShell } from "@/features/onboarding-survey/components/SurveyShell";
import type { SurveyRecord } from "@/features/onboarding-survey/types/survey";

export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/onboard");
  }

  const existing = await prisma.userSurvey.findUnique({
    where: { userId: session.user.id },
  });

  // Never show the survey twice — respect the user's time.
  if (existing?.completedAt || existing?.skippedAt) {
    redirect("/dashboard");
  }

  const initial: SurveyRecord | null = existing
    ? {
        id: existing.id,
        userId: existing.userId,
        discoverySource: existing.discoverySource,
        discoveryOther: existing.discoveryOther,
        profession: existing.profession,
        professionOther: existing.professionOther,
        teamSize: existing.teamSize,
        pricingAction:
          existing.pricingAction === "chose_free" ||
          existing.pricingAction === "chose_pro" ||
          existing.pricingAction === "skipped"
            ? existing.pricingAction
            : null,
        completedAt: null,
        skippedAt: null,
        skippedAtScene: existing.skippedAtScene,
      }
    : null;

  return <SurveyShell initial={initial} />;
}
