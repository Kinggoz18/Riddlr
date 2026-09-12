export const THEME_STORAGE_KEY = "riddlr-theme";
export const THEME_DARK_COLOR = "#070b0a";
export const THEME_LIGHT_COLOR = "#eef3f0";

export type Theme = "light" | "dark";

export function readStoredTheme(raw: string | null | undefined): Theme {
  return raw === "light" ? "light" : "dark";
}

export function themeColor(theme: Theme) {
  return theme === "light" ? THEME_LIGHT_COLOR : THEME_DARK_COLOR;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor(theme));
}
