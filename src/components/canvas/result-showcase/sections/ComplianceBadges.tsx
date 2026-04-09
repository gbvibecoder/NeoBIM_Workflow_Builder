"use client";

import { motion } from "framer-motion";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { COLORS } from "@/features/execution/components/result-showcase/constants";
import type { ComplianceItem } from "@/features/execution/components/result-showcase/useShowcaseData";

interface ComplianceBadgesProps {
  items: ComplianceItem[];
}

const STATUS_CONFIG = {
  pass: {
    icon: <CheckCircle2 size={14} />,
    color: COLORS.EMERALD,
    bg: "rgba(16,185,129,0.1)",
    border: "rgba(16,185,129,0.2)",
  },
  fail: {
    icon: <XCircle size={14} />,
    color: "#EF4444",
    bg: "rgba(239,68,68,0.1)",
    border: "rgba(239,68,68,0.2)",
  },
  warning: {
    icon: <AlertTriangle size={14} />,
    color: COLORS.AMBER,
    bg: "rgba(255,191,0,0.1)",
    border: "rgba(255,191,0,0.2)",
  },
};

export function ComplianceBadges({ items }: ComplianceBadgesProps) {
  const { t } = useLocale();
  if (items.length === 0) return null;

  return (
    <div>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: COLORS.TEXT_SECONDARY,
        marginBottom: 12,
      }}>
        {t('showcase.complianceChecks')}
      </div>

      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
      }}>
        {items.map((item, i) => {
          const config = STATUS_CONFIG[item.status];

          return (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 * i }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 8,
                background: config.bg,
                border: `1px solid ${config.border}`,
              }}
            >
              <div style={{ color: config.color, display: "flex" }}>
                {config.icon}
              </div>
              <div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: config.color,
                }}>
                  {item.label}
                </div>
                {item.detail && (
                  <div style={{
                    fontSize: 9,
                    color: COLORS.TEXT_MUTED,
                    marginTop: 1,
                  }}>
                    {item.detail}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
