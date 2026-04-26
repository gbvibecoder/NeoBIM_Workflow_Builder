"use client";

import { UserMenu } from "@/shared/components/UserMenu";

interface HeaderProps {
  /**
   * Color tone for the floating UserMenu trigger. `light` for cream pages
   * (result, BOQ, floor-plan, 3d-render); `dark` for canvas / IFC viewer /
   * immersive landing where the page surface is dark.
   */
  theme?: "dark" | "light";
}

/**
 * Phase 5.2 — TRUE floating chrome.
 *
 * The previous Header reserved ~56px of flex space in the dashboard
 * column. On dark pages (IFC viewer, canvas, dashboard landing) the
 * layout's #0a0c10 background showed through the transparent strip,
 * producing a visible black horizontal bar above the page content.
 *
 * Now: Header takes ZERO flex space. The avatar floats `position: fixed`
 * top-right (just like the support chat floats bottom-right). The
 * canvas-toolbar-slot also floats `position: fixed` top-center — same
 * portal contract, just no longer wrapped inside a horizontal bar.
 *
 * Pages render edge-to-edge. The 56px-tall black strip is gone.
 */
export function Header({ theme = "light" }: HeaderProps) {
  const isDark = theme === "dark";

  return (
    <>
      {/* Canvas toolbar portal target — fixed top-center. CanvasToolbar.tsx
          portals into `#canvas-toolbar-slot`; the slot's fixed positioning
          is what gives the toolbar its top-center anchor. Hidden on mobile
          since CanvasToolbar's mobile bar is sticky-bottom and bypasses the
          slot. */}
      <div
        id="canvas-toolbar-slot"
        className="hidden md:flex"
        style={{
          position: "fixed",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 39,
          pointerEvents: "auto",
          alignItems: "center",
          justifyContent: "center",
        }}
      />

      {/* UserMenu — floating fixed top-right. Same architectural pattern
          as the bottom-right support chat: corner-only, no chrome strip,
          no reserved space, no horizontal bar. */}
      <div
        style={{
          position: "fixed",
          top: 12,
          right: 16,
          zIndex: 40,
          pointerEvents: "auto",
        }}
      >
        <UserMenu tone={isDark ? "dark" : "light"} />
      </div>
    </>
  );
}
