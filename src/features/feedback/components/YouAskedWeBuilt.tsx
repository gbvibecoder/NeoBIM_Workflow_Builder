"use client";

import { Trophy } from "lucide-react";
import s from "./page.module.css";

export interface ShippedItem {
  id: string;
  type: string;
  title: string;
  quote: string;
  category: string | null;
  shippedAt: string;
  submittedAt: string;
  submitterFirstName: string;
  linkedTasks: Array<{ id: string; title: string }>;
}

interface YouAskedWeBuiltProps {
  items: ShippedItem[];
  locale: string;
}

export function YouAskedWeBuilt({ items, locale }: YouAskedWeBuiltProps) {
  const isDE = locale === "de";

  if (items.length === 0) return null;

  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <div className={s.sectionEyebrow}>
          <span className={s.sectionNum}>03</span>
          <Trophy size={10} />
          <span>{isDE ? "IHR HABT GEFRAGT, WIR HABEN GEBAUT" : "YOU ASKED, WE BUILT"}</span>
        </div>
        <h2 className={s.sectionTitle}>
          {isDE ? (
            <>Von der Idee zum <em className={s.sectionTitleEm}>Feature</em></>
          ) : (
            <>From idea to <em className={s.sectionTitleEm}>feature</em></>
          )}
        </h2>
        <p className={s.sectionSub}>
          {items.length} {isDE ? "Features begannen als Feedback" : "features started as feedback"}.
        </p>
      </div>

      <div className={s.builtGrid}>
        {items.map((item) => {
          const shippedDate = new Date(item.shippedAt).toLocaleDateString(
            isDE ? "de-DE" : "en-US",
            { month: "short", day: "numeric" }
          );

          return (
            <div key={item.id} className={s.builtCard}>
              <div className={s.builtStamp}>
                <span className={s.builtStampDot} />
                {isDE ? "VERÖFFENTLICHT" : "SHIPPED"}
              </div>
              <div className={s.builtFrom}>
                {isDE ? `Von ${item.submitterFirstName}` : `From ${item.submitterFirstName}`}
              </div>
              <div className={s.builtTitle}>{item.title}</div>
              {item.quote && (
                <div className={s.builtQuote}>&ldquo;{item.quote}&rdquo;</div>
              )}
              <div className={s.builtMeta}>
                <span>{shippedDate}</span>
                {item.category && (
                  <>
                    <span className={s.submissionRowDot} />
                    <span>{item.category}</span>
                  </>
                )}
                {item.linkedTasks.length > 0 && (
                  <>
                    <span className={s.submissionRowDot} />
                    <span className={s.builtMetaLink}>
                      {item.linkedTasks.length} {isDE ? "Sprint-Aufgabe(n)" : "sprint task(s)"}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
