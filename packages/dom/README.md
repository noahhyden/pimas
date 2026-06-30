# @pimas/dom

The DOM renderer and JSX runtime for [Pimas](../../README.md). Turns components
into **real DOM nodes once**; each *dynamic* binding is wrapped in an effect from
[`@pimas/reactive`](../reactive), so only that node updates when a signal
changes. No virtual DOM, no diffing of the static structure.

```tsx
import { createSignal } from "@pimas/reactive";
import { render } from "@pimas/dom";

function Counter() {
  const [n, setN] = createSignal(0);
  return (
    <button onClick={() => setN(n() + 1)}>
      count: {() => n()}   {/* thunk = dynamic; only this text node updates */}
    </button>
  );
}

render(() => <Counter />, document.body);
```

## The thunk convention

Until the compiler (Phase 5), dynamic bindings are marked by passing a
**function**: `{() => n()}`, `class={() => active() ? "on" : "off"}`. A plain
value (`"hello"`, `42`, a node) is inserted once and never touched. The thunk is
the explicit, honest signal of "this is reactive" — the compiler will later infer
it so you can write `{n()}` directly.

## API

- `render(code, container)` → `dispose` — mount a tree, returns teardown.
- `h(type, props, ...children)` — hyperscript; the JSX factory.
- `Fragment` — group children with no wrapper.
- `@pimas/dom/jsx-runtime` / `@pimas/dom/jsx-dev-runtime` — automatic-runtime
  entries for TS's `react-jsx` transform (`jsxImportSource: "@pimas/dom"`).

## Known gaps (next)

- **SVG**: elements are created with `createElement`, not `createElementNS` —
  inline `<svg>` won't render correctly yet. Needed before the noahhyden.com port.
- **Keyed lists**: dynamic array children are full-swapped, not keyed-diffed.
  `<For>` (real reconciliation) lands in Phase 3 (`@pimas/control-flow`).
- **Event delegation**: events use direct `addEventListener` (correct, simple).

> The dependency direction is fixed: `@pimas/dom` → `@pimas/reactive`, never the
> reverse. The core stays headless.
