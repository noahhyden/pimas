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

---

## Consolidation review — 2026-06-30

Two background agents consolidated the facts: a comparison vs the modern reactive
field, and an in-browser test-suite design. Outcomes:

### 17. Validated against the field
Comparison vs Solid, Svelte 5 runes, Vue Vapor, Qwik, Angular signals, React 19
compiler, Leptos/Dioxus/Sycamore, Compose/SwiftUI/Flutter confirmed: the 3-color
push-pull core is best-in-class (glitch-free, lazy memos, equality cutoff); the
`RenderBackend` seam is idiomatic and correctly factored (`effect` as the run-once
hinge mirrors Solid's universal renderer); the bundle floor (588 B gz signal /
~1.75 KB dom) is far under peers (Solid ~7 KB, Preact-signals ~4 KB) — partly
because scope is smaller; the per-import size guardrail is a discipline most
frameworks lack; single-package subpaths is a good solo-owner call. Verdict:
**"modern core, incomplete API surface."**

### 18. Post-3b primitive backlog (build order)
Confirmed gaps vs the field, sequenced cheap-owner-tree-wins-first, compiler-last
(against a frozen API). None block Phase 4 (the static site needs none), so the
site port goes first; this cluster is **pre-Klarum** (Klarum apps will need store
+ context):
1. `createContext`/`useContext` — LOW cost, the owner tree is already the substrate. Highest-leverage cheap win.
2. `<ErrorBoundary>`/`catchError` — LOW–MED; wrap update/component in try/catch, propagate up the owner tree.
3. `createStore` (nested reactive proxy) — HIGHEST real-app value (an object in one signal re-runs everything on any field change); pure userland-of-the-kernel, no core change.
4. `hydrate()` — seam-ready (the `<!---->` anchors are already emitted on both sides); needs a backend mode that *adopts* existing DOM instead of creating it.
5. Scheduler seam — microtask flush + parent/child effect ordering; the precondition for any future concurrency/transitions. Current flush is synchronous (simple, debuggable, but no ordering guarantee and forecloses concurrency).
6. Compiler (thunk-eraser) — Phase 5 anchor; erases the `{() => x()}` tax every comparable framework eventually compiled away. Sequence last, against a stable runtime API.

### 19. OPEN — resumability vs direct `addEventListener`
The comparison flagged a real tension between #13 (resumability goal) and #9
(direct `addEventListener` + closure handlers). Qwik-style resumability needs
**serializable, addressable handler identity** (a registry/QRL-like indirection
at the backend `listen` seam) — the opposite of closures. **Not urgent:** there's
no event-heavy code yet (the static site barely uses handlers), so retrofit cost
is still low. Recommendation: introduce the handler-identity layer in the `listen`
contract when we start klarum.com's interactive demos, not before — but track it
so it's a deliberate decision, not a surprise. **Status: OPEN.**

### 20. In-browser test suite — Vite dev server + WebBridge (BUILT)
A real-browser suite to complement the happy-dom unit tests, for cases happy-dom
can't reach (real SVG `getBBox`/namespace, focus surviving a keyed `<For>`
reorder, event bubbling, CSS box-model, live `checked`/`value`). Design as built:
a tiny Vite dev server (`npm run test:browser`, +1 devDep `vite`, no browser
binaries) reusing the existing `jsxImportSource`+alias config (`vite.config.ts`),
serving `browser-test/` — a framework-free hand-rolled runner that publishes
`window.__PIMAS_TEST_RESULTS__` (JSON for WebBridge `evaluate()`) + a rendered
pass/fail list (for `screenshot()`). Rejected Vitest browser mode (Playwright
binaries fight WebBridge for browser control). `browser-test/**` is excluded from
vitest. **9 fixtures, all green.** It earned its keep on the first run — see #22.

