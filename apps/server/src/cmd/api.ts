import { buildApp } from "../app.js";
import { createContext } from "../context.js";
import {
  ensureDefaultCryptoFeedSources,
  ensureDefaultSearxngNewsEngines,
} from "../modules/default-sources.js";

const ctx = await createContext();
await ensureDefaultSearxngNewsEngines(ctx);
await ensureDefaultCryptoFeedSources(ctx);
const app = await buildApp(ctx);
await app.listen({ host: ctx.config.RIDDLR_HTTP_HOST, port: ctx.config.RIDDLR_HTTP_PORT });
ctx.logger.info({ port: ctx.config.RIDDLR_HTTP_PORT }, "Riddlr API started");

const shutdown = async () => {
  await app.close();
  await ctx.redis.quit();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
