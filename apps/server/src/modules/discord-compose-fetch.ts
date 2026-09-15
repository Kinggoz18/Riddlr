import { assertSafeResolvedHttpUrl } from "@riddlr/source-adapters";
import type { AppContext } from "../context.js";

export function composeDiscordWebhookFetch(
  ctx: AppContext,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const origin = ctx.config.RIDDLR_DISCORD_WEBHOOK_ORIGIN;
  if (!origin) {
    return fetchImpl;
  }
  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(href);
    const redirected = `${origin}${parsed.pathname}${parsed.search}`;
    await assertSafeResolvedHttpUrl(redirected, ["discord-webhook-mock"]);
    return fetchImpl(redirected, init);
  };
}
