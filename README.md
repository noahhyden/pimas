# Pimas

A fine-grained reactive UI framework, built from scratch – no React, no virtual
DOM, no in-browser transpiler, **zero runtime dependencies**. Same engine class
as [SolidJS](https://www.solidjs.com/): values are *observable*, and only the
exact DOM nodes that read a changed value update. There is no diffing.

![An agent streams run-state updates into the same UI rendered two ways. On each change, React re-renders and diffs the whole subtree (every node flashes; "component re-renders" climbs to 36), while Pimas updates only the one node that read the value ("DOM nodes updated" reaches just 6). No virtual DOM, no diffing.](docs/demo.gif)

But the framework is also the **lab** for the thing that makes pimas worth owning
as a small, sharp project: a from-scratch fine-grained engine is, incidentally, a
**live machine-readable model of the page** – one an AI agent can *subscribe* to,
get *causal explanations* from, and *simulate against before it acts*. A virtual
DOM cannot do that; the reason why is mechanical, and it's the last third of this
document.

Three questions organize the rest: **how it works** (mechanistically, in detail),
**why it works this way** (the load-bearing decisions and what pimas is *different*
from), and **what it lets you do** that nothing else can.

> **New here?** The [Getting Started guide](docs/GETTING-STARTED.md) is the
> hands-on path: install, first component, reactivity, control flow, stores, SSR.

## One package, subpath entry points

`pimas` is a single package (published to npm as [`pimas-ui`](https://www.npmjs.com/package/pimas-ui)).
You import only the surface you need; the rest is tree-shaken away (every entry is
pure ESM + `"sideEffects": false`). Run `npm run size` for the per-import gzip cost.

| Import | What | gzip |
| --- | --- | --- |
| `pimas` | reactive core – `createSignal`/`createEffect`/`createMemo`/`batch`/`untrack`/`onCleanup`/`createRoot`, `createContext`/`useContext`. **Headless** (browser *or* Node). | 752 B |
| `pimas/dom` | DOM renderer – `render`/`h`/`Fragment`/`onMount`, two-way form binding (`model`/`modelChecked`/`modelNumber`), automatic JSX runtime. | 1999 B |
| `pimas/server` | `renderToString` – the *same* components rendered to HTML (SSR / static prerender). | 1906 B |
| `pimas/flow` | control flow – `<Show>`/`<Switch>`/`<Match>`, keyed `<For>`, position-keyed `<Index>`, `<ErrorBoundary>`. | 704 B–1.4 KB |
| `pimas/store` | `createStore` – nested reactive proxy, fine-grained per-field; `reconcile`/`produce`. **Headless.** | 1713 B |
| `pimas/resource` | 🔬 `createResource` – async fetch as reactive state (`loading`/`error`/`refetch`/`mutate`). **Headless.** | opt-in |
| `pimas/resume` | 🔬 renderer-free client dispatcher – wires a server tree's serialized handlers to live events **without re-running components**. | 878 B |
| `pimas/hydrate` | 🔬 `claim()` – **adopts** the server-rendered DOM in place instead of discarding + client-rendering it. | 2412 B |
| `pimas/agent` | 🔬 expose the reactive graph to an AI agent: subscribe (L1), causal provenance (L2), deterministic what-if `speculate` (L3). **Headless.** | opt-in, tree-shaken when unused |
| `pimas/agent/webmcp` | 🔬 project the bridge onto the WebMCP browser API (`document.modelContext` tools). | – |
| `pimas/compiler` | 🔬 build-time only – thunk-eraser Vite plugin (`{count()}` → `{() => count()}`). Never in a runtime bundle. | – |
| `pimas/jsx-runtime`, `pimas/jsx-dev-runtime` | automatic JSX runtime for TS's `react-jsx` transform. | – |

Internally it's **one module graph** – the renderer imports the core by relative
path – so there is exactly one reactive kernel instance: no dual-package hazard, no
peer-dependency wiring. The headless core is the irreducible floor; anything
reactive includes it, nothing else does.

---

## 1 – How it works

### 1.1 The reactive kernel: track-on-read, notify-on-write

The whole engine is one mechanism: **reading a value inside a computation
subscribes that computation; writing the value re-runs exactly the computations
that read it.** Everything else is bookkeeping to make that correct and cheap.
The core is ~200 commented lines: [`src/reactive/reactive.ts`](src/reactive/reactive.ts).

```ts
import { createSignal, createEffect } from "pimas";

const [count, setCount] = createSignal(0);
createEffect(() => console.log("count is", count())); // "count is 0"
setCount(1); // "count is 1"
```

**The node.** Every reactive thing – a signal, a memo, an effect – is one
`Reactive` node with the same shape. The load-bearing fields:

- `value` – the cached value.
- `fn?` – the compute function. **Present on memos and effects, absent on plain
  signals.** `node.fn && !node.effect` is the "is a memo" test used throughout.
- `state` – a 3-color mark: `CLEAN (0)` / `CHECK (1)` / `DIRTY (2)`.
- `sources: Set<Reactive>` – the nodes this one *read* last run (its dependencies).
- `observers: Set<Reactive>` – the nodes that read *this* one (its dependents).
- `owner` / `owned[]` – the ownership tree (disposal, context, error boundaries).
- `env?` – the ambient render backend captured at creation (§1.3).

Signals are born `CLEAN`; memos/effects are born `DIRTY` (they need a first
compute). The links are always **two-way**: a read adds the node to the reader's
`sources` *and* adds the reader to the node's `observers`.

**Read** (`readNode`): if a computation is currently running (`currentObserver`),
form the two-way link. If the node is a memo, bring it current via
`updateIfNecessary` *before* trusting its value. Return `value`.

**Write** (`writeNode`): if the new value `Object.is`-equals the old, **do nothing**
(the first cascade-killer). Otherwise set `value`, then **PUSH**: mark every direct
observer `DIRTY` and everything transitively below `CHECK` – via `stale()`, which
*only marks, never computes*, and stops re-traversing as soon as a node is already
at least that stale. An effect transitioning off `CLEAN` gets pushed onto the
`effectQueue` here. Then, unless batching, flush.

### 1.2 Why it's glitch-free: push–pull, not eager

Propagation is **two-phase**, split across the write and the read:

- **PUSH (on write)** marks dependents without computing anything. Direct
  dependents become `DIRTY` ("a source *definitely* changed"); everything below
  becomes `CHECK` ("a source *might* have changed").
- **PULL (on read / effect flush)** is `updateIfNecessary`. A `CHECK` node walks
  its `sources` *first*, recursively bringing each current; if one of them actually
  recomputes to a new value it flips this node to `DIRTY`, and only a `DIRTY` node
  calls `update()` to re-run its `fn`. **`update` propagates to observers only if
  the new value is unequal to the old** – the second cascade-killer.

This is what "glitch-free" means concretely. Take a diamond: `D = B + C`, where
`B = A + 1` and `C = A + 1`. Writing `A` pushes `DIRTY` to `B` and `C` and `CHECK`
to `D` – no computation yet. When the driving effect pulls `D`, `D` is `CHECK`, so
it resolves `B` then `C` to current *before* recomputing – and recomputes **exactly
once**, on fully-current inputs. No transient wrong value, no double-run. Memos are
**lazy** (compute on read); effects are **eager** (the roots that drive the pull).
Algorithm after Milo Hansen's *Reactively*.

**Re-subscription is per-run.** Before every recompute, `update` clears the node's
`sources` and re-collects them as `fn` runs – so a conditional branch subscribes
only to what it actually read *this time*. Dead branches silently unsubscribe.

**The rest of the core, mechanically:**

- `batch(fn)` – increments a depth counter; `writeNode` only flushes at depth 0, so
  writes inside accumulate marks and drain once at the end.
- `untrack(fn)` – nulls `currentObserver` for the duration, so reads form no links.
- `onCleanup(fn)` – pushes teardown onto the current owner; runs (reverse order)
  before every re-run and on disposal.
- `createRoot(fn)` – a top-level owner that does *not* auto-dispose; you get a manual
  `dispose`. The owner tree gives O(changed) teardown and carries context + error
  handlers, walked by `.owner` (not the DOM tree – so it survives portals and
  serialization).
- **Scheduler seam** – `setScheduler((flush) => queueMicrotask(flush))` makes flush
  *timing* pluggable: a synchronous write-burst coalesces into one deferred repaint
  (effects still run FIFO). Default is a direct synchronous flush, so `renderToString`
  and post-write DOM reads stay correct; deferral is strictly opt-in. `flushSync()`
  forces a drain.

### 1.3 Rendering: one component, two backends, no diff

The renderer never diffs. It runs each component **once** to build real nodes, and
wraps every *dynamic* binding in its own effect – so a change re-runs one binding,
not a subtree. All host interaction goes through a small `RenderBackend` contract
(`element`/`text`/`anchor`/`insert`/`remove`/`setAttr`/`setStyle`/`listen`/
`nextSibling`/`effect`/`scheduleMount`). **`effect` is the hinge:**

- `pimas/dom` – `effect(run)` creates a live `createEffect`: a persistent reactive
  subscription. Nodes are real `document.createElement`/`createTextNode`.
- `pimas/server` – `effect(run)` calls `untrack(run)`: it runs the binding **exactly
  once, with no subscription**, and the value bakes into a plain-object tree that
  serializes to HTML. `ref`/`scheduleMount` are no-ops.

The same component code drives both. That seam is why SSR, hydration, and
resumability are *additive*, not a rewrite.

**The thunk convention.** Passing a **function** marks a value as dynamic:

```tsx
import { createSignal } from "pimas";
import { render } from "pimas/dom";

function Counter() {
  const [n, setN] = createSignal(0);
  return <button onClick={() => setN(n() + 1)}>count: {() => n()}</button>;
}
render(() => <Counter />, document.body);
```

`h` routes each prop through `setProp`: a `function` value becomes
`effect(() => applyProp(el, key, value()))`; a static value applies once and is
never touched again; `on*` binds a listener; `ref` delivers the node. For a dynamic
child, the engine inserts a stable comment `anchor` and wraps the body in an effect
whose **fast path** is the headline: if the current content is a single text node
and the new value is a string/number, it calls `setText(node, ...)` – reassigning
`.data` on the existing `Text` node **in place**. That is literally "only the text
node updates, no diffing." (Non-text updates fall through to a keyed reconcile
against the anchor.)

`renderToString` calls the *identical* `renderWith`, just handing it the string
backend. No component knows which backend it ran under – the `effect` seam is the
only difference. An `env` field on each reactive node records the backend it was
built under and is re-established while it recomputes, so a re-running `<For>` row
rebuilds through the right backend – which is also what lets claimed and freshly
rendered islands coexist on one page.

**Control flow** (`pimas/flow`) all rides one trick: each component **returns a
`createMemo`** (a thunk), which the engine binds as a dynamic child. The branch is
built *during the memo's run*, so its effects and cleanups are owned by that memo;
when the condition flips, the old branch's owner is disposed (real unmount, cleanups
fire) before the new one builds.

- `<Show>`/`<Switch>`/`<Match>` – a boolean/selection memo gates which children
  build; the equality short-circuit means downstream only re-runs when the *branch*
  actually changes.
- keyed `<For>` – reconciles by **item identity**: trims common prefix/suffix,
  builds a key→index map over the middle, and **reuses each surviving row's DOM node
  and reactive scope** (each row is its own `createRoot`). The move itself uses the
  DOM backend's `Element.moveBefore()` (atomic – preserves focus/selection/media
  state), placing nodes right-to-left and skipping any already in position.
