# Pimas — Decision Log

Why each architectural choice was made. Newest decisions may supersede older ones;
superseded entries are marked. Short by design — the *why* matters more than prose.

> Process rule: every architecture phase is paired with a parallel research agent
> (clean-room for unbiased first-principles, or comparative when reading our own
> code). Findings are reconciled against what was built; consequential divergences
> become decisions here.

---

### 1. Build our own framework
Own the entire frontend stack. The trigger was disliking Claude's design-canvas
runtime (`support.js` + in-browser Babel + unpkg CDN) currently powering
noahhyden.com. Educational + dogfoodable across noahhyden.com and Klarum.

### 2. Fine-grained signals, no virtual DOM (SolidJS-class)
Values are observable; only the exact DOM nodes that read a changed value update.
No diffing. Smaller, faster, and conceptually cleaner than a VDOM; the reactive
core is ~hundreds of lines, not thousands.

### 3. JSX/TSX authoring via the automatic runtime; runtime-first with a thunk convention
Familiar, great tooling, transformed at **build** time (not in the browser).
Dynamic bindings are marked by passing a function: `{() => count()}`. No compiler
yet — it's deferred (see #14). The "thunk tax" is the accepted cost of being
runtime-first; the runtime is designed so a compiler can later target the same
functions without a rewrite.

### 4. Single package with subpath exports (NOT a multi-scoped monorepo)
*Superseded the initial monorepo.* We first built `@pimas/reactive` + `@pimas/dom`
as separate packages, then migrated to one `pimas` package with subpaths
(`pimas`, `/dom`, `/server`, `/flow`, `/jsx-runtime`). Reason (clean-room review):
for a **solo owner with no third-party renderers**, multi-package is pure overhead
— release ceremony plus a real dual-kernel hazard (two copies of the reactive
globals = silently broken reactivity). Single package → one version, one
changelog, and internal relative imports guarantee exactly one kernel instance.

### 5. Tree-shaking is the modularity lever; per-import size guardrail
Pure ESM + `"sideEffects": false` means a bundler drops what you don't import
(signal-only import shakes to <600 B gz). The kernel is indivisible (shared module
globals), so we don't sub-split it — tree-shaking handles granularity. A custom
~50-line `scripts/size.mjs` (esbuild + gzip, per-import fixtures) enforces byte
budgets; chosen over `size-limit` to avoid a heavy dep tree. **Budgets are
re-baselined consciously, never silently** — a regression must be looked at and
justified in the commit.

### 6. Renderer over a `RenderBackend` host config; `effect` is the SSR hinge
All host interaction goes through a small backend contract
(element/text/anchor/insert/remove/setAttr/setStyle/listen/nextSibling/effect).
The DOM backend makes live nodes with persistent effects; the string backend runs
`effect` ONCE and serializes. The same component code drives both — which makes
SSR (and later hydration/resumability) **additive, not a rewrite**. This was the
single highest-leverage decision per the deep research ("a rewrite to retrofit").

### 7. SVG via `createElementNS`, tag-keyed
A runtime renderer can't know parent context (children build before parents), so
the DOM backend keys the SVG namespace off the tag name. Without this, inline
`<svg>` renders as invisible `HTMLUnknownElement`s — and noahhyden.com's azulejo
pattern is SVG. Caught proactively before the port.

### 8. Glitch-free push-pull reactive core — done NOW, not deferred to Phase 5
*Superseded the initial eager core.* Replaced eager push with a Reactively-style
3-color (Clean/Check/Dirty) push-pull: writes only MARK; reads/effect-flushes PULL
and recompute only if a source truly changed. Lazy memos; equality short-circuit.
Diamonds recompute once, no transient stale value. **Why now:** reactivity
semantics are the hardest thing to retrofit (everything schedules on them), and
Klarum's design-token cascade is diamond-shaped — glitches would be real bugs
there. This is correctness, not perf, so it was exempt from the "defer perf" rule.

### 9. Direct `addEventListener`, not event delegation
Correctness and simplicity over benchmark perf. Delegation's costs (shadow DOM,
`stopPropagation` timing, non-bubbling events, a global registry) outweigh its
savings for our targets. The research recommended "flip Solid's default" — which
is exactly this.

### 10. Owner tree is the one canonical persistent tree
Disposal, and later context + error boundaries, route through the
reactive-owner tree — never the DOM tree. It survives serialization (no call
stack on resume), works across portals (DOM ancestry broken, owner intact), and
gives O(changed) disposal.

### 11. Control flow: row lifecycle in `pimas/flow`, DOM move-min in the engine
Reconciliation is confined. `mapArray`/`indexArray` own row lifecycle (identity
caching, per-row `createRoot` owners, index/value signals); the engine's
`reconcile` does keyed-by-node-identity DOM placement. The DOM move-minimizer is
an **O(n) heuristic, not LIS** — fine-grained survivors never re-run, so a few
extra `insertBefore`s are cheaper than LIS's `n log n` + allocation.

### 12. `<For>` keyed by identity; `<Index>` keyed by position
`<For>` reuses a row (DOM + reactive scope) by item reference and moves it on
reorder, updating only an index signal. `<Index>` keeps DOM in place and updates a
per-slot value signal. Different intents, both shipped.

### 13. Resumability is a committed GOAL
klarum.com's interactive/game-like demos + heavy analytics make Qwik-style
resumability worth pursuing AND a real surface to dogfood. Not built yet, but the
doors are propped open: the reactive graph stays serializable (enumerable
values + edges), handler/effect identity is preserved as a seam (no
anonymous-closure-only lock-in), and the backend seam supports a future
"claim existing DOM" hydration/resumable backend.

### 14. Perf work deferred to Phase 5 — except correctness
"It just has to work" until Phase 5 (compiler, scheduling perf, optimizations).
The one exception was glitch-freedom (#8), reclassified as correctness. The
compiler, when it comes, will be a pure optimizer targeting the existing runtime
functions so compiled and hand-written code interoperate.

### 15. Dogfood sequence by stakes
(1) noahhyden.com — sandbox, break freely; (2) klarum.com landing/demo — real
components, intermediate stakes; (3) Klarum token engine — headless `import "pimas"`
in Node for the design-token cascade feeding Typst; (4) Klarum production — last.
Tracks 1–2 exercise the renderer; 3–4 the headless core.

### 16. Privacy
Stays a private repo until it can literally replace the Claude design framework.
No open-sourcing / npm publish before then.
