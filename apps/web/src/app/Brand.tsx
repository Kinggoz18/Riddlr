import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

export function BrandMark() {
  return (
    <span className="brand">
      <span className="brand-wordmark-frame">
        <img
          className="brand-wordmark"
          src="/riddlr_logo.png"
          width={176}
          height={96}
          alt="Riddlr"
          fetchPriority="high"
        />
      </span>
    </span>
  );
}

export function AuthShell(props: { title: string; children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <main id="main" className="auth-shell">
        <aside className="auth-brand" aria-hidden="true">
          <img src="/icon.png" width={187} height={719} alt="" />
        </aside>
        <section className="auth-panel">
          <header className="auth-header">
            <BrandMark />
            <h1>{props.title}</h1>
          </header>
          <div className="auth-content">{props.children}</div>
        </section>
      </main>
    </>
  );
}

export function PageNavLink(props: { to: string; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={props.to}
      end={props.end}
      className={({ isActive }) => (isActive ? "active" : undefined)}
    >
      {props.children}
    </NavLink>
  );
}
