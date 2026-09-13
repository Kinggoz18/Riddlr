import { Button } from "@riddlr/ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "./api.js";
import { BrandMark, PageNavLink } from "./Brand.js";
import { ThemeToggle } from "./ThemeToggle.js";

const NAV_CLUSTERS: Array<Array<{ to: string; label: string; end?: boolean }>> = [
  [
    { to: "/", label: "Overview", end: true },
    { to: "/signals", label: "Signals" },
    { to: "/events", label: "Events" },
  ],
  [
    { to: "/agents", label: "Agents" },
    { to: "/skills", label: "Skills" },
    { to: "/sources", label: "Sources" },
    { to: "/watchlists", label: "Watchlists" },
    { to: "/portfolios", label: "Portfolios" },
  ],
  [
    { to: "/notifications", label: "Notifications" },
    { to: "/scans", label: "Scans" },
    { to: "/usage", label: "Usage" },
    { to: "/health", label: "Health" },
  ],
  [{ to: "/settings", label: "Settings" }],
];

export function Shell(props: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <div className="masthead-row">
          <BrandMark />
          <Button
            variant="ghost"
            className="nav-toggle"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="primary-nav"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <span className="nav-toggle-close" aria-hidden="true">
                <span />
                <span />
              </span>
            ) : (
              <span className="nav-toggle-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
          </Button>
        </div>
        <nav
          className={`primary-nav${open ? " primary-nav-open" : ""}`}
          id="primary-nav"
          aria-label="Primary"
        >
          <div className="nav-links">
            {NAV_CLUSTERS.map((cluster) => (
              <div className="nav-cluster" key={cluster.map((item) => item.to).join("-")}>
                {cluster.map((item) => (
                  <PageNavLink key={item.to} to={item.to} end={item.end}>
                    {item.label}
                  </PageNavLink>
                ))}
              </div>
            ))}
          </div>
          <div className="nav-footer">
            <ThemeToggle />
            <Button
              variant="ghost"
              className="signout-button"
              onClick={async () => {
                await api("/api/v1/auth/logout", { method: "POST" });
                window.location.assign("/login");
              }}
            >
              Sign out
            </Button>
          </div>
        </nav>
      </header>
      <main id="main" className="page-frame">
        {props.children}
        <p className="data-attribution">Price data by CoinGecko</p>
      </main>
    </div>
  );
}
