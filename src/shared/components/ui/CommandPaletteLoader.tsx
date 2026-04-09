"use client";

import dynamic from "next/dynamic";

// Keyboard-triggered only — load lazily on the client
const CommandPalette = dynamic(
  () => import("./CommandPalette").then((m) => m.CommandPalette),
  { ssr: false }
);

export function CommandPaletteLoader() {
  return <CommandPalette />;
}
