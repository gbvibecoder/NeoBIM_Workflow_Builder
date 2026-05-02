"use client";

import React, { useCallback, useRef, useState } from "react";
import s from "./UploadZone.module.css";

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  onError?: (message: string) => void;
  loading: boolean;
  loadProgress: number;
  loadMessage: string;
}

const SAMPLE_MODELS = [
  { id: "house", label: "House Model", size: "~1 MB" },
  { id: "office", label: "Office Building", size: "~2 MB" },
  { id: "structure", label: "Structure", size: "~800 KB" },
  { id: "mep", label: "MEP Systems", size: "~1.5 MB" },
];

const SAMPLE_URLS: Record<string, string> = {
  house: "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Munkerud/Munkerud_hus6_BE.ifc",
  office: "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Munkerud/Munkerud_hus6_ARC.ifc",
  structure: "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Munkerud/Munkerud_hus6_STR.ifc",
  mep: "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Munkerud/Munkerud_hus6_VVS.ifc",
};

/* Isometric SVG thumbnails per sample model type */
function SampleThumbSvg({ type }: { type: string }) {
  switch (type) {
    case "house":
      return (
        <svg viewBox="0 0 200 125" className={s.sampleThumbSvg} aria-hidden="true">
          <polygon points="40,80 100,50 160,80 100,110" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
          <polygon points="40,80 100,50 100,30 40,60" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
          <polygon points="100,50 160,80 160,60 100,30" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
        </svg>
      );
    case "office":
      return (
        <svg viewBox="0 0 200 125" className={s.sampleThumbSvg} aria-hidden="true">
          <polygon points="60,100 100,80 100,30 60,50" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
          <polygon points="100,80 140,100 140,50 100,30" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
          <polygon points="60,50 100,30 140,50 100,70" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
          <line x1="70" y1="60" x2="70" y2="100" stroke="rgba(44,62,80,.5)" strokeWidth="0.8" />
          <line x1="80" y1="56" x2="80" y2="98" stroke="rgba(44,62,80,.5)" strokeWidth="0.8" />
          <line x1="90" y1="52" x2="90" y2="96" stroke="rgba(44,62,80,.5)" strokeWidth="0.8" />
          <line x1="110" y1="76" x2="110" y2="96" stroke="rgba(44,62,80,.5)" strokeWidth="0.8" />
          <line x1="120" y1="74" x2="120" y2="98" stroke="rgba(44,62,80,.5)" strokeWidth="0.8" />
          <line x1="130" y1="72" x2="130" y2="100" stroke="rgba(44,62,80,.5)" strokeWidth="0.8" />
        </svg>
      );
    case "structure":
      return (
        <svg viewBox="0 0 200 125" className={s.sampleThumbSvg} aria-hidden="true">
          <line x1="40" y1="100" x2="40" y2="40" stroke="rgba(44,62,80,.6)" strokeWidth="1.5" />
          <line x1="80" y1="110" x2="80" y2="50" stroke="rgba(44,62,80,.6)" strokeWidth="1.5" />
          <line x1="120" y1="110" x2="120" y2="50" stroke="rgba(44,62,80,.6)" strokeWidth="1.5" />
          <line x1="160" y1="100" x2="160" y2="40" stroke="rgba(44,62,80,.6)" strokeWidth="1.5" />
          <line x1="40" y1="40" x2="160" y2="40" stroke="rgba(44,62,80,.6)" strokeWidth="1.5" />
          <line x1="40" y1="70" x2="160" y2="70" stroke="rgba(44,62,80,.6)" strokeWidth="1.5" />
          <line x1="40" y1="100" x2="160" y2="100" stroke="rgba(44,62,80,.6)" strokeWidth="1.5" />
        </svg>
      );
    case "mep":
      return (
        <svg viewBox="0 0 200 125" className={s.sampleThumbSvg} aria-hidden="true">
          <line x1="20" y1="60" x2="180" y2="60" stroke="rgba(44,62,80,.6)" strokeWidth="3" />
          <line x1="60" y1="60" x2="60" y2="100" stroke="rgba(44,62,80,.6)" strokeWidth="3" />
          <line x1="100" y1="60" x2="100" y2="20" stroke="rgba(44,62,80,.6)" strokeWidth="3" />
          <line x1="140" y1="60" x2="140" y2="100" stroke="rgba(44,62,80,.6)" strokeWidth="3" />
          <circle cx="60" cy="100" r="6" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1" />
          <circle cx="100" cy="20" r="6" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1" />
          <circle cx="140" cy="100" r="6" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 200 125" className={s.sampleThumbSvg} aria-hidden="true">
          <polygon points="40,80 100,50 160,80 100,110" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
          <polygon points="40,80 100,50 100,30 40,60" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
          <polygon points="100,50 160,80 160,60 100,30" fill="rgba(44,62,80,.06)" stroke="rgba(44,62,80,.6)" strokeWidth="1.2" />
        </svg>
      );
  }
}

