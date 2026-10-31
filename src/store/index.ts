/** Nested reactive store: a deep proxy tracking reads per field, with `produce` and `reconcile` updaters. */
import { createSignal, batch, getListener, speculationScratch } from "../reactive/index.js";

const $RAW = Symbol("pimas.store.raw");
const $NODES = Symbol("pimas.store.nodes");
// Tags an in-place updater (reconcile/produce): the setter runs its `apply` instead of replacing the target.
const $UPDATER = Symbol("pimas.store.updater");
// Sentinel `key` meaning "the parent object itself" — a root-level updater.
const ROOT = Symbol("pimas.store.root");
// Per-object signal pinged when its key set / array length changes (keys, `in`, iteration, `.length`).
const $KEYS = Symbol("pimas.store.keys");

/** Per-object registry: key → its ping signal (a monotonic counter). */
type Nodes = Record<PropertyKey, ReturnType<typeof createSignal<number>>>;

// ── L2 provenance (#13): observe committed writes by path ────────────────────
export interface StoreWriteEvent {
  /** The path written, e.g. `["rows", 3, "status"]`. */
  path: PropertyKey[];
}
const writeListeners = new Set<(e: StoreWriteEvent) => void>();

/** Subscribe to committed store write paths (speculative writes are silent); returns an unsubscribe. */
export function onStoreWrite(fn: (e: StoreWriteEvent) => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

// Stable proxy per raw object: reading a nested object twice returns the SAME proxy.
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
  // See AGENTS.d/220-store-signals-outlive-their-readers-owner.md
  return nodes[key] || (nodes[key] = createSignal(0));
}

/** Subscribe the current computation to `key`'s ping signal, only if one is listening — see AGENTS.d/210-a-store-read-outside-a-reactive-scope-creates-no-signal.md */
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
    if (typeof value === "function") return value; // array methods run with `this` = proxy, re-entering these traps
    track(target, key);
    // Speculation shadow wins over raw — see AGENTS.d/230-a-write-during-speculate-goes-to-the-scratch-never-the-raw-object.md
    const scratch = speculationScratch();
    if (scratch) {
      const shadow = scratch.get(target) as Map<PropertyKey, unknown> | undefined;
      if (shadow && shadow.has(key)) {
        const ov = shadow.get(key);
        return isWrappable(ov) ? wrap(ov) : ov;
      }
    }
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
  if (key === "__proto__") return; // prototype-pollution guard — see AGENTS.d/260-setproperty-must-refuse-the-proto-key.md
  const next = unwrap(value);
  // Speculative write: scratch only — see AGENTS.d/230-a-write-during-speculate-goes-to-the-scratch-never-the-raw-object.md
  const scratch = speculationScratch();
  if (scratch) {
    let shadow = scratch.get(state) as Map<PropertyKey, unknown> | undefined;
    if (!shadow) scratch.set(state, (shadow = new Map()));
    shadow.set(key, next);
    return;
  }
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

// ── in-place updaters: reconcile + produce (#5) ──────────────────────────────

/** Applies an in-place update to `parent[key]` (or `parent` itself for ROOT). */
type StoreUpdater = (parent: Record<PropertyKey, unknown>, key: PropertyKey | typeof ROOT) => void;

/** The updater tag on a value, if any; `produce` tags a function and `reconcile` an object, so check both. */
function updaterTag(v: unknown): StoreUpdater | undefined {
  return v && (typeof v === "object" || typeof v === "function")
    ? (v as { [$UPDATER]?: StoreUpdater })[$UPDATER]
    : undefined;
}

/** Resolve an updater's target: the parent itself (ROOT) or `parent[key]`. */
function updaterTarget(parent: Record<PropertyKey, unknown>, key: PropertyKey | typeof ROOT): unknown {
  return key === ROOT ? parent : parent[key];
}

/** Read a raw field through the speculation scratch (no tracking), returning RAW unwrapped values. */
function readField(target: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
  const scratch = speculationScratch();
  if (scratch) {
    const shadow = scratch.get(target) as Map<PropertyKey, unknown> | undefined;
    if (shadow && shadow.has(key)) return shadow.get(key);
  }
  return target[key];
}

/** Both wrappable and the same shape (both arrays, or both plain objects). */
function sameShape(a: unknown, b: unknown): boolean {
  return isWrappable(a) && isWrappable(b) && Array.isArray(a) === Array.isArray(b);
}

/** Diff `next` into the raw object `prev`, mutating in place through setProperty. */
function applyReconcile(prev: Record<PropertyKey, unknown>, next: unknown, keyName: string | null): void {
  const n = unwrap(next);
  if (Array.isArray(prev) && Array.isArray(n)) reconcileArray(prev as unknown[], n, keyName);
  else reconcileObject(prev, n as Record<PropertyKey, unknown>, keyName);
}

function reconcileObject(prev: Record<PropertyKey, unknown>, next: Record<PropertyKey, unknown>, keyName: string | null): void {
  for (const k of Object.keys(next)) {
    const nv = unwrap(next[k]);
    const pv = readField(prev, k);
    // Recurse into a same-shaped child to keep its identity; otherwise a plain field write.
    if (sameShape(pv, nv)) applyReconcile(pv as Record<PropertyKey, unknown>, nv, keyName);
    else setProperty(prev, k, nv);
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) setProperty(prev, k, undefined);
  }
}

