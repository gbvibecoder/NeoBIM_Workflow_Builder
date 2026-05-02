"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type LiveChatTheme = "light" | "dark";

interface Ctx {
  theme: LiveChatTheme;
  toggleTheme: () => void;
  setTheme: (t: LiveChatTheme) => void;
}

const ThemeCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "livechat-admin-theme";

function readInitial(): LiveChatTheme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return "light";
}

export function LiveChatThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<LiveChatTheme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setThemeState(readInitial());
    setHydrated(true);
  }, []);

  const setTheme = (t: LiveChatTheme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* localStorage blocked — degrade silently */
    }
  };

  const toggleTheme = () =>
    setTheme(theme === "light" ? "dark" : "light");

  return (
    <ThemeCtx.Provider value={{ theme, toggleTheme, setTheme }}>
      <div
        data-lc-theme={hydrated ? theme : "light"}
        style={{ display: "contents" }}
      >
        {children}
      </div>
    </ThemeCtx.Provider>
  );
}

export function useLiveChatTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx)
    throw new Error(
      "useLiveChatTheme must be used within LiveChatThemeProvider",
    );
  return ctx;
}
