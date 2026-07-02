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
 * v2 `reconcile` (#5): diff external data into the store preserving object
 * identity (matched by key) so a server-refreshed keyed list reuses row proxies
 * and keeps keyed `<For>` stable — see `reconcile` below. `produce` (mutable
 * draft) is still deferred (sugar only). See DECISIONS.
 */
import { createSignal, batch, getListener, speculationScratch } from "../reactive/index.js";

const $RAW = Symbol("pimas.store.raw");
const $NODES = Symbol("pimas.store.nodes");
// Tags a `reconcile(next)` updater so the setter diffs-in-place instead of
// replacing the reference (which would re-mint every proxy and rebuild <For>).
const $RECONCILE = Symbol("pimas.store.reconcile");
// One extra tracking signal per object, pinged when its key set / array length
// changes — so `Object.keys`, `in`, iteration, and `.length` are reactive.
const $KEYS = Symbol("pimas.store.keys");

/** Per-object registry: key → its ping signal (a monotonic counter). */
type Nodes = Record<PropertyKey, ReturnType<typeof createSignal<number>>>;

// ── L2 provenance (#13): observe committed writes by path ────────────────────
export interface StoreWriteEvent {
  /** The path written, e.g. `["rows", 3, "status"]`. */
  path: PropertyKey[];
}
const writeListeners = new Set<(e: StoreWriteEvent) => void>();

/**
 * Subscribe to committed store writes — the write PATH. Feeds L2 causal
 * provenance ("`total` changed because a write hit `rows.3.status`"). Only REAL
 * writes fire; speculation (#13) is silent. Returns an unsubscribe.
 */
export function onStoreWrite(fn: (e: StoreWriteEvent) => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

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
    // L3 copy-on-write (#13): during speculation, a hypothetical edit lives in
    // the rollback-scoped scratch, never in the raw object — return it here so
    // derived memos recompute against the what-if without committing anything.
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
  if (key === "__proto__") return; // prototype-pollution guard
  const next = unwrap(value);
  // L3 copy-on-write (#13): a write while speculating goes to the rollback-scoped
  // scratch, NOT the raw object — the real store is never mutated by a what-if.
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

// ── reconcile (#5): diff external data in, preserving row identity ────────────

interface ReconcileConfig {
  /** Unwrapped replacement value (used for the shape check + plain-replace fallback). */
  next: unknown;
  /** Diff `next` into `prev` in place. A CLOSURE so the walkers below are pulled
   *  into the bundle only when `reconcile` is actually imported — a createStore
   *  consumer that never reconciles pays nothing (tree-shaken, like speculate). */
  run: (prev: Record<PropertyKey, unknown>) => void;
}

/** The reconcile tag on a value, if any. */
function reconcileTag(v: unknown): ReconcileConfig | undefined {
  return v && typeof v === "object" ? (v as { [$RECONCILE]?: ReconcileConfig })[$RECONCILE] : undefined;
}

/**
 * Read a raw field, honoring the speculation scratch (mirrors the get trap) so
 * a reconcile that runs during `speculate` diffs against the what-if, not the
 * committed raw. Returns RAW values (scratch stores unwrapped), so the walkers
 * can recurse into raw children and reuse their cached proxies.
 */
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
    // Recurse into a same-shaped child to preserve its proxy identity; otherwise
    // a plain field write (which self-dedups + fine-grained-notifies).
    if (sameShape(pv, nv)) applyReconcile(pv as Record<PropertyKey, unknown>, nv, keyName);
    else setProperty(prev, k, nv);
  }
  // Delete keys absent from `next` (routes through setProperty → pings $KEYS).
  for (const k of Object.keys(prev)) {
    if (!(k in next)) setProperty(prev, k, undefined);
  }
}

function reconcileArray(prevArr: unknown[], next: unknown[], keyName: string | null): void {
  const prev = prevArr as unknown as Record<PropertyKey, unknown>; // setProperty/readField view
  // Snapshot key → existing RAW row BEFORE mutating, so matched rows keep their
  // reference (hence their cached proxy, hence their <For> DOM row).
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
      // Genuinely new row: a fresh raw object → new proxy → <For> builds a new DOM row.
      setProperty(prev, j, nItem);
      structural = true;
    }
  }

  // Truncate a shrunk tail (removed rows' <For> scopes dispose via onCleanup).
  if (prevArr.length !== next.length) setProperty(prev, "length", next.length);

  // A same-length reorder/swap bumps only per-index nodes (which <For> doesn't
  // track); ping $KEYS so <For> re-diffs and MOVES surviving rows (not rebuild).
  if (structural && prevArr.length === next.length) bump(prevArr, $KEYS);
}

/** Walk `[...keys, value]`: navigate by the keys, apply `value` at the leaf. */
function updatePath(current: Record<PropertyKey, unknown>, path: unknown[]): void {
  if (path.length === 1) {
    let value = path[0];
    // A root reconcile: diff `next` into the root object in place.
    const rc = reconcileTag(value);
    if (rc) {
      if (sameShape(current, rc.next)) rc.run(current);
      return;
    }
    // Merge a partial object (or updater→partial) into `current`.
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
    // A keyed reconcile: diff `next` into current[key] in place (else replace).
    const rc = reconcileTag(value);
    if (rc) {
      const prev = current[key];
      if (sameShape(prev, rc.next)) rc.run(prev as Record<PropertyKey, unknown>);
      else setProperty(current, key, rc.next);
      return;
    }
    if (typeof value === "function") value = (value as (p: unknown) => unknown)(current[key]);
    setProperty(current, key, value);
    return;
  }
  updatePath(current[key] as Record<PropertyKey, unknown>, path.slice(1));
}

/**
 * Diff `next` into a store in place, preserving object identity so keyed `<For>`
 * rows are reused, not rebuilt. Pass the result to the setter where a value goes:
 *
 *   setStore("rows", reconcile(freshRows));       // rows matched by `id` (default)
 *   setStore("rows", reconcile(freshRows, { key: "sku" }));
 *   setStore(reconcile(freshWholeState));         // reconcile the root object
 *
 * Array rows with the same key are mutated field-by-field through the fine-grained
 * setter (only changed fields notify; unchanged rows stay silent), moved on
 * reorder, and added/removed on membership change. Nested objects/arrays recurse.
 * `key: null` opts out of identity matching (positional replace). It is a
 * COMMIT-time operation — not intended for use inside `speculate`.
 */
export function reconcile<T>(next: T, options?: { key?: string | null }): T {
  const key = options && "key" in options ? (options.key ?? null) : "id";
  const n = unwrap(next);
  const cfg: ReconcileConfig = { next: n, run: (prev) => applyReconcile(prev, n, key) };
  return { [$RECONCILE]: cfg } as unknown as T;
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
    batch(() => updatePath(raw as Record<PropertyKey, unknown>, args));
    // L2 (#13): announce the committed write path. A speculative write records
    // into the scratch (setProperty) and never reaches here as a real change —
    // so speculation stays silent to provenance listeners.
    if (writeListeners.size && !speculationScratch() && args.length >= 2) {
      const path = args.slice(0, -1) as PropertyKey[];
      for (const l of writeListeners) l({ path });
    }
  };
  return [proxy, setStore as SetStoreFunction<T>];
}
