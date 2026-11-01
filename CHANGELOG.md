# Changelog

Pre-1.0: minor versions may carry breaking changes.

## [0.4.0] — 2026-11-01

### Changed
- `onStoreWrite` hands the listener the path directly — `(path: PropertyKey[]) => void`,
  was `(e: { path }) => void`. The `StoreWriteEvent` wrapper is gone; every caller
  destructured it on the next line anyway.
- `installPageAgent` always nests under `window.__pimas`. An un-namespaced install used
  to put the `PageAgent` *at* `__pimas` and a namespaced one put a dict there, so the
  global's shape depended on an option. It now lands at `__pimas[namespace ?? "default"]`.
- `installPageAgent` forwards its `namespace` when projecting tools, so the map it exposes
  as `PageAgent.tools` carries the same prefixed names it registers with WebMCP. It
  previously built an unprefixed second map and registered a different one.
- `toWebMCP` takes an optional `opts.tools`, a prebuilt map, so a caller that already
  projected the descriptor does not project it twice.
- `prepack` and `build` run `rm -rf dist` first. `tsc` never cleaned its `outDir`, so a
  local `npm pack` swept up 2,673 lines of the renderer deleted in 0.2.0 — `dist/dom`,
  `dist/compiler`, `dist/server`, `dist/flow`, `dist/resource`. CI publishes from a
  clean checkout, so no published tarball ever carried them.
- README restructured: what → install → quick start → why → agents → API → stability
  → licence. The agent story was spread across three places and is now one section,
  `Stability` was bold inline text inside `## API` and is now its own heading, and the
  quickstart is no longer titled "Afternoon, in a React app".
- **License is Apache 2.0**, was MIT. Published versions up to and including `0.3.0`
  remain MIT; the change takes effect from the next release.
- `NOTICE` and `TRADEMARKS.md` (both new, both shipped in the tarball) reserve the
  names "pimas" / "pimas-ui", the name Noah Hyden, and the project's logos as
  trademarks. Apache 2.0 § 6 grants no rights in them. Nominative use — "works with
  pimas", "a fork of pimas" — stays fine; naming your own product after it does not.

