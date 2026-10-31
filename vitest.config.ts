import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
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
