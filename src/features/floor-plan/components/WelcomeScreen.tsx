"use client";

import React, { useState } from "react";

interface WelcomeScreenProps {
  onGenerateFromPrompt: (prompt: string) => void;
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

export function WelcomeScreen({
  onGenerateFromPrompt,
  onOpenSample,
  onStartBlank,
  onOpenSaved,
  onImportFile,
  savedProjects,
}: WelcomeScreenProps) {
  const [prompt, setPrompt] = useState("");
  const [showSaved, setShowSaved] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) onGenerateFromPrompt(prompt.trim());
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-50 via-white to-blue-50/30">
      <div className="w-full max-w-2xl px-6">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/20">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Floor Plan Editor</h1>
          <p className="mt-2 text-sm text-gray-500">
            Describe your ideal layout and AI will generate a professional floor plan
          </p>
        </div>

        {/* AI Generation Input */}
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your floor plan... e.g., '3BHK apartment with spacious living room, modular kitchen, master bedroom with ensuite bathroom'"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 pr-24 text-sm text-gray-800 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit(e);
              }}
            />
            <button
              type="submit"
              disabled={!prompt.trim()}
              className="absolute bottom-3 right-3 rounded-lg bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
            >
              Generate
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-400">
            Press Ctrl+Enter to generate
          </p>
        </form>

        {/* Quick Templates */}
        <div className="mb-6">
          <p className="mb-2.5 text-center text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Quick Templates
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.label}
                onClick={() => onGenerateFromPrompt(tpl.prompt)}
                className="group flex flex-col items-center gap-2 rounded-xl border border-gray-100 bg-white p-3 text-center shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50 transition-colors group-hover:bg-blue-50">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400 group-hover:text-blue-500">
                    <path d={tpl.icon} strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span className="text-[11px] font-medium text-gray-600 group-hover:text-gray-800">
                  {tpl.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="mb-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">or</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onStartBlank}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mr-1.5 inline-block">
              <path d="M12 4v16m8-8H4" strokeLinecap="round"/>
            </svg>
            Start from Scratch
          </button>

          <button
            onClick={onOpenSample}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mr-1.5 inline-block">
              <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 7h1m-1 4h1m4-4h1m-1 4h1" strokeLinecap="round"/>
            </svg>
            Open Sample 2BHK
          </button>

          <button
            onClick={onImportFile}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mr-1.5 inline-block">
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Import File
          </button>

          {savedProjects.length > 0 && (
            <button
              onClick={() => setShowSaved(!showSaved)}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mr-1.5 inline-block">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Saved ({savedProjects.length})
            </button>
          )}
        </div>

        {/* Saved projects list */}
        {showSaved && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Recent Projects
            </p>
            {savedProjects.length > 0 ? (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {savedProjects.map((proj) => (
                  <button
                    key={proj.id}
                    onClick={() => onOpenSaved(proj.id)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-gray-50"
                  >
                    <div>
                      <span className="text-xs font-medium text-gray-700">{proj.name}</span>
                      <span className="ml-2 text-[10px] text-gray-400">
                        {proj.floorCount}F &middot; {proj.roomCount}R
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-400">
                      {new Date(proj.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-gray-400">No saved projects yet</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
