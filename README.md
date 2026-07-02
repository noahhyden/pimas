# Pimas

A fine-grained reactive UI framework, built from scratch. The goal: own the
whole frontend stack — no React, no virtual DOM, no in-browser transpiler.

Same engine class as [SolidJS](https://www.solidjs.com/): values are
*observable*, and only the exact DOM nodes that read a changed value update.
There is no diffing.

## One package, subpath entry points

`pimas` is a single package. You import only the surface you need; the rest is
tree-shaken away (every entry is pure ESM + `"sideEffects": false`).

| Import | What | Pulls in |
| --- | --- | --- |
| `pimas` | reactive core — signals/effects/memos, `createContext`/`useContext`. **Headless** (browser *or* Node). | nothing else |
| `pimas/dom` | DOM renderer + `render`/`h`/`Fragment`. | the core |
| `pimas/server` | `renderToString` — same components, rendered to HTML (SSR / static prerender). | the core |
| `pimas/flow` | control flow — `<Show>`/`<Switch>`/`<Match>`, keyed `<For>`, position-keyed `<Index>`. | the core |
| `pimas/store` | `createStore` — nested reactive proxy (fine-grained per-field). **Headless.** | the core |
| `pimas/agent` | 🔬 **experimental** — expose the reactive graph to an AI agent: subscribe to live state (L1), causal provenance (L2), deterministic what-if `speculate` (L3). **Headless.** | the core |
| `pimas/agent/webmcp` | 🔬 **experimental** — project a bridge onto the WebMCP browser API (`document.modelContext` tools). | `pimas/agent` |
| `pimas/resume` | 🔬 **experimental** — `resume()` client dispatcher that wires a server-rendered tree's serialized handlers to live events **without re-running components**. Renderer-free. | the zero-dep wire contract only |
| `pimas/hydrate` | 🔬 **experimental** — `claim()` **adopts** the server-rendered DOM in place (reuse nodes + wire reactivity) instead of client-render-first discarding it. The *state* half of resumability (`resume` is the *listener* half). | the renderer |
| `pimas/compiler` | 🔬 **experimental**, build-time only — Phase A thunk-eraser (`{count()}` → `{() => count()}`) as an `enforce:"pre"` Vite plugin. Uses `typescript` (optional peer) as a parser; never in a runtime bundle. | — |
| `pimas/jsx-runtime`, `pimas/jsx-dev-runtime` | automatic JSX runtime for TS's `react-jsx` transform | the renderer |

The renderer is parameterized over a small `RenderBackend` contract, so `pimas/dom`
(live nodes, persistent effects) and `pimas/server` (run-once, serialize) run the
**same component code**. That seam is what makes SSR/hydration additive rather than
a rewrite.

Internally it's one module graph (the renderer imports the core via a relative
path), so there is exactly **one** reactive kernel instance — no dual-package
hazard, no peer-dependency wiring. The headless core is the irreducible floor:
anything reactive includes it, nothing else does. Run `npm run size` to see the
per-import cost.

> Single-package-with-subpaths over a multi-package monorepo is a deliberate
> choice for a solo-owned framework: one version, one changelog, zero
> dual-kernel risk. Boundaries are kept by discipline (and later a lint rule),
> not by `node_modules`.

## The idea in 30 seconds

```ts
import { createSignal, createEffect } from "pimas";

const [count, setCount] = createSignal(0);
createEffect(() => console.log("count is", count())); // "count is 0"
setCount(1); // "count is 1"
```

`createEffect` runs once; reading `count()` subscribes it. Each `setCount`
re-runs *only* the effects that read that signal. Track-on-read, notify-on-write
— that single mechanism is the whole engine. See
[`src/reactive/reactive.ts`](src/reactive/reactive.ts), ~200 commented lines.

```tsx
import { createSignal } from "pimas";
import { render } from "pimas/dom";

function Counter() {
  const [n, setN] = createSignal(0);
  return <button onClick={() => setN(n() + 1)}>count: {() => n()}</button>;
}
render(() => <Counter />, document.body); // only the text node updates on click
```

## Status

