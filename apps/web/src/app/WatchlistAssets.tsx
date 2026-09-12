import { NavLink } from "react-router-dom";
import { assetClassLabel, assetDisplayName, assetTicker } from "./format.js";
import { previewWatchlist, type WatchlistAsset } from "./watchlist-view.js";

export function WatchlistAssets(props: {
  items: WatchlistAsset[];
  limit?: number;
  moreHref?: string;
  empty?: string;
}) {
  if (props.items.length === 0) {
    return <p className="quiet-state">{props.empty ?? "No assets on this watchlist"}</p>;
  }
  const { shown, remaining } =
    props.limit === undefined
      ? { shown: props.items, remaining: 0 }
      : previewWatchlist(props.items, props.limit);
  return (
    <div className="watchlist-assets">
      <ul className="asset-list">
        {shown.map((item) => {
          const ticker = assetTicker(item.canonicalId, item);
          const name = assetDisplayName(item.canonicalId, item);
          const klass = assetClassLabel(item.assetClass);
          return (
            <li key={item.canonicalId}>
              <span className="asset-ticker" aria-hidden="true">
                {ticker}
              </span>
              <span className="asset-copy">
                <strong>{name}</strong>
                <small>{klass ? `${ticker} · ${klass}` : ticker}</small>
              </span>
            </li>
          );
        })}
      </ul>
      {remaining > 0 && props.moreHref ? (
        <NavLink
          className="watchlist-more"
          to={props.moreHref}
          aria-label={`View ${remaining} more assets`}
        >
          View more
        </NavLink>
      ) : remaining > 0 ? (
        <p className="field-note">+{remaining} more</p>
      ) : null}
    </div>
  );
}
