const allowed = new Set([
  "Apache-2.0",
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "MPL-2.0",
  "CC-BY-4.0",
  "MIT-0",
]);

export function licenseAllowed(expression) {
  if (typeof expression !== "string" || !expression.trim()) {
    return false;
  }
  const normalized = expression.trim();
  if (normalized.includes(" AND ") && !normalized.includes(" OR ")) {
    return normalized.split(/\s+AND\s+/).every((part) => licenseAllowed(part.trim()));
  }
  if (normalized.includes(" OR ")) {
    return normalized.split(/\s+OR\s+/).some((part) => licenseAllowed(part.trim()));
  }
  const token = normalized.replace(/[()]/g, "").trim();
  if (!token || token === "UNKNOWN" || /GPL|AGPL/i.test(token)) {
    return false;
  }
  return allowed.has(token);
}
