import { defineConfig } from "vitest/config";
// @ts-expect-error untyped .mjs shared with scripts/size.mjs
import { viteAliases } from "./scripts/aliases.mjs";

export default defineConfig({
  resolve: {
    alias: viteAliases as { find: string | RegExp; replacement: string }[],
  },
  test: {
    environment: "happy-dom",
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/reactive/index.ts",
        "src/agent/index.ts",
      ],
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 94,
        branches: 89,
        functions: 93,
        lines: 94,
      },
    },
  },
});
