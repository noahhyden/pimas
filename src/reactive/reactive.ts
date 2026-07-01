/**
 * Pimas — reactive core (push-pull, glitch-free).
 * ------------------------------------------------
 * Fine-grained reactivity. Reading a signal subscribes the running computation;
 * writing it re-runs only the computations that depend on it. But propagation is
 * NOT eager — it's a two-phase push-pull, which makes it glitch-free:
 *
 *   PUSH (on write): mark dependents without computing anything. Direct
 *     dependents become DIRTY ("a source definitely changed"); everything
 *     transitively below becomes CHECK ("a source *might* have changed").
 *   PULL (on read / effect flush): `updateIfNecessary` walks a CHECK node's
 *     sources first; it recomputes only if a source actually changed value.
 *
 * In a diamond (D = B + C, B = C = A+1), writing A recomputes D exactly once,
 * after both B and C are current — no transient wrong value, no double-run. An
 * equality short-circuit (a recompute that yields the same value stops there)
 * kills cascades. Memos are LAZY (compute on read); effects are EAGER (the roots
 * that drive the pull). Algorithm after Milo Hansen's "Reactively".
 */

// Type-only (erased at build — no runtime coupling to the DOM layer). Context's
// Provider is a JSX component, so its return must be the renderer's Child type;
// `flow` imports it the same way. The reactive core ships zero DOM code.
import type { Child } from "../dom/engine.js";

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
  /** Context values provided at this scope, keyed by context id. Lazily created
   *  — only `<Provider>` nodes carry one, so plain signals/effects pay nothing. */
  context?: Record<symbol, unknown>;
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
  if (node.equals(node.value as T, next)) return node.value as T; // no-op on equal
  node.value = next;
  // PUSH: mark direct dependents DIRTY (transitive ones become CHECK).
  for (const o of node.observers) stale(o, DIRTY);
  if (batchDepth === 0) flushEffects();
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
    flushEffects();
  }
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

// ── Context ──────────────────────────────────────────────────────────────────

/**
 * A context: a value any descendant can read without prop-drilling. Created by
 * `createContext`; provided by `ctx.Provider`; read by `useContext(ctx)`.
 *
 * Context rides the OWNER tree (#10), not the DOM tree — so it survives portals
 * and (later) serialization. `useContext` walks the owner chain upward to the
 * nearest provider; absent one, it returns the context's default.
 */
export interface Context<T> {
  /** Unique key under which this context's value is stored on a provider node. */
  readonly id: symbol;
  /** Value `useContext` returns when no provider is found above the reader. */
  readonly defaultValue: T;
  /** Component that supplies `value` to everything in its `children` subtree. */
  Provider: (props: { value: T; children: Child }) => Child;
}

export function createContext<T>(defaultValue: T): Context<T>;
export function createContext<T>(): Context<T | undefined>;
export function createContext<T>(defaultValue?: T): Context<T | undefined> {
  const id = Symbol("pimas.context");
  return {
    id,
    defaultValue,
    Provider(props) {
      // A memo gives us a fresh OWNER scope (like Show/Switch): the value is
      // stamped on that scope's node, and children are built *inside* it, so
      // their owner chain runs through here and `useContext` finds the value.
      // NOTE (pre-compiler): children must be a THUNK — `{() => <App/>}` — or
      // they'd be evaluated before this scope exists (same rule as <Show>).
      return createMemo(() => {
        (currentOwner!.context ??= {})[id] = props.value;
        return typeof props.children === "function"
          ? (props.children as () => Child)()
          : props.children;
      });
    },
  };
}

/**
 * Read the nearest provided value for `context`, or its default if no
 * `ctx.Provider` sits above the current owner. Call it during a component's
 * setup (synchronously), so `currentOwner` points into the provider's subtree.
 */
export function useContext<T>(context: Context<T>): T {
  for (let node = currentOwner; node; node = node.owner) {
    const ctx = node.context;
    if (ctx && context.id in ctx) return ctx[context.id] as T;
  }
  return context.defaultValue;
}
