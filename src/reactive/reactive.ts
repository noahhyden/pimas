/** Fine-grained push-pull reactive core: writes mark (PUSH), reads and effect flushes recompute (PULL) — see AGENTS.d/100-a-memo-is-lazy-and-an-effect-is-eager.md. */

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
/** A custom flush scheduler, or `null` for the synchronous default — see AGENTS.d/140-the-default-scheduler-is-synchronous.md. */
let scheduler: ((flush: () => void) => void) | null = null;
/** Latch: a deferred flush is already queued for this scheduler turn. */
let scheduled = false;
/** Non-null while a `speculate(...)` is running; reads/writes route through it and the real graph is never touched. */
let speculating: {
  read<T>(n: Reactive<T>): T;
  write<T>(n: Reactive<T>, v: T): T;
  /** Rollback-scoped scratchpad for userland primitives (e.g. store copy-on-write). */
  scratch: Map<unknown, unknown>;
} | null = null;

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
  if (Object.is(node.value as T, next)) return node.value as T; // no-op on equal
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
    if (!Object.is(node.value as T, next)) {
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

/** Flush now, or hand the drain to the custom scheduler — see AGENTS.d/120-the-flush-latch-clears-before-the-drain.md. */
function requestFlush(): void {
  if (!scheduler) return flushEffects();
  if (scheduled) return;
  scheduled = true;
  scheduler(flushScheduled);
}

/** The shared drain a custom scheduler runs; clears the latch before draining. */
function flushScheduled(): void {
  scheduled = false;
  flushEffects();
}

/** Install a custom flush scheduler (e.g. `queueMicrotask`); pass nothing to restore the synchronous default, returns the previous one. */
export function setScheduler(
  fn?: ((flush: () => void) => void) | null,
): ((flush: () => void) => void) | null {
  const prev = scheduler;
  scheduler = fn ?? null;
  return prev;
}

/** Drain queued effects now regardless of the scheduler, clearing the latch so a dropped callback can't wedge flushing. */
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

/** A reactive value: `count()` reads and subscribes, `setCount(v)` or `setCount(n => n + 1)` writes. */
export function createSignal<T>(initial: T): Signal<T> {
  const node = makeNode<T>(undefined, initial, false);
  const read: Accessor<T> = () => readNode(node);
  const write: Setter<T> = (next) =>
    writeNode(node, typeof next === "function" ? (next as (p: T) => T)(node.value as T) : next);
  return [read, write];
}

/** A cached derived value; lazy, computes on first read and recomputes only when a dependency truly changes. */
export function createMemo<T>(fn: () => T): Accessor<T> {
  const node = makeNode<T>(fn, undefined, false);
  if (currentOwner) currentOwner.owned.push(node);
  return () => readNode(node);
}

/** Run `fn` now and again whenever a signal it read changes; dependencies are re-collected each run. */
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

/** The computation currently tracking, or null outside any effect/memo; an opaque handle, treat it as truthy/falsy. */
export function getListener(): unknown {
  return currentObserver;
}

/** The current speculation's rollback-scoped scratchpad, or null when not speculating. */
export function speculationScratch(): Map<unknown, unknown> | null {
  return speculating ? speculating.scratch : null;
}

/** Apply hypothetical writes in `apply`, return `read()` against a shadow graph: no real mutation, no effects, rolled back on exit; no nesting. */
export function speculate<T>(apply: () => void, read: () => T): T {
  if (speculating) throw new Error("speculate: no nested speculation yet");
  const values = new Map<Reactive, unknown>();
  // Shadow read: hypothetical value, else a detached memoized memo recompute, else the real value — see AGENTS.d/130-speculate-detaches-the-observer-and-owner.md
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

/** A node of the dependency graph as a plain read-only shape, never the raw `Reactive`. */
export interface GraphNode {
  /** Stable for a node's lifetime (lazily assigned on first introspection). */
  id: string;
  /** `signal` = a source with no dependencies; `memo` = a derived value. */
  kind: "signal" | "memo";
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

/** Lazily-assigned stable ids in a WeakMap, so the hot node shape stays untouched. */
const nodeIds = new WeakMap<Reactive, string>();
let nodeIdSeq = 0;
function idOf(n: Reactive): string {
  let id = nodeIds.get(n);
  if (id === undefined) nodeIds.set(n, (id = "n" + ++nodeIdSeq));
  return id;
}
const kindOf = (n: Reactive): GraphNode["kind"] => (n.fn ? "memo" : "signal");

/** Snapshot the derives-from DAG (signals and memos only, never effects) behind named seed reads, leaving no subscription; not public, use `bridge.graph()`. */
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

/** Run `listener` now and whenever anything `read` touched changes; returns an unsubscribe. */
export function subscribe<T>(read: Accessor<T>, listener: (value: T) => void): () => void {
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createEffect(() => listener(read()));
  });
  return dispose;
}

/** A top-level scope that never auto-disposes; call the provided `dispose` to tear down everything created inside. */
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
      currentOwner = node.owner;   // PARENT scope — see AGENTS.d/110-handleerror-runs-the-handler-at-the-boundarys-parent-scope.md
      currentObserver = null;
      try { h(err); }
      catch (e) { handleError(e, node.owner); }
      finally { currentOwner = prevOwner; currentObserver = prevObs; }
      return;
    }
  }
  throw err;
}

/** Run `tryFn` in a scope whose `handler` receives errors from `tryFn` and the effects/memos created inside it; a rethrow goes to the next boundary up. */
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
