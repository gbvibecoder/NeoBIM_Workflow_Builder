"use client";

import React, { useCallback, useRef, useState } from "react";
import { Upload, FileBox, Building2, Warehouse, Wrench, Building } from "lucide-react";
import { UI } from "./constants";

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  onError?: (message: string) => void;
  loading: boolean;
  loadProgress: number;
  loadMessage: string;
}

const SAMPLE_MODELS = [
  { id: "house", label: "House Model", icon: Building2, size: "~1 MB" },
  { id: "office", label: "Office Building", icon: Building, size: "~2 MB" },
  { id: "structure", label: "Structure", icon: Warehouse, size: "~800 KB" },
  { id: "mep", label: "MEP Systems", icon: Wrench, size: "~1.5 MB" },
];

const SAMPLE_URLS: Record<string, string> = {
  house: "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Munkerud/Munkerud_hus6_BE.ifc",
  office: "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Munkerud/Munkerud_hus6_ARC.ifc",
  structure: "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Munkerud/Munkerud_hus6_STR.ifc",
  mep: "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/master/IFC%202x3/Munkerud/Munkerud_hus6_VVS.ifc",
};

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

  /* ── Elegant white theme tokens (empty + loading state only) ── */
  const INK = "#0B1220";
  const INK_SOFT = "#475569";
  const INK_MUTED = "#94A3B8";
  const BRAND = "#2563EB";
  const BRAND_SOFT = "#EFF4FF";
  const HAIRLINE = "#E5E9F2";
  const SURFACE = "#FFFFFF";
  /* Subtle architectural backdrop: soft white with faint grid + radial wash */
  const BACKDROP: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    background:
      "radial-gradient(1200px 600px at 50% -10%, #EEF3FF 0%, rgba(238,243,255,0) 60%)," +
      "radial-gradient(900px 500px at 90% 110%, #F5F7FB 0%, rgba(245,247,251,0) 60%)," +
      "linear-gradient(180deg, #FFFFFF 0%, #FAFBFD 100%)",
    zIndex: 10,
  };
  const GRID_OVERLAY: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(15,23,42,0.04) 1px, transparent 1px)," +
      "linear-gradient(90deg, rgba(15,23,42,0.04) 1px, transparent 1px)",
    backgroundSize: "32px 32px",
    maskImage: "radial-gradient(ellipse at center, #000 40%, transparent 80%)",
    WebkitMaskImage: "radial-gradient(ellipse at center, #000 40%, transparent 80%)",
    pointerEvents: "none",
  };

  if (loading) {
    return (
      <div
        style={{
          ...BACKDROP,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={GRID_OVERLAY} />
        <div style={{ width: 340, textAlign: "center", position: "relative" }}>
          <div
            style={{
              width: 72,
              height: 72,
              margin: "0 auto 24px",
              borderRadius: 18,
              background: SURFACE,
              border: `1px solid ${HAIRLINE}`,
              boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "spin 2.4s linear infinite",
            }}
          >
            <FileBox size={30} color={BRAND} />
          </div>
          <p style={{ color: INK, fontSize: 16, fontWeight: 600, marginBottom: 6, letterSpacing: "-0.01em" }}>
            Loading IFC Model
          </p>
          <p style={{ color: INK_SOFT, fontSize: 13, marginBottom: 20 }}>{loadMessage}</p>
          <div
            style={{
              width: "100%",
              height: 6,
              borderRadius: 999,
              background: "#EEF1F7",
              overflow: "hidden",
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.max(loadProgress, 2)}%`,
                background: `linear-gradient(90deg, #60A5FA, ${BRAND})`,
                borderRadius: 999,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <p style={{ color: INK_MUTED, fontSize: 12, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(loadProgress)}%
          </p>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        ...BACKDROP,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
      }}
    >
      <div style={GRID_OVERLAY} />
      <input ref={inputRef} type="file" accept=".ifc" style={{ display: "none" }} onChange={handleInputChange} />

      {/* Eyebrow */}
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderRadius: 999,
          background: SURFACE,
          border: `1px solid ${HAIRLINE}`,
          boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
          marginBottom: 18,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: BRAND }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: INK_SOFT, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          IFC Viewer
        </span>
      </div>

      <h1
        style={{
          position: "relative",
          margin: 0,
          marginBottom: 8,
          color: INK,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          textAlign: "center",
        }}
      >
        Bring your building model to life
      </h1>
      <p
        style={{
          position: "relative",
          margin: 0,
          marginBottom: 28,
          color: INK_SOFT,
          fontSize: 15,
          textAlign: "center",
          maxWidth: 520,
          lineHeight: 1.55,
        }}
      >
        Drop an IFC file to explore geometry, properties, and spatial structure in a high-fidelity 3D viewer.
      </p>

      {/* Upload card */}
      <div
        onClick={handleBrowse}
        style={{
          position: "relative",
          width: "min(92%, 560px)",
          padding: 36,
          borderRadius: 20,
          border: `1.5px dashed ${dragOver ? BRAND : "#CBD5E1"}`,
          background: dragOver ? BRAND_SOFT : SURFACE,
          textAlign: "center",
          transition: "all 0.2s ease",
          cursor: "pointer",
          boxShadow: dragOver
            ? "0 20px 50px rgba(37,99,235,0.12)"
            : "0 12px 40px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
        }}
      >
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: 20,
            background: `linear-gradient(180deg, ${BRAND_SOFT}, #FFFFFF)`,
            border: `1px solid ${HAIRLINE}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 22px",
            boxShadow: "inset 0 -2px 6px rgba(37,99,235,0.06), 0 6px 16px rgba(37,99,235,0.10)",
            animation: "float 3.2s ease-in-out infinite",
          }}
        >
          <Upload size={30} color={BRAND} />
        </div>

        <p style={{ color: INK, fontSize: 18, fontWeight: 600, marginBottom: 6, letterSpacing: "-0.01em" }}>
          Drag &amp; drop your IFC file here
        </p>
        <p style={{ color: INK_SOFT, fontSize: 14, marginBottom: 22 }}>or click to browse from your computer</p>

        <button
          onClick={(e) => {
            e.stopPropagation();
            handleBrowse();
          }}
          style={{
            padding: "11px 26px",
            borderRadius: 10,
            border: "1px solid transparent",
            background: BRAND,
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.18s ease",
            boxShadow: "0 8px 20px rgba(37,99,235,0.25), inset 0 1px 0 rgba(255,255,255,0.25)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#1D4ED8";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = BRAND;
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          Browse Files
        </button>

        <p style={{ color: INK_MUTED, fontSize: 12, marginTop: 18 }}>
          Supports <strong style={{ color: INK_SOFT, fontWeight: 600 }}>.ifc</strong> files up to 500 MB · IFC2x3 &amp; IFC4
        </p>
      </div>

      {/* Sample models */}
      <div style={{ position: "relative", marginTop: 32, textAlign: "center" }}>
        <p style={{ color: INK_SOFT, fontSize: 12, marginBottom: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Or try a sample model
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {SAMPLE_MODELS.map((sample) => {
            const Icon = sample.icon;
            const isFetching = fetchingSample === sample.id;
            return (
              <button
                key={sample.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isFetching) handleSampleClick(sample.id);
                }}
                disabled={isFetching}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 16px",
                  borderRadius: 10,
                  border: `1px solid ${HAIRLINE}`,
                  background: SURFACE,
                  color: INK_SOFT,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isFetching ? "wait" : "pointer",
                  transition: "all 0.18s ease",
                  opacity: isFetching ? 0.6 : 1,
                  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                }}
                onMouseEnter={(e) => {
                  if (!isFetching) {
                    e.currentTarget.style.borderColor = "#BFD2FF";
                    e.currentTarget.style.color = INK;
                    e.currentTarget.style.background = BRAND_SOFT;
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 8px 18px rgba(37,99,235,0.10)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = HAIRLINE;
                  e.currentTarget.style.color = INK_SOFT;
                  e.currentTarget.style.background = SURFACE;
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04)";
                }}
              >
                <Icon size={14} color={BRAND} />
                <span>{isFetching ? (fetchProgress > 0 ? `${fetchProgress}%` : "Loading…") : sample.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <style>{`@keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }`}</style>
    </div>
  );
}
