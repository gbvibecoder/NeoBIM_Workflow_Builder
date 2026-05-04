import { LightNav } from "@/features/landing/components/light/LightNav";
import { LightHero } from "@/features/landing/components/light/LightHero";
import { LightSocialProof } from "@/features/landing/components/light/LightSocialProof";
import { LightTestimonials } from "@/features/landing/components/light/LightTestimonials";
import { LightProductProof } from "@/features/landing/components/light/LightProductProof";
import { LightFourSurfaces } from "@/features/landing/components/light/LightFourSurfaces";
import { LightPrebuiltWorkflows } from "@/features/landing/components/light/LightPrebuiltWorkflows";
import { LightPricing } from "@/features/landing/components/light/LightPricing";
import { LightBottomCTA } from "@/features/landing/components/light/LightBottomCTA";
import { LightSchema } from "@/features/landing/components/light/LightSchema";
import { LightFooter } from "@/features/landing/components/light/LightFooter";
import { LightTrackingEvents } from "@/features/landing/components/light/LightTrackingEvents";

export default function LightLandingPage() {
  return (
    <>
      <LightNav />
      <main id="main-content">
        <LightHero />
        <LightSocialProof />
        <LightTestimonials />
        <LightProductProof />
        <LightFourSurfaces />
        <LightPrebuiltWorkflows />
        <LightPricing />
        <LightBottomCTA />
        <LightSchema />
      </main>
      <LightFooter />
      <LightTrackingEvents />
    </>
  );
}