| Phase | Scope | State |
| --- | --- | --- |
| **1 — Reactive core** | `signal`/`effect`/`memo`/`batch`/`untrack`/`onCleanup`/`createRoot` — glitch-free push-pull (3-color), lazy memos | ✅ done |
| **2 — DOM renderer + JSX** | `h`/`Fragment`/`render`, dynamic attrs & children via effects, automatic JSX runtime | ✅ done |
| **3 — Backend seam + SVG** | renderer over a `RenderBackend` contract, SVG `createElementNS`, `pimas/server` `renderToString` | ✅ done |
| **3b — Control flow** | `<Show>`/`<Switch>`/`<Match>`, keyed `<For>`, position-keyed `<Index>`, per-row owner scopes | ✅ done |
| **4 — Port noahhyden.com** | rebuilt every page, static HTML via `pimas/server`, 0 KB JS, self-hosted fonts — **deployed live**, the canvas runtime is gone | ✅ done |
| **5 — Interactivity + Klarum** | `createContext`, `createStore`, `onMount`, `<ErrorBoundary>`/`catchError`, descriptor-capable `listen` seam, **islands** (client-rendered, lazy) — and klarum.com rebuilt on pimas | ✅ done |
| **6 — Agent-native** | expose the reactive graph to an AI agent — subscribe (L1), causal provenance (L2), deterministic what-if `speculate` (L3), WebMCP projection; proven on a real HTTP stack | 🔬 exploration |

Real-browser tests live in `browser-test/` (`npm run test:browser`, drives a real Chrome;
189 vitest + 26 browser tests green). Architecture rationale for every choice is in
[`DECISIONS.md`](DECISIONS.md); the phase tracker is [issue #1](../../issues/1).

### Phase 5

- **`createContext` / `useContext`** — rides the owner tree (survives portals/serialization).
- **`createStore`** — nested reactive proxy: reading `state.rows[3].status` in an effect re-runs
  only when *that* field changes. Fine-grained down to the property.
- **`onMount`** (`pimas/dom`) — run a callback once *after* the render's nodes are inserted (the
  hook for focus/measure/wiring live nodes); a no-op under SSR.
- **`<ErrorBoundary fallback={(err, reset) => …}>` / `catchError`** — errors in render, an effect,
  or a memo route to the nearest boundary on the owner tree; `reset()` rebuilds the subtree.
- **Islands** — interactive widgets ship as their own lazy-loaded, code-split bundles
  (`load`/`idle`/`visible`); the rest of the page stays 0 KB JS and is client-rendered on demand.
  One shared pimas kernel chunk across all islands (no dual-kernel hazard).
- **`listen` seam** takes a closure *or* a serializable handler descriptor `{ref, load, capture}`.
- **Dogfood:** klarum.com rebuilt on pimas (branch `pimas-port` of the landing repo) — 19 routes,
  0 KB JS on static pages, a 10-demo interactive `/showcase/` (records/pricing/analytics-charts/
  agent-playback/knowledge-graph SVG/…), verified across static reactivity + browser interaction +
  runtime timers.

### Since (resumability + compiler + store v2)

