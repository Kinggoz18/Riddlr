import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.RIDDLR_DATABASE_URL ?? "postgres://riddlr:riddlr@127.0.0.1:5432/riddlr",
  },
});