function reconcileArray(prevArr: unknown[], next: unknown[], keyName: string | null): void {
  const prev = prevArr as unknown as Record<PropertyKey, unknown>; // setProperty/readField view
  // Snapshot key → row BEFORE mutating — see AGENTS.d/240-reconcile-snapshots-key-to-row-before-mutating.md
  const byKey = new Map<unknown, Record<PropertyKey, unknown>>();
  if (keyName !== null) {
    for (let i = 0; i < prevArr.length; i++) {
      const row = readField(prev, i);
      if (isWrappable(row)) byKey.set(row[keyName], row);
    }
  }

  let structural = prevArr.length !== next.length;

  for (let j = 0; j < next.length; j++) {
    const nItem = unwrap(next[j]);
    const match = keyName !== null && isWrappable(nItem) ? byKey.get(nItem[keyName]) : undefined;
    if (match !== undefined) {
      byKey.delete((nItem as Record<PropertyKey, unknown>)[keyName!]); // consume — a duplicate key falls through to a fresh row
      applyReconcile(match, nItem, keyName); // update the SAME row's fields in place
      if (readField(prev, j) !== match) {
        setProperty(prev, j, match); // move to slot j (same ref → proxy kept)
        structural = true;
      }
    } else {
      setProperty(prev, j, nItem);
      structural = true;
    }
  }

  if (prevArr.length !== next.length) setProperty(prev, "length", next.length);

  // See AGENTS.d/250-a-same-length-reorder-must-ping-keys-explicitly.md
  if (structural && prevArr.length === next.length) bump(prevArr, $KEYS);
}

/** Walk `[...keys, value]`: navigate by the keys, apply `value` at the leaf. */
function updatePath(current: Record<PropertyKey, unknown>, path: unknown[]): void {
  if (path.length > 2) {
    updatePath(current[path[0] as PropertyKey] as Record<PropertyKey, unknown>, path.slice(1));
    return;
  }
  const root = path.length === 1;
  const key = root ? ROOT : (path[0] as PropertyKey);
  let value = path[path.length - 1];
  const u = updaterTag(value);
  if (u) {
    u(current, key);
    return;
  }
  if (typeof value === "function") {
    value = (value as (p: unknown) => unknown)(root ? current : current[key as string]);
  }
  if (!root) {
    setProperty(current, key, value);
  } else if (value && typeof value === "object") {
    // Merge a partial object (or updater→partial) into `current`.
    for (const k of Object.keys(value as object)) {
      setProperty(current, k, (value as Record<string, unknown>)[k]);
    }
  }
}

/** Diff `next` into a store in place, matching rows by `key` (default "id", null = positional) and keeping object identity; pass it where the setter takes a value. */
export function reconcile<T>(next: T, options?: { key?: string | null }): T {
  const key = options && "key" in options ? (options.key ?? null) : "id";
  const n = unwrap(next);
  // A ROOT target can't be replaced, only diffed.
  const apply: StoreUpdater = (parent, k) => {
    const prev = updaterTarget(parent, k);
    if (sameShape(prev, n)) applyReconcile(prev as Record<PropertyKey, unknown>, n, key);
    else if (k !== ROOT) setProperty(parent, k, n);
  };
  return { [$UPDATER]: apply } as unknown as T;
}

// Writable draft view: every write routes through setProperty; reads never track().
const draftTraps: ProxyHandler<Record<PropertyKey, unknown>> = {
  get(target, key) {
    if (key === $RAW) return target; // so unwrap(draft) resolves to the raw object
    if (typeof key === "symbol") return Reflect.get(target, key);
    const value = readField(target, key); // scratch-aware, no track
    if (typeof value === "function") return value;
    return isWrappable(value) ? wrapDraft(value) : value;
  },
  set(target, key, value) {
    setProperty(target, key, value);
    return true;
  },
  deleteProperty(target, key) {
    setProperty(target, key, undefined);
    return true;
  },
};

function wrapDraft<T extends object>(value: T): T {
  return new Proxy(value as Record<PropertyKey, unknown>, draftTraps) as T;
}

/** Immer-style mutable-draft updater; reorder with `reconcile` instead (AGENTS.d/250), and never retain the draft past `fn`. */
export function produce<T>(fn: (draft: T) => void): (prev: T) => T {
  const apply: StoreUpdater = (parent, k) => {
    const prev = updaterTarget(parent, k);
    if (isWrappable(prev)) fn(wrapDraft(prev) as unknown as T);
    else throw new Error(`pimas store: produce() target at "${String(k)}" is not an object.`);
  };
  // Tagged function so `T` infers from the setter slot; updatePath runs `apply`, never this body.
  const tagged = (((prev: T) => prev) as ((prev: T) => T) & { [$UPDATER]: StoreUpdater });
  tagged[$UPDATER] = apply;
  return tagged;
}

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

/** Create a reactive store: a read-only reactive proxy plus a path/updater/partial setter. */
export function createStore<T extends object>(init: T): [T, SetStoreFunction<T>] {
  const raw = unwrap(init);
  const proxy = wrap(raw);
  const setStore = (...args: unknown[]): void => {
    batch(() => updatePath(raw as Record<PropertyKey, unknown>, args));
    // Speculative writes land in the scratch, so the !speculationScratch() guard keeps listeners silent.
    if (writeListeners.size && !speculationScratch() && args.length >= 2) {
      const path = args.slice(0, -1) as PropertyKey[];
      for (const l of writeListeners) l({ path });
    }
  };
  return [proxy, setStore as SetStoreFunction<T>];
}
