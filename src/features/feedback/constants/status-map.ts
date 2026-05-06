export type FeedbackStatusKey =
  | "NEW"
  | "REVIEWING"
  | "PLANNED"
  | "IN_PROGRESS"
  | "DONE"
  | "DECLINED";

export interface FeedbackStatusMeta {
  key: FeedbackStatusKey;
  label: { en: string; de: string };
  color: string;
  tint: string;
}

export const STATUS_MAP: Record<FeedbackStatusKey, FeedbackStatusMeta> = {
  NEW: {
    key: "NEW",
    label: { en: "New", de: "Neu" },
    color: "var(--rs-blueprint)",
    tint: "rgba(26,77,92,.08)",
  },
  REVIEWING: {
    key: "REVIEWING",
    label: { en: "Reviewing", de: "In Pr\u00fcfung" },
    color: "var(--rs-burnt)",
    tint: "rgba(194,106,59,.08)",
  },
  PLANNED: {
    key: "PLANNED",
    label: { en: "Planned", de: "Geplant" },
    color: "#8B5CF6",
    tint: "rgba(139,92,246,.08)",
  },
  IN_PROGRESS: {
    key: "IN_PROGRESS",
    label: { en: "In Progress", de: "In Arbeit" },
    color: "var(--rs-blueprint-2)",
    tint: "rgba(44,123,143,.08)",
  },
  DONE: {
    key: "DONE",
    label: { en: "Shipped", de: "Ver\u00f6ffentlicht" },
    color: "var(--rs-sage)",
    tint: "rgba(74,107,77,.08)",
  },
  DECLINED: {
    key: "DECLINED",
    label: { en: "Declined", de: "Abgelehnt" },
    color: "#B44",
    tint: "rgba(184,68,68,.06)",
  },
};
