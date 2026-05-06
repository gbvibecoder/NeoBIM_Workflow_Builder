"use client";

import React, { useState } from "react";
import s from "./WelcomeScreen.module.css";

interface WelcomeScreenProps {
  onGenerateFromPrompt: (prompt: string) => void;
  /** Direct generation bypassing validation — used by Quick Templates. */
  onDirectGenerate?: (prompt: string) => void;
  onOpenSample: () => void;
  onStartBlank: () => void;
  onOpenSaved: (projectId: string) => void;
  onImportFile: () => void;
  savedProjects: Array<{ id: string; name: string; updatedAt: string; roomCount: number; floorCount: number }>;
}

const TEMPLATES = [
  { label: "2BHK Apartment", prompt: "2BHK apartment, 900 sqft, living room, kitchen, 2 bedrooms, 2 bathrooms, balcony", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" },
  { label: "3BHK Villa", prompt: "3BHK villa, 1500 sqft, living room, dining room, kitchen, 3 bedrooms, 3 bathrooms, study, balcony, utility room", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
  { label: "Duplex 4BHK", prompt: "duplex 4BHK, 2200 sqft, ground floor: living, dining, kitchen, guest bedroom, powder room, staircase; first floor: master suite, 2 bedrooms, family lounge, 2 bathrooms, terrace", icon: "M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" },
  { label: "Studio Flat", prompt: "studio apartment, 400 sqft, open plan living and kitchen, bedroom area, bathroom, small balcony", icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" },
  { label: "Office Layout", prompt: "small office, 1200 sqft, reception, 3 cabins, conference room, pantry, 2 restrooms, storage", icon: "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
];

const EXAMPLES = [
  "compact 2BHK with home office",
  "4BHK villa with central courtyard",
  "minimal studio for one",
  "co-living suite, 3 bedrooms",
  "office for 12 with lounge",
];

export function WelcomeScreen({
  onGenerateFromPrompt,
  onDirectGenerate,
  onOpenSample,
  onStartBlank,
  onOpenSaved,
  onImportFile,
  savedProjects,
}: WelcomeScreenProps) {
  const handleTemplate = onDirectGenerate ?? onGenerateFromPrompt;
  const [prompt, setPrompt] = useState("");
  const [showSaved, setShowSaved] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) onGenerateFromPrompt(prompt.trim());
  };

  return (
    <div className={s.page}>
      <div className={s.backdrop} aria-hidden="true" />

      <div className={s.content}>
        {/* ── Hero ────────────────────────────────────────────── */}
        <div className={s.hero}>
          <span className={s.eyebrow}>
            <span className={s.eyebrowDot} />
            Floor Plan &middot; AI design assistant
          </span>
          <h1 className={s.heroTitle}>
            <span className={s.heroWord} style={{ animationDelay: "0.05s" }}>Sketch </span>
            <span className={s.heroWord} style={{ animationDelay: "0.11s" }}>a </span>
            <span className={s.heroWord} style={{ animationDelay: "0.17s" }}>home </span>
            <span className={s.heroWord} style={{ animationDelay: "0.23s" }}>with </span>
            <em className={s.heroWord} style={{ animationDelay: "0.29s" }}>words.</em>
          </h1>
          <p className={s.heroLead}>
            Describe the home you have in your head. We draft a professional
            floor plan you can iterate on, render in 3D, or export as IFC.
          </p>
        </div>

        {/* ── Composer ────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className={s.composer}>
          <div className={s.composerInner}>
            <div className={s.composerLabel}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M12 3v1m0 16v1m-8-9H3m18 0h-1M5.6 5.6l.7.7m12.1 12.1l.7.7M5.6 18.4l.7-.7m12.1-12.1l.7-.7" strokeLinecap="round" />
              </svg>
              Describe your floor plan
            </div>
            <textarea
              className={s.composerTextarea}
              aria-label="Describe your floor plan"
              placeholder="A 3BHK apartment with a sunlit living room facing south, modular kitchen with island, master bedroom with ensuite bath, and a balcony for plants&#x2026;"
              rows={3}
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit(e);
              }}
            />
            <div className={s.composerFoot}>
              <div className={s.composerTools}>
                {/* TODO: wire attach/image/settings when available */}
                <button type="button" className={s.toolBtn} aria-label="Attach reference" title="Attach reference">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button type="button" className={s.toolBtn} aria-label="Add image" title="Add image">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button type="button" className={s.toolBtn} aria-label="Settings" title="Settings">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6M9 8h6M17 16h6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className={s.composerShortcut}>
                  <kbd className={s.composerKbd}>&thinsp;&#x2318;&thinsp;</kbd>
                  <kbd className={s.composerKbd}>&thinsp;&#x23CE;&thinsp;</kbd>
                  generate
                </span>
                <button
                  type="submit"
                  className={s.generateBtn}
                  disabled={!prompt.trim()}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Generate
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* ── Example chips ───────────────────────────────────── */}
        <div className={s.examplesRow}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className={s.exChip} onClick={() => setPrompt(ex)}>
              <svg className={s.exChipIcon} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {ex}
            </button>
          ))}
        </div>

        {/* ── Templates ───────────────────────────────────────── */}
        <div className={s.templates}>
          <div className={s.templatesHead}>
            <span className={s.templatesTitle}>Quick start templates</span>
          </div>
          <div className={s.templatesGrid}>
            {TEMPLATES.map((tpl) => {
              const sqft = tpl.prompt.match(/(\d+)\s*sqft/)?.[1];
              return (
                <button
                  key={tpl.label}
                  className={s.tplCard}
                  onClick={() => handleTemplate(tpl.prompt)}
                >
                  <div className={s.tplIcon}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d={tpl.icon} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className={s.tplName}>{tpl.label}</div>
                  {sqft && <div className={s.tplMeta}>{sqft} sqft</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Divider ─────────────────────────────────────────── */}
        <div className={s.divider}>
          <div className={s.dividerLine} />
          <span className={s.dividerText}>Or</span>
          <div className={s.dividerLine} />
        </div>

        {/* ── Alt actions ─────────────────────────────────────── */}
        <div className={s.altRow}>
          <button className={s.altBtn} onClick={onStartBlank}>
            <div className={s.altBtnIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M12 4v16m8-8H4" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div className={s.altBtnName}>Start from scratch</div>
              <div className={s.altBtnDesc}>Blank canvas with full tool palette</div>
            </div>
          </button>
          <button className={s.altBtn} onClick={onOpenSample}>
            <div className={s.altBtnIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 7h1m-1 4h1m4-4h1m-1 4h1" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div className={s.altBtnName}>Open sample 2BHK</div>
              <div className={s.altBtnDesc}>Pre-built apartment to explore</div>
            </div>
          </button>
          <button className={s.altBtn} onClick={onImportFile}>
            <div className={s.altBtnIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div className={s.altBtnName}>Import file</div>
              <div className={s.altBtnDesc}>Load a saved .bfp project</div>
            </div>
          </button>
        </div>

        {/* ── Saved projects ──────────────────────────────────── */}
        {savedProjects.length > 0 && (
          <div className={s.savedSection}>
            <button
              className={s.savedToggle}
              onClick={() => setShowSaved(!showSaved)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {savedProjects.length} saved project{savedProjects.length !== 1 ? "s" : ""}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
                style={{ transform: showSaved ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {showSaved && (
              <div className={s.savedPanel}>
                <div className={s.savedPanelHead}>Recent projects</div>
                {savedProjects.map((proj) => (
                  <button
                    key={proj.id}
                    className={s.savedItem}
                    onClick={() => onOpenSaved(proj.id)}
                  >
                    <div>
                      <span className={s.savedItemName}>{proj.name}</span>
                      <span className={s.savedItemMeta}>
                        {proj.floorCount}F &middot; {proj.roomCount}R
                      </span>
                    </div>
                    <span className={s.savedItemDate}>
                      {new Date(proj.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Footnote ────────────────────────────────────────── */}
        <div className={s.footnote}>
          <span className={s.footnoteGlyph}>{"\u25B2"}</span>
          Trained on 240,000 architectural drawings &middot; Powered by GPT-4o
        </div>
      </div>
    </div>
  );
}