- position-keyed `<Index>` – the slot stays put; a changed item just writes that
  slot's value signal. No DOM move, no rebuild.
- `<ErrorBoundary fallback={(err, reset) => …}>` / `catchError` – errors in render,
  an effect, or a memo route up the *owner* chain to the nearest handler; `reset()`
  rebuilds the subtree.
- `onMount` – runs after the render's nodes are inserted (deferred via
  `queueMicrotask`, since binding effects run *before* insertion); a no-op under SSR.

**The `listen` seam** takes a closure *or* a serializable `HandlerDescriptor
{ref, load, capture}`. On the client, a closure wires a live listener. On the
server, a descriptor serializes to an `on:<type>` attribute plus an
`application/pimas-state` capture table – which `pimas/resume` later resolves to
live listeners **without re-running any component**, and `pimas/hydrate`'s `claim()`
adopts by reusing the existing server DOM instead of throwing it away and
client-rendering from scratch.

### 1.4 The agent surface: subscribe, explain, simulate

`pimas/agent` is a thin adapter that turns the running graph into an agent-facing
surface. `createAgentBridge(setup)` gives you `expose(name, () => value)` and
`action(name, fn)`.

- **L1 – subscribe.** Each `expose` wraps its accessor in a `createEffect` that emits
  a delta on every change. **The exposing effect *is* the subscription** – because
  the accessor runs inside it, it subscribes to exactly the fields it reads
  (`() => s.rows[3].status` subscribes to just that store field). The agent is
  *pushed* deltas; no polling, no DOM scraping.
