import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Resolve the public subpaths to source (dist isn't built during tests) and
// wire the JSX automatic runtime to `pimas`. Order matters: subpaths first.
const src = (p: string) => resolve(process.cwd(), "src", p);

export default defineConfig({
  resolve: {
    alias: [
      { find: "pimas/jsx-dev-runtime", replacement: src("dom/jsx-dev-runtime.ts") },
      { find: "pimas/jsx-runtime", replacement: src("dom/jsx-runtime.ts") },
      { find: "pimas/dom", replacement: src("dom/index.ts") },
      { find: "pimas/server", replacement: src("server/index.ts") },
      { find: "pimas/resume", replacement: src("dom/resume.ts") },
      { find: "pimas/hydrate", replacement: src("dom/claim.ts") },
      { find: "pimas/flow", replacement: src("flow/index.ts") },
      { find: "pimas/store", replacement: src("store/index.ts") },
      { find: "pimas/resource", replacement: src("resource/index.ts") },
      { find: /^pimas$/, replacement: src("reactive/index.ts") },
    ],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "pimas",
  },
  test: {
    environment: "happy-dom",
    // browser-test/ runs in a REAL browser via Vite + WebBridge, not vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "browser-test/**"],
    coverage: {
      provider: "v8",
      // Instrument the shipped surface only; barrels/type-only files add noise.
      include: ["src/**/*.ts"],
      exclude: [
        // Re-export barrels (flow/store/resource keep real code in index.ts).
        "src/reactive/index.ts",
        "src/dom/index.ts",
        "src/server/index.ts",
        "src/compiler/index.ts",
        "src/dom/jsx-types.ts", // types-only, validated by tsc
        "src/dom/jsx-runtime.ts",
        "src/dom/jsx-dev-runtime.ts",
      ],
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // Ratchet gate: set just under the current numbers so the suite passes
      // today but a coverage regression fails CI. Raise these as gaps close;
      // never lower them to make a red build green.
      thresholds: {
        statements: 94,
        branches: 89,
        functions: 93,
        lines: 94,
      },
    },
  },
});
