import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: [
        "packages/**/*.test.ts",
        "apps/server/test/unit/**/*.test.ts",
        "apps/web/src/**/*.test.ts",
        "scripts/**/*.test.ts",
      ],
      exclude: ["**/*.integration.test.ts", "**/node_modules/**", "**/dist/**"],
      environment: "node",
    },
  },
  {
    test: {
      name: "integration",
      include: ["**/*.integration.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      environment: "node",
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  },
]);
