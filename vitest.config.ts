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
      { find: "pimas/flow", replacement: src("flow/index.ts") },
      { find: "pimas/store", replacement: src("store/index.ts") },
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
  },
});
