/**
 * Fine-grained reactive core (push-pull, glitch-free).
 *
 * Reading a signal subscribes the running computation; writing it re-runs only
 * the computations that depend on it. Propagation is two-phase:
 *
 *   PUSH (on write): mark dependents without computing. Direct dependents become
 *     DIRTY; everything transitively below becomes CHECK.
 *   PULL (on read / effect flush): a CHECK node walks its sources first and
 *     recomputes only if a source actually changed.
 *
 * Diamonds recompute once. Equal values stop the cascade. Memos are lazy;
 * effects are eager. Algorithm after Milo Hansen's "Reactively".
 *
 * `speculate` evaluates hypothetical writes against a shadow of this graph:
 * memos recompute, effects do not fire, the real graph is never mutated.
 */

// ── Node model ───────────────────────────────────────────────────────────

type State = 0 | 1 | 2;
const CLEAN: State = 0;
const CHECK: State = 1;
const DIRTY: State = 2;

interface Reactive<T = any> {
  value: T | undefined;
  /** Present for memos & effects; absent for plain signals. */
  fn?: () => T;
  state: State;
  /** Effects are eager roots that must run when dirty even if unread. */
  effect: boolean;
  disposed: boolean;
  /** Nodes this one read last run (its dependencies). */
  sources: Set<Reactive>;
  /** Nodes that read this one (its dependents). */
  observers: Set<Reactive>;
  owner: Reactive | null;
  owned: Reactive[];
  cleanups: Array<() => void>;
  equals: (a: T, b: T) => boolean;
  /** Error handler installed at this scope (a boundary). Walked up the owner chain. */
  errorHandler?: (err: unknown) => void;
}

// ── Globals ──────────────────────────────────────────────────────────────

/** The computation currently running, so reads can wire up dependencies. */
let currentObserver: Reactive | null = null;
/** The current ownership scope (for disposal of nested computations). */
let currentOwner: Reactive | null = null;
/** While > 0, writes mark + queue effects but don't flush until the outer exit. */
let batchDepth = 0;
/** Effects marked dirty/check, awaiting a flush. */
const effectQueue: Reactive[] = [];
let flushing = false;
/** A custom flush scheduler, or `null` for the synchronous default. When set,
 *  a synchronous write-burst is coalesced into one deferred `flush()` call
 *  (e.g. via `queueMicrotask`). Null keeps the write→flush path a direct call —
 *  the seam costs the common case only a single branch. */
let scheduler: ((flush: () => void) => void) | null = null;
/** Latch: a deferred flush is already queued for this scheduler turn. */
let scheduled = false;
/** Non-null while a `speculate(...)` what-if evaluation is in progress (L3, #13).
 *  Reads/writes route through its methods; the heavy shadow logic lives in
 *  `speculate` (tree-shaken away for anyone who never imports it) so the core's
 *  hot read/write path pays only a single null-check. The real graph is never
 *  touched during speculation. */
let speculating: {
  read<T>(n: Reactive<T>): T;
  write<T>(n: Reactive<T>, v: T): T;
  /** Rollback-scoped scratchpad for userland primitives (e.g. store copy-on-write). */
  scratch: Map<unknown, unknown>;
} | null = null;

const defaultEquals = <T>(a: T, b: T) => Object.is(a, b);

function makeNode<T>(fn: (() => T) | undefined, value: T | undefined, effect: boolean): Reactive<T> {
  return {
    value,
    fn,
    state: fn ? DIRTY : CLEAN, // computeds start dirty (need first compute); signals clean
    effect,
    disposed: false,
    sources: new Set(),
    observers: new Set(),
    owner: currentOwner,
    owned: [],
    cleanups: [],
    equals: defaultEquals,
  };
}

// ── Read / write ───────────────────────────────────────────────────────────

function readNode<T>(node: Reactive<T>): T {
  if (speculating) return speculating.read(node); // L3: shadow read, real graph untouched
  // Subscribe the running computation (two-way link).
  if (currentObserver) {
    currentObserver.sources.add(node);
    node.observers.add(currentObserver);
  }
  // A memo must be current before its value is trusted (effects pull via flush).
  if (node.fn && !node.effect) updateIfNecessary(node);
  return node.value as T;
}

