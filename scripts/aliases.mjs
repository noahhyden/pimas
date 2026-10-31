// Single source of truth for subpath -> source aliases (vitest + size.mjs).
// Ordered most-specific first: vitest matches in order, so bare "pimas" is last.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = (p) => resolve(root, "src", p);

export const subpaths = [
  ["pimas/agent/page", "agent/page.ts"],
  ["pimas/agent/webmcp", "agent/webmcp.ts"],
  ["pimas/agent", "agent/index.ts"],
  ["pimas/store", "store/index.ts"],
  ["pimas/react", "react/index.ts"],
  ["pimas", "reactive/index.ts"],
];

/** vitest/vite: ordered array; bare specifier needs an anchored RegExp. */
export const viteAliases = subpaths.map(([find, p]) => ({
  find: find === "pimas" ? /^pimas$/ : find,
  replacement: src(p),
}));

/** esbuild: plain object. */
export const esbuildAliases = Object.fromEntries(subpaths.map(([k, p]) => [k, src(p)]));
