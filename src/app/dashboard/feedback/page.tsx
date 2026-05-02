"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { useLocale } from "@/hooks/useLocale";
import type { FeedbackTypeKey } from "@/features/feedback/constants/feedback-types";
import { FeedbackHero } from "@/features/feedback/components/FeedbackHero";
import { FeedbackTypeCards } from "@/features/feedback/components/FeedbackTypeCards";
import { FeedbackPipelineConnector } from "@/features/feedback/components/FeedbackPipelineConnector";
import { FeedbackForm } from "@/features/feedback/components/FeedbackForm";
import { FeedbackSuccessCard } from "@/features/feedback/components/FeedbackSuccessCard";
import { MySubmissions } from "@/features/feedback/components/MySubmissions";
import type { SubmissionView } from "@/features/feedback/components/MySubmissions";
import { YouAskedWeBuilt } from "@/features/feedback/components/YouAskedWeBuilt";
import type { ShippedItem } from "@/features/feedback/components/YouAskedWeBuilt";
import { FounderNote } from "@/features/feedback/components/FounderNote";
import s from "@/features/feedback/components/page.module.css";

export default function FeedbackPage() {
  const { locale } = useLocale();
  const isDE = locale === "de";

  const [selectedType, setSelectedType] = useState<FeedbackTypeKey | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissions, setSubmissions] = useState<SubmissionView[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(true);
  const [shippedItems, setShippedItems] = useState<ShippedItem[]>([]);
  const [stats] = useState({ totalShipped: 247, features: 38, replyHours: 11 });

  // Load own submissions
  useEffect(() => {
    setLoadingSubmissions(true);
    fetch("/api/feedback")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => setSubmissions(d.feedbacks ?? []))
      .catch(() => { toast.error(isDE ? "Laden fehlgeschlagen" : "Failed to load submissions"); })
      .finally(() => setLoadingSubmissions(false));
  }, [submitted]);

  // Load "You asked, we built"
  useEffect(() => {
    fetch("/api/feedback/shipped")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => setShippedItems(d.items ?? []))
      .catch(() => {});
  }, []);

  const handleSubmit = useCallback(
    async (formData: FormData) => {
      setIsSubmitting(true);
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || (isDE ? "Senden fehlgeschlagen" : "Failed to submit"));
          return;
        }
        setSubmitted(true);
        toast.success(isDE ? "Feedback gesendet!" : "Feedback submitted!");
      } catch {
        toast.error(isDE ? "Netzwerkfehler" : "Network error");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isDE],
  );

  const handleSubmitMore = () => {
    setSubmitted(false);
    setSelectedType(null);
  };

  return (
    <div className={s.page}>
      <FeedbackHero
        totalShipped={stats.totalShipped}
        featuresFromFeedback={stats.features}
        replyHours={stats.replyHours}
        locale={locale}
      />

      {!submitted ? (
        <>
          <FeedbackTypeCards
            selectedType={selectedType}
            onSelectType={setSelectedType}
            locale={locale}
          />
          {selectedType && (
            <>
              <FeedbackPipelineConnector />
              <FeedbackForm
                selectedType={selectedType}
                onSubmit={handleSubmit}
                onClose={() => setSelectedType(null)}
                isSubmitting={isSubmitting}
                locale={locale}
              />
            </>
          )}
        </>
      ) : (
        <FeedbackSuccessCard onSubmitMore={handleSubmitMore} locale={locale} />
      )}

      {(submissions.length > 0 || loadingSubmissions) && (
        <MySubmissions
          submissions={submissions}
          locale={locale}
          isLoading={loadingSubmissions}
        />
      )}

      {shippedItems.length > 0 && (
        <YouAskedWeBuilt items={shippedItems} locale={locale} />
      )}

      <FounderNote avgReplyHours={stats.replyHours} locale={locale} />
    </div>
  );
}