### Fixed
- `AgentRegistrar.action` accepts a function with real parameter types. It took
  `(...args: unknown[]) => unknown`, so the README's own example — `(id: string,
  qty: number) => …` — failed to compile under `strict`. Widening is additive;
  anything that compiled before still does. The example is now a typecheck
  fixture at `test/readme-example.tsx`, so it cannot rot silently again.

### Removed
- `pimas-ui/agent/webmcp` and `pimas-ui/agent/page` subpaths. Both re-export from
  `pimas-ui/agent` now; `sideEffects: false` and ESM mean a bundler tree-shakes the
  unused half either way, so the extra entry points bought nothing.
- The `simulate_sweep` WebMCP tool. It was `argsList.map(args => speculate(action, ...args))`
  behind thirty lines of JSON Schema. **A sensitivity sweep is N separate
  `simulate_<action>` calls, one per arg-set** — the `simulate_plan` tool description
  now says so, so an agent reading the surface finds the replacement without the docs.
- `StateMeta.schema` and `ActionMeta.input` — two optional JSON Schema fields nothing
  ever set. `ActionMeta.params` builds the tool schema and is the only path exercised.
- `AgentOptions.historyLimit` — config no caller set. The bound is a constant, 50.
- `GraphNode.name`. It was only assigned when a seed read touched exactly one root, so
  it was absent on most nodes and its "first name wins" tiebreak never fired.
- Most of `scripts/check-package.mjs`. It asserted four `package.json` literals visible
  in any diff, and compared `files` by exact `JSON.stringify`, so reordering a key broke
  the build. The one check a diff can hide — runtime `dependencies` must be empty — stays.
- `docs/0.3-react-dropin-SPEC.md` — a work order for shipping 0.3, which shipped. It
  described `useSnapshot` as a feature, told the reader not to publish, and pointed at
  a home directory that does not exist on this machine.

## [0.3.0] — 2026-10-31

An audit release. Nothing was added. Every cut below had one caller, one
implementation, or no caller at all.

### Removed (breaking)
- `connectRemoteBridge` / `handleBridgeRequest` and the `BridgeRequest` wire
  types from `pimas-ui/agent/page` — a hand-rolled JSON-RPC transport for an
  in-process bridge. POST to your own endpoint and call the bridge method there.
- `useSnapshot` from `pimas-ui/react` — a coarse hook whose own doc comment said
  to prefer `usePimas`. Use `usePimas` per field.
- `bridge.speculateSweep()` — it was `argsList.map(a => bridge.speculate(n, ...a))`.
  The `simulate_sweep` WebMCP tool is unchanged and still does exactly that.
- `readTools` / `simulateTools` on `toWebMCP` — flags nothing ever set. Read and
  simulate tools are always registered. `namespace` stays.
- Exported types with no referent: `Owner`, `WebMCPBridgeSurface`,
  `WebMCPRegisterOptions`.

### Changed
- `installPageAgent(bridge, opts)` is **synchronous** and returns the `PageAgent`
  directly — it only ever took an in-process bridge. Drop the `await`.
- `AgentDescriptor` is typed `StateMeta & { value }` / `ActionMeta` instead of
  re-declaring those fields. Absent metadata keys are now absent rather than
  present-and-`undefined`.
- One `npm run lint` replaces `lint:comments` + `lint:rules`; the two guard
  scripts merged, losing the YAML block-scalar parser the repo never needed.
- Tests import source directly; the `pimas/*` test alias map is gone, so the
  subpath map lives in `package.json` only.

### Internal
- The per-node `equals` override was unreachable from any public API; nodes
  compare with `Object.is` and carry one less field.

[0.3.0]: https://github.com/noahhyden/pimas/releases/tag/v0.3.0

## [0.2.0] — 2026-09-03

The renderer is gone. pimas is a headless reactive model with exact what-if
(`speculate`) and a React/agent binding. Sites on the old framework should pin
`pimas-ui@0.1.2`.

### Added
- `createModel` — one-call factory (store provenance wired by default)
- `subscribe(read, listener)` on the core
- `pimas-ui/react` — `usePimas`, `useSnapshot` (React 18+ optional peer)
- `bridge.graph()` — dependency topology of exposed state
- `pimas-ui/agent/page` — `installPageAgent`, `connectRemoteBridge`,
  `handleBridgeRequest`. Sets `window.__pimas` with or without WebMCP.

### Removed
- `pimas-ui/dom`, `/flow`, `/server`, `/resume`, `/hydrate`, `/compiler`,
  `/resource`, `/jsx-runtime`, `/jsx-dev-runtime`
- `createContext` / `useContext`
- The in-browser test suite and Vite browser runner

[0.2.0]: https://github.com/noahhyden/pimas/releases/tag/v0.2.0

## [0.1.2] — 2026-07-07


Additive, non-breaking over 0.1.1.

### Added
- **`pimas/resource`** (🔬) — `createResource`, an async data primitive: turns a
  fetch into reactive state (value accessor + `loading`/`error`/`state` +
  `refetch`/`mutate`). Race-safe (stale in-flight fetches are dropped). Kept off
  the core hot-path floor. (#19)
- **Two-way form binding** in `pimas/dom` — `model` / `modelChecked` /
  `modelNumber`, spread onto a control to bind a signal both ways. Tree-shaken
  when unused (dom budget unchanged). (#23)

[0.1.2]: https://github.com/noahhyden/pimas/releases/tag/v0.1.2

## [0.1.1] — 2026-07-07

First release published through the CI pipeline (OIDC trusted publishing +
provenance). Additive and non-breaking over 0.1.0.

### Added
- **Typed JSX** — intrinsic elements now carry real types: misspelled tags and
  unknown attributes on well-known elements are caught at compile time, while
  reactive thunks, `data-*`/`aria-*`, custom elements, and `HandlerDescriptor`
  event handlers stay allowed. SVG is intentionally permissive. (#18, #26)
- **Getting Started guide** (`docs/GETTING-STARTED.md`) — install, JSX setup,
  first component, reactivity, control flow, stores, SSR. (#18)
- **`LICENSE`** file (MIT) — declared before, now actually shipped. (#17)

### Changed
- **Smaller install** — sourcemaps (`.js.map`/`.d.ts.map`) are no longer
  published; readable `src/` still ships. Tarball dropped ~108→66 files. (#24)
- Long-form design docs moved under `docs/` to keep the repo root clean. (#17)

### Removed
- The downstream-canary CI workflow (a framework shouldn't dispatch into
  consumer repos). (#24)

[0.1.1]: https://github.com/noahhyden/pimas/releases/tag/v0.1.1

## [0.1.0] — 2026-07-03

First tagged release. A from-scratch fine-grained reactive UI framework — same
engine class as SolidJS (observable values, no virtual DOM, no diffing), shipped
as one package with tree-shakeable subpath entry points. 195 unit tests + a
real-Chrome browser suite green; ported and deployed live on two production sites.

### Reactive core (`pimas`)
- Glitch-free push–pull reactivity (3-color marking), lazy memos, `createRoot`,
  `batch`, `untrack`, `onCleanup`, `createContext`/`useContext`. Headless — runs
  in the browser or Node. ~200 commented lines.
- **Scheduler seam** — `setScheduler` / `flushSync` make flush *timing* pluggable
  (default synchronous; opt-in `queueMicrotask` coalescing), byte-for-byte
  unchanged unless you opt in.

### DOM renderer & JSX (`pimas/dom`)
- `render` / `h` / `Fragment`, dynamic attributes and children via effects,
  automatic JSX runtime (`pimas/jsx-runtime`), `onMount`, and a `listen` seam
  that accepts a closure *or* a serializable handler descriptor.

### Server rendering (`pimas/server`)
- `renderToString` runs the **same** component code through a string backend
  (SSR / static prerender), enabled by a small `RenderBackend` contract shared
  with the DOM renderer.

### Control flow (`pimas/flow`)
- `<Show>` / `<Switch>` / `<Match>`, keyed `<For>`, position-keyed `<Index>`,
  `<ErrorBoundary>` / `catchError` with per-subtree reset.

### Store (`pimas/store`)
- `createStore` — a nested reactive proxy with per-field granularity; `reconcile`
  (diff external data, preserve row identity) and `produce` (Immer-style draft).

### Resumability
- `pimas/resume` — a renderer-free client dispatcher that makes a server-rendered
  tree interactive with **zero component re-execution** (serialized handler
  descriptors + a type-tagged capture codec).
- `pimas/hydrate` — `claim()` **adopts** the server-rendered DOM in place (reuses
  nodes, wires reactivity + listeners) instead of client-render-first discarding
  it; covers static elements, dynamic attrs, handlers, reactive text, and control
  flow, with a correctness-first fallback to a client render on any structural
  desync.

### Compiler (🔬 experimental, build-time only) — `pimas/compiler`
- Phase A thunk-eraser: write `{count()}`, it emits the `() => …` thunk at build
  time (TypeScript-as-parser Vite plugin; never in a runtime bundle).

### Agent-native (🔬 experimental) — `pimas/agent`, `pimas/agent/webmcp`
- `createAgentBridge` exposes the reactive graph to an AI agent across three
  layers: **L1** subscribe (push-on-change), **L2** explain (causal provenance via
  `onStoreWrite`), **L3** simulate — `speculate` / `speculatePlan` /
  `speculateSweep` / `commitPlan` predict the exact next state against a shadow of
  the graph **without committing** (no effects fire; free rollback).
- `toWebMCP(bridge)` projects the surface onto the browser `document.modelContext`
  standard — actions → tools, state → `get_*` tools, and **L3 → `simulate_*`
  tools**.

### Tested & dogfooded
- 195 unit tests (vitest) + a real-Chrome browser suite.
- Rebuilt and deployed on [noahhyden.com](https://noahhyden.com) (0 KB JS on
  static pages) and used to validate the agent-native layer against real
  quantitative models.

[0.1.0]: https://github.com/noahhyden/pimas/releases/tag/v0.1.0
