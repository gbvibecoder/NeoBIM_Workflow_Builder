import { t as translate } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";

const FAQ_KEYS: { qKey: TranslationKey; aKey: TranslationKey }[] = [
  { qKey: "landing.faq1Q", aKey: "landing.faq1A" },
  { qKey: "landing.faq2Q", aKey: "landing.faq2A" },
  { qKey: "landing.faq3Q", aKey: "landing.faq3A" },
  { qKey: "landing.faq4Q", aKey: "landing.faq4A" },
  { qKey: "landing.faq5Q", aKey: "landing.faq5A" },
  { qKey: "landing.faq6Q", aKey: "landing.faq6A" },
];

/**
 * Server Component that emits FAQPage JSON-LD for crawlers.
 * Renders no visible content — only a <script> tag.
 */
export function LightFAQSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_KEYS.map(({ qKey, aKey }) => ({
      "@type": "Question",
      name: translate(qKey, "en"),
      acceptedAnswer: {
        "@type": "Answer",
        text: translate(aKey, "en"),
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