### 22. Keyed-move uses `moveBefore()`, not `insertBefore` (correctness)
The in-browser suite (#20) immediately caught what happy-dom hid: on a keyed
`<For>` reorder the row node was correctly *reused* (identity + `.value`
survived), but a focused input lost focus — plain `insertBefore` of a connected
node detaches+reattaches it, which blurs it and resets selection/iframe/media
state. The DOM backend's `insert` now uses the atomic `Element.moveBefore()` when
the node is already a child of the target parent (a true move) and the platform
supports it, falling back to `insertBefore` otherwise (happy-dom lacks it; the
`try/catch` covers constraint violations). This is the natural completion of the
identity-keying promise (#12): reusing the node should preserve *all* its state,
not just its data. Correctness, not perf — so not deferred (#14). Cost: +34 B gz
on the `dom` import (1756→1790, under the 1800 budget; no re-baseline).

### 21. Interim thunk-staleness dev warning (low priority)
Until the compiler (#18.6) erases the thunk convention, a dev-mode warning when a
non-function but dynamic-looking value is set as a child/attr would catch the
silent-staleness footgun. Recorded; not yet built.

---

## Phase 4 — porting noahhyden.com (in progress, 2026-06-30)

Research agent (clean-room, SSG/prerender field survey) ran in parallel; its
recommendations are adopted below. Site source lives in the noahhyden.com repo
under `site/` (consumes the real `pimas` package, not source — honest dogfood of
the exports map). Home page ported, prerendered, and real-browser verified;
remaining pages + deployment pending.

### 23. Static prerender via a plain esbuild script — no Vite, no meta-framework
For a handful of pages the smallest honest pipeline wins (research verdict): one
~110-line `site/build.mjs` — esbuild compiles each `.tsx` (`jsxImportSource:
pimas`), Node imports it, `pimas/server` `renderToString` → one `index.html` per
route, `<head>` from a per-page `meta` export, sitemap/robots/.nojekyll/CNAME
emitted. Adopting Vite would mean fighting a plugin model to inject a non-React
jsxImportSource for zero benefit at this scale. The backend seam (#6) paid off
exactly as predicted: the SAME page components render to HTML with no rewrite.

### 24. Zero JavaScript shipped (delete the runtime, don't hydrate)
The site ships **0 KB JS** — no hydration, no islands. Research confirmed this is
the right default for a content site; the azulejo is static SVG, and the few
interactive bits (if any) will be ~15 lines of vanilla JS, not a framework.
Resumability (#13) is correctly deferred here (nothing to resume on a static
page); the only forward-compatible seam reserved is optional flag-gated stable
instance IDs in the string renderer — NOT built yet, not needed for this site.

### 25. Honest, build-measured footer metrics (the anti-bloat incentive)
The footer reports only defensible numbers, injected at build via sentinel tokens:
JS shipped (0), gzipped HTML weight, prerender time, pimas version, and the
*structural* "no diff pass → no wasted re-renders" claim. Browser RAM is omitted
(theater, per research). External requests are reported **honestly** — fonts are
the one external origin (Google Fonts), and the footer says so rather than claim a
false zero; self-hosting is the planned follow-up to make it a true 0.

### 26. Dual-kernel hazard, confirmed in the wild — `pimas` stays external in builds
The prerender first rendered with the DOM backend active under SSR (it crashed on
`document`). Cause: `esbuild bundle:true` had inlined a SECOND copy of the engine
into the page, so the page's `h()` read a different `currentBackend` global than
the `renderToString` copy set. This is exactly the dual-kernel failure #4 warned
about — observed live. Fix: mark `pimas`/`pimas/*` **external** in the page build
so both resolve to the one installed package → one kernel instance. The lesson
generalizes: any consumer that both authors components AND drives a renderer must
guarantee a single engine instance. (Also: never evaluate JSX at module top level
— it runs `h()` before any `renderWith` sets the backend; make icons components.)

### 27. Self-hosted fonts → true zero external requests (site)
A parallel clean-room font-research agent (standing rule) confirmed the approach.
The Google Fonts `<link>`s were the only thing breaking the site's headline
metric. Now fonts are same-origin: `build.mjs` vendors woff2 from Fontsource
(OFL), ships the license, generates `@font-face` (latin + latin-ext,
`unicode-range`, `font-display:swap`), and preloads the two above-the-fold faces
(Spectral 500 hero, IBM Plex Sans 400 body). **All static instances** — Spectral
and IBM Plex Mono have no variable build, and for these narrow axes static is both
smaller and simpler (the rare case where smallest = simplest). Verified in-browser:
resource timing reports zero external hosts. Footer #25 updated from the honest
"fonts only" to the now-true **0 external requests**. All five pages ported, 0 KB
JS, 0 external requests. Only the deployment swap remains for Phase 4 (deferred —
"when we get there").
