import { describe, expect, it } from "vitest";
import { readStoredTheme, THEME_DARK_COLOR, THEME_LIGHT_COLOR, themeColor } from "./theme.js";

describe("appearance", () => {
  it("defaults to dark when storage is empty or unknown", () => {
    expect(readStoredTheme(null)).toBe("dark");
    expect(readStoredTheme("nope")).toBe("dark");
    expect(readStoredTheme("dark")).toBe("dark");
    expect(readStoredTheme("light")).toBe("light");
  });

  it("exposes theme-color values for the browser chrome", () => {
    expect(themeColor("light")).toBe(THEME_LIGHT_COLOR);
    expect(themeColor("dark")).toBe(THEME_DARK_COLOR);
  });
});
