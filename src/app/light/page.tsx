import { LightNav } from "@/features/landing/components/light/LightNav";
import { LightHero } from "@/features/landing/components/light/LightHero";
import { LightSocialProof } from "@/features/landing/components/light/LightSocialProof";
import { LightProductProof } from "@/features/landing/components/light/LightProductProof";
import { LightUseCases } from "@/features/landing/components/light/LightUseCases";
import { LightWhatItDoes } from "@/features/landing/components/light/LightWhatItDoes";
import { LightPricing } from "@/features/landing/components/light/LightPricing";
import { LightFAQ } from "@/features/landing/components/light/LightFAQ";
import { LightBottomCTA } from "@/features/landing/components/light/LightBottomCTA";
import { LightFAQSchema } from "@/features/landing/components/light/LightFAQSchema";
import { LightSchema } from "@/features/landing/components/light/LightSchema";
import { LightFooter } from "@/features/landing/components/light/LightFooter";
import { LightTrackingEvents } from "@/features/landing/components/light/LightTrackingEvents";
import { LightTestimonials } from "@/features/landing/components/light/LightTestimonials";

export default function LightLandingPage() {
  return (
    <>
      <LightNav />
      <main id="main-content">
        <LightHero />
        <LightSocialProof />
        <LightTestimonials />
        <LightProductProof />
        <LightUseCases />
        <LightWhatItDoes />
        <LightPricing />
        <LightFAQ />
        <LightBottomCTA />
        <LightFAQSchema />
        <LightSchema />
      </main>
      <LightFooter />
      <LightTrackingEvents />
    </>
  );
}
