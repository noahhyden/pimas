import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Dev server for the README demo page (docs/demo-src/). Same subpath→source
 * aliases as the browser-test config, so the demo imports `pimas`/`pimas/dom`
 * exactly like a real consumer — measured straight from source, no build step.
 */
const src = (p: string) => resolve(import.meta.dirname, "..", "..", "src", p);

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: [
      { find: "pimas/dom", replacement: src("dom/index.ts") },
      { find: /^pimas$/, replacement: src("reactive/index.ts") },
    ],
  },
  server: { port: 5184 },
});
