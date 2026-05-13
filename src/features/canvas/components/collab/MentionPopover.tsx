"use client";

/**
 * Z.CANVAS.COLLAB-COMPLETE Gap 4 — @mention autocomplete popover.
 * Positioned below the textarea, filtered by query string after "@".
 */

import React, { memo } from "react";
import { useCanvasTheme } from "@/features/canvas/stores/canvas-theme-store";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";

export interface MentionUser {
  id: string;
  name: string | null;
  email: string;
}

function initials(name: string | null, email: string): string {
  const src = name || email;
  return src.split(/[\s@]/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

interface MentionPopoverProps {
  users: MentionUser[];
  query: string;
  activeIndex: number;
  onSelect: (user: MentionUser) => void;
}

export const MentionPopover = memo(function MentionPopover({ users, query, activeIndex, onSelect }: MentionPopoverProps) {
  const { theme } = useCanvasTheme();
  const tk = useCanvasToken();

  const filtered = users.filter((u) => {
    const q = query.toLowerCase();
    const name = (u.name ?? "").toLowerCase();
    const email = u.email.toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  if (filtered.length === 0) {
    return (
              <div style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: 4,
          minWidth: 200, padding: "10px 12px",
          background: tk.mentionPopBg,
          border: `1px solid ${tk.mentionPopBorder}`,
          borderRadius: 8,
          boxShadow: tk.mentionPopShadow,
          zIndex: 60,
          fontSize: 12, fontStyle: "italic", color: tk.text3,
        }}>
          No matching collaborators
        </div>
    );
  }

  return (
          <div
        role="listbox"
        style={{
          position: "absolute", bottom: "100%", left: 0, marginBottom: 4,
          minWidth: 200, maxHeight: 200, overflowY: "auto",
          background: tk.mentionPopBg,
          border: `1px solid ${tk.mentionPopBorder}`,
          borderRadius: 8,
          boxShadow: tk.mentionPopShadow,
          zIndex: 60,
          padding: 4,
        }}
      >
        {filtered.map((user, i) => (
          <div
            key={user.id}
            role="option"
            aria-selected={i === activeIndex}
            onClick={() => onSelect(user)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px",
              borderRadius: 6,
              cursor: "pointer",
              background: i === activeIndex ? tk.mentionActive : "transparent",
              transition: "background 0.1s ease",
            }}
            onMouseEnter={(e) => {
              if (i !== activeIndex) e.currentTarget.style.background = tk.mentionHover;
            }}
            onMouseLeave={(e) => {
              if (i !== activeIndex) e.currentTarget.style.background = "transparent";
            }}
          >
            {/* Avatar */}
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              background: "linear-gradient(135deg, #C7D2FE, #A5B4FC)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 600, color: "#3730A3", flexShrink: 0,
            }}>
              {initials(user.name, user.email)}
            </div>
            {/* Name + email */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: tk.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user.name || user.email.split("@")[0]}
              </div>
              {user.name && (
                <div style={{ fontSize: 11, color: tk.text3, fontFamily: "var(--font-jetbrains), monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.email}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
  );
});
