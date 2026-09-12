import { useEffect, useState } from "react";
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY, type Theme } from "./theme.js";

export function ThemeToggle() {
  const [theme, setTheme] = useState(() =>
    readStoredTheme(localStorage.getItem(THEME_STORAGE_KEY)),
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function choose(next: Theme) {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setTheme(next);
    applyTheme(next);
  }

  return (
    <fieldset className="theme-switch">
      <legend>Appearance</legend>
      <div className="theme-switch-track">
        <button type="button" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>
          Dark
        </button>
        <button type="button" aria-pressed={theme === "light"} onClick={() => choose("light")}>
          Light
        </button>
      </div>
    </fieldset>
  );
}
