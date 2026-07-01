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
1. `createContext`/`useContext` — LOW cost, the owner tree is already the substrate. Highest-leverage cheap win. **BUILT — see #28.**
2. `<ErrorBoundary>`/`catchError` — LOW–MED; wrap update/component in try/catch, propagate up the owner tree.
3. `createStore` (nested reactive proxy) — HIGHEST real-app value (an object in one signal re-runs everything on any field change); pure userland-of-the-kernel, no core change. **BUILT — see #34.**
4. `hydrate()` — seam-ready (the `<!---->` anchors are already emitted on both sides); needs a backend mode that *adopts* existing DOM instead of creating it. **Superseded by the islands model (#29–#32): client-render islands first; the CLAIM/hydrate backend is deferred to islands that visibly flash.**
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
so it's a deliberate decision, not a surprise. **Status: RESOLVED by #30** (the
descriptor-or-closure `listen` seam — the middle path this entry called for).

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

---

## Phase 5 — interactivity, and the dogfood rung-up to klarum.com (2026-07-01)

Phase 4 shipped noahhyden.com fully on pimas. The next dogfood rung is **klarum.com**
(repo `Klarum-Software/klarum-landing`) — the intermediate-stakes target from #15.
An inventory agent mapped it: a **Next.js 16 App Router** site, 19 pages, 83
components, **71% `"use client"`**, NOT statically exportable. Unlike noahhyden.com
(content-only, 0 KB JS), it is genuinely interactive: **8 interactive islands, 4 of
them complex** — a records spreadsheet (inline edit / sort / filter / live totals),
an SVG knowledge-graph (hover-highlight, click-select, ResizeObserver layout),
recharts-style analytics (tab-switched bar+line), and a timed "agent playback" state
machine (setTimeout phase machine) — on an otherwise mostly-static marketing page.
Heavy deps (Radix ×27, recharts, embla, react-hook-form+zod, next-themes) are mostly
lightly used. Estimated 5–7 day port. **Implication:** this rung finally forces
browser interactivity, so it triggers the hydration/islands work (#18.4) and the
OPEN handler-identity decision (#19). Discipline (#15): port the **home page + ONE
representative island first** to prove the mechanism end-to-end before porting 83
components — do not boil the ocean. A parallel research agent (hydration↔resumability
spectrum, islands-in-plain-esbuild, the `listen`-seam handler-identity design) runs
alongside per the standing rule; its synthesis will become the seam decisions here.

### 28. `createContext` / `useContext` — BUILT (backlog #18.1)
The first Phase-5 primitive, and decision-independent of the hydration work (Klarum
needs it regardless — e.g. a theme provider replacing next-themes). It rides the
**owner tree** (#10), not the DOM tree, so it survives portals and future
serialization. Design: a lazily-created `context` map on the reactive node;
`ctx.Provider` is a `createMemo` — reusing the flow-component pattern (#11), the memo
is a fresh owner scope whose node carries the value, and children are built *inside*
it so their owner chain runs through it. `useContext` walks `owner` upward to the
nearest provider, else returns the default. **Pre-compiler caveat:** Provider children
must be a THUNK `{() => <App/>}` (same rule as `<Show>`) — eager children would be
built before the scope exists. Lives in the reactive **core** (headless consumers,
e.g. the Klarum token engine, will want context too); the only DOM coupling is a
**type-only** `Child` import for the Provider's JSX return type (erased at build —
the core ships zero DOM runtime; `flow` imports `Child` the same way). 6 tests
(DOM + nesting + reactive value + SSR + default). Cost: `core: full surface` 825→963
gz (budget 1000 — no re-baseline). SSR verified: context resolves under
`renderToString` too.

### 29. Interactivity model = ISLANDS, client-rendered first (resolves the Phase-5 fork)
The parallel hydration research (clean-room, grounded in Solid/Astro/Qwik mechanics)
was decisive: for a mostly-static marketing page with a handful of interactive
widgets, **islands beat full-page hydration and resumability**. Full-page hydration
would ship+execute JS for static hero/feature/footer content — violating the 0-KB
static baseline (#24). Resumability needs a compiler we don't have and taxes all
authoring; wrong time. So: the static shell stays **0 KB JS**; each interactive
island ships its **own tree-shaken bundle**, lazy-loaded by strategy
(`load`/`idle`/`visible` via `requestIdleCallback`/`IntersectionObserver`), mirroring
Astro's `client:*` + `<astro-island>`. **Client-render each island first** (run the
component fresh on the DOM backend in create-mode, replace the server HTML) rather
than truly hydrating it — this removes the entire hydration-mismatch failure class
(Solid Start's #1 pain) from the critical path. 7 of klarum's 8 islands are
below-the-fold/interaction-gated, so no flash. The true CLAIM/hydrate backend (#31)
is built later, only for an island that visibly flashes (realistically just the
parallax hero). Direct `addEventListener` closures (#9) stay correct for these
islands — just routed through the descriptor-capable `listen` seam (#30).

### 30. `listen` seam takes a handler DESCRIPTOR or a bare function — RESOLVES #19
The one expensive-to-retrofit decision, so locked now even though only half is built.
The `RenderBackend.listen` contract becomes:
`listen(el, type, handler, opts?)` where `handler` is EITHER a live closure (today's
path, wired via `addEventListener`) OR a descriptor `{ ref: string; load: () =>
fn | Promise<fn>; capture?: unknown[] }`. **Build now:** only the closure path +
descriptor-with-synchronous-`load` (zero behavior change for existing code).
**Reserved now, built later:** the string backend may emit a serialized
`on:<type>="<ref>#…"` attribute + a per-root capture table for descriptors; a future
compiler rewrites bare closures into descriptors and `load` into a real dynamic
`import()`, and a qwikloader-style global dispatcher reads the attributes — **all
additive, no seam change**. This is the middle path #19 asked for: closures keep
working for islands NOW without foreclosing resumability LATER. If we hardcoded
"handler is always a function," resumability would be a rewrite — hence lock now.

### 31. Deterministic create-order + `<!---->` anchor invariant is LOCKED
A fine-grained renderer has no rebuilt tree to diff against on hydration — it must
hand each reactive leaf the *exact* server node it owns, in one forward pass. That
requires (a) DOM and string backends walk children in identical order, and (b)
self-delimiting boundary markers so a claim-walker can parse the DOM as a token
stream (`getNextElement`/`getNextMarker`). We ALREADY emit `<!---->` anchors around
dynamic sections (#6/#24 seam) — this decision just *locks* that invariant as load-
bearing and forbids silently changing child-visit order. The CLAIM backend mode
itself (reinterpret `element`/`text`/`anchor`/`insert`/`effect` to adopt existing
nodes instead of creating them; run `effect` once-then-live) is **deferred** to when
an island needs true hydration — the anchors make it purely additive when we get there.

### 32. Islands build in the plain-esbuild pipeline (no Vite/Next) + type-tagged props
Consistent with #23. Mechanism: an `<Island src="..." client="visible" props={...}/>`
marker; a two-pass build — SSR pass renders the static HTML and registers each
island `{src, export, client, props}` (island server HTML produced here too), then a
client pass runs `esbuild.build({ entryPoints:[src], splitting:true, format:'esm',
bundle:true })` per distinct island so the shared runtime (signals + DOM renderer +
loader) is factored into ONE shared chunk (our per-import byte budgets make it cheap).
Each island is emitted as an `<is-land>` wrapper containing its server HTML +
`data-src`/`data-export`/`data-client`/`data-props`. Props use a **type-tagged JSON
encoder** (Dates/Maps/typed rows round-trip) — built once, reused later for the
resumable capture table (#30). A few-hundred-byte inline loader walks `<is-land>`s
and mounts by strategy. Locked now: the `<is-land>` wire conventions + the reserved
`on:*`/capture format. **Sandbox discipline (#15):** prove the whole islands pipeline
end-to-end on noahhyden.com (the break-freely sandbox) with one simple island BEFORE
applying it to klarum's 83 components.

### 33. Islands pipeline BUILT + browser-proven on the sandbox (#29/#30/#32 realized)
Built end-to-end on noahhyden.com and verified in a real browser (WebBridge):
- **`listen` descriptor seam (#30)** shipped in the engine + both backends; 4 tests
  (closure, sync descriptor, capture-bag carried, async-descriptor throws). Conscious
  size re-baseline: `dom` 1800→1850 gz (justified — the resumability lock).
- **Site islands mechanism (#32):** `<Island slug component client/>` marker renders
  the component INLINE at SSR wrapped in `<is-land data-island/data-client/data-props>`;
  `build.mjs` runs a second esbuild pass (`splitting:true`, pimas BUNDLED not external,
  `minify`) over `[boot, …islands]` → `dist/islands/`. `splitting` factored the pimas
  kernel into ONE shared chunk imported by both `boot.js` and `accordion.js` — verified
  single kernel (same `chunk-*.js` import), so NO dual-kernel (#26) in the browser.
- **`boot.ts`** (the only client entry) walks `<is-land>`s, schedules by `data-client`
  (`load`/`idle`/`visible` via IntersectionObserver/requestIdleCallback), dynamic-imports
  the island bundle, and **client-renders** it (drops server HTML, `render()`s the live
  component) — #29's client-render-first, no claim/hydrate.
- **First island:** a 3-panel accordion on the design-language page, `client="visible"`.
  Browser proof: SSR shipped 3 real `<button>`s of static HTML; scrolling mounted it
  (IntersectionObserver); clicks toggled panels one-open-at-a-time via one signal
  (`[220px,0,0]`→`[0,220px,0]`→`[0,0,0]`); **zero console/window errors**.
- **Honest metrics held:** 4 static pages ship **0 KB JS**; design-language ships
  exactly **4.0 KB gz** (boot 376 B + accordion 1.7 KB + shared kernel 2.1 KB), reported
  truthfully in its footer ("static shell + one 4.0 KB island"). The 0-KB baseline (#24)
  is preserved everywhere JS isn't needed. **NOT yet deployed** to the live root (deploy
  is the copy-dist-to-root step, done on request). Deferred as planned: type-tagged prop
  serializer (plain JSON suffices until an island needs Dates/Maps — klarum's spreadsheet),
  the claim/hydrate backend, per-island byte attribution (sum-of-all-islands is exact at
  N=1), content-hashed island filenames. Next: `createStore` (#18.3) for klarum's stateful
  islands, then apply the pipeline to klarum's home page + first real island.

### 34. `createStore` — nested reactive proxy, new `pimas/store` subpath (backlog #18.3)
The highest real-app-value primitive, for klarum's stateful islands (the records
spreadsheet, the agent state machine). A parallel comparative research agent (standing
rule) verified the design against Solid's `store.ts`, Svelte 5's `proxy.js`, and Vue 3's
`baseHandlers.ts`; findings adopted below. Headless (`pimas/store`, no DOM) so the Klarum
token engine can use it in Node. **Design:** a read-only deep Proxy over the raw object,
which is the single source of truth. Reading a property lazily creates + subscribes a
per-key "ping" signal (a monotonic counter → always notifies; dedup done in the setter via
`Object.is`, mirroring Solid's `equals:false` nodes). A per-object `$KEYS` signal makes
`length`/`in`/`Object.keys`/iteration reactive. Proxies are cached per raw object (`WeakMap`)
for **stable identity** — so identity-keyed `<For>` still reuses rows. Writes go through a
variadic `setStore(...path, value)` (path-navigate + leaf set) supporting functional updaters
and root/partial merge, wrapped in `batch` so a multi-field set flushes dependents once.
**Adopted from research:** (a) a `getListener()` guard (added to the core) so reads OUTSIDE
any effect/SSR create no signal — critical for a thousand-cell grid; (b) `__proto__` write
guard; (c) verified `{...spread}`/`Object.assign` don't trip the Proxy invariant (our props
are configurable, so Solid's getter-conversion in `getOwnPropertyDescriptor` isn't needed yet).
**Verified against `<For>`:** For's memo reads `.length` (→ subscribes `$KEYS`) and diffs
per-index under `untrack`, so a cell-field edit re-runs only that cell's binding, never the
whole list; structural changes (length / slot replacement) re-run For. **Deferred to v2**
(research concurred): `produce` (mutable-draft sugar) and `reconcile` (diff external data
preserving identity) — `reconcile` first if klarum does server-refresh of keyed lists. 12
tests. Size: new fixture `store: createStore` 1363 gz (budget 1400, initial baseline — includes
the kernel); `core: full surface` 963→979 gz for `getListener`. 65 tests total green.

---

## Dogfood rung 2 — klarum.com port begins (2026-07-01)

### 35. klarum-landing home page ported to pimas — milestone 1 (static shell + 1 island)
The intermediate-stakes rung (#15). A parallel research agent (standing rule) settled the
port strategy vs Next.js 16 + Tailwind v4; adopted below. Source lives in the
`Klarum-Software/klarum-landing` repo under `site/` (the noahhyden.com model), consuming the
real `pimas` package. **Milestone 1 scope (disciplined, not the whole site):** the home page's
core marketing sections — Navbar, Hero (+ full workspace mock), Features, FAQ, Footer — with
the **FAQ accordion as the one interactive island**. Deferred: the demo-heavy middle sections
(Demo tab-switcher, InterfaceGallery, Algorithm, KnowledgeGraph, Capabilities, Process), the
parallax HeroCover, and the other 18 pages.
- **Tailwind v4 stays — compiled standalone.** Do NOT hand-translate 83 components to inline
  styles (that was right for noahhyden's one-off page, wrong here). `build.mjs` shells out to
  `@tailwindcss/cli` (no PostCSS, no config; auto-scans `src/**.tsx`, tree-shakes to used
  utilities), and inlines the result. `globals.css` tokens (`:root` + `@theme inline` +
  `@custom-variant dark` + the custom `.eyebrow/.mock-panel/.pill/.live-dot` utilities) copied
  nearly verbatim; the demo-only `.pivi-skin` block + `tw-animate-css` dropped for this slice.
  **The React→pimas port is mechanical when classes are kept:** `className`→`class`, `.map()`
  for static lists, `next/Link|Image`→`<a>|<img>`, `useState`→`createSignal`, cond→`<Show>`,
  `usePathname` dropped, `lucide-react`→inlined SVG pimas components (exact lucide paths). The
  one discipline: Tailwind classes must be static literals (no interpolation in thunks).
- **Fonts self-hosted** (Inter + JetBrains Mono woff2 from Fontsource; the home slice uses no
  serif) replacing `next/font/google`; preloaded above-the-fold. **lucide** inlined (4 icons).
- **Islands pipeline reused unchanged** from noahhyden (#32/#33): `<Island>` marker +
  `<is-land>` + boot loader + esbuild `splitting` (one shared kernel). FAQ island shipped.
- **Browser-verified (WebBridge):** the home page renders **pixel-faithfully** to the Next
  original (nav, hero, the full sidebar+search+tenders workspace mock with colored match bars);
  Tailwind compiled + applied; fonts loaded. FAQ island: SSR static → client-mounts → toggles
  one-open-at-a-time with reactive `aria-expanded` + `<Show>` answer, **0 errors**. Home ships
  **8.4 KB gz HTML (Tailwind inlined) + 4.3 KB gz island JS**; everything else 0 KB JS.
- **Test-env note:** `IntersectionObserver` does not fire in the WebBridge browser (no
  compositor), so `client="visible"` islands can't be verified there; switched FAQ to
  `client="idle"` (via `requestIdleCallback`, not visibility-gated) — a fine choice for a small
  island. `visible` remains supported (proven on noahhyden). **NOT deployed** — klarum.com still
  runs the Next app; this is a local port milestone (`site/` source; `dist/` gitignored). Next:
  port the demo sections (needs the `.pivi-skin` CSS + complex islands built on `createStore`:
  records grid, agent playback), then the remaining pages.

### 36. Records ledger island — `createStore` proven in a real complex UI (milestone 2)
The klarum home's Demo section, upgraded from the original static preview to the **genuine
interactive Records (EOI ledger)** — the first island built on `pimas/store`. Ported from the
Next app's `components/demo/records-demo.tsx` (which lives on the unmerged `fix/demos-real-pivi-
design` branch, NOT on `main`/the live site — so this ports an as-yet-unshipped product demo; a
faithful proof, not a live-parity port). 18-row bid ledger with sortable columns, status filter
chips (live counts), search, and **inline status + bid-value editing** — a real spreadsheet.
- **State split that makes fine-grained pay off:** the row collection is one `createStore({rows})`
  (the single source of truth); view state (`filter`/`query`/`sortKey`/`sortDir`, edit cursors) is
  plain signals; `visible`/`totalValue`/`filterCounts` are `createMemo`s over both. An inline edit
  is `setRows("rows", i, "field", v)` — the store pings only that field, so only the one cell
  binding (a thunk) re-renders, plus whichever memos actually read that field. Editing a bid value
  while NOT sorted by value updates just that cell + the totals footer, no re-sort — observed.
- **`createStore` × `<For>` confirmed end-to-end:** the `visible` memo reads `state.rows` (via
  `.filter`/`.sort`/`.reduce`/`for..of`, all of which route length + index + field reads through
  the store traps → correct subscription), returns row **proxies** (stable identity via the proxy
  cache), and `<For each={visible}>` keys by that identity — a re-sort MOVES existing `<tr>` nodes,
  doesn't rebuild. `.filter()` returns a fresh plain array so the subsequent `.sort()` never touches
  the read-only proxy (the set trap would throw). `updatePath` takes literal keys only (no predicate
  paths yet) → resolve the raw index by id in handlers (`state.rows.findIndex`).
- **`ref` fires at element creation, BEFORE insertion** → `el.focus()` in a ref is a no-op on a
  detached node. Fix: `ref={el => queueMicrotask(() => el.focus())}` (node is in the DOM by the
  microtask). A small framework ergonomics gap — a post-insert `onMount`/ref-timing hook is worth
  considering (noted on the tracker). SSR-safe: the input only exists mid-edit, so the ref never
  runs on the string backend.
- **`.pivi-skin` app skin brought in (subset).** DemoFrame wraps the demo in the real Pivi app
  chrome; `.pivi-skin` re-points the marketing tokens to the Bloomberg-grade app palette + remaps
  the font vars to **IBM Plex** (self-hosted Sans 400/500/600 + Mono 400/500 from Fontsource,
  NOT preloaded — below-fold + idle). Only the classes this demo uses were ported (`.tag`, `.tbl`,
  `.label`); more land as further demos do. Because `@theme` maps `--color-*` to `var(--token)`,
  re-pointing raw tokens inside the wrapper is enough — no utility rewrites.
- **Browser-verified (WebBridge):** SSR bakes the full 18-row table (real first paint) → island
  client-mounts on `idle` (single shared kernel `chunk-*` across boot/faq/records) → sort asc/desc,
  filter (counts + subsetting), search, inline status edit (pill + filter counts recompute), inline
  value edit (value + totals recompute), autofocus — all confirmed, 0 errors, pixel-faithful. Home
  now ships **12.6 KB gz HTML + 9.6 KB gz island JS** (records adds ~5 KB incl. `pimas/store`),
  everything else still 0 KB JS. Test-env note from #35 stands (`visible` unverifiable in WebBridge;
  used `idle`). NOT deployed — local milestone, `dist/` gitignored, klarum.com still runs Next.

## Phase 5 autonomous loop (2026-07-01→) — living decisions in issue #11

### 37. `onMount` — post-insert lifecycle hook at the backend seam (resolves the #36/#10 ref gap)
Binding effects run during construction, BEFORE the tree is inserted, so a `ref` or effect sees a
detached node (the #36 focus workaround). `onMount(fn)` runs `fn` once after insertion.
- **At the RenderBackend seam, not the reactive core.** Added `scheduleMount(fn)` to the backend:
  DOM → `queueMicrotask(fn)` (defers past the synchronous build+insert); string backend → **no-op**
  (SSR is run-once, no live nodes). This makes onMount **automatically SSR-safe with no
  server-specific export** — the active backend during `renderToString` is the string one — and
  needs **zero changes to `reactive.ts`** (core stays DOM-free). Exported from `pimas/dom`.
- **Usage:** pair with a `ref` to capture the node — `let el; onMount(() => el.focus()); <input ref={n => el = n} />`.
  For teardown, register `onCleanup` at setup time, NOT inside onMount (documented). v1 has no
  disposal-race guard (focusing a removed node is a harmless no-op) — kept minimal.
- **Cost:** dom 1850 → 1875 gz (14 real bytes). 4 tests; 69 total green. Committed `6604bc1`.

### 38. `<ErrorBoundary>` + `catchError` — error handling on the owner tree (#2)
Errors thrown during initial render, an effect re-run, or a memo recompute route to the nearest
enclosing boundary, walked up the OWNER tree exactly like context (#10) — survives portals/serialization.
- **Core (reactive.ts):** an `errorHandler?` field on the Reactive node; `handleError(err, from)`
  walks `owner` upward for the nearest handler and runs it at the boundary's PARENT scope (so a
  rethrow escapes to the NEXT boundary up, not itself); the core `update()` gains a `catch` that sets
  the node CLEAN (don't retry a thrower) then routes. `catchError(tryFn, handler)` primitive exported.
- **Flow:** `<ErrorBoundary fallback={(err,reset)=>…}>{() => <App/>}</ErrorBoundary>` (static OR
  render-fn fallback via `fn.length`; thunk children like `<Show>`).
- **The one deviation from the design (verified correct):** the design had the handler's `setErrored`
  write trigger a re-run to show the fallback — but for an INITIAL-build throw that write happens
  during the boundary memo's OWN compute, and the pull marks the memo CLEAN at the end, clobbering the
  re-dirty, so the fallback never appeared. Fix: render the fallback **inline in the same compute**
  (the handler captures the error locally AND writes `errored`). `setErrored` still drives `reset()`
  and later-UPDATE throws (which route from OUTSIDE the memo's compute, via the normal dirty→re-run
  path). The reactive core is byte-for-byte the design; only ErrorBoundary's render body differs. I
  added a DOM test for the throw-on-update swap (the exact path the deviation reasons about) — passes.
- **NOT caught (matches Solid, documented):** throws in event handlers / setTimeout (no owner on the
  stack). **SSR:** renders fallback if a boundary exists, else rethrows (prerender fails loudly).
- **Cost:** handleError + the update() catch land in the indivisible kernel, so every core-pulling
  fixture pays ~+86 gz — signal 700→725, full 1000→1125, dom 1875→1950, store 1400→1475; new
  `flow: ErrorBoundary` fixture 912 gz (budget 1000). 15 tests; 84 total green. Committed `f9fadce`.
- **Real-browser coverage:** added `browser-test/` fixtures for onMount + ErrorBoundary (real focus,
  real-DOM throw/catch/reset) — `npm run test:browser` now 15/15 in real Chrome (was 9).

### 39. klarum.com fully rebuilt on pimas (Phase-5 dogfood complete — supersedes #35/#36 milestones)
The intermediate-stakes dogfood (#15) is DONE on the `pimas-port` branch of `Klarum-Software/klarum-landing`
(NOT merged to main — a test branch, per direction). Scope far beyond the #35/#36 milestones (home +
FAQ + records): **19 routes** — 18 faithful marketing pages (auto-discovered `src/pages/*.tsx`, wrapped
in a shared `Layout`, nav-active via `meta.path` with 0 client JS, Tailwind v4 compiled+inlined,
self-hosted fonts) + a 10-demo interactive `/showcase/`. Every static page ships **0 KB JS**; island
pages share one pimas kernel chunk.
- **The showcase is ONE island** (islands don't share signals across `<is-land>` boundaries) that imports
  the demo components directly and switches them with `<Switch>`/`<Match>` on a `demoTab` signal.
- **10 demos** exercising the full surface: records/items/issuers/inbound (`createStore`), discovery/
  workspace (signals + `<Switch>`), pricing (interval toggle), automations/agent (timed state machines
  via a ~15-line userland `_timer.ts` `useSequence`/`useInterval` — timers arm in `onMount`, SSR no-op),
  analytics (hand-built SVG `BarChart`/`LineChart` replacing recharts, ~1.3 KB vs ~90 KB gz),
  knowledge-graph (inline SVG constellation + ResizeObserver-in-`onMount`).
- **Verified across three layers:** static reactivity review (all 10), browser interaction, and runtime
  timers (automations run→done, EOI progressive reveal, agent playback→"answer ready"). Pre-merge audit:
  0 blockers (honest per-page byte metric via esbuild metafile, a11y labels, trailing-slash links).
- **NO framework growth for the whole rebuild** beyond onMount (#37) + ErrorBoundary (#38); every demo is
  userland. Autonomous-loop decision log w/ full detail: issue #11 (D1–D12).

### 40. `<Show>`/`<Match>` capture-freeze — read the gated value INSIDE the child thunk (gotcha)
Found + fixed two real bugs in the klarum port (items detail pane, knowledge-graph evidence panel both
FROZEN to the first item). Root cause is a genuine pimas semantics sharp edge, same family as the
thunk-children caveat in #28 and the staleness footgun in #21: **`<Show when={x}>` / `<Switch>`/`<Match>`
memoize the gate to a boolean/selected-case; the child thunk re-runs ONLY when that flips, not when the
underlying value changes.** So if the gate is non-null by default (never flips) and the child captures
`const v = selected()!` ONCE, every `v.field` read is frozen at the first value — clicking a different
row updates the signal but not the pane. **Rule: never capture a signal's value at the top of a `<Show>`/
`<Match>` child; read it inside per-node thunks** — `const sel = () => selected()!; …{() => sel().title}`,
`<For each={() => sel().items}>`, `onClick={() => f(sel().id)}`. The correctly-written demos (discovery,
issuers) already did this; the bug only hit the two that captured once. Committed `ea1c7f0`. This is
exactly what the deferred dev-warning (#21 / issue #9) should catch — cross-linked.

### 41. Direction spike — the agent-simulatable frontend (exploration, not a committed pivot)
Concluded that pimas-as-a-general-React-replacement is not viable solo (React has thousands of
maintainers; pimas one, and as a UI framework it dies with the portfolio site). Reframe: **the
framework becomes the lab; the product-shaped idea is a niche in frontend-for-agents the incumbents
structurally can't reach.** Every existing agent↔UI path is request/response or scrape — WebMCP
(`document.modelContext.registerTool`, Chrome trial/Gemini) and CopilotKit expose *actions*; AG-UI /
mcp-ui / generative-UI go agent→UI; computer-use/Playwright-MCP scrape the a11y tree. None expose the
**live dependency graph** a fine-grained engine already maintains. Thesis in three layers: **L1** agent
*subscribes* to live signal state (an agent-side `createEffect` already is this — near-free); **L2**
*causal provenance* to the agent ("total changed because action X set cart[3].qty which the memo
reads") — the sources/observers DAG makes it possible, human-facing versions exist (Redux/MobX/React
Scan) but agent-facing is unclaimed; **L3 (the wedge)** *deterministic what-if simulation* — agent
proposes hypothetical writes, framework computes derived memos in a **shadow graph without committing
to DOM or firing effects**, returns predicted state so the agent can plan. L3 is categorically distinct
from learned agent world-models (approximate) and optimistic updates (commit-then-rollback), and is
**genuinely open**. Why pimas can do L3 and a VDOM can't: the engine is **pull-based with topology
separate from value**, so you shadow just values+colors and reuse the real DAG read-only; naive
set/read/restore corrupts the memo cache, the shadow overlay is the minimal correct mechanism. **The one
risk:** L3 correctness assumes memo purity (assumed, not enforced) — mitigate with store copy-on-write +
no-op effects in speculation mode. Full writeup + staged plan: [`AGENT-NATIVE.md`](AGENT-NATIVE.md);
tracker + spikes: issue #13. This likely supersedes the reason to ever build the compiler (#12 / #14 /
#18.6) — that's a UI-rendering optimization with near-zero value to an agent surface.

### 42. Agent-native, sharpened — an exact what-if engine for quantitative models (validated)
Following #41, a research pass concluded that L3 `speculate`'s defensible frontier is not generic app
state but **pure, derived-heavy quantitative models** — the one domain where the "only correct if memos
are pure" caveat is *free* (such models are already pure functions of their inputs), and where
hypothetical what-if / sensitivity is the entire activity. Proven by building `noahhyden/von-neumann`
`wall-live/`: the `closure-sim` self-replicating-lunar-factory model run in a pimas graph
(bill-of-materials = `createStore` COW, replication params = signals, closure/sim = memos). Its
"electronics wall" analysis — which the reference Python does by deep-copy → toggle → re-run → diff →
discard — becomes a first-class `speculate` (exact after-state vs a shadow graph, nothing committed);
`pimas/agent` `explain()` names the field-level cause; the reactive core computes the model AND renders
the page (~11 KB gz). The TS math is pinned to the Python by parity tests + a cross-language
differential test (60 random factories / 540 fields, all match). Framing to use going forward: pimas is
a purpose-built **reactive what-if + provenance engine**, dogfooded on real models; the reactive UI core
is the delivery vehicle. WebMCP/adoption/standards are explicitly out of scope for this direction.
Generalizes to the econ-model repos (road-econ, fiscal-incidence) whose hand-rolled `model_copy(update=…)`
sweeps are a weaker reimplementation of `speculate`.
