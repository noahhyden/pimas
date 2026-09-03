import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const src = (p: string) => resolve(process.cwd(), "src", p);

export default defineConfig({
  resolve: {
    alias: [
      { find: "pimas/agent/page", replacement: src("agent/page.ts") },
      { find: "pimas/agent/webmcp", replacement: src("agent/webmcp.ts") },
      { find: "pimas/agent", replacement: src("agent/index.ts") },
      { find: "pimas/store", replacement: src("store/index.ts") },
      { find: "pimas/react", replacement: src("react/index.ts") },
      { find: /^pimas$/, replacement: src("reactive/index.ts") },
    ],
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
