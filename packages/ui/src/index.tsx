import type { CSSProperties, ReactNode } from "react";

export const tokens = {
  bg: "#07111c",
  elevated: "#0c1a29",
  mint: "#3ee0b2",
  text: "#e7f3ee",
  muted: "#8aa39a",
  danger: "#ff6b6b",
  line: "rgba(62, 224, 178, 0.18)",
};

export function Button(props: {
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      className="ui-button"
      style={{
        background: tokens.mint,
        color: "#04110c",
        border: 0,
        borderRadius: 8,
        padding: "10px 16px",
        minHeight: 44,
        fontWeight: 700,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.5 : 1,
      }}
    >
      {props.children}
    </button>
  );
}

export function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  const id = props.label.toLowerCase().replace(/\s+/g, "-");
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 6, color: tokens.text }}>
      <span>{props.label}</span>
      {props.children}
      {props.hint ? (
        <small id={hintId} style={{ color: tokens.muted }}>
          {props.hint}
        </small>
      ) : null}
      {props.error ? (
        <small id={errorId} role="alert" style={{ color: tokens.danger }}>
          {props.error}
        </small>
      ) : null}
    </label>
  );
}

export function Card(props: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      className="ui-card"
      style={{
        background: tokens.elevated,
        border: `1px solid ${tokens.line}`,
        borderRadius: 16,
        padding: 20,
        ...props.style,
      }}
    >
      {props.children}
    </section>
  );
}

export function EmptyState(props: { title: string; body: string }) {
  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>{props.title}</h2>
      <p style={{ color: tokens.muted }}>{props.body}</p>
    </Card>
  );
}

export function StatusBadge(props: { label: string; tone?: "ok" | "soon" | "danger" | "risk" }) {
  return <span className={`badge${props.tone === "soon" ? " soon" : ""}`}>{props.label}</span>;
}

export function Banner(props: { children: ReactNode; tone?: "info" | "danger" }) {
  return (
    <p
      role={props.tone === "danger" ? "alert" : "status"}
      aria-live="polite"
      style={{
        border: `1px solid ${props.tone === "danger" ? tokens.danger : tokens.line}`,
        borderRadius: 12,
        padding: "12px 16px",
        color: props.tone === "danger" ? tokens.danger : tokens.text,
      }}
    >
      {props.children}
    </p>
  );
}

export function Skeleton(props: { label?: string }) {
  return (
    <p aria-busy="true" aria-live="polite">
      {props.label ?? "Loading…"}
    </p>
  );
}

export function Dialog(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  confirmLabel?: string;
  onConfirm?: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <Card style={{ maxWidth: 420, width: "100%" }}>
        <h2 id="dialog-title">{props.title}</h2>
        {props.children}
        <p style={{ display: "flex", gap: 8 }}>
          {props.onConfirm ? (
            <Button onClick={props.onConfirm}>{props.confirmLabel ?? "Confirm"}</Button>
          ) : null}
          <Button onClick={props.onClose}>Close</Button>
        </p>
      </Card>
    </div>
  );
}

export function Pagination(props: { onOlder?: () => void; hasMore?: boolean }) {
  if (!props.hasMore || !props.onOlder) {
    return null;
  }
  return <Button onClick={props.onOlder}>Load older</Button>;
}
