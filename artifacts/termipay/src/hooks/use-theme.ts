import { useEffect, useState } from "react";

const THEME_KEY = "termipay_theme";
const THEME_EVENT = "termipay_theme_change";
export type Theme = "light" | "dark";

function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_KEY) as Theme | null;
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined" ? readStoredTheme() : "light"
  );

  useEffect(() => {
    // in case of SSR / first mount timing, re-sync once mounted
    setTheme(readStoredTheme());

    // same-tab sync: fires whenever ANY component on this page calls toggleTheme/setThemeValue
    const onThemeChange = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      if (next === "dark" || next === "light") setTheme(next);
    };
    window.addEventListener(THEME_EVENT, onThemeChange as EventListener);

    // cross-tab sync: fires when theme changes in another browser tab
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY && (e.newValue === "dark" || e.newValue === "light")) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(THEME_EVENT, onThemeChange as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const applyTheme = (next: Theme) => {
    window.localStorage.setItem(THEME_KEY, next);
    // notify every other component using useTheme() in this same tab, instantly
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
    setTheme(next);
  };

  const toggleTheme = () => {
    applyTheme(theme === "light" ? "dark" : "light");
  };

  return { theme, isDark: theme === "dark", toggleTheme, setTheme: applyTheme };
}