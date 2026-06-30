/**
 * Pimas — reactive core
 * ----------------------
 * Fine-grained reactivity in ~200 lines. No virtual DOM, no diffing.
 *
 * The whole system rests on one idea: a single global pointer to "the
 * computation currently running". When you READ a signal, it records that
 * running computation as a subscriber. When you WRITE a signal, it re-runs
 * every computation that read it. Because reads are tracked individually,
 * a change only re-runs the exact computations that depend on it — that is
 * what "fine-grained" means.
 *
 * Built on top of this file:
 *   - createSignal : a reactive value            (read/write)
 *   - createEffect : a side effect that re-runs   (the subscriber)
 *   - createMemo   : a derived, cached value       (effect + signal)
 *   - batch        : coalesce many writes into one flush
 *   - untrack      : read without subscribing
 *   - createRoot   : an ownership scope you can dispose
 *   - onCleanup    : run teardown before a re-run / on disposal
 */

// ── Module-global state ──────────────────────────────────────────────────

/**
 * The computation currently executing. While an effect/memo runs, this points
 * at it so signal reads can wire up the dependency. `null` outside any
 * computation (or inside `untrack`).
 */
let currentObserver: Computation | null = null;

/**
 * The current ownership scope. A computation created while another is running
 * (or inside a `createRoot`) is "owned" by it, so disposing the parent
 * disposes the children. This is what stops nested effects from leaking.
 */
let currentOwner: Owner | null = null;

/**
 * Batching depth. While > 0, signal writes queue their subscribers into
 * `pending` instead of running them immediately; the outermost `batch` runs
 * them once on exit. A burst of N writes then triggers one flush, not N.
 */
let batchDepth = 0;
const pending = new Set<Computation>();

// ── Types ────────────────────────────────────────────────────────────────

export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((prev: T) => T)) => T;
export type Signal<T> = [get: Accessor<T>, set: Setter<T>];

/** A scope that owns child computations and teardown callbacks. */
export interface Owner {
  owned: Computation[];
  cleanups: Array<() => void>;
}

interface Computation extends Owner {
  /** Re-run this computation: tear down, then evaluate while tracked. */
  execute: () => void;
  /**
   * Every signal subscriber-set this computation currently belongs to. We keep
   * back-references so that before each re-run we can remove ourselves from
   * the signals we read last time — otherwise stale dependencies pile up and a
   * computation keeps re-running for values it no longer reads.
   */
  sources: Set<Set<Computation>>;
}

// ── Teardown ───────────────────────────────────────────────────────────────

/** Dispose owned children (depth-first) and run cleanup callbacks. */
function cleanupNode(node: Owner): void {
  for (const child of node.owned) disposeComputation(child);
  node.owned.length = 0;
  // Run user cleanups in reverse registration order (like nested scopes).
  for (let i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]!();
  node.cleanups.length = 0;
}

/** Fully tear down a computation: children, cleanups, and signal links. */
function disposeComputation(c: Computation): void {
  cleanupNode(c);
  for (const subscribers of c.sources) subscribers.delete(c);
  c.sources.clear();
}

// ── Primitives ───────────────────────────────────────────────────────────

/**
 * A reactive value. Returns `[read, write]`.
 *   const [count, setCount] = createSignal(0)
 *   count()        // read  — subscribes the running computation
 *   setCount(1)    // write — re-runs subscribers
 *   setCount(n => n + 1)  // functional update
 */
export function createSignal<T>(initial: T): Signal<T> {
  const subscribers = new Set<Computation>();
  let value = initial;

  const read: Accessor<T> = () => {
    if (currentObserver) {
      // Two-way link: signal knows its subscriber, subscriber knows its source.
      subscribers.add(currentObserver);
      currentObserver.sources.add(subscribers);
    }
    return value;
  };

  const write: Setter<T> = (next) => {
    const newValue =
      typeof next === "function" ? (next as (p: T) => T)(value) : next;

    // Skip the whole notification if nothing actually changed.
    if (Object.is(newValue, value)) return value;
    value = newValue;

    // Snapshot first: a subscriber re-running will re-subscribe and mutate
    // this set, which would corrupt a live iteration.
    for (const sub of [...subscribers]) {
      if (batchDepth > 0) pending.add(sub);
      else sub.execute();
    }
    return value;
  };

  return [read, write];
}

/**
 * Run `fn` now, and again whenever any signal it read changes. Dependencies
 * are re-collected on every run, so conditional branches subscribe only to
 * the signals actually touched this time.
 */
export function createEffect(fn: () => void): void {
  const computation: Computation = {
    execute() {
      // Clear last run's deps + child scopes before re-tracking.
      disposeComputation(computation);
      const prevObserver = currentObserver;
      const prevOwner = currentOwner;
      currentObserver = computation;
      currentOwner = computation;
      try {
        fn();
      } finally {
        currentObserver = prevObserver;
        currentOwner = prevOwner;
      }
    },
    sources: new Set(),
    owned: [],
    cleanups: [],
  };

  // Attach to the enclosing scope so it can be disposed with its parent.
  if (currentOwner) currentOwner.owned.push(computation);
  computation.execute();
}

/**
 * A derived value that recomputes when its dependencies change and caches the
 * result. Reading the memo subscribes you to it like any other signal.
 *
 * Note (v1): this is the eager implementation — the memo recomputes as soon as
 * a dependency changes, not lazily on read. Simple and correct; a lazy/pull
 * memo (which also fixes "diamond" glitches) is a Phase 5 optimization.
 */
export function createMemo<T>(fn: () => T): Accessor<T> {
  const [get, set] = createSignal<T>(undefined as T);
  createEffect(() => set(fn()));
  return get;
}

/**
 * Group multiple writes so subscribers run once, after `fn` returns, instead
 * of after each write. Nested batches join the outermost one.
 */
export function batch<T>(fn: () => T): T {
  if (batchDepth > 0) return fn(); // already inside a batch
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    const toRun = [...pending];
    pending.clear();
    for (const c of toRun) c.execute();
  }
}

/**
 * Read signals inside `fn` WITHOUT subscribing the current computation to
 * them. Useful when you want a value but don't want changes to it to re-run
 * you.
 */
export function untrack<T>(fn: () => T): T {
  const prev = currentObserver;
  currentObserver = null;
  try {
    return fn();
  } finally {
    currentObserver = prev;
  }
}

/**
 * Register a teardown callback for the current scope. It runs right before the
 * owning computation re-executes, and when the scope is disposed. Use it to
 * clean up timers, listeners, subscriptions, etc.
 */
export function onCleanup(fn: () => void): void {
  if (currentOwner) currentOwner.cleanups.push(fn);
}

/**
 * Create a top-level reactive scope that does NOT auto-dispose. Everything
 * created inside is owned by it; call the provided `dispose` to tear it all
 * down at once. This is the root you mount an app under.
 *
 *   const dispose = createRoot(dispose => { ...build UI...; return dispose })
 *   // later: dispose()
 */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner: Computation = {
    execute() {}, // a root never re-runs; it only owns
    sources: new Set(),
    owned: [],
    cleanups: [],
  };
  const prevOwner = currentOwner;
  currentOwner = owner;
  const dispose = () => disposeComputation(owner);
  try {
    return fn(dispose);
  } finally {
    currentOwner = prevOwner;
  }
}
