import { Button } from "@riddlr/ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { api } from "./api.js";
import { BrandMark, PageNavLink } from "./Brand.js";

export function Shell(props: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
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
            {open ? "Close" : "Menu"}
          </Button>
        </div>
        <nav
          className={`primary-nav${open ? " primary-nav-open" : ""}`}
          id="primary-nav"
          aria-label="Primary"
        >
          <div className="nav-links">
            <PageNavLink to="/" end>
              Overview
            </PageNavLink>
            <PageNavLink to="/signals">Signals</PageNavLink>
            <PageNavLink to="/events">Events</PageNavLink>
            <PageNavLink to="/agents">Agents</PageNavLink>
            <PageNavLink to="/skills">Skills</PageNavLink>
            <PageNavLink to="/sources">Sources</PageNavLink>
            <PageNavLink to="/watchlists">Watchlists</PageNavLink>
            <PageNavLink to="/portfolios">Portfolios</PageNavLink>
            <PageNavLink to="/notifications">Notifications</PageNavLink>
            <PageNavLink to="/scans">Scans</PageNavLink>
            <PageNavLink to="/usage">Usage</PageNavLink>
            <PageNavLink to="/health">Health</PageNavLink>
            <PageNavLink to="/settings">Settings</PageNavLink>
          </div>
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
        </nav>
      </header>
      <main id="main" className="page-frame">
        {props.children}
      </main>
    </div>
  );
}
