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

  if (loading) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: UI.bg.canvas,
          zIndex: 10,
        }}
      >
        <div style={{ width: 320, textAlign: "center" }}>
          {/* Animated cube */}
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 24px",
              border: `2px solid ${UI.accent.cyan}`,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "spin 2s linear infinite",
            }}
          >
            <FileBox size={28} color={UI.accent.cyan} />
          </div>

          <p style={{ color: UI.text.primary, fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
            Loading IFC Model
          </p>
          <p style={{ color: UI.text.secondary, fontSize: 13, marginBottom: 20 }}>{loadMessage}</p>

          {/* Progress bar */}
          <div
            style={{
              width: "100%",
              height: 4,
              borderRadius: 2,
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.max(loadProgress, 2)}%`,
                background: `linear-gradient(90deg, ${UI.accent.cyan}, ${UI.accent.blue})`,
                borderRadius: 2,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <p style={{ color: UI.text.tertiary, fontSize: 12, marginTop: 8 }}>{Math.round(loadProgress)}%</p>
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
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: UI.bg.canvas,
        zIndex: 10,
        cursor: "pointer",
      }}
      onClick={handleBrowse}
    >
      <input ref={inputRef} type="file" accept=".ifc" style={{ display: "none" }} onChange={handleInputChange} />

      <div
        style={{
          width: "min(90%, 480px)",
          padding: 40,
          borderRadius: UI.radius.xl,
          border: `2px dashed ${dragOver ? UI.accent.cyan : "rgba(255,255,255,0.12)"}`,
          background: dragOver ? "rgba(0,245,255,0.03)" : "rgba(255,255,255,0.02)",
          textAlign: "center",
          transition: UI.transition,
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: "rgba(79,138,255,0.06)",
            border: `1px solid rgba(79,138,255,0.12)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px",
            animation: "float 3s ease-in-out infinite",
          }}
        >
          <Upload size={32} color={UI.accent.blue} style={{ opacity: 0.8 }} />
        </div>

        <p style={{ color: UI.text.primary, fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          Drag & drop your IFC file here
        </p>
        <p style={{ color: UI.text.secondary, fontSize: 14, marginBottom: 20 }}>or click to browse</p>

        <button
          onClick={(e) => {
            e.stopPropagation();
            handleBrowse();
          }}
          style={{
            padding: "10px 28px",
            borderRadius: UI.radius.md,
            border: `1px solid ${UI.accent.blue}`,
            background: "rgba(79,138,255,0.1)",
            color: UI.accent.blue,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            transition: UI.transition,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(79,138,255,0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(79,138,255,0.1)";
          }}
        >
          Browse Files
        </button>

        <p style={{ color: UI.text.tertiary, fontSize: 12, marginTop: 16 }}>
          Supports .ifc files up to 500 MB · IFC2x3 & IFC4
        </p>
      </div>

      {/* Sample models */}
      <div style={{ marginTop: 32, textAlign: "center" }}>
        <p style={{ color: UI.text.tertiary, fontSize: 13, marginBottom: 12 }}>
          🚀 Try with a sample model:
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
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: UI.radius.sm,
                  border: `1px solid ${UI.border.subtle}`,
                  background: "rgba(255,255,255,0.02)",
                  color: UI.text.secondary,
                  fontSize: 13,
                  cursor: isFetching ? "wait" : "pointer",
                  transition: "all 0.2s ease",
                  opacity: isFetching ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isFetching) {
                    e.currentTarget.style.borderColor = "rgba(79,138,255,0.3)";
                    e.currentTarget.style.color = UI.text.primary;
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = UI.border.subtle;
                  e.currentTarget.style.color = UI.text.secondary;
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <Icon size={14} />
                <span>{isFetching ? (fetchProgress > 0 ? `${fetchProgress}%` : "Loading...") : sample.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <style>{`@keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }`}</style>
    </div>
  );
}