function writeNode<T>(node: Reactive<T>, next: T): T {
  if (speculating) return speculating.write(node, next); // L3: shadow write
  if (node.equals(node.value as T, next)) return node.value as T; // no-op on equal
  node.value = next;
  // PUSH: mark direct dependents DIRTY (transitive ones become CHECK).
  for (const o of node.observers) stale(o, DIRTY);
  if (batchDepth === 0) requestFlush();
  return next;
}

/** Propagate a "you may be out of date" mark down the graph. No computation. */
function stale(node: Reactive, level: State): void {
  if (node.state < level) {
    // An effect transitioning off CLEAN must be queued to run.
    if (node.state === CLEAN && node.effect) effectQueue.push(node);
    node.state = level;
    for (const o of node.observers) stale(o, CHECK);
  }
}

// ── Pull / recompute ─────────────────────────────────────────────────────

/** Bring a node up to date, recomputing only if a source truly changed. */
function updateIfNecessary(node: Reactive): void {
  if (node.state === CLEAN) return;
  // CHECK: a source *might* have changed — resolve sources first (walk up).
  if (node.state === CHECK) {
    for (const source of node.sources) {
      if (source.fn) updateIfNecessary(source);
      if ((node.state as State) === DIRTY) break; // a source recompute dirtied us
    }
  }
  if (node.state === DIRTY) update(node);
  node.state = CLEAN;
}

/** Recompute a node; propagate to observers ONLY if the value actually changed. */
function update<T>(node: Reactive<T>): void {
  cleanup(node); // dispose owned children + run cleanups before re-running
  removeSources(node);

  const prevObserver = currentObserver;
  const prevOwner = currentOwner;
  currentObserver = node;
  currentOwner = node;
  try {
    const next = node.fn!();
    if (!node.equals(node.value as T, next)) {
      node.value = next;
      for (const o of node.observers) o.state = DIRTY; // real change → dependents dirty
    }
  } catch (err) {
    node.state = CLEAN; // don't retry a thrower
    handleError(err, node);
  } finally {
    currentObserver = prevObserver;
    currentOwner = prevOwner;
  }
}

function flushEffects(): void {
  if (flushing) return; // a write inside an effect just enqueues; the loop picks it up
  flushing = true;
  try {
    for (let i = 0; i < effectQueue.length; i++) {
      const e = effectQueue[i]!;
      if (!e.disposed && e.state !== CLEAN) updateIfNecessary(e);
    }
    effectQueue.length = 0;
  } finally {
    flushing = false;
  }
}

/** Flush now (the default) or hand the drain to a custom scheduler, coalescing a
 *  write-burst into one turn. The latch is cleared *before* the drain so that
 *  writes made inside a running effect are serialized by the `flushing` guard
 *  (not the latch) — the drain loop picks them up in the same pass. */
function requestFlush(): void {
  if (!scheduler) return flushEffects();
  if (scheduled) return;
  scheduled = true;
  scheduler(flushScheduled);
}

/** The bound drain a custom scheduler runs — shared (not per-request) so the
 *  common no-scheduler path allocates nothing. */
function flushScheduled(): void {
  scheduled = false;
  flushEffects();
}

/**
 * Install a custom flush scheduler (e.g. `(flush) => queueMicrotask(flush)`) to
 * coalesce a burst of synchronous writes into one deferred flush — effects still
 * run in FIFO enqueue order, just later. Pass nothing (or `null`) to restore the
 * synchronous default. Returns the previous scheduler so callers can nest/restore.
 *
 * The default is synchronous because `renderToString` and post-write DOM reads
 * depend on effects having flushed by the time the write call returns; deferring
 * is strictly opt-in (a client-side perf choice — see `flushSync` for the escape
 * hatch when a custom scheduler is installed).
 */
export function setScheduler(
  fn?: ((flush: () => void) => void) | null,
): ((flush: () => void) => void) | null {
  const prev = scheduler;
  scheduler = fn ?? null;
  return prev;
}

