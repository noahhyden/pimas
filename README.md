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
| `pimas` | reactive core — signals/effects/memos. **Headless** (browser *or* Node). | nothing else |
| `pimas/dom` | DOM renderer + `render`/`h`/`Fragment`. | the core |
| `pimas/jsx-runtime`, `pimas/jsx-dev-runtime` | automatic JSX runtime for TS's `react-jsx` transform | the renderer |

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
| **1 — Reactive core** | `signal`/`effect`/`memo`/`batch`/`untrack`/`onCleanup`/`createRoot` | ✅ done |
| **2 — DOM renderer + JSX** | `h`/`Fragment`/`render`, dynamic attrs & children via effects, automatic JSX runtime | ✅ done |
| 3 — Control flow + backend seam | `<Show>`/`<For>` (keyed), SVG namespace, renderer-over-a-backend-contract (so SSR is additive) | next |
| 4 — Port noahhyden.com | rebuild pages, ship static HTML via a string backend, delete the canvas runtime | — |
| 5 — Optional | router, SSR/hydrate, compiler plugin, devtools | — |

## Develop

```sh
npm install
npm test            # vitest, once
npm run test:watch
npm run typecheck
npm run size        # per-import gzip budgets
npm run build       # emit dist/
```
