import { type KeyboardEvent, useState } from "react";

export function ChipInput(props: {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  normalize?: (raw: string) => string | undefined;
  format?: (value: string) => string;
}) {
  const [draft, setDraft] = useState("");
  const normalize = props.normalize ?? ((raw: string) => raw.trim() || undefined);
  const format = props.format ?? ((value: string) => value);

  function add(raw: string) {
    const next = normalize(raw);
    if (!next || props.values.includes(next)) {
      setDraft("");
      return;
    }
    props.onChange([...props.values, next]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    }
    if (event.key === "Backspace" && draft === "" && props.values.length > 0) {
      props.onChange(props.values.slice(0, -1));
    }
  }

  return (
    <div className="chip-field">
      {props.values.map((value) => (
        <span key={value} className="chip">
          <span>{format(value)}</span>
          <button
            type="button"
            className="chip-remove"
            aria-label={`Remove ${format(value)}`}
            onClick={() => props.onChange(props.values.filter((item) => item !== value))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={props.id}
        value={draft}
        placeholder={props.values.length === 0 ? props.placeholder : "Add another"}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) {
            add(draft);
          }
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (text.includes(",") || text.includes("\n")) {
            event.preventDefault();
            const extras = text
              .split(/[\s,]+/)
              .map((item) => normalize(item))
              .filter((item): item is string => Boolean(item));
            props.onChange([...new Set([...props.values, ...extras])]);
            setDraft("");
          }
        }}
      />
    </div>
  );
}

export function ChipList(props: {
  values: string[];
  format?: (value: string) => string;
  empty?: string;
}) {
  if (props.values.length === 0) {
    return <p className="quiet-state">{props.empty ?? "None"}</p>;
  }
  const format = props.format ?? ((value: string) => value);
  return (
    <p className="chip-presets">
      {props.values.map((value) => (
        <span key={value} className="chip">
          {format(value)}
        </span>
      ))}
    </p>
  );
}
