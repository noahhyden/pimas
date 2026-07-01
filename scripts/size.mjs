/**
 * Per-import bundle-size guardrail.
 *
 * The point isn't total package size — it's "what does a REAL consumer import
 * actually cost?". Each fixture is a minimal realistic import; we bundle it
 * with esbuild (tree-shaking on), gzip, and compare to a byte budget. A
 * signal-only fixture that suddenly grows means tree-shaking broke or the
 * kernel bloated — exactly the regression we want to catch at landing time.
 *
 * Measures from SOURCE via alias, so no prior build is needed. Run: `npm run size`.
 */
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => resolve(root, "src", p);

// Resolve the public subpaths to source so we measure what ships, build-free.
const alias = {
  pimas: src("reactive/index.ts"),
  "pimas/dom": src("dom/index.ts"),
  "pimas/server": src("server/index.ts"),
  "pimas/flow": src("flow/index.ts"),
  "pimas/store": src("store/index.ts"),
};

// name -> [fixture code, gzip byte budget | null]
// Re-baselined in Phase 3a: the eager core was replaced by a glitch-free
// push-pull (3-color) reactive core — more machinery, but correctness, not
// bloat. Even a bare signal drags the propagation code it references (the
// kernel is indivisible). Deliberate bumps, not silent: signal 192→588,
// dom 1505→1673 gz.
// Re-baselined in Phase 5 (#30): the `listen` seam now accepts a handler
// DESCRIPTOR (not only a bare closure) so resumability stays additive later —
// a deliberate foundational capability. Cost is in the DOM backend's listen:
// dom 1790→1850 gz. Conscious bump, not bloat.
const fixtures = {
  "core: signal only": [`import { createSignal } from "pimas"; createSignal(0);`, 700],
  "core: full surface": [`import * as R from "pimas"; globalThis.x = R;`, 1000],
  "dom: render + h": [`import { render, h } from "pimas/dom"; globalThis.x = [render, h];`, 1850],
  "server: renderToString": [`import { renderToString } from "pimas/server"; globalThis.x = renderToString;`, 1350],
  "flow: Show + Switch": [`import { Show, Switch, Match } from "pimas/flow"; globalThis.x = [Show, Switch, Match];`, 900],
  "flow: For (keyed)": [`import { For } from "pimas/flow"; globalThis.x = For;`, 1350],
  "store: createStore": [`import { createStore } from "pimas/store"; globalThis.x = createStore;`, 1400],
};

let failed = false;
console.log("per-import size (min / gzip):\n");
for (const [name, [code, budget]] of Object.entries(fixtures)) {
  const out = await build({
    stdin: { contents: code, resolveDir: root, loader: "ts" },
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    treeShaking: true,
    alias,
    logLevel: "silent",
  });
  const raw = out.outputFiles[0].contents;
  const gz = gzipSync(raw).length;
  const over = budget != null && gz > budget;
  failed ||= over;
  const tag = over ? "FAIL" : "ok  ";
  const bud = budget != null ? `  (budget ${budget} gz)` : "";
  console.log(`  ${tag} ${name.padEnd(24)} ${raw.length} min / ${gz} gz${bud}`);
}
console.log("");
process.exit(failed ? 1 : 0);
