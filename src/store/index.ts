/**
 * pimas/store — a nested reactive store (deep reactive proxy).
 *
 * A plain signal holding an object is coarse: replace the object and *everything*
 * that read any field re-runs. A store is fine-grained at the FIELD level — an
 * effect that read `state.rows[3].status` re-runs only when that exact field
 * changes, nothing else. That's what a data-heavy UI (an editable table, a state
 * machine) needs. Built entirely on the public core (signals + batch) — no kernel
 * change, and headless (no DOM), so the Node-side token engine can use it too.
 *
 * How it works: reading a property lazily creates a per-key "ping" signal and
 * subscribes the current computation to it; a per-object keys-signal tracks
 * `length`/enumeration. The RAW object is the one source of truth; the proxy is a
 * read-only reactive view. Writes go through the setter (`setStore(...path,v)`),
 * which mutates the raw object and pings only the signals for the fields that
 * actually changed — inside a `batch`, so dependent effects flush once.
 *
 * Deferred to v2 (not needed yet): `produce` (mutable draft) and `reconcile`
 * (diff external data in, preserving identity). See DECISIONS.
 */
import { createSignal, batch, getListener, isSpeculating } from "../reactive/index.js";

const $RAW = Symbol("pimas.store.raw");
const $NODES = Symbol("pimas.store.nodes");
// One extra tracking signal per object, pinged when its key set / array length
// changes — so `Object.keys`, `in`, iteration, and `.length` are reactive.
const $KEYS = Symbol("pimas.store.keys");

/** Per-object registry: key → its ping signal (a monotonic counter). */
type Nodes = Record<PropertyKey, ReturnType<typeof createSignal<number>>>;

// Stable proxy per raw object: reading the same nested object twice returns the
// SAME proxy, so identity-keyed reconciliation (<For>) keeps reusing rows.
const proxyCache = new WeakMap<object, unknown>();

function isWrappable(v: unknown): v is Record<PropertyKey, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === Array.prototype || proto === null;
}

/** Get the raw object behind a store proxy (or return `value` if it isn't one). */
export function unwrap<T>(value: T): T {
  return (value != null && (value as { [$RAW]?: T })[$RAW]) || value;
}

function getNodes(target: object): Nodes {
  const existing = (target as { [$NODES]?: Nodes })[$NODES];
  if (existing) return existing;
  const nodes: Nodes = Object.create(null);
  Object.defineProperty(target, $NODES, { value: nodes, configurable: true });
  return nodes;
}

function signalFor(nodes: Nodes, key: PropertyKey) {
  // Store signals outlive any reader's owner: createSignal never registers on the
  // owner tree (only memos/effects do), so these are held solely by `nodes` and
  // live as long as the store. The value is a ping counter; reading it subscribes.
  return nodes[key] || (nodes[key] = createSignal(0));
}

/**
 * Subscribe the current computation to `key`'s ping signal — but ONLY if there
 * is one. A read outside any effect/memo (e.g. an assertion, or SSR where the
 * whole tree renders once) creates no signal, so a large store never allocates
 * per-cell nodes for cells nobody observes.
 */
function track(target: object, key: PropertyKey): void {
  if (getListener()) signalFor(getNodes(target), key)[0]();
}

/** Force-notify subscribers of `key` (monotonic bump — always changes). */
function bump(target: object, key: PropertyKey): void {
  const nodes = (target as { [$NODES]?: Nodes })[$NODES];
  if (nodes && nodes[key]) nodes[key]![1]((c) => c + 1);
}

