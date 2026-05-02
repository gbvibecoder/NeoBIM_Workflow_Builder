"use client";

import { Sun, Moon } from "lucide-react";
import { useLiveChatTheme } from "./ThemeContext";
import s from "./admin-live-chat.module.css";

export function ThemeToggle() {
  const { theme, toggleTheme } = useLiveChatTheme();
  return (
    <button
      className={s.themeToggle}
      onClick={toggleTheme}
      title={
        theme === "light"
          ? "Switch to dark theme"
          : "Switch to light theme"
      }
      aria-label="Toggle theme"
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
