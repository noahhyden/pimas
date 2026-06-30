# @pimas/reactive

The fine-grained reactive core of [Pimas](../../README.md). **Zero dependencies**,
no DOM — runs in the browser, in Node, in a worker. This is the irreducible
kernel everything else builds on.

```ts
import { createSignal, createEffect, createMemo } from "@pimas/reactive";

const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);
createEffect(() => console.log(doubled())); // 0
setCount(2);                                 // 4
```

Track-on-read, notify-on-write. A write re-runs only the computations that read
that signal. See [`src/reactive.ts`](src/reactive.ts) — ~200 commented lines.

## API

- `createSignal(initial)` → `[read, write]`
- `createEffect(fn)`
- `createMemo(fn)` → `read`
- `batch(fn)`
- `untrack(fn)`
- `onCleanup(fn)`
- `createRoot(fn)`

Because the package is marked `"sideEffects": false` and is pure ESM, a bundler
drops anything you don't import.