const traps: ProxyHandler<Record<PropertyKey, unknown>> = {
  get(target, key, receiver) {
    if (key === $RAW) return target;
    if (key === $NODES) return (target as { [$NODES]?: Nodes })[$NODES];
    if (typeof key === "symbol") return Reflect.get(target, key, receiver);
    if (key === "length" && Array.isArray(target)) {
      track(target, $KEYS); // array length rides the keys signal
      return target.length;
    }
    const value = target[key];
    // Methods (array iteration/map/etc.): return as-is. Called with `this` = the
    // proxy, so their internal length/index reads still go through these traps.
    if (typeof value === "function") return value;
    track(target, key);
    return isWrappable(value) ? wrap(value) : value;
  },
  has(target, key) {
    if (key === $RAW || key === $NODES) return true;
    if (typeof key === "symbol") return Reflect.has(target, key);
    track(target, $KEYS);
    return key in target;
  },
  ownKeys(target) {
    track(target, $KEYS);
    return Reflect.ownKeys(target).filter((k) => k !== $NODES);
  },
  getOwnPropertyDescriptor(target, key) {
    if (key === $NODES) return undefined;
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
  set() {
    throw new Error("pimas store is read-only — mutate through the setter (the 2nd tuple element).");
  },
  deleteProperty() {
    throw new Error("pimas store is read-only — mutate through the setter.");
  },
};

function wrap<T extends object>(value: T): T {
  let proxy = proxyCache.get(value) as T | undefined;
  if (!proxy) {
    proxy = new Proxy(value as Record<PropertyKey, unknown>, traps) as T;
    proxyCache.set(value, proxy);
  }
  return proxy;
}

/** Set one field on a raw object and ping exactly the signals that changed. */
function setProperty(state: Record<PropertyKey, unknown>, key: PropertyKey, value: unknown): void {
  if (key === "__proto__") return; // prototype-pollution guard
  const next = unwrap(value);
  if (Object.is(state[key], next)) return; // equality short-circuit — no notify
  const isArray = Array.isArray(state);
  const prevLen = isArray ? (state as unknown[]).length : 0;
  const had = key in state;
  if (next === undefined && !isArray) delete state[key];
  else state[key] = next;
  bump(state, key);
  if (isArray) {
    if ((state as unknown[]).length !== prevLen) bump(state, $KEYS);
  } else if (had !== key in state) {
    bump(state, $KEYS); // key added or removed → enumeration changed
  }
}

/** Walk `[...keys, value]`: navigate by the keys, apply `value` at the leaf. */
function updatePath(current: Record<PropertyKey, unknown>, path: unknown[]): void {
  if (path.length === 1) {
    // Merge a partial object (or updater→partial) into `current`.
    let value = path[0];
    if (typeof value === "function") value = (value as (c: unknown) => unknown)(current);
    if (value && typeof value === "object") {
      for (const k of Object.keys(value as object)) {
        setProperty(current, k, (value as Record<string, unknown>)[k]);
      }
    }
    return;
  }
  const key = path[0] as PropertyKey;
  if (path.length === 2) {
    let value = path[1];
    if (typeof value === "function") value = (value as (p: unknown) => unknown)(current[key]);
    setProperty(current, key, value);
    return;
  }
  updatePath(current[key] as Record<PropertyKey, unknown>, path.slice(1));
}

export type Store<T> = T;

export interface SetStoreFunction<T> {
  (value: Partial<T> | ((prev: T) => Partial<T> | void)): void;
  <K extends keyof T>(key: K, value: T[K] | ((prev: T[K]) => T[K])): void;
  <K1 extends keyof T, K2 extends keyof T[K1]>(
    k1: K1,
    k2: K2,
    value: T[K1][K2] | ((prev: T[K1][K2]) => T[K1][K2]),
  ): void;
  /** Deeper paths (escape hatch, loosely typed). */
  (...path: [PropertyKey, ...PropertyKey[], unknown]): void;
}

/**
 * Create a reactive store. Returns a read-only reactive proxy and a setter:
 *
 *   const [state, setState] = createStore({ user: { name: "Ada" }, rows: [] });
 *   state.user.name;                      // read (fine-grained subscribe)
 *   setState("user", "name", "Grace");    // path set — only name's readers re-run
 *   setState("rows", (r) => [...r, row]); // updater — replaces the array
 *   setState({ loading: false });         // merge a partial at the root
 */
export function createStore<T extends object>(init: T): [Store<T>, SetStoreFunction<T>] {
  const raw = unwrap(init);
  const proxy = wrap(raw);
  const setStore = (...args: unknown[]): void => {
    // A store write mutates the RAW object directly, so it can't ride the L3
    // shadow (#13) — reject it until copy-on-write lands. Reads during
    // speculation are fine (they return the real committed data).
    if (isSpeculating())
      throw new Error("pimas store: writes inside speculate() aren't supported yet (copy-on-write is a later layer)");
    batch(() => updatePath(raw as Record<PropertyKey, unknown>, args));
  };
  return [proxy, setStore as SetStoreFunction<T>];
}
