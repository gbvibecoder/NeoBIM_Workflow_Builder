"use client";

import { Clock } from "lucide-react";
import type { FeedbackTypeKey } from "../constants/feedback-types";
import { getFeedbackType } from "../constants/feedback-types";
import { StatusPill } from "./StatusPill";
import { renderMarkdown } from "../lib/markdown";
import s from "./page.module.css";

export interface SubmissionView {
  id: string;
  type: string;
  title: string;
  description: string;
  category: string | null;
  screenshotUrl: string | null;
  status: string;
  createdAt: string;
}

interface MySubmissionsProps {
  submissions: SubmissionView[];
  locale: string;
  isLoading?: boolean;
}

export function MySubmissions({ submissions, locale, isLoading }: MySubmissionsProps) {
  const isDE = locale === "de";

  const inProgress = submissions.filter((s) =>
    ["REVIEWING", "PLANNED", "IN_PROGRESS"].includes(s.status)
  ).length;
  const shipped = submissions.filter((s) => s.status === "DONE").length;

  const subLine = [
    `${submissions.length} ${isDE ? "Einreichungen" : "submissions"}`,
    inProgress > 0 ? `${inProgress} ${isDE ? "in Bearbeitung" : "in progress"}` : null,
    shipped > 0 ? `${shipped} ${isDE ? "veröffentlicht" : "shipped"}` : null,
  ].filter(Boolean).join(", ");

  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <div className={s.sectionEyebrow}>
          <span className={s.sectionNum}>02</span>
          <Clock size={10} />
          <span>{isDE ? "MEINE EINREICHUNGEN" : "MY SUBMISSIONS"}</span>
        </div>
        <h2 className={s.sectionTitle}>
          {isDE ? (
            <>Dein <em className={s.sectionTitleEm}>Verlauf</em></>
          ) : (
            <>Your <em className={s.sectionTitleEm}>history</em></>
          )}
        </h2>
        <p className={s.sectionSub}>{subLine}</p>
      </div>

      {isLoading ? (
        <div className={s.loadingSpinner}>
          <span className={s.btnSpinner} style={{ borderColor: "var(--rs-rule-strong)", borderTopColor: "var(--rs-blueprint)" }} />
          <span>{isDE ? "Laden\u2026" : "Loading\u2026"}</span>
        </div>
      ) : (
        <div className={s.submissionsGrid}>
          {submissions.map((sub) => {
            const meta = getFeedbackType(sub.type as FeedbackTypeKey);
            const Icon = meta.icon;
            const date = new Date(sub.createdAt).toLocaleDateString(
              isDE ? "de-DE" : "en-US",
              { year: "numeric", month: "short", day: "numeric" }
            );

            return (
              <div key={sub.id} className={s.submissionRow}>
                <div className={s.submissionIcon} data-type={sub.type}>
                  <Icon size={14} strokeWidth={2} />
                </div>
                <div className={s.submissionBody}>
                  <div className={s.submissionRowTop}>
                    <span className={s.submissionTitle}>{sub.title}</span>
                    <StatusPill status={sub.status} locale={locale} />
                    {sub.category && <span className={s.submissionCat}>{sub.category}</span>}
                  </div>
                  <div
                    className={s.submissionDesc}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(sub.description) }}
                  />
                  <div className={s.submissionRowBottom}>
                    <span>{date}</span>
                    <span className={s.submissionRowDot} />
                    <span>{isDE ? meta.label.de : meta.label.en}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
