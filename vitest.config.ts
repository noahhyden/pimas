import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Resolve @pimas/* to package SOURCE (dist isn't built during tests) and wire
// the JSX automatic runtime to @pimas/dom. Order matters: subpaths first.
const pkg = (p: string) => resolve(process.cwd(), "packages", p);

export default defineConfig({
  resolve: {
    alias: [
      { find: "@pimas/dom/jsx-dev-runtime", replacement: pkg("dom/src/jsx-dev-runtime.ts") },
      { find: "@pimas/dom/jsx-runtime", replacement: pkg("dom/src/jsx-runtime.ts") },
      { find: "@pimas/dom", replacement: pkg("dom/src/index.ts") },
      { find: "@pimas/reactive", replacement: pkg("reactive/src/index.ts") },
    ],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@pimas/dom",
  },
  test: {
    environment: "happy-dom",
  },
});
