"use client";

import type { FeedbackStatusKey } from "../constants/status-map";
import { STATUS_MAP } from "../constants/status-map";
import s from "./page.module.css";

interface StatusPillProps {
  status: string;
  locale: string;
}

export function StatusPill({ status, locale }: StatusPillProps) {
  const isDE = locale === "de";
  const meta = STATUS_MAP[status as FeedbackStatusKey] ?? STATUS_MAP.NEW;

  return (
    <span className={s.statusPill} data-status={meta.key}>
      <span className={s.statusPillDot} />
      {isDE ? meta.label.de : meta.label.en}
    </span>
  );
}
