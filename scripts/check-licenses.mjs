#!/usr/bin/env node
import { execSync } from "node:child_process";
import { licenseAllowed } from "./license-policy.mjs";

let output = "";
try {
  output = execSync("pnpm licenses list --json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  console.error("pnpm licenses list failed.", error instanceof Error ? error.message : error);
  process.exit(1);
}

const forbidden = [];
let parsed;
try {
  parsed = JSON.parse(output);
} catch {
  console.error("pnpm licenses list did not return JSON.");
  process.exit(1);
}

for (const [license, packages] of Object.entries(parsed)) {
  if (!licenseAllowed(license)) {
    const names = Array.isArray(packages)
      ? packages.map((item) =>
          item && typeof item === "object" && "name" in item ? String(item.name) : String(item),
        )
      : Object.keys(packages ?? {});
    forbidden.push({ license, packages: names });
  }
}

if (forbidden.length > 0) {
  console.error("Forbidden licenses:", JSON.stringify(forbidden, null, 2));
  process.exit(1);
}

console.log("License allowlist passed.");