export function UploadZone({ onFileSelected, onError, loading, loadProgress, loadMessage }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fetchingSample, setFetchingSample] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState(0);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith(".ifc")) {
        onError?.("Please upload a valid .ifc file");
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        onError?.("File exceeds 500 MB limit. Large files may cause performance issues.");
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected, onError]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleBrowse = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleFile]
  );

  const handleSampleClick = useCallback(
    async (id: string) => {
      const url = SAMPLE_URLS[id];
      if (!url) return;
      setFetchingSample(id);
      setFetchProgress(0);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch sample");
        const contentLength = res.headers.get("content-length");
        const total = contentLength ? parseInt(contentLength, 10) : 0;

        /* Stream response for progress tracking */
        let loaded = 0;
        const reader = res.body?.getReader();
        const chunks: Uint8Array[] = [];
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            if (total > 0) setFetchProgress(Math.round((loaded / total) * 100));
          }
        }
        const blob = new Blob(chunks as BlobPart[]);
        const file = new File([blob], `${id}-sample.ifc`, { type: "application/octet-stream" });
        onFileSelected(file);
      } catch {
        onError?.("Failed to load sample model. Please try uploading your own IFC file.");
      } finally {
        setFetchingSample(null);
      }
    },
    [onFileSelected, onError]
  );

  /* ── Loading state ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div className={`${s.page} ${s.loadingWrap}`}>
        <div className={s.backdrop} aria-hidden="true" />
        <div className={s.loadingInner}>
          <div className={s.loadingIcon}>
            <svg className={s.loadingIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className={s.loadingTitle}>Loading IFC Model</p>
          <p className={s.loadingMessage}>{loadMessage}</p>
          <div className={s.loadingTrack}>
            <div className={s.loadingFill} style={{ width: `${Math.max(loadProgress, 2)}%` }} />
          </div>
          <p className={s.loadingPct}>{Math.round(loadProgress)}%</p>
        </div>
      </div>
    );
  }

  /* ── Upload state ──────────────────────────────────────────── */
  return (
    <div className={s.page}>
      <div className={s.backdrop} aria-hidden="true" />
      <input ref={inputRef} type="file" accept=".ifc" style={{ display: "none" }} onChange={handleInputChange} />

      <div className={s.content}>
        {/* ── Hero ── */}
        <div className={s.hero}>
          <span className={s.eyebrow}>
            <span className={s.eyebrowDot} />
            IFC Viewer &middot; Browser-native BIM
          </span>
          <h1 className={s.heroTitle}>
            <span className={s.heroWord} style={{ animationDelay: "0.05s" }}>Open </span>
            <span className={s.heroWord} style={{ animationDelay: "0.11s" }}>any </span>
            <em className={s.heroWord} style={{ animationDelay: "0.17s" }}>BIM model.</em>
          </h1>
          <p className={s.heroLead}>
            Open any IFC2x3, IFC4, or IFC4x3 model in a fast, browser-based
            viewer. No installs, no plugins — drag a file in and explore the
            geometry, properties, and structure tree.
          </p>
        </div>

        {/* ── Two-column layout ── */}
        <div className={s.layout}>
          {/* LEFT: Drop zone */}
          <div
            className={`${s.dropzone} ${dragOver ? s.dropzoneActive : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleBrowse}
            aria-label="Upload IFC file"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleBrowse(); }}
          >
            <div className={s.dropIcon}>
              <svg className={s.dropIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className={s.dropTitle}>Drag &amp; drop your IFC</h3>
            <p className={s.dropSub}>
              Or browse from your computer. Files up to 500 MB process
              locally — your model never leaves your browser.
            </p>
            <button
              className={s.browseBtn}
              type="button"
              onClick={(e) => { e.stopPropagation(); handleBrowse(); }}
            >
              <span className={s.browseBtnContent}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Browse files</span>
              </span>
            </button>
            <div className={s.formats}>
              <span className={s.formatsItem}>IFC2x3</span>
              <span className={s.formatsSep} />
              <span className={s.formatsItem}>IFC4</span>
              <span className={s.formatsSep} />
              <span className={s.formatsItem}>IFC4x3</span>
              <span className={s.formatsSep} />
              <span className={s.formatsItem}>up to 500 MB</span>
            </div>
          </div>

          {/* RIGHT: Capabilities */}
          <div className={s.capabilities}>
            <div className={s.capEyebrow}>Once loaded</div>
            <div className={s.capTitle}>
              Inspect every <em>element</em>
            </div>
            <div className={s.capList}>
              <div className={s.capRow}>
                <div className={s.capIcon}>
                  <svg className={s.capIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M3 9l9-7 9 7v13H3z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 22V12h6v10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className={s.capBody}>
                  <div className={s.capName}>Structure tree</div>
                  <div className={s.capDesc}>Browse storeys, spaces, walls, slabs, doors</div>
                </div>
              </div>
              <div className={s.capRow}>
                <div className={s.capIcon}>
                  <svg className={s.capIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 9h6v6H9z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className={s.capBody}>
                  <div className={s.capName}>Properties panel</div>
                  <div className={s.capDesc}>Read every Pset, attribute, and quantity</div>
                </div>
              </div>
              <div className={s.capRow}>
                <div className={s.capIcon}>
                  <svg className={s.capIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className={s.capBody}>
                  <div className={s.capName}>Editor</div>
                  <div className={s.capDesc}>Add a floor, swap a wall, rename a space</div>
                </div>
              </div>
              <div className={s.capRow}>
                <div className={s.capIcon}>
                  <svg className={s.capIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className={s.capBody}>
                  <div className={s.capName}>Enhance with AI</div>
                  <div className={s.capDesc}>Apply PBR materials, HDRI, photoreal grade</div>
                  <span className={s.capTag}>Beta</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Sample models ── */}
        <div className={s.samples}>
          <div className={s.samplesHead}>
            <div>
              <div className={s.samplesTitle}>Or try a sample model</div>
              <div className={s.samplesSub}>Public IFC files curated for testing</div>
            </div>
          </div>
          <div className={s.sampleGrid}>
            {SAMPLE_MODELS.map((sample) => {
              const isFetching = fetchingSample === sample.id;
              return (
                <button
                  key={sample.id}
                  className={`${s.sampleCard} ${isFetching ? s.sampleCardLoading : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isFetching && !fetchingSample) handleSampleClick(sample.id);
                  }}
                  disabled={fetchingSample !== null && fetchingSample !== sample.id}
                  aria-label={`${sample.label} sample`}
                  aria-disabled={fetchingSample !== null && fetchingSample !== sample.id}
                >
                  <div className={s.sampleThumb}>
                    <SampleThumbSvg type={sample.id} />
                  </div>
                  <div className={s.sampleInfo}>
                    <div>
                      <div className={s.sampleName}>
                        {isFetching
                          ? fetchProgress > 0 ? `Loading ${fetchProgress}%` : "Loading\u2026"
                          : sample.label}
                      </div>
                      <div className={s.sampleMeta}>{sample.size} &middot; IFC2x3</div>
                    </div>
                    <svg className={s.sampleArrow} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  {isFetching && fetchProgress > 0 && (
                    <div className={s.sampleProgress}>
                      <div className={s.sampleProgressFill} style={{ width: `${fetchProgress}%` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Footnote ── */}
        <div className={s.footnote}>
          <span className={s.footnoteGlyph}>{"\u25B2"}</span>
          Powered by web-ifc &middot; Three.js &middot; Local processing
        </div>
      </div>
    </div>
  );
}
