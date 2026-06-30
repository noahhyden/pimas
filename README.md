# Pimas

A fine-grained reactive UI framework, built from scratch. The goal: own the
whole frontend stack — no React, no virtual DOM, no in-browser transpiler.

Same engine class as [SolidJS](https://www.solidjs.com/): values are
*observable*, and only the exact DOM nodes that read a changed value update.
There is no diffing.

## Packages

A monorepo (npm workspaces) so you import only what you need. The dependency
direction is one-way: renderer → core, never the reverse.

| Package | What | Depends on |
| --- | --- | --- |
| [`@pimas/reactive`](packages/reactive) | reactive core — signals/effects/memos. Zero deps, headless (browser **or** Node). | — |
| [`@pimas/dom`](packages/dom) | DOM renderer + JSX runtime *(Phase 2, stub)* | `@pimas/reactive` *(peer)* |
| [`pimas`](packages/pimas) | one-install facade re-exporting the common surface | `@pimas/reactive` (+ `@pimas/dom` in Phase 2) |

The core is the irreducible kernel: anything reactive drags it in, but nothing
else. Every package is pure ESM and `"sideEffects": false`, so a bundler strips
unused exports. `@pimas/reactive` is a **peer** dependency of every runtime
consumer, so an app only ever loads one copy of the kernel. Watch per-import
cost with `npm run size`.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| **1 — Reactive core** | `signal` / `effect` / `memo` / `batch` / `untrack` / `onCleanup` / `createRoot` | ✅ done |
| **2 — DOM renderer + JSX** | `h` / `Fragment` / `render`, dynamic attrs & children via effects, automatic JSX runtime | ✅ done |
| 3 — Components + control flow | `<Show>`, `<For>` (keyed list reconciliation), SVG namespace | next |
| 4 — Port noahhyden.com | rebuild pages as `.tsx`, ship static HTML, delete the canvas runtime | — |
| 5 — Optional | router, SSR/prerender, compiler plugin, devtools | — |

## The idea in 30 seconds

```ts
import { createSignal, createEffect } from "pimas";

const [count, setCount] = createSignal(0);

createEffect(() => console.log("count is", count())); // logs "count is 0"

setCount(1); // logs "count is 1"
setCount(2); // logs "count is 2"
```

`createEffect` runs once, and the read of `count()` inside it registers a
subscription. Each `setCount` re-runs *only* the effects that read that signal.
That single mechanism — track-on-read, notify-on-write — is the entire engine.
See [`src/reactive.ts`](src/reactive.ts); it's ~200 commented lines.

## Develop

```sh
npm install
npm test          # run the suite once
npm run test:watch
npm run typecheck
npm run build     # emit dist/
```

## API (Phase 1)

- `createSignal(initial)` → `[read, write]` — a reactive value.
- `createEffect(fn)` — run `fn`, re-run when its tracked signals change.
- `createMemo(fn)` → `read` — a cached derived value (also a signal).
- `batch(fn)` — coalesce multiple writes into one flush.
- `untrack(fn)` — read signals without subscribing.
- `onCleanup(fn)` — teardown before re-run / on disposal.
- `createRoot(fn)` — a disposable ownership scope to mount under.
