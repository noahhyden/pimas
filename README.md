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
| **5 — Interactivity + Klarum** | `createContext`, `createStore`, descriptor-capable `listen` seam, **islands** (client-rendered, lazy), Klarum home ported | 🚧 in progress |

Real-browser tests live in `browser-test/` (`npm run test:browser`, drives a real Chrome).
Architecture rationale for every choice is in [`DECISIONS.md`](DECISIONS.md); the phase
tracker is [issue #1](../../issues/1).

### Phase 5 so far

- **`createContext` / `useContext`** — rides the owner tree (survives portals/serialization).
- **`createStore`** — nested reactive proxy: reading `state.rows[3].status` in an effect re-runs
  only when *that* field changes. Fine-grained down to the property.
- **Islands** — interactive widgets ship as their own lazy-loaded, code-split bundles
  (`load`/`idle`/`visible`); the rest of the page stays 0 KB JS and is client-rendered on demand.
  Proven on noahhyden.com (an accordion) and Klarum (an FAQ).
- **`listen` seam** takes a closure *or* a serializable handler descriptor `{ref, load, capture}`
  — the door to Qwik-style resumability is held open without paying for it yet.
- **Deferred** (tracked in issues): `ErrorBoundary`, a microtask scheduler, the compiler
  (thunk-eraser), store `produce`/`reconcile`, the claim/hydrate backend, resumability.

## Develop

```sh
npm install
npm test            # vitest, once
npm run test:watch
npm run typecheck
npm run size        # per-import gzip budgets
npm run build       # emit dist/
```
