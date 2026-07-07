# Changelog

All notable changes to pimas are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and pimas aims to follow
[Semantic Versioning](https://semver.org/) from 0.1.0 onward. Pre-1.0: minor
versions may carry breaking changes; the 🔬 experimental surfaces especially.

The full design rationale for every decision lives in [`DECISIONS.md`](docs/DECISIONS.md).

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
