# Getting started with pimas

A hands-on tour of the stable surface. For *why* it works the way it does, see
[`DECISIONS.md`](DECISIONS.md); for the internals, the [README](../README.md).

> The npm package is **`pimas-ui`** (the bare name `pimas` was taken). You import
> from `pimas-ui`, `pimas-ui/dom`, etc. Throughout this guide, that's the name.

## 1. Install

```sh
npm install pimas-ui
```

Zero runtime dependencies. TypeScript is an optional peer (only used at build time).

## 2. TypeScript / bundler setup

pimas authors in JSX/TSX using TypeScript's **automatic runtime** — no Babel, no
in-browser transpile. Point the JSX transform at pimas in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "pimas-ui",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"]
  }
}
```

That's it — `jsxImportSource: "pimas-ui"` makes `<div/>` compile to calls into
`pimas-ui/jsx-runtime`. Any ESM bundler (Vite, esbuild, etc.) works; there's no
required meta-framework.

## 3. Your first component

```tsx
import { createSignal } from "pimas-ui";
import { render } from "pimas-ui/dom";

function Counter() {
  const [n, setN] = createSignal(0);
  return <button onClick={() => setN(n() + 1)}>count: {() => n()}</button>;
}

render(() => <Counter />, document.body);
```

Click the button and **only the text node updates** — there's no virtual DOM and
no diffing.

### The one rule: dynamic values are thunks

A signal is read by *calling* it: `n()`. To make a piece of JSX reactive, pass a
**function** (a thunk) so the renderer knows to re-run just that binding:

```tsx
<p>{() => n()}</p>              // ✅ reactive — updates when n changes
<p>{n()}</p>                    // ❌ reads once at render, never updates
<div class={() => cls()} />     // ✅ reactive attribute
<div class="static" />          // fine — static, never touched again
```

Everything static (plain strings, numbers, nodes) is written once and left alone.

## 4. Reactivity: effects and memos

```tsx
import { createSignal, createEffect, createMemo, batch } from "pimas-ui";

const [first, setFirst] = createSignal("Ada");
const [last, setLast] = createSignal("Lovelace");

// A memo: a cached derived value, recomputed only when a dependency truly changes.
const full = createMemo(() => `${first()} ${last()}`);

// An effect: runs now, and again whenever something it read changes.
createEffect(() => console.log("name is", full()));

// Group writes so dependent effects run once, at the end.
batch(() => {
  setFirst("Grace");
  setLast("Hopper");
}); // effect logs "name is Grace Hopper" exactly once
```

Reading a signal *inside* an effect or memo subscribes it automatically — no
dependency arrays. `onCleanup(fn)` registers teardown for the current scope;
`untrack(fn)` reads without subscribing.

## 5. Control flow

Import from `pimas-ui/flow`. Pass branch children as **thunks** so a hidden branch
isn't built (and is disposed when it flips away):

```tsx
import { Show, For } from "pimas-ui/flow";

<Show when={() => loggedIn()} fallback={<a href="/login">Sign in</a>}>
  {() => <Dashboard />}
</Show>;

// Keyed by item identity — reorders MOVE DOM rows instead of rebuilding them.
<For each={() => todos()}>
  {(todo, i) => <li>{() => `${i() + 1}. ${todo.text}`}</li>}
</For>;
```

Also available: `<Switch>`/`<Match>`, position-keyed `<Index>`, and
`<ErrorBoundary fallback={(err, reset) => …}>`.

## 6. Stores (nested reactive state)

For structured/nested state, `createStore` gives a proxy that tracks reads down to
the individual field — an effect reading `state.rows[3].status` re-runs only when
*that* field changes.

```tsx
import { createStore } from "pimas-ui/store";

const [state, setState] = createStore({ rows: [{ id: 1, done: false }] });

setState("rows", 0, "done", true);          // fine-grained path update
// Immer-style draft:
import { produce } from "pimas-ui/store";
setState(produce((s) => { s.rows.push({ id: 2, done: false }); }));
```

`reconcile(next, { key })` diffs external/server data into the store in place,
preserving row identity (so a keyed `<For>` reuses DOM rows).

## 7. Server rendering

The same components render to an HTML string through a different backend — no code
changes:

```tsx
import { renderToString } from "pimas-ui/server";

const html = renderToString(() => <Counter />);
// send `html` from your server; 0 KB of framework JS is required to display it
```

To make server-rendered HTML interactive on the client, see the experimental
`pimas-ui/resume` and `pimas-ui/hydrate` (`claim()`) surfaces.

## 8. Accessibility

pimas has no synthetic event system and no attribute allow-list — it sets what you
write straight onto the real DOM node and dispatches native events. So standard
accessibility techniques work as-is, and the typed JSX keeps them ergonomic:

- **ARIA & roles.** `role` and every `aria-*` attribute are accepted (and `aria-*`
  is always allowed by the types). Use thunks for the reactive ones:
  ```tsx
  <button aria-pressed={() => String(on())} aria-label="Mute">…</button>
  <div role="status" aria-live="polite">{() => msg()}</div>
  ```
- **Labels.** `<label for={id}>` (or `htmlFor`) is typed on `<label>`; pair it with
  a matching input `id`.
- **Focus management.** Move focus after mount with `onMount` + a `ref` (a plain
  effect would see a detached node):
  ```tsx
  let el; onMount(() => el?.focus()); return <input ref={(n) => (el = n)} />;
  ```
  And because keyed `<For>` **moves** DOM rows on reorder (via `moveBefore`) rather
  than rebuilding them, focus and selection survive a list reorder — the correct
  behavior for keyboard users.
- **No focus traps from re-render.** Fine-grained updates change only the nodes that
  read a changed value, so typing in one field never re-creates (and blurs) another.

There's no pimas-specific a11y magic to learn — that's the point. Test with a
screen reader and keyboard as you would any real-DOM app. (Tracking further a11y
examples/tests in issue #23.)

## Where to go next

- **[README](../README.md)** — how the engine works and what makes it different.
- **[`STABILITY.md`](STABILITY.md)** — which APIs are stable vs 🔬 experimental, and the versioning policy.
- **[`DECISIONS.md`](DECISIONS.md)** — the rationale for every architectural choice.
- **[`AGENT-NATIVE.md`](AGENT-NATIVE.md)** — the experimental agent-simulatable surface.