/** Force any queued effects to drain synchronously now, regardless of the
 *  installed scheduler. The escape hatch for code that must observe up-to-date
 *  state immediately (SSR, tests) while a deferred scheduler is active. Clears
 *  the pending-flush latch so a scheduler that *dropped* its callback (or one
 *  being torn down) can't wedge all future flushes. */
export function flushSync(): void {
  scheduled = false;
  flushEffects();
}

// ── Teardown ───────────────────────────────────────────────────────────────

function removeSources(node: Reactive): void {
  for (const s of node.sources) s.observers.delete(node);
  node.sources.clear();
}

function cleanup(node: Reactive): void {
  for (const child of node.owned) dispose(child);
  node.owned.length = 0;
  for (let i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]!();
  node.cleanups.length = 0;
}

function dispose(node: Reactive): void {
  node.disposed = true;
  cleanup(node);
  removeSources(node);
}

// ── Public API ─────────────────────────────────────────────────────────────

export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((prev: T) => T)) => T;
export type Signal<T> = [get: Accessor<T>, set: Setter<T>];
export interface Owner {
  owned: Reactive[];
  cleanups: Array<() => void>;
}

/**
 * A reactive value. `count()` reads (and subscribes); `setCount(v)` writes.
 * Functional updates supported: `setCount(n => n + 1)`.
 */
export function createSignal<T>(initial: T): Signal<T> {
  const node = makeNode<T>(undefined, initial, false);
  const read: Accessor<T> = () => readNode(node);
  const write: Setter<T> = (next) =>
    writeNode(node, typeof next === "function" ? (next as (p: T) => T)(node.value as T) : next);
  return [read, write];
}

/**
 * A cached derived value. LAZY — it computes on first read and recomputes only
 * when a dependency truly changes. Reading it subscribes you like any signal.
 */
export function createMemo<T>(fn: () => T): Accessor<T> {
  const node = makeNode<T>(fn, undefined, false);
  if (currentOwner) currentOwner.owned.push(node);
  return () => readNode(node);
}

/**
 * Run `fn` now, and again whenever a signal it read changes. Effects are eager:
 * they're the roots that drive the pull. Dependencies are re-collected each run,
 * so conditional branches subscribe only to what they actually read.
 */
export function createEffect(fn: () => void): void {
  const node = makeNode<void>(fn, undefined, true);
  if (currentOwner) currentOwner.owned.push(node);
  updateIfNecessary(node); // initial run (DIRTY → update)
}

/** Group writes so dependent effects run once, after `fn` returns. */
export function batch<T>(fn: () => T): T {
  if (batchDepth > 0) return fn();
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    requestFlush();
  }
}

/**
 * The computation currently tracking, or null outside any effect/memo. Lets
 * userland primitives (e.g. `pimas/store`) skip work when nobody is listening —
 * a store read outside a reactive scope then creates no signal. Opaque handle;
 * treat it as truthy/falsy.
 */
export function getListener(): unknown {
  return currentObserver;
}

/** True while a `speculate(...)` what-if evaluation is in progress (L3, #13). */
export function isSpeculating(): boolean {
  return speculating !== null;
}

/**
 * The current speculation's rollback-scoped scratchpad, or null when not
 * speculating. Lets a userland primitive (e.g. `pimas/store`) shadow its own
 * out-of-graph state (copy-on-write) during a `speculate(...)`, discarded for
 * free when the speculation ends.
 */
export function speculationScratch(): Map<unknown, unknown> | null {
  return speculating ? speculating.scratch : null;
}

/**
 * L3 what-if oracle (issue #13). Apply hypothetical writes in `apply`, then
 * evaluate `read` — both against a SHADOW of the reactive graph. Reads see the
 * hypothetical values and memos recompute against them, but the real graph is
 * never mutated and NO effects fire; the whole thing rolls back on exit (drop
 * the shadow map). Returns `read`'s result.
 *
 * Lets you ask "what would derived state become if I did X?" and get an exact
 * answer from the model's own memos — before committing anything. Correct for
 * pure memos. Store writes are copy-on-write via `speculationScratch`. No nesting.
 */
