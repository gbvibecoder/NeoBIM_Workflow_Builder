import { LightNav } from "@/features/landing/components/light/LightNav";
import { LightHero } from "@/features/landing/components/light/LightHero";
import { LightFooter } from "@/features/landing/components/light/LightFooter";

export default function LightLandingPage() {
  return (
    <>
      <LightNav />
      <main id="main-content">
        <LightHero />
      </main>
      <LightFooter />
    </>
  );
}
