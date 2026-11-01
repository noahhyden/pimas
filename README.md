# pimas

A reactive model an agent (or a React preview UI) can **simulate against without committing**.

You put derived state in signals, memos, and a store. `speculate` answers “what would `total` be if I set qty to 10?” by recomputing those memos against a shadow of the graph. Effects do not run. The live model does not change. The number you get is the number a real commit would produce.

That is the whole product. There is no renderer, no JSX, no VDOM. Your UI is React (or nothing). Pin `pimas-ui@0.1.2` if you still need the old framework.

```sh
npm install pimas-ui
```

## Afternoon, in a React app

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
  m.action(
    "setQty",
    (id: string, qty: number) => {
      const i = cart.items.findIndex((row) => row.id === id);
      if (i >= 0) setCart("items", i, "qty", qty);
    },
    { params: ["id", "qty"] },
  );

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

`usePimas(() => model.cart.items[0].qty)` re-renders that component only when that field changes.

Give the same bridge to an agent (`toWebMCP(model.bridge)` from `pimas-ui/agent/webmcp`) and it gets `setQty` plus `simulate_setQty`. The preview UI and the agent call the same function. Same answer.

## What this does that a reducer does not

`next = reducer(state, action)` already previews a Redux store. You do not need pimas for that.

You need it when the model is a **graph of derived values**, not one reducer:

- nested store fields, each independently subscribed
- memos that fan in (a diamond recomputes once, glitch-free)
- a multi-step plan in **one** shadow (`speculatePlan`) so A-then-B is not two separate previews that reset
- a sensitivity sweep (`simulate_sweep`) that never touches live state
- the same surface projected as agent tools, including `simulate_*`

Memos must be pure. If a memo writes to the network, speculation will not save you — and should not. Put I/O in `action`s; put math in memos.

## API

| Import | Exports |
| --- | --- |
| `pimas-ui` | `createSignal` `createMemo` `createEffect` `batch` `untrack` `onCleanup` `createRoot` `subscribe` `catchError` `speculate` `setScheduler` `flushSync` `getListener` `speculationScratch` |
| `pimas-ui/store` | `createStore` `produce` `reconcile` `unwrap` `onStoreWrite` |
| `pimas-ui/agent` | `createModel` `createAgentBridge` — the bridge carries `snapshot` `subscribe` `descriptor` `call` `explain` `history` `speculate` `speculatePlan` `commitPlan` `graph` `dispose` |
| `pimas-ui/agent/webmcp` | `toWebMCP` `detectModelContext` — actions plus `get_*` and `simulate_*` tools |
| `pimas-ui/agent/page` | `installPageAgent` — sets `window.__pimas`, with or without WebMCP |
| `pimas-ui/react` | `usePimas` — React 18+, optional peer |

`getListener` and `speculationScratch` are the seam `pimas-ui/store` is built on; you need
them only to write your own store-like primitive.

Zero runtime dependencies. React is an optional peer, pulled in only if you import `pimas-ui/react`.

### Stability

Pre-1.0, solo-maintained — pin exact versions. Within `0.3.x` the surface above is additive;
breaking changes bump `0.x.0`. Releases after `0.1.0` carry signed npm provenance. The `0.1.x`
renderer entries (`pimas-ui/dom`, `/flow`, `/server`, `/resume`, `/hydrate`, `/compiler`,
`/resource`, `/jsx-runtime`) no longer exist.

A page agent works with or without `document.modelContext`:

```ts
import { installPageAgent } from "pimas-ui/agent/page";

installPageAgent(model.bridge, { namespace: "model" });
// window.__pimas.model.speculate(action, ...args)  — live state unchanged
// window.__pimas.model.call(action, ...args)       — commit
```

## License

[Apache License 2.0](LICENSE).

The names **pimas** and **pimas-ui**, the name **Noah Hyden**, and the project's
logos are trademarks and are *not* covered by that licence — see
[TRADEMARKS.md](TRADEMARKS.md) for what's fine without asking, and
[NOTICE](NOTICE). Fork the code freely; just give your fork its own name.

Releases published before the move to Apache 2.0 (`pimas-ui` up to `0.3.0`)
keep the MIT terms they shipped under.