export function speculate<T>(apply: () => void, read: () => T): T {
  if (speculating) throw new Error("speculate: no nested speculation yet");
  const values = new Map<Reactive, unknown>();
  // A shadow read: hypothetical value if one was written; else for a memo,
  // recompute against the shadow — fully detached (no subscription, no
  // ownership) so nothing real is mutated — and memoize (diamonds compute once);
  // else a plain signal's real committed value. Correct for pure memos.
  const spec = {
    read<U>(node: Reactive<U>): U {
      if (values.has(node)) return values.get(node) as U;
      if (node.fn && !node.effect) {
        const po = currentObserver, pw = currentOwner;
        currentObserver = null;
        currentOwner = null;
        try {
          const v = node.fn();
          values.set(node, v);
          return v;
        } finally {
          currentObserver = po;
          currentOwner = pw;
        }
      }
      return node.value as U;
    },
    write<U>(node: Reactive<U>, next: U): U {
      values.set(node, next);
      return next;
    },
    scratch: new Map<unknown, unknown>(),
  };
  const prevObserver = currentObserver;
  const prevOwner = currentOwner;
  currentObserver = null; // hypothetical writes/reads must not subscribe anything real
  currentOwner = null;
  speculating = spec;
  try {
    apply();
    return read();
  } finally {
    speculating = null;
    currentObserver = prevObserver;
    currentOwner = prevOwner;
  }
}

// ── Topology introspection (L0, issue #37) ─────────────────────────────────

/** A node of the dependency graph, projected to a plain read-only shape (never
 *  the raw `Reactive` — a caller must not be able to mutate `sources`/`observers`
 *  and corrupt the graph). */
export interface GraphNode {
  /** Stable for a node's lifetime (lazily assigned on first introspection). */
  id: string;
  /** `signal` = a source with no dependencies; `memo` = a derived value. (The
   *  `effect` tag is reserved: effects are downstream *observers* of the exposed
   *  state, not sources, so they never appear in a derives-from walk — see below.) */
  kind: "signal" | "memo" | "effect";
  /** The exposed name this node backs, when a seed read touched it alone. */
  name?: string;
}
/** A directed derives-from edge: `from` is a source of `to` (i.e. `to` reads `from`). */
export interface GraphEdge {
  from: string;
  to: string;
}
/** A point-in-time snapshot of the dependency topology (structure only). */
export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Lazily-assigned stable ids. A WeakMap (not a field on the node) keeps the hot
 *  node shape + size budget untouched (D#5) and lets a node be GC'd normally — an
 *  id is minted only for the nodes that are actually introspected. */
const nodeIds = new WeakMap<Reactive, string>();
let nodeIdSeq = 0;
function idOf(n: Reactive): string {
  let id = nodeIds.get(n);
  if (id === undefined) nodeIds.set(n, (id = "n" + ++nodeIdSeq));
  return id;
}
const kindOf = (n: Reactive): GraphNode["kind"] => (!n.fn ? "signal" : n.effect ? "effect" : "memo");

/**
 * Read-only structural introspection of the dependency graph (the L0 surface
 * beneath L1 subscribe / L2 explain / L3 speculate — issue #37). Given named seed
 * reads, run each in a throwaway tracking scope to discover the node(s) it reads —
 * leaving NO subscription behind — then walk `sources` transitively to build the
 * derives-from DAG those seeds depend on.
 *
 * The scope is exactly the transitive `sources` closure of the seeds: signals
 * (roots) and memos (interior). Effects are downstream `observers`, not sources,
 * of the seeds, so they never appear — the result is "what the exposed state
 * derives from," matching the privacy boundary a caller has already drawn by
 * choosing which reads to pass. A seed whose read touches exactly one node names
 * that node (the idiomatic `expose(name, memo)` / `() => store.field` form); a
 * composite read's inputs still appear as nodes but back no single name.
 *
 * A snapshot: topology is re-collected on every recompute, so this reflects the
 * committed structure as-of the call. NOT re-exported from the public `pimas`
 * core (see `index.ts`) — `bridge.graph()` is the documented, scoped entry point.
 */
export function introspectGraph(seeds: Iterable<readonly [string, () => unknown]>): DependencyGraph {
  const nodes = new Map<Reactive, GraphNode>();
  const edges: GraphEdge[] = [];

  const visit = (n: Reactive): void => {
    if (nodes.has(n)) return;
    nodes.set(n, { id: idOf(n), kind: kindOf(n) });
    for (const s of n.sources) {
      edges.push({ from: idOf(s), to: idOf(n) });
      visit(s);
    }
  };

  for (const [name, read] of seeds) {
    // Run the accessor in a throwaway observer to discover the node(s) it reads,
    // then unsubscribe the probe so introspection leaves the real graph untouched.
    const probe = makeNode<unknown>(undefined, undefined, false);
    const prevObserver = currentObserver;
    const prevOwner = currentOwner;
    currentObserver = probe;
    currentOwner = null; // the probe owns nothing and is never flushed
    try {
      read();
    } finally {
      currentObserver = prevObserver;
      currentOwner = prevOwner;
    }
    const roots = [...probe.sources];
    removeSources(probe); // leave no trace: drop the probe from every source's observers
    for (const r of roots) {
      visit(r);
      // First name wins (two exposed names may read the same node).
      if (roots.length === 1 && nodes.get(r)!.name === undefined) nodes.get(r)!.name = name;
    }
  }

  return { nodes: [...nodes.values()], edges };
}

/** Read signals inside `fn` without subscribing the current computation. */
export function untrack<T>(fn: () => T): T {
  const prev = currentObserver;
  currentObserver = null;
  try {
    return fn();
  } finally {
    currentObserver = prev;
  }
}

/** Register teardown for the current scope: runs before re-run and on disposal. */
export function onCleanup(fn: () => void): void {
  if (currentOwner) currentOwner.cleanups.push(fn);
}

/**
 * Subscribe to an accessor. `listener` runs immediately and again whenever
 * anything `read` touched changes. Returns an unsubscribe that disposes the
 * underlying effect. The same primitive the React hook and the agent bridge use.
 */
export function subscribe<T>(read: Accessor<T>, listener: (value: T) => void): () => void {
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createEffect(() => listener(read()));
  });
  return dispose;
}