- **L2 – explain.** `call(name, ...)` records a `CauseRecord`: it starts a
  `writeTap` (wired to `pimas/store`'s `onStoreWrite`) to collect the field paths the
  action wrote, snapshots the exposed values before, and after settling computes
  which exposed names changed. `explain()` / `history()` return "`total` changed
  because action `addItem` wrote `cart[3].qty`, which the `total` memo reads." (Async
  actions defer settling until the promise resolves.)
- **L3 – simulate.** `speculate(apply, read)` evaluates hypothetical writes against a
  **shadow** of the graph and returns the exact predicted state – *without committing*.

`speculate` (in the core) is the wedge. A module-level `speculating` overlay holds a
`Map<Reactive, value>`; the read/write hot path is gated by a single null-check
(everything heavy tree-shakes away for anyone who never imports it). During a
speculation:

- a **write** lands only in the shadow map – `node.value` is never touched;
- a **read** returns the shadowed value if present, else *recomputes a memo detached*
  (no subscription, no ownership) against the shadow and memoizes it (so diamonds
  compute once), else returns the real committed value;
- **no effect ever fires** – nothing calls `stale()` or the flush;
- **rollback is free**: drop the map. The real graph was never mutated.

The bridge adds the planning half: `speculatePlan(steps)` composes a multi-factor
scenario in *one* shadow (not reducible to separate `speculate` calls – each of
those resets the shadow), `speculateSweep(name, argsList)` runs an independent
what-if per arg-set (a sensitivity sweep), and `commitPlan(steps)` applies an
approved scenario for real in one `batch()` with a single coalesced `CauseRecord` –
so *preview* and *commit* stay symmetric. `pimas/store`'s copy-on-write
(`speculationScratch`) extends the shadow to store *edits*, so hypothetical mutations
work too.

