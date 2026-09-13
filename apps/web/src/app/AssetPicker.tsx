import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { api } from "./api.js";
import { type AssetOption, assetLabel } from "./format.js";

type AssetHit = {
  canonicalId: string;
  symbol: string | null;
  name: string | null;
};

function optionLabel(item: { canonicalId: string; symbol?: string | null; name?: string | null }) {
  if (item.name && item.symbol) {
    return `${item.name} · ${item.symbol}`;
  }
  if (item.name) {
    return item.name;
  }
  return assetLabel(item.canonicalId);
}

export function AssetPicker(props: {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  single?: boolean;
  known?: AssetOption[];
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const listboxId = useId();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<AssetHit[]>([]);
  const [active, setActive] = useState(0);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const knownLabels = Object.fromEntries(
    (props.known ?? []).map((item) => [item.canonicalId, optionLabel(item)]),
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const handle = window.setTimeout(() => {
      void api<{ assets: AssetHit[] }>(`/api/v1/assets?q=${encodeURIComponent(draft)}&limit=12`)
        .then((body) => {
          const available = body.assets.filter((item) => !props.values.includes(item.canonicalId));
          setHits(available);
          setActive(0);
        })
        .catch(() => {
          setHits([]);
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draft, open, props.values]);

  function select(hit: AssetHit) {
    const next = props.single ? [hit.canonicalId] : [...props.values, hit.canonicalId];
    if (!props.values.includes(hit.canonicalId)) {
      props.onChange(next);
    }
    setLabels((current) => ({ ...current, [hit.canonicalId]: optionLabel(hit) }));
    setDraft("");
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(hits.length - 1, current + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active] ?? hits[0];
      if (hit) {
        select(hit);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Backspace" && draft === "" && props.values.length > 0) {
      props.onChange(props.values.slice(0, -1));
    }
  }

  const activeId = hits[active] ? `${listboxId}-opt-${active}` : undefined;

  return (
    <div className="asset-picker">
      <div className="chip-field">
        {props.values.map((value) => (
          <span key={value} className="chip">
            <span>{labels[value] ?? knownLabels[value] ?? assetLabel(value)}</span>
            <button
              type="button"
              className="chip-remove"
              aria-label={`Remove ${labels[value] ?? knownLabels[value] ?? assetLabel(value)}`}
              onClick={() => props.onChange(props.values.filter((item) => item !== value))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={props.id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={props["aria-describedby"]}
          aria-invalid={props["aria-invalid"]}
          value={draft}
          placeholder={
            props.values.length === 0
              ? props.single
                ? "Search an asset"
                : "Search assets by name or symbol"
              : "Add another"
          }
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {open ? (
        <div id={listboxId} className="asset-picker-list" role="listbox">
          {hits.length === 0 ? (
            <div className="asset-picker-empty">No matching assets</div>
          ) : (
            hits.map((hit, index) => (
              <div
                key={hit.canonicalId}
                id={`${listboxId}-opt-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === active}
                className={index === active ? "asset-picker-option active" : "asset-picker-option"}
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(hit);
                }}
              >
                {optionLabel(hit)}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