/**
 * A top-level scope that doesn't auto-dispose. Everything created inside is
 * owned by it; call the provided `dispose` to tear it all down at once.
 */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner = makeNode<void>(undefined, undefined, false);
  const prevOwner = currentOwner;
  currentOwner = owner;
  try {
    return fn(() => dispose(owner));
  } finally {
    currentOwner = prevOwner;
  }
}

// ── Error handling ─────────────────────────────────────────────────────────

/** Route `err` to the nearest enclosing boundary above `from`. Rethrows if none. */
function handleError(err: unknown, from: Reactive | null): void {
  for (let node = from; node; node = node.owner) {
    const h = node.errorHandler;
    if (h) {
      const prevOwner = currentOwner, prevObs = currentObserver;
      currentOwner = node.owner;   // run handler at the boundary's PARENT scope,
      currentObserver = null;      // so a rethrow escapes to the NEXT boundary up
      try { h(err); }
      catch (e) { handleError(e, node.owner); }
      finally { currentOwner = prevOwner; currentObserver = prevObs; }
      return;
    }
  }
  throw err;
}

/**
 * Run `tryFn` in a scope carrying `handler`. Any error thrown synchronously by
 * `tryFn`, or later by an effect/memo created inside it, routes to `handler`.
 * If `handler` rethrows, the error propagates to the next enclosing boundary.
 */
export function catchError<T>(tryFn: () => T, handler: (err: unknown) => void): T | undefined {
  const scope = makeNode<void>(undefined, undefined, false);
  scope.errorHandler = handler;
  if (currentOwner) currentOwner.owned.push(scope);
  const prevOwner = currentOwner;
  currentOwner = scope;
  try { return tryFn(); }
  catch (err) { handleError(err, scope); }
  finally { currentOwner = prevOwner; }
  return undefined;
}
