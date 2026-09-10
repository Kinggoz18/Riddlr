import { Button } from "@riddlr/ui";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api } from "./api.js";

export function Shell(props: { children: ReactNode }) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="nav" aria-label="Primary">
        <p style={{ color: "var(--mint)", fontWeight: 800, letterSpacing: "0.08em" }}>RIDDLR</p>
        <p style={{ color: "var(--muted)", fontSize: 12 }}>
          Crypto intelligence · other domains coming soon
        </p>
        <NavLink to="/">Overview</NavLink>
        <NavLink to="/signals">Signals</NavLink>
        <NavLink to="/events">Events</NavLink>
        <NavLink to="/agents">Agents</NavLink>
        <NavLink to="/sources">Sources</NavLink>
        <NavLink to="/watchlists">Watchlists</NavLink>
        <NavLink to="/notifications">Notifications</NavLink>
        <NavLink to="/portfolios">Portfolios</NavLink>
        <NavLink to="/scans">Scan History</NavLink>
        <NavLink to="/usage">AI Usage</NavLink>
        <NavLink to="/health">System Health</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <Button
          onClick={async () => {
            await api("/api/v1/auth/logout", { method: "POST" });
            window.location.assign("/login");
          }}
        >
          Sign out
        </Button>
      </nav>
      <main id="main" className="page">
        {props.children}
      </main>
    </div>
  );
}