`toWebMCP(bridge)` projects all of this onto the browser `document.modelContext`
standard: actions → tools, exposed state → read-only `get_*` tools, and **L3 →
`simulate_*` tools** (`simulate_<action>` / `simulate_plan` / `simulate_sweep`).
`simulateTools:false` drops the L3 tools, leaving a poke-and-rescrape baseline – that
flag is the A/B switch for the eval in §3.

---

## 2 – Why it works this way

The rationale for every choice lives in [`DECISIONS.md`](docs/DECISIONS.md) (53 numbered
entries). The load-bearing ones:

| Decision | Why | D# |
| --- | --- | --- |
| **No virtual DOM, no diffing** – fine-grained signals | Only the exact nodes reading a changed value update. The core is hundreds of lines, not thousands – and (see §3) a standing dependency graph is something a VDOM has and can't shadow. | D#2 |
| **Glitch-free push–pull, built first** | Reactivity semantics are the single hardest thing to retrofit, and real UIs (design-token cascades) are diamond-shaped – a glitch is a real bug, not a perf nit. This was correctness work, exempt from "defer optimization." | D#8 |
| **Renderer over a `RenderBackend`; `effect` is the SSR hinge** | The highest-leverage decision: same component code drives live DOM *and* string SSR because one method (`effect`) decides live-vs-once. Retrofitting this later would be a rewrite. | D#6 |
| **Single package, subpath exports** | For a solo owner, a multi-package monorepo is pure overhead *plus* a dual-kernel hazard – two copies of the reactive globals silently break reactivity. One package → one kernel, guaranteed by relative imports. (This failed *live* once under SSR bundling; D#26.) | D#4 |
| **Tree-shaking is the modularity lever** | Pure ESM + `sideEffects:false` means a signal-only import shakes to <1 KB. The kernel is indivisible (shared globals), so granularity comes from tree-shaking, not sub-packages. A ~50-line size script enforces per-import byte budgets, re-baselined *consciously, never silently*. | D#5 |
| **Runtime-first; compiler is a pure build-time optimizer** | The thunk convention (`{() => count()}`) is the accepted "thunk tax" of being runtime-first. The runtime is designed so a compiler can *later* target the same functions with no rewrite – the shipped Phase-A thunk-eraser is exactly that, never in a runtime bundle. | D#3, D#45 |
| **Direct `addEventListener`, not delegation** | Correctness over a benchmark: delegation's costs (shadow DOM, `stopPropagation` timing, non-bubbling events) outweigh the savings. (`resume` re-introduces scoped capture-phase delegation only where resumability needs it.) | D#9 |
| **Zero runtime dependencies** | The install has no third-party code in the hot path (TypeScript is an *optional* build-time peer). A CI guard fails the build if a runtime dep appears. | – |

**What pimas is deliberately *different* from** – and this is not just other UI
frameworks:

- **vs React / any virtual DOM** – no diff pass; fine-grained updates; and the deeper
  point behind §3: a VDOM keeps *no standing value/topology-separated dependency
  graph*, so it structurally cannot do exact what-if simulation.
- **vs SolidJS (same engine class)** – the distinctions are choices, not accidents:
  direct listeners over delegation, one package over many, atomic `moveBefore` on
  keyed reorder, an O(n) move-minimizer heuristic (fine-grained survivors never
  re-run, so extra `insertBefore`s beat LIS's `n log n` + allocation), and the entire
  agent-native surface, which has no Solid analog.
- **vs WebMCP / computer-use / Playwright / AG-UI / CopilotKit** – every existing
  agent↔UI path is *request/response or scrape*: it exposes callable actions, or
  streams UI into a chat, or reads an a11y-tree snapshot. **None expose the live
  dependency graph** a fine-grained engine already maintains. That is the unoccupied
  cell pimas fills.
- **vs learned agent world-models** – those *guess* the next state and drift; L3
  re-runs the app's own pure memos, so the prediction is *bit-identical* to what
  committing would produce. Ground truth, not a forecast.
- **vs optimistic updates / MST snapshots** – those *commit-then-rollback* (or
  deep-copy) for UX latency, driven by the app. L3 is *pre-compute-without-committing*,
  queried by the agent for planning, with a values-only shadow and free rollback.
- **vs Redux DevTools / MobX `trace` / React Scan** – human-facing causal tracing
  exists; exposing a reactive causal chain *to an agent* is unclaimed.

**The one honest risk:** L3 is only correct if memos are pure (assumed, not
enforced). The resolution isn't to pretend it's solved – it's to aim L3 at the domain
where purity is *free*: pure, derived-heavy **quantitative models**, where what-if is
the whole activity (D#41→D#42).

---

## 3 – What it lets you do

Everything above is table stakes for a good reactive framework. This is the part
nobody else can do.

> **Committing is how you normally find out what an action does.** Every existing way
> an agent touches a UI – WebMCP actions, computer-use, Playwright scraping – shares
> one property: to learn what "set the weight to 8" does, the agent has to *actually
> set it to 8*, then look again. Observation requires mutation. That means side
> effects fire for real (a network write, an email, a DB row), the live app passes
> through every wrong state the agent considered, and planning multi-step ("if I do A
> then B…") is impossible without entering branches you won't take. **pimas removes
> that tax:** `speculate` evaluates the pure derived consequence with no effect
> flushed, so the UI stops being a surface you poke and becomes a model you query.

### Example A – an agent-simulatable quantitative model

Run a real model *inside* a pimas graph: inputs are signals, a bill-of-materials or
data table is a `createStore` (copy-on-write under speculation), and every derived
result is a memo. Now the model is simultaneously the compute engine, the rendered
page, and an agent-queryable surface – and a "what-if" is a first-class `speculate`,
not a deep-copy-mutate-rerun-diff-discard loop.

This is proven twice. [`von-neumann/wall-live`](https://github.com/noahhyden/von-neumann)
rebuilds a self-replicating-lunar-factory model this way; its "electronics wall"
analysis – which the reference Python does by copying the whole model, toggling,
re-running, diffing, and discarding – becomes one `speculate` (exact after-state, a
shadow graph, nothing committed), with `explain()` naming the field-level cause. The
same ~11 KB core computes the model *and* renders the page, and the TS math is pinned
to the Python by a cross-language differential test (60 random factories / 540 fields,
all match).

**The claim, measured with a real agent in the loop.** In `sector-engines`
(`composite_ind`), the *same* grid-search policy drives an OECD-style
composite-indicator model through the projected WebMCP tools under two conditions –
**A** (baseline: mutate + re-read, `simulateTools:false`) vs **B** (also has
`simulate_*`). Same answers, same correctness, structurally different footprint
(*calls / commits / wrong live states*):

| Task | A – baseline | B – agent-native |
| --- | --- | --- |
| France → top-2 (solvable) | 55 calls, 37 commits, **27 wrong live states** | 4 calls, 1 commit, **0** |
| Germany → #1 (impossible) | 54 calls, 36 commits, **36 wrong live states** | 3 calls, 0 commits, **0** |

"Impossible" is where non-committal wins hardest: the baseline must probe the whole
space – passing through every wrong live state – to be *sure*; B sweeps it in the
shadow and never touches the real model. (A metric-grade LLM benchmark rides the same
harness; designed, not yet built.) This has also run end-to-end against a real HTTP
stack (pivi's `/api/proposals`): a **preview → approve → commit** copilot where
`speculate` shows the exact resulting totals, *approve* fires a real `PATCH`, and the
backend persists.

### Example B – a site that ships 0 KB of JS, then adopts its own HTML

Because the *same* components render through the string backend, a whole marketing
site prerenders to static HTML with **zero client JS and zero external requests**
(self-hosted fonts). Interactivity is opt-in **islands**: a widget ships as its own
lazy, code-split bundle sharing one kernel chunk; the rest of the page stays 0 KB.

When an island *does* boot, `claim()` **adopts** the server-rendered DOM in place –
reusing the existing nodes and wiring reactivity onto them – instead of the usual
client-render-first that throws server HTML away and rebuilds it. On klarum.com's
10-demo `/showcase/`, that was measured to recover **55.8 KB** of HTML that was
otherwise discarded and recreated. Both noahhyden.com and klarum.com were fully
rebuilt on pimas this way (19 routes, hand-built SVG charts replacing ~90 KB of
recharts with ~1.3 KB) – the framework's own proving ground.

---

## Status

| Phase | Scope | State |
| --- | --- | --- |
| **1 – Reactive core** | signal/effect/memo/batch/untrack/onCleanup/createRoot – glitch-free push–pull (3-color), lazy memos | ✅ |
| **2 – DOM renderer + JSX** | `h`/`Fragment`/`render`, dynamic bindings via effects, automatic JSX runtime | ✅ |
| **3 – Backend seam + SVG + SSR** | renderer over `RenderBackend`, `pimas/server` `renderToString` | ✅ |
| **3b – Control flow** | `<Show>`/`<Switch>`/`<Match>`, keyed `<For>`, `<Index>`, per-row owner scopes | ✅ |
| **4 – Static site port** | noahhyden.com rebuilt, 0 KB JS, deployed live | ✅ |
| **5 – Interactivity** | `createContext`, `createStore`, `onMount`, `<ErrorBoundary>`, islands; klarum.com rebuilt | ✅ |
| **Resumability + store v2 + compiler A** | `resume`/`hydrate` `claim()`, `reconcile`/`produce`, thunk-eraser plugin, scheduler seam | ✅ |
| **6 – Agent-native** | L1 subscribe / L2 explain / L3 `speculate` + plan/sweep/commit, WebMCP `simulate_*` projection; validated on two quantitative models + a real HTTP stack | 🔬 exploration |

207 vitest + a real-Chrome browser suite (31 tests, run headless in CI) green.
Published on npm as [`pimas-ui`](https://www.npmjs.com/package/pimas-ui) with signed
provenance. Docs: [Getting Started](docs/GETTING-STARTED.md) ·
[Stability & versioning](docs/STABILITY.md) · design rationale in
[`DECISIONS.md`](docs/DECISIONS.md) · the agent-native thesis in
[`AGENT-NATIVE.md`](docs/AGENT-NATIVE.md).

## Develop

```sh
npm install
npm test            # vitest, once
npm run test:watch
npm run typecheck
npm run size        # per-import gzip budgets
npm run test:browser  # drives a real Chrome
npm run build       # emit dist/
```
