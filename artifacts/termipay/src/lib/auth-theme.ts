import { useLayoutEffect, useState } from "react";

export const THEME_KEY = "termipay_theme";
export type Theme = "light" | "dark";

/** Reads the theme synchronously so the very first paint is already correct. */
export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";

  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* ignore storage errors */
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useAuthTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Paint <html>/<body> with the theme color before the browser paints,
  // so there is never a white frame between page transitions.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    const prev = {
      rootBg: root.style.backgroundColor,
      bodyBg: body.style.backgroundColor,
      scheme: root.style.colorScheme,
    };

    const bg = theme === "dark" ? "#020617" : "#ffffff";
    root.style.backgroundColor = bg;
    body.style.backgroundColor = bg;
    root.style.colorScheme = theme;

    return () => {
      root.style.backgroundColor = prev.rootBg;
      body.style.backgroundColor = prev.bodyBg;
      root.style.colorScheme = prev.scheme;
    };
  }, [theme]);

  const toggleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore storage errors */
    }
    setTheme(next);
  };

  return { theme, isDark: theme === "dark", toggleTheme };
}