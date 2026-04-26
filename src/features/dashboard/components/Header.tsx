"use client";

import { UserMenu } from "@/shared/components/UserMenu";

interface HeaderProps {
  /**
   * When true, the header becomes a transparent overlay — no flex space
   * reservation. Used on immersive pages (dashboard landing hero) where
   * the 3D scene fills the full viewport and only the right-side action
   * pill needs to float above it.
   */
  floating?: boolean;
  /**
   * Color theme. `light` keeps cream-friendly chrome (default); `dark`
   * adapts the UserMenu trigger for canvas / IFC viewer / immersive
   * landing surfaces.
   */
  theme?: "dark" | "light";
}

/**
 * Phase 5 — chrome cleanup. The legacy dark grey header bar (search +
 * language + profile) was retired. Header now hosts only:
 *  - `canvas-toolbar-slot`: portal target for `CanvasToolbar.tsx`. Critical;
 *    keeping this id intact preserves the canvas-page toolbar behavior.
 *  - `<UserMenu />`: floating top-right avatar that opens a dropdown with
 *    identity, language pills, Settings, Refer & Earn, Sign out.
 *
 * The bar itself is transparent — no background, no border, no blur. It
 * still reserves ~52px in the flex column so page content does not
 * collide with the floating UserMenu. Immersive landing keeps absolute
 * positioning via `floating`.
 */
export function Header({ floating = false, theme = "light" }: HeaderProps) {
  const isDark = theme === "dark";

  return (
    <header
      className="dashboard-header"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "0 20px",
        minHeight: floating ? 48 : 56,
        flexShrink: 0,
        background: "transparent",
        borderBottom: "none",
        position: floating ? "absolute" : "relative",
        top: floating ? 0 : undefined,
        left: floating ? 0 : undefined,
        right: floating ? 0 : undefined,
        paddingTop: floating ? 12 : undefined,
        zIndex: 40,
        pointerEvents: floating ? "none" : undefined,
      }}
    >
      {/* Canvas toolbar portal target — preserved so CanvasToolbar.tsx
          continues to render its Manual mode / Share / Run pill into this
          slot. Stretches to fill horizontal space; portal owner controls
          alignment internally. */}
      <div
        id="canvas-toolbar-slot"
        className="hidden md:flex items-center justify-center"
        style={{ flex: 1, minWidth: 0, marginRight: 12, pointerEvents: "auto" }}
      />

      {/* UserMenu wrapper — explicit transparent bg + no border to defeat
          legacy `.dashboard-header > div:last-child` mobile rule in
          globals.css that would otherwise paint a green pill behind it
          on settings-page layouts. Inline styles win over the legacy
          rule since neither uses !important. */}
      <div
        style={{
          pointerEvents: "auto",
          background: "transparent",
          border: "none",
          padding: 0,
          borderRadius: 0,
        }}
      >
        <UserMenu tone={isDark ? "dark" : "light"} />
      </div>
    </header>
  );
}
