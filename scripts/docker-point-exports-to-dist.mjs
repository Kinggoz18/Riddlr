import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packagesDir = join(process.cwd(), "packages");
for (const name of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, name, "package.json");
  let raw;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch {
    continue;
  }
  const pkg = JSON.parse(raw);
  const entry = pkg.exports?.["."];
  if (!entry || typeof entry !== "object") {
    continue;
  }
  const dist = "./dist/index.js";
  pkg.exports["."] = {
    ...entry,
    default: dist,
    import: dist,
  };
  pkg.main = dist;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
