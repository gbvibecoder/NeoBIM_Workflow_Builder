import type { LucideIcon } from "lucide-react";
import { Bug, Lightbulb, Compass } from "lucide-react";

export type FeedbackTypeKey = "BUG" | "FEATURE" | "SUGGESTION";

export interface FeedbackTypeMeta {
  key: FeedbackTypeKey;
  nodeId: string;
  icon: LucideIcon;
  accent: string;
  accentTint: string;
  label: { en: string; de: string };
  tagline: { en: string; de: string };
  description: { en: string; de: string };
  placeholders: {
    title: { en: string; de: string };
    description: { en: string; de: string };
  };
}

export const FEEDBACK_TYPES: FeedbackTypeMeta[] = [
  {
    key: "BUG",
    nodeId: "FB-001",
    icon: Bug,
    accent: "var(--rs-burnt)",
    accentTint: "rgba(194,106,59,.08)",
    label: { en: "Bug Report", de: "Fehlermeldung" },
    tagline: { en: "Crack in the foundation", de: "Riss im Fundament" },
    description: {
      en: "Report issues so we can patch the blueprint. We treat bugs like leaks\u2009\u2014\u2009fix fast.",
      de: "Melde Probleme, damit wir den Bauplan reparieren. Bugs behandeln wir wie Lecks\u2009\u2014\u2009schnell beheben.",
    },
    placeholders: {
      title: {
        en: "What's broken? (e.g. Canvas freezes with 50+ nodes)",
        de: "Was ist kaputt? (z.B. Canvas friert bei 50+ Nodes ein)",
      },
      description: {
        en: "Steps to reproduce, what you expected, what actually happened\u2026",
        de: "Schritte zur Reproduktion, was erwartet wurde, was passiert ist\u2026",
      },
    },
  },
  {
    key: "FEATURE",
    nodeId: "FB-002",
    icon: Lightbulb,
    accent: "var(--rs-ember)",
    accentTint: "rgba(229,168,120,.10)",
    label: { en: "Feature Request", de: "Funktionswunsch" },
    tagline: { en: "Design the next floor", de: "Den n\u00e4chsten Stock entwerfen" },
    description: {
      en: "What tool should we add to your AEC toolkit? Big or small\u2009\u2014\u2009describe the gap.",
      de: "Welches Werkzeug fehlt in deinem AEC-Toolkit? Gro\u00df oder klein\u2009\u2014\u2009beschreibe die L\u00fccke.",
    },
    placeholders: {
      title: {
        en: "What's missing? (e.g. Bulk export to Revit)",
        de: "Was fehlt? (z.B. Massen-Export nach Revit)",
      },
      description: {
        en: "What's the use case? When does it matter? What does success look like?",
        de: "Was ist der Anwendungsfall? Wann ist es wichtig? Wie sieht Erfolg aus?",
      },
    },
  },
  {
    key: "SUGGESTION",
    nodeId: "FB-003",
    icon: Compass,
    accent: "var(--rs-blueprint)",
    accentTint: "rgba(26,77,92,.08)",
    label: { en: "AEC Vision", de: "AEC-Vision" },
    tagline: { en: "Architect the future", de: "Die Zukunft entwerfen" },
    description: {
      en: "Share your vision for the AEC industry's digital future. What should be possible?",
      de: "Teile deine Vision f\u00fcr die digitale Zukunft der AEC-Branche. Was sollte m\u00f6glich sein?",
    },
    placeholders: {
      title: {
        en: "Your big idea? (e.g. Automated BOQ from IFC models)",
        de: "Deine gro\u00dfe Idee? (z.B. Automatische BOQ aus IFC-Modellen)",
      },
      description: {
        en: "What does the AEC industry need but doesn't have yet? Be ambitious.",
        de: "Was braucht die AEC-Branche, hat es aber noch nicht? Sei ehrgeizig.",
      },
    },
  },
];

export function getFeedbackType(key: FeedbackTypeKey): FeedbackTypeMeta {
  return FEEDBACK_TYPES.find((t) => t.key === key) ?? FEEDBACK_TYPES[0];
}
