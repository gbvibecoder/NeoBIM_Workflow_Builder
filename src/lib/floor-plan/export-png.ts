/**
 * PNG Export for Floor Plan
 *
 * Captures the Konva stage as a PNG image.
 * Supports multiple DPI options and transparent background.
 */

import type Konva from "konva";

export type PngDpi = 72 | 150 | 300;

export interface PngExportOptions {
  dpi: PngDpi;
  transparentBackground: boolean;
}

export function exportStageToPng(
  stage: Konva.Stage,
  filename: string,
  options: PngExportOptions
): void {
  // DPI scaling: 72 DPI = 1x, 150 DPI = ~2.08x, 300 DPI = ~4.17x
  const pixelRatio = options.dpi / 72;

  const dataUrl = stage.toDataURL({
    pixelRatio,
    mimeType: "image/png",
    quality: 1,
  });

  // If not transparent, we need to add a white background
  // Konva renders with transparent bg by default
  if (!options.transparentBackground) {
    // Create a canvas to composite white bg + stage content
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;

      // White background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw stage content on top
      ctx.drawImage(img, 0, 0);

      // Download
      canvas.toBlob((blob) => {
        if (!blob) return;
        downloadBlob(blob, filename);
      }, "image/png");
    };
    img.src = dataUrl;
  } else {
    // Transparent: download directly
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
