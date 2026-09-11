import {
  Children,
  type CSSProperties,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";

export const tokens = {
  bg: "#050807",
  elevated: "#0c1411",
  mint: "#3ee0b2",
  text: "#e8faf3",
  muted: "#8fa59c",
  danger: "#ff8a7a",
  ok: "#3ee0b2",
  line: "rgba(62, 224, 178, 0.18)",
};

export function Button(props: {
  children: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "ghost" | "danger" | "quiet";
  className?: string;
  onClick?: () => void;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  const variant = props.variant ?? "primary";
  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled || props.busy}
      onClick={props.onClick}
      className={`ui-button ui-button-${variant}${props.className ? ` ${props.className}` : ""}`}
      aria-busy={props.busy || undefined}
      aria-label={props["aria-label"]}
      aria-expanded={props["aria-expanded"]}
      aria-controls={props["aria-controls"]}
    >
      {props.busy ? "Working…" : props.children}
    </button>
  );
}

export function Field(props: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  const generatedId = useId();
  const child = Children.only(props.children);
  const existingId =
    isValidElement<{ id?: string }>(child) && typeof child.props.id === "string"
      ? child.props.id
      : undefined;
  const id = existingId ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null]
    .filter(Boolean)
    .join(" ");
  const control = isValidElement(child)
    ? cloneElement(
        child as ReactElement<{
          id?: string;
          "aria-describedby"?: string;
          "aria-invalid"?: boolean;
        }>,
        {
          id,
          "aria-describedby": describedBy || undefined,
          "aria-invalid": props.error ? true : undefined,
        },
      )
    : child;
  return (
    <label htmlFor={id} className="ui-field">
      <span className="ui-field-label">{props.label}</span>
      {control}
      {props.hint ? (
        <small id={hintId} className="ui-field-hint">
          {props.hint}
        </small>
      ) : null}
      {props.error ? (
        <small id={errorId} role="alert" className="ui-field-error">
          {props.error}
        </small>
      ) : null}
    </label>
  );
}

export function Card(props: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={props.id}
      className={`ui-card${props.className ? ` ${props.className}` : ""}`}
      style={props.style}
    >
      {props.children}
    </section>
  );
}

export function EmptyState(props: {
  title: string;
  body: string;
  asPageTitle?: boolean;
  action?: ReactNode;
}) {
  const Title = props.asPageTitle ? "h1" : "h2";
  return (
    <Card>
      <Title className="ui-empty-title">{props.title}</Title>
      <p className="lede">{props.body}</p>
      {props.action ? <p className="ui-actions">{props.action}</p> : null}
    </Card>
  );
}

export function StatusBadge(props: { label: string; tone?: "ok" | "soon" | "danger" | "risk" }) {
  const tone =
    props.tone === "soon"
      ? "soon"
      : props.tone === "danger" || props.tone === "risk"
        ? "danger"
        : "";
  return <span className={`badge${tone ? ` ${tone}` : ""}`}>{props.label}</span>;
}

export function Banner(props: { children: ReactNode; tone?: "info" | "danger" | "ok" }) {
  const tone = props.tone ?? "info";
  return (
    <p
      className={`notice notice-${tone}`}
      role={tone === "danger" ? "alert" : "status"}
      aria-live="polite"
    >
      {props.children}
    </p>
  );
}

export function Notice(props: { children: ReactNode; tone?: "info" | "danger" | "ok" }) {
  return <Banner tone={props.tone}>{props.children}</Banner>;
}

export function PageHeader(props: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-row">
        <h1>{props.title}</h1>
        {props.actions ? <div className="page-header-actions">{props.actions}</div> : null}
      </div>
      {props.description ? <p className="lede">{props.description}</p> : null}
    </header>
  );
}

export function Skeleton(props: { label?: string }) {
  return (
    <p className="ui-skeleton" aria-busy="true" aria-live="polite">
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
      className="ui-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <Card style={{ maxWidth: 420, width: "100%" }}>
        <h2 id="dialog-title">{props.title}</h2>
        {props.children}
        <p className="ui-actions">
          {props.onConfirm ? (
            <Button onClick={props.onConfirm}>{props.confirmLabel ?? "Confirm"}</Button>
          ) : null}
          <Button variant="ghost" onClick={props.onClose}>
            Close
          </Button>
        </p>
      </Card>
    </div>
  );
}

export function Pagination(props: { onOlder?: () => void; hasMore?: boolean }) {
  if (!props.hasMore || !props.onOlder) {
    return null;
  }
  return (
    <Button variant="ghost" onClick={props.onOlder}>
      Load older
    </Button>
  );
}
