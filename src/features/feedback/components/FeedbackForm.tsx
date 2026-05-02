"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { X, Send, ImagePlus, Type } from "lucide-react";
import { toast } from "sonner";
import type { FeedbackTypeKey } from "../constants/feedback-types";
import { getFeedbackType } from "../constants/feedback-types";
import { AEC_CATEGORIES } from "../constants/aec-categories";
import s from "./page.module.css";

interface FeedbackFormProps {
  selectedType: FeedbackTypeKey;
  onSubmit: (formData: FormData) => Promise<void>;
  onClose: () => void;
  isSubmitting: boolean;
  locale: string;
}

export function FeedbackForm({ selectedType, onSubmit, onClose, isSubmitting, locale }: FeedbackFormProps) {
  const isDE = locale === "de";
  const meta = getFeedbackType(selectedType);
  const Icon = meta.icon;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleScreenshot = useCallback((file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error(isDE ? "Screenshot muss unter 5MB sein" : "Screenshot must be under 5MB");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(isDE ? "Bitte eine Bilddatei hochladen" : "Please upload an image file");
      return;
    }
    setScreenshot(file);
    const reader = new FileReader();
    reader.onload = () => setScreenshotPreview(reader.result as string);
    reader.readAsDataURL(file);
  }, [isDE]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) handleScreenshot(file);
        break;
      }
    }
  }, [handleScreenshot]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    const formData = new FormData();
    formData.append("type", selectedType);
    formData.append("title", title.trim());
    formData.append("description", description.trim());
    if (category) formData.append("category", category);
    if (screenshot) formData.append("screenshot", screenshot);
    formData.append("pageUrl", window.location.href);

    await onSubmit(formData);
  };

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !isSubmitting;

  return (
    <div className={s.section} style={{ paddingTop: 0, paddingBottom: 24 }}>
      <form className={s.formCard} data-type={selectedType} onSubmit={handleSubmit}>
        {/* Header */}
        <div className={s.formHead}>
          <div className={s.formHeadInfo}>
            <div className={s.formHeadIcon}>
              <Icon size={16} strokeWidth={2} />
            </div>
            <div>
              <div className={s.formHeadLabel}>{meta.nodeId} &middot; {isDE ? "DESIGN BRIEF" : "DESIGN BRIEF"}</div>
              <div className={s.formHeadTitle}>{isDE ? meta.label.de : meta.label.en}</div>
            </div>
          </div>
          <button type="button" className={s.formHeadClose} onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className={s.formBody}>
          {/* Title */}
          <div className={s.formRow}>
            <div className={s.formLabel}>
              <span>
                {isDE ? "Titel" : "Title"}
                <span className={s.formLabelRequired}> *</span>
              </span>
              <span className={`${s.formLabelCounter} ${title.length > 180 ? s.formLabelCounterWarn : ""}`}>
                {title.length}/200
              </span>
            </div>
            <input
              type="text"
              className={s.formInput}
              placeholder={isDE ? meta.placeholders.title.de : meta.placeholders.title.en}
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className={s.formRow}>
            <div className={s.formLabel}>
              <span>
                {isDE ? "Beschreibung" : "Description"}
                <span className={s.formLabelRequired}> *</span>
              </span>
              <span className={`${s.formLabelCounter} ${description.length > 4800 ? s.formLabelCounterWarn : ""}`}>
                {description.length}/5000
              </span>
            </div>
            <textarea
              className={s.formTextarea}
              placeholder={isDE ? meta.placeholders.description.de : meta.placeholders.description.en}
              required
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className={s.formMdHint}>
              <Type size={10} />
              <span>{isDE ? "Unterst\u00fctzt **fett**, *kursiv*, `code`" : "Supports **bold**, *italic*, `code`"}</span>
            </div>
          </div>

          {/* AEC Domain */}
          <div className={s.formRow}>
            <div className={s.formLabel}>
              <span>{isDE ? "AEC-Bereich" : "AEC Domain"}</span>
              <span className={s.formLabelOptional}>{isDE ? "optional" : "optional"}</span>
            </div>
            <div className={s.categoryGrid}>
              {AEC_CATEGORIES.map((cat) => {
                const isActive = category === cat.label;
                const CatIcon = cat.icon;
                return (
                  <button
                    key={cat.label}
                    type="button"
                    className={s.categoryTag}
                    data-active={isActive}
                    style={{
                      "--cat-color": cat.color,
                      "--cat-tint": `color-mix(in srgb, ${cat.color} 8%, transparent)`,
                    } as React.CSSProperties}
                    onClick={() => setCategory(isActive ? "" : cat.label)}
                  >
                    <CatIcon size={12} strokeWidth={2} />
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Screenshot */}
          <div className={s.formRow}>
            <div className={s.formLabel}>
              <span>{isDE ? "Screenshot" : "Screenshot"}</span>
              <span className={s.formLabelOptional}>{isDE ? "optional" : "optional"}</span>
            </div>
            {screenshotPreview ? (
              <div className={s.screenshotPreview}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={screenshotPreview} alt="Preview" className={s.screenshotPreviewImg} />
                <button
                  type="button"
                  className={s.screenshotRemove}
                  onClick={() => { setScreenshot(null); setScreenshotPreview(null); }}
                  aria-label="Remove screenshot"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button type="button" className={s.screenshotZone} onClick={() => fileInputRef.current?.click()}>
                <div className={s.screenshotZoneIcon}>
                  <ImagePlus size={20} strokeWidth={1.5} />
                </div>
                <span className={s.screenshotZoneText}>{isDE ? "Klicken zum Hochladen" : "Click to upload"}</span>
                <span className={s.screenshotZoneKbd}>
                  {isDE ? "oder Ctrl+V zum Einf\u00fcgen \u00b7 PNG, JPG, WebP \u2014 max 5MB" : "or Ctrl+V to paste \u00b7 PNG, JPG, WebP \u2014 max 5MB"}
                </span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleScreenshot(f);
              }}
              style={{ display: "none" }}
            />
          </div>

          {/* Submit */}
          <div className={s.formFooter}>
            <span className={s.formFooterInfo}>
              {isDE ? "Alle Einreichungen werden von unserem Team gepr\u00fcft" : "Every submission is reviewed by our team"}
            </span>
            <button
              type="submit"
              className={s.btnSubmit}
              data-type={selectedType}
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <>
                  <span className={s.btnSpinner} />
                  {isDE ? "Wird gesendet\u2026" : "Submitting\u2026"}
                </>
              ) : (
                <>
                  <Send size={14} />
                  {isDE ? "Feedback senden" : "Submit Feedback"}
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
