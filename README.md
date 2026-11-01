# pimas

A reactive model an agent (or a React preview UI) can **simulate against without committing**.

Put derived state in signals, memos, and a store. `speculate` answers "what would `total` be if I
set qty to 10?" by recomputing those memos against a shadow of the graph: effects do not run, the
live model does not change, and the number you get is the number a real commit would produce.

No renderer, no JSX — your UI is React, or nothing. (Pin `pimas-ui@0.1.2` for the old renderer.)

## Install

```sh
npm install pimas-ui
```

## Quick start

```tsx
import { createMemo } from "pimas-ui";
import { createStore } from "pimas-ui/store";
import { createModel } from "pimas-ui/agent";
import { usePimas } from "pimas-ui/react";

const model = createModel((m) => {
  const [cart, setCart] = createStore({
    items: [{ id: "a", qty: 2, price: 5 }],
  });
  const total = createMemo(() =>
    cart.items.reduce((s, i) => s + i.qty * i.price, 0),
  );

  m.expose("total", total);
  m.action("setQty", (id: string, qty: number) => {
    const i = cart.items.findIndex((row) => row.id === id);
    if (i >= 0) setCart("items", i, "qty", qty);
  }, { params: ["id", "qty"] });

  return { cart, total };
});

function Checkout({ draftQty }: { draftQty: number }) {
  const live = usePimas(model.total);
  const preview = model.bridge.speculate("setQty", "a", draftQty).total as number;

  return (
    <>
      <div>Now: {live}</div>
      <div>If you confirm: {preview}</div>
      <button onClick={() => model.bridge.call("setQty", "a", draftQty)}>
        Confirm
      </button>
    </>
  );
}
```

`usePimas(() => model.cart.items[0].qty)` re-renders only when that one field changes.

## Why not a reducer

`next = reducer(state, action)` already previews a Redux store. pimas earns its place when the
model is a **graph of derived values**: store fields subscribed independently, memos that fan in
(a diamond recomputes once, glitch-free), and a multi-step plan applied in **one** shadow
(`speculatePlan`), so A-then-B is not two previews that reset.

Memos must be pure — if a memo writes to the network, speculation will not save you. I/O in
`action`s, math in memos.

## Agents

The bridge behind that preview is the same surface an agent gets. `toWebMCP(model.bridge)` projects
it onto `document.modelContext` as `setQty` alongside `simulate_setQty`, so the preview UI and the
agent call the same function and cannot disagree about the answer.

Where WebMCP is not available, `installPageAgent` puts the same surface on `window`:

```ts
import { installPageAgent } from "pimas-ui/agent/page";

installPageAgent(model.bridge, { namespace: "model" });
// window.__pimas.model.speculate(action, ...args)  — live state unchanged
// window.__pimas.model.call(action, ...args)       — commit
```

## API

| Import | Exports |
| --- | --- |
| `pimas-ui` | `createSignal` `createMemo` `createEffect` `batch` `untrack` `onCleanup` `createRoot` `subscribe` `catchError` `speculate` `setScheduler` `flushSync` `getListener` `speculationScratch` |
| `pimas-ui/store` | `createStore` `produce` `reconcile` `unwrap` `onStoreWrite` |
| `pimas-ui/agent` | `createModel` `createAgentBridge` — the bridge carries `snapshot` `subscribe` `descriptor` `call` `explain` `history` `speculate` `speculatePlan` `commitPlan` `graph` `dispose` |
| `pimas-ui/agent/webmcp` | `toWebMCP` `detectModelContext` — actions plus `get_*` and `simulate_*` tools |
| `pimas-ui/agent/page` | `installPageAgent` — sets `window.__pimas`, with or without WebMCP |
| `pimas-ui/react` | `usePimas` — React 18+, optional peer |

`getListener` and `speculationScratch` are the seam the store is built on — you need them only to
write your own store-like primitive. Zero runtime dependencies; React is an optional peer.

## Stability

Pre-1.0, solo-maintained — pin exact versions. Within `0.3.x` the surface above is additive;
breaking changes bump `0.x.0`. Releases carry signed npm provenance.

## License

[Apache License 2.0](LICENSE). The names **pimas** and **pimas-ui**, the name **Noah Hyden**, and
the project's logos are trademarks, *not* covered by that licence — see
[TRADEMARKS.md](TRADEMARKS.md) and [NOTICE](NOTICE). Fork freely; give your fork its own name.

Releases up to and including `0.3.0` shipped under MIT and keep those terms.
