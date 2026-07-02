import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Dev server for the in-browser test suite (browser-test/). Reuses the same
 * subpath→source aliases and JSX automatic-runtime wiring as vitest, so the
 * fixtures import `pimas`, `pimas/dom`, `pimas/flow` exactly like real consumers
 * do — measured straight from source, no build step. Order matters: subpaths
 * before the bare `pimas`.
 */
const src = (p: string) => resolve(import.meta.dirname, "src", p);

export default defineConfig({
  root: "browser-test",
  resolve: {
    alias: [
      { find: "pimas/jsx-dev-runtime", replacement: src("dom/jsx-dev-runtime.ts") },
      { find: "pimas/jsx-runtime", replacement: src("dom/jsx-runtime.ts") },
      { find: "pimas/dom", replacement: src("dom/index.ts") },
      { find: "pimas/server", replacement: src("server/index.ts") },
      { find: "pimas/resume", replacement: src("dom/resume.ts") },
      { find: "pimas/hydrate", replacement: src("dom/claim.ts") },
      { find: "pimas/flow", replacement: src("flow/index.ts") },
      { find: /^pimas$/, replacement: src("reactive/index.ts") },
    ],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "pimas",
  },
  server: { port: 5183 },
});
