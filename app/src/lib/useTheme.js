import { useState, useEffect } from "react";

const THEME_KEY = "ecs_theme";

// Apply immediately on module load to avoid flash
const saved = localStorage.getItem(THEME_KEY) || "dark";
document.documentElement.setAttribute("data-theme", saved);

export function useTheme() {
  const [theme, setThemeState] = useState(saved);

  const setTheme = (updater) => {
    setThemeState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  };

  return { theme, setTheme };
}