import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const generic = [
  "domain",
  "source-adapters",
  "llm",
  "queue",
  "notifications",
  "crypto",
  "observability",
  "api-contract",
  "config",
  "db",
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...filesUnder(path));
    } else if (/\.(ts|tsx|json)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe("package boundaries", () => {
  it("keeps crypto-specific implementation out of generic core packages", () => {
    for (const name of generic) {
      const dir = join(root, "packages", name);
      for (const file of filesUnder(dir)) {
        const text = readFileSync(file, "utf8");
        expect(text, file).not.toMatch(/@riddlr\/domain-crypto/);
        if (name !== "domain") {
          expect(text, file).not.toMatch(/cryptocurrency bitcoin ethereum stablecoin news/);
        }
      }
    }
  });

  it("keeps crypto implementation out of generic engine modules", () => {
    const files = [
      join(root, "apps/server/src/modules/pipeline.ts"),
      join(root, "apps/server/src/modules/intelligence.ts"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/@riddlr\/domain-crypto/);
      expect(text, file).not.toMatch(/cryptocurrency bitcoin ethereum stablecoin news/);
    }
  });
});
