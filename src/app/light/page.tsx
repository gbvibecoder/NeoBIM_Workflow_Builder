import { LightNav } from "@/features/landing/components/light/LightNav";
import { LightHero } from "@/features/landing/components/light/LightHero";
import { LightWhatItDoes } from "@/features/landing/components/light/LightWhatItDoes";
import { LightProductProof } from "@/features/landing/components/light/LightProductProof";
import { LightPricing } from "@/features/landing/components/light/LightPricing";
import { LightFAQ } from "@/features/landing/components/light/LightFAQ";
import { LightFAQSchema } from "@/features/landing/components/light/LightFAQSchema";
import { LightFooter } from "@/features/landing/components/light/LightFooter";

export default function LightLandingPage() {
  return (
    <>
      <LightNav />
      <main id="main-content">
        <LightHero />
        <LightWhatItDoes />
        <LightProductProof />
        <LightPricing />
        <LightFAQ />
        <LightFAQSchema />
      </main>
      <LightFooter />
    </>
  );
}
