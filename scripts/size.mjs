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
  "pimas/resume": src("dom/resume.ts"),
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
// Re-baselined in Phase 5 (#37): `onMount` (post-insert lifecycle hook) added at
// the backend seam — DOM defers via microtask, SSR no-ops. Foundational for any
// component touching a live node (focus/measure). dom 1850→1875 gz.
// Re-baselined in Phase 5 (#38): ErrorBoundary/catchError — foundational error
// handling. The `handleError` walk + the catch in `update()` land in the
// indivisible kernel, so every fixture pulling the core pays (~+86 gz each):
// signal 700→725, full surface 1000→1125, dom 1875→1950, store 1400→1475 gz.
// Deliberate, not bloat.
// Re-baselined for L3 `speculate` (#13, the agent-simulatable-frontend pivot):
// readNode/writeNode gain a single `if (speculating)` branch — the heavy shadow
// logic lives inside `speculate` itself, so it TREE-SHAKES away for anyone who
// doesn't import it. The hot-path floor barely moves (signal 679→698, well
// under budget); the cost lands only where L3 is actually pulled in —
// full surface 1125→1325 (includes `speculate`), store 1475→1575 (the write
// guard + `isSpeculating`), For 1350→1375 (the core branch). Opt-in, not bloat.
// Re-baselined again (#13, store COW + L2): the store gains copy-on-write under
// speculation (predict an EDIT without committing) + `onStoreWrite` provenance.
// store 1575→1625. Both are the L3/L2 store features; still opt-in — a store
// consumer that never speculates or subscribes to writes pays only the branches.
// Re-baselined for `reconcile` (#5, createStore v2): the setter (`updatePath`)
// now detects a reconcile-tagged updater + shape-checks it — store 1625→1700.
// The heavy diff walkers (array key-match, in-place field merge, recursion) are
// carried in a CLOSURE on the tag, so they tree-shake away for a createStore
// consumer that never imports `reconcile`; the "+ reconcile" fixture shows the
// opt-in cost (~+280 gz over createStore alone). Opt-in, not bloat.
// Re-baselined for RESUMABILITY (#6/#30): the string backend's `listen` now
// serializes handler DESCRIPTORS (emits `on:<type>` + a per-render capture table),
// and `renderToString` flushes that table as an `application/pimas-state` script.
// This is the foundational resume path (compiler-free proof of the reserved seam):
// server 1350→1550. The client dispatcher ships as a SEPARATE entry, `pimas/resume`
// (~640 gz), that pulls the zero-dep wire contract but NOT the renderer — a
// resumable page ships the dispatcher, never the component code. Deliberate, not
// bloat: a page with no serializable handlers emits zero extra bytes (0-KB-static
// guarantee preserved).
const fixtures = {
  "core: signal only": [`import { createSignal } from "pimas"; createSignal(0);`, 725],
  "core: full surface": [`import * as R from "pimas"; globalThis.x = R;`, 1325],
  "dom: render + h": [`import { render, h } from "pimas/dom"; globalThis.x = [render, h];`, 1950],
  "server: renderToString": [`import { renderToString } from "pimas/server"; globalThis.x = renderToString;`, 1550],
  "resume: dispatcher": [`import { resume, registerHandler } from "pimas/resume"; globalThis.x = [resume, registerHandler];`, 700],
  "flow: Show + Switch": [`import { Show, Switch, Match } from "pimas/flow"; globalThis.x = [Show, Switch, Match];`, 900],
  "flow: For (keyed)": [`import { For } from "pimas/flow"; globalThis.x = For;`, 1375],
  "flow: ErrorBoundary": [`import { ErrorBoundary } from "pimas/flow"; globalThis.x = ErrorBoundary;`, 1000],
  "store: createStore": [`import { createStore } from "pimas/store"; globalThis.x = createStore;`, 1700],
  "store: + reconcile": [`import { createStore, reconcile } from "pimas/store"; globalThis.x = [createStore, reconcile];`, 2050],
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
