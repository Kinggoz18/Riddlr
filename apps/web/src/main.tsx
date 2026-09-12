import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App.js";
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY } from "./app/theme.js";
import "./styles/global.css";
import "./styles/product.css";

applyTheme(readStoredTheme(localStorage.getItem(THEME_STORAGE_KEY)));

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing root");
}
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
