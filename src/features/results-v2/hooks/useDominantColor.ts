"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Extract a single dominant color from an image (or video's poster frame).
 *
 * Strategy: once the source reports loaded/ready, draw it onto a 4×4 pixel
 * offscreen canvas — the downscale acts as a cheap average over the image.
 * We read the center pixel as the dominant value and cache it in state.
 *
 * Runs exactly once per source URL; null until the read lands. Any failure
 * path (CORS taint, missing canvas, element unmounted) returns null silently
 * so the caller degrades gracefully to the workflow accent.
 */
export function useDominantColor(source: string | null | undefined, fallback?: string): string | null {
  // Keyed state — color is tied to the source it was sampled from. When the
  // source changes we derive "stale" via a render-time compare instead of
  // setting state synchronously inside the effect body.
  const [entry, setEntry] = useState<{ source: string; color: string } | null>(null);
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!source) {
      firedRef.current = null;
      return;
    }
    if (firedRef.current === source) return;
    firedRef.current = source;

    let cancelled = false;
    const extract = (el: HTMLImageElement | HTMLVideoElement, w: number, h: number) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(el, 0, 0, w, h, 0, 0, 4, 4);
        const data = ctx.getImageData(1, 1, 2, 2).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (n === 0) return;
        const avgR = Math.round(r / n);
        const avgG = Math.round(g / n);
        const avgB = Math.round(b / n);
        // Clamp very dark averages — readers see pure black glow as "broken".
        const boosted = boostLuminance(avgR, avgG, avgB);
        if (!cancelled) setEntry({ source, color: rgbToHex(boosted.r, boosted.g, boosted.b) });
      } catch {
        /* CORS-tainted canvas or stale element — silent fallback */
      }
    };

    const imgSrcLike = isImageSrc(source);
    if (imgSrcLike) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        if (cancelled) return;
        extract(img, img.naturalWidth || 1, img.naturalHeight || 1);
      };
      img.onerror = () => {
        /* silent */
      };
      img.src = source;
    } else {
      // Video path — create a hidden offscreen video, seek to 0.5s, then sample.
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = source;
      const onLoaded = () => {
        if (cancelled) return;
        try {
          video.currentTime = Math.min(0.5, (video.duration || 1) * 0.1);
        } catch {
          extract(video, video.videoWidth || 1, video.videoHeight || 1);
        }
      };
      const onSeeked = () => {
        if (cancelled) return;
        extract(video, video.videoWidth || 1, video.videoHeight || 1);
      };
      video.addEventListener("loadeddata", onLoaded);
      video.addEventListener("seeked", onSeeked);
      // Kick off load
      video.load();
      return () => {
        cancelled = true;
        video.removeEventListener("loadeddata", onLoaded);
        video.removeEventListener("seeked", onSeeked);
        video.src = "";
      };
    }

    return () => {
      cancelled = true;
    };
  }, [source]);

  const color = entry && entry.source === source ? entry.color : null;
  return color ?? (fallback ?? null);
}

function isImageSrc(src: string): boolean {
  return /\.(png|jpe?g|webp|avif|gif|svg)(\?|#|$)/i.test(src);
}

function boostLuminance(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const max = Math.max(r, g, b);
  if (max >= 80) return { r, g, b };
  const scale = 80 / Math.max(max, 1);
  return {
    r: Math.min(255, Math.round(r * scale)),
    g: Math.min(255, Math.round(g * scale)),
    b: Math.min(255, Math.round(b * scale)),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`;
}
