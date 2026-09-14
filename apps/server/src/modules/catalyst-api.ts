import {
  type CatalystKind,
  type MarketDomainId,
  principalCatalystKindForClaims,
} from "@riddlr/domain";
import type { AppContext } from "../context.js";

export function catalystKindForEvent(
  ctx: AppContext,
  marketDomainId: string | null | undefined,
  kinds: readonly string[],
): CatalystKind | undefined {
  const module = ctx.domains.get((marketDomainId ?? "crypto") as MarketDomainId);
  return principalCatalystKindForClaims(kinds, (kind) => module?.mapClaimKindToCatalyst(kind));
}

export function catalystKindForClaim(
  ctx: AppContext,
  marketDomainId: string | null | undefined,
  kind: string,
): CatalystKind | undefined {
  return catalystKindForEvent(ctx, marketDomainId, [kind]);
}
