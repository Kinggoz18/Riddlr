export const SETUP_DEFAULT_MARKET_DOMAIN = "crypto";

export function initialSetupMarketDomains(): string[] {
  return [SETUP_DEFAULT_MARKET_DOMAIN];
}

export function toggleSetupMarketDomain(
  current: readonly string[],
  id: string,
  selectable: boolean,
): string[] {
  const unique = [...new Set(current.filter(Boolean))];
  const withDefault = unique.includes(SETUP_DEFAULT_MARKET_DOMAIN)
    ? unique
    : [SETUP_DEFAULT_MARKET_DOMAIN, ...unique];
  if (id === SETUP_DEFAULT_MARKET_DOMAIN) {
    return withDefault;
  }
  if (!selectable) {
    return withDefault;
  }
  if (withDefault.includes(id)) {
    return withDefault.filter((item) => item !== id);
  }
  return [...withDefault, id];
}

export function completeSetupMarketDomains(current: readonly string[]): string[] {
  const unique = [...new Set(current.filter(Boolean))];
  if (unique.includes(SETUP_DEFAULT_MARKET_DOMAIN)) {
    return unique;
  }
  return [SETUP_DEFAULT_MARKET_DOMAIN, ...unique];
}