- **`createStore` v2** — `reconcile(next, {key})` diffs external data in preserving row identity (a
  server-refreshed keyed `<For>` reuses/moves DOM rows, never rebuilds); `produce(fn)` is Immer-style
  mutable-draft sugar over the fine-grained setter. Both are tree-shakeable tagged updaters. (D#43)
- **Resumability (compiler-free foundation)** — the string backend serializes handler descriptors →
  `on:<type>` + an `application/pimas-state` capture table; the renderer-free **`pimas/resume`**
  dispatcher makes a server tree interactive with **zero component re-execution** (real-Chrome verified,
  incl. non-bubbling focus via capture phase). A zero-dep **type-tagged codec** (`encode`/`decode`) makes
  captures round-trip Dates/Maps/typed rows. (D#44)
- **Compiler — Phase A (`pimas/compiler`)** — the thunk-eraser: write `{count()}`, it emits the
  `() => (…)` thunk at build time (TypeScript-as-parser Vite plugin; zero runtime change; out of every
  size budget). The wedge toward automatic resumability (Phase D, staged D1→D4). (D#45)
- **Agent-surface hardening** — bridge listener isolation, an L2 change-log (`history()`), and correct
  L2 provenance for async actions. (D#46)
- **Scheduler seam (#3)** — `setScheduler((flush) => queueMicrotask(flush))` makes flush *timing* pluggable:
  a synchronous write-burst coalesces into one deferred repaint (effects still run in FIFO order). The default
  is a direct synchronous flush — timing is byte-for-byte unchanged, so `renderToString` and post-write DOM
  reads stay correct; deferral is strictly opt-in. `flushSync()` forces a drain when a deferred scheduler is
  installed. (D#47)
- **Claim/hydrate backend (`pimas/hydrate`, #6)** — `claim(code, container)` **adopts** the server-rendered
  DOM in place (reuses nodes, wires reactivity + listeners) instead of client-render-first discarding it — the
  *state* half of resumability (`resume` is the *listener* half). Motivated by measuring klarum's showcase
  throw away **55.8 KB** of server HTML and recreate the tree. Covers static elements, dynamic attrs, event
  handlers, reactive text, **and control flow** (`<For>`/`<Show>`/`<Switch>` reorder/append/remove against the
  adopted DOM); correctness-first fallback to a client render on any structural desync. All real-browser proven.
  Enabled by a small reactive-core **`env` seam** — a computation recomputes under the backend it was created
  with (so a `<For>` memo rebuilds through claim, not the DOM backend), which also lets claimed and rendered
  islands coexist on one page. Also handles `ref` (deferred to fire with the adopted node) and adjacent text
  the parser coalesced (`splitText` to rebind the pieces). (D#48, D#49, D#50)
- **Dogfood — claim adopts both real sites.** Swapping each site's island boot from `render()` to `claim()`,
  every load-strategy island now **adopts the server DOM in place instead of discarding and rebuilding it**, and
  stays interactive after adoption (real-Chrome verified). klarum: the **~56 KB `/showcase/`** (previously thrown
  away), the home hero (root `ref` → `getBoundingClientRect`), `/pricing/`. noahhyden.com: `primitives-demo`
  (increment updates the adopted node, autofocus ref fires, the coalesced `count = ` run is split & adopted).
  claim falls back to a client render on any structural desync, so the swap is safe. (D#50)
- **Still deferred** (tracked in issues): compiler Phase B (templates — reconsidered as marginal under the
  static-first model) / Phase D (D2+ lazy handler chunks; D4 = claim from the serialized capture-table, not just
  live closures) and claim's subtree-granular fallback (#6/#12).

### Agent-native (exploration — issue [#13](../../issues/13), rationale in [`AGENT-NATIVE.md`](AGENT-NATIVE.md))

A from-scratch fine-grained engine is, incidentally, a live machine-readable model of the
page — signals are readable/subscribable state, setters/handlers are actions, memos are
derivations. A virtual DOM is not. `pimas/agent` turns that into an agent-facing surface:

- **L1 — subscribe.** `createAgentBridge` exposes signals/memos as named live values an agent
  is *pushed* deltas for (an exposing `createEffect` **is** the subscription) and registers
  actions it can `call`. No polling, no DOM scraping.
- **L2 — explain.** Each `call()` records a causal record — which fields it wrote (via
  `pimas/store`'s `onStoreWrite`) and which exposed values changed — read via `explain()`.
- **L3 — simulate.** `speculate(apply, read)` evaluates hypothetical writes against a *shadow*
  of the graph: reads/memos see the what-if, the real graph and effects are untouched, rollback
  is free — so an agent gets the **exact predicted next state before committing**. Only tractable
  because the engine is pull-based with topology separate from value; store copy-on-write covers
  edits. Distinct from learned agent world-models (approximate) and optimistic updates (commit-
  then-rollback). The bridge adds the **planning half**: `speculatePlan(steps)` composes a
  multi-factor scenario in one shadow, `speculateSweep(name, argsList)` runs a sensitivity sweep —
  the core of a what-if engine for quantitative models. (D#51)
- **WebMCP.** `pimas/agent/webmcp` `toWebMCP(bridge)` projects actions → tools and state →
  read-only `get_*` tools onto the browser `document.modelContext` standard; the bridge's live
  subscribe channel is the push WebMCP structurally lacks — the differentiator.

Proven end-to-end driving a real HTTP stack (pivi's `/api/proposals` contract): a **preview →
approve → commit** copilot where `speculate` shows the exact resulting totals, *approve* fires a
real `PATCH`, and the backend persists it. And proven on a **quantitative model** — the
[`von-neumann/wall-live`](https://github.com/noahhyden/von-neumann) explainer: a self-replicating-
lunar-factory simulation run entirely in a pimas graph (bill-of-materials as a copy-on-write store,
results as memos), where the "electronics wall" what-if is a first-class `speculate` (exact
after-state, nothing committed) and the core both computes the model *and* renders the page (~11 KB
gz; the ported math is pinned to the reference implementation by a cross-language differential test).
The sharpest fit for L3 is exactly this: **pure, derived-heavy quantitative models**, where "what-if"
is the whole activity and the memo-purity caveat is free.

Exploration, not a committed pivot — the core (Phases 1–5) is unchanged and the whole agent layer is
opt-in (tree-shaken when unused; the hot-path floor moved only 679→698 gz).

## Develop

```sh
npm install
npm test            # vitest, once
npm run test:watch
npm run typecheck
npm run size        # per-import gzip budgets
npm run build       # emit dist/
```
