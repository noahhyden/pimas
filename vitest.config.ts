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
      { find: /^pimas$/, replacement: src("reactive/index.ts") },
    ],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "pimas",
  },
  test: {
    environment: "happy-dom",
  },
});
