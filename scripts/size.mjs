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
  "pimas/hydrate": src("dom/claim.ts"),
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
// Re-baselined for createStore v2 (#5): `reconcile` + `produce`. Both are
// in-place tagged updaters sharing ONE detection ($UPDATER) in the setter, so a
// createStore consumer that imports neither pays for a single tag lookup only:
// store 1625→1675. Each feature's heavy logic (reconcile's diff walkers /
// produce's writable draft traps) rides in a CLOSURE on the tag and tree-shakes
// away — the "+ reconcile" (~+300 gz) and "+ produce" (~+190 gz) fixtures show
// each opt-in cost. Opt-in, not bloat.
// Re-baselined for the TYPE-TAGGED CODEC (#7 / resumability task 6, D#32): the
// capture table + island props now round-trip undefined/NaN/±Inf/-0/bigint/
// Date/Map/Set/RegExp via a JSON replacer/reviver in wire.ts. The DECODER ships
// to every resumable page (resume 700→900); the ENCODER runs server-side
// (server 1550→1900, also re-exports decode for island use). encode tree-shakes
// OUT of the resume bundle (resume imports decode only). Foundational, not bloat.
// Re-baselined for RESUMABILITY (#6/#30): the string backend's `listen` now
// serializes handler DESCRIPTORS (emits `on:<type>` + a per-render capture table),
// and `renderToString` flushes that table as an `application/pimas-state` script.
// This is the foundational resume path (compiler-free proof of the reserved seam):
// server 1350→1550. The client dispatcher ships as a SEPARATE entry, `pimas/resume`
// (~640 gz), that pulls the zero-dep wire contract but NOT the renderer — a
// resumable page ships the dispatcher, never the component code. Deliberate, not
// bloat: a page with no serializable handlers emits zero extra bytes (0-KB-static
// guarantee preserved).
// Re-baselined for the SCHEDULER SEAM (#3): `writeNode`/`batch` now route the
// implicit flush through `requestFlush`, so the flush *timing* is pluggable —
// the default stays a direct synchronous `flushEffects()` (byte-for-byte timing
// unchanged), and installing a `queueMicrotask` scheduler coalesces a write-burst
// into one deferred flush. The indirection + the shared drain land in the
// indivisible kernel, so every core consumer pays a little: signal 725→740,
// For 1375→1400, store 1675→1700. `full surface` 1325→1410 additionally includes
// the two new exports (`setScheduler`/`flushSync`), which tree-shake away for
// anyone who never installs a scheduler. Foundational, opt-in, not bloat.
// New fixture for the CLAIM/HYDRATE backend (#6, D#31): `pimas/hydrate` adopts
// server DOM in place (reuse nodes + wire reactivity) instead of client-render-first
// discarding it. Unlike renderer-free `pimas/resume` (the listener half), claim
// RE-EXECUTES components, so it necessarily pulls the full renderer — budget ≈ the
// `dom` render path (~1941 gz) + the plan-tree build/adopt walk (~110 gz) = 2052,
// budget 2075. A separate subpath so it never touches the `pimas/dom` render budget.
const fixtures = {
  "core: signal only": [`import { createSignal } from "pimas"; createSignal(0);`, 740],
  "core: full surface": [`import * as R from "pimas"; globalThis.x = R;`, 1410],
  "dom: render + h": [`import { render, h } from "pimas/dom"; globalThis.x = [render, h];`, 1950],
  "server: renderToString": [`import { renderToString } from "pimas/server"; globalThis.x = renderToString;`, 1900],
  "resume: dispatcher": [`import { resume, registerHandler } from "pimas/resume"; globalThis.x = [resume, registerHandler];`, 900],
  "hydrate: claim": [`import { claim } from "pimas/hydrate"; globalThis.x = claim;`, 2075],
  "flow: Show + Switch": [`import { Show, Switch, Match } from "pimas/flow"; globalThis.x = [Show, Switch, Match];`, 900],
  "flow: For (keyed)": [`import { For } from "pimas/flow"; globalThis.x = For;`, 1400],
  "flow: ErrorBoundary": [`import { ErrorBoundary } from "pimas/flow"; globalThis.x = ErrorBoundary;`, 1000],
  "store: createStore": [`import { createStore } from "pimas/store"; globalThis.x = createStore;`, 1700],
  "store: + reconcile": [`import { createStore, reconcile } from "pimas/store"; globalThis.x = [createStore, reconcile];`, 2050],
  "store: + produce": [`import { createStore, produce } from "pimas/store"; globalThis.x = [createStore, produce];`, 1925],
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
