import { ChipInput } from "./ChipInput.js";
import { ASSET_CATALOG, assetLabel, resolveAssetInput } from "./format.js";

export function AssetPicker(props: {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  single?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  return (
    <div className="asset-picker">
      <ChipInput
        id={props.id}
        values={props.values}
        onChange={(next) => props.onChange(props.single && next.length > 1 ? next.slice(-1) : next)}
        placeholder={props.single ? "Bitcoin or ETH" : "Bitcoin, ETH, or Solana"}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        normalize={resolveAssetInput}
        format={assetLabel}
      />
      <div className="chip-presets">
        {ASSET_CATALOG.map((asset) => {
          const selected = props.values.includes(asset.canonicalId);
          return (
            <button
              key={asset.canonicalId}
              type="button"
              className={`chip-preset${selected ? " selected" : ""}`}
              aria-pressed={selected}
              onClick={() => {
                if (selected) {
                  props.onChange(props.values.filter((item) => item !== asset.canonicalId));
                  return;
                }
                props.onChange(
                  props.single ? [asset.canonicalId] : [...props.values, asset.canonicalId],
                );
              }}
            >
              {asset.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
