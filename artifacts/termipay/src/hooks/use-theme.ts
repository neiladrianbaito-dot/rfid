import { useEffect, useState } from "react";

const THEME_KEY = "termipay_theme";
const THEME_EVENT = "termipay_theme_change";

export type Theme = "light" | "dark";

function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_KEY) as Theme | null;

  if (stored === "dark" || stored === "light") {
    return stored;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyDocumentTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined"
      ? readStoredTheme()
      : "light"
  );

  useEffect(() => {
    const currentTheme = readStoredTheme();

    setTheme(currentTheme);
    applyDocumentTheme(currentTheme);

    const onThemeChange = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;

      if (next === "dark" || next === "light") {
        setTheme(next);
        applyDocumentTheme(next);
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (
        e.key === THEME_KEY &&
        (e.newValue === "dark" || e.newValue === "light")
      ) {
        const next = e.newValue as Theme;

        setTheme(next);
        applyDocumentTheme(next);
      }
    };

    window.addEventListener(
      THEME_EVENT,
      onThemeChange as EventListener
    );

    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(
        THEME_EVENT,
        onThemeChange as EventListener
      );

      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const applyTheme = (next: Theme) => {
    window.localStorage.setItem(THEME_KEY, next);

    applyDocumentTheme(next);

    window.dispatchEvent(
      new CustomEvent(THEME_EVENT, {
        detail: next,
      })
    );

    setTheme(next);
  };

  const toggleTheme = () => {
    applyTheme(theme === "light" ? "dark" : "light");
  };

  return {
    theme,
    isDark: theme === "dark",
    toggleTheme,
    setTheme: applyTheme,
  };
}