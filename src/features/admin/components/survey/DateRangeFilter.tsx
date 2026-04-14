"use client";

import { useLocale } from "@/hooks/useLocale";
import type { TranslationKey } from "@/lib/i18n";

const PRESETS: Array<{ id: string; labelKey: TranslationKey; days: number | null }> = [
  { id: "7",   labelKey: "admin.survey.range7",   days: 7 },
  { id: "30",  labelKey: "admin.survey.range30",  days: 30 },
  { id: "90",  labelKey: "admin.survey.range90",  days: 90 },
  { id: "all", labelKey: "admin.survey.rangeAll", days: null },
];

interface DateRangeFilterProps {
  value: string; // preset id
  onChange: (id: string, range: { from?: string; to?: string }) => void;
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const { t } = useLocale();
  return (
    <div
      role="group"
      aria-label="Date range"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 3,
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {PRESETS.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              const to = new Date();
              const from = p.days === null ? undefined : new Date(to.getTime() - p.days * 86400 * 1000);
              onChange(p.id, {
                from: from?.toISOString(),
                to: to.toISOString(),
              });
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: "0.02em",
              border: "none",
              cursor: "pointer",
              background: active ? "rgba(79,138,255,0.18)" : "transparent",
              color: active ? "#A5B4FC" : "rgba(255,255,255,0.45)",
              transition: "background 180ms ease, color 180ms ease",
            }}
          >
            {t(p.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
