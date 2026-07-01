/**
 * The renderer engine — backend-agnostic.
 *
 * The engine knows the *conventions* (thunks are dynamic, `on*` is an event,
 * `ref`, `class`/`style`, fragments, child insertion) but nothing about the DOM.
 * Every concrete operation goes through a `RenderBackend`. The DOM backend makes
 * real nodes; a string backend (pimas/server) serializes to HTML — the SAME
 * component code runs against either, which is what makes SSR additive.
 */
import { createRoot, untrack } from "../reactive/index.js";

/** Opaque to the engine; each backend defines its own node representation. */
type BNode = any;

/**
 * The host-config contract a backend implements. A fine-grained renderer needs
 * no diff/patch — only "create nodes" + "run a binding". `effect` is the seam
 * that separates live (DOM, persistent, reactive) from run-once (SSR).
 */
/** A plain event handler — the closure form (works today, always). */
export type EventHandler<E = any> = (event: E) => void;

/**
 * A handler as an addressable, serializable REFERENCE rather than a live closure.
 * The seam accepts this now (DECISIONS #30) but only the synchronous `load()`
 * path is implemented; the rest is reserved so resumability is additive later:
 *  - `ref`     a stable, build-assignable symbol id (for `on:<type>="ref#…"` HTML)
 *  - `load`    resolves the actual handler; synchronous today, `import()` later
 *  - `capture` the handler's serializable captured values (the resumable-state
 *              channel; carried, not required, so authored captures stay nameable)
 */
export interface HandlerDescriptor<E = any> {
  ref: string;
  load: () => EventHandler<E> | Promise<EventHandler<E>>;
  capture?: unknown[];
}

export type Handler<E = any> = EventHandler<E> | HandlerDescriptor<E>;

export interface RenderBackend {
  element(tag: string): BNode;
  text(value: string): BNode;
  /** A stable position marker (DOM comment) a dynamic binding inserts before. */
  anchor(): BNode;
  isNode(value: unknown): boolean;
  setText(node: BNode, value: string): void;
  insert(parent: BNode, node: BNode, before: BNode | null): void;
  remove(parent: BNode, node: BNode): void;
  /** Set one resolved attribute/property. The backend decides prop vs attr. */
  setAttr(el: BNode, key: string, value: unknown): void;
  setStyle(el: BNode, name: string, value: string): void;
  /** Bind an event. `handler` is a closure OR a descriptor (#30); `opts` is
   *  reserved for passive/once/capture listeners (not yet wired from JSX). */
  listen(el: BNode, type: string, handler: Handler, opts?: AddEventListenerOptions): void;
  /** Next sibling, for keyed-reconcile move-skipping (DOM only; SSR returns null). */
  nextSibling(node: BNode): BNode | null;
  /** DOM: a persistent reactive effect. SSR: run once, no subscription. */
  effect(run: () => void): void;
}

export type Child =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => Child)
  | Child[];

export type Props = Record<string, unknown> & { children?: Child };
export type Component<P extends object = {}> = (props: P) => Child;

/** Fragment groups children without a wrapper element. */
export const Fragment = Symbol.for("pimas.Fragment");
type ElementType = string | Component<any> | typeof Fragment;

// The backend in effect for the current render pass. Set by `renderWith`; each
// binding closes over the backend passed to it, so re-runs use the right one
// even if this global is later switched (DOM ⇄ SSR).
let currentBackend: RenderBackend | null = null;

export function setDefaultBackend(backend: RenderBackend): void {
  if (currentBackend === null) currentBackend = backend;
}

function activeBackend(): RenderBackend {
  if (currentBackend === null) {
    throw new Error("pimas: no active render backend — call render() or renderToString().");
  }
  return currentBackend;
}

/** Hyperscript / JSX factory. Reads the active backend and builds through it. */
export function h(type: ElementType, props?: Props | null, ...rest: Child[]): Child {
  const p = props ?? {};
  const children: Child = rest.length > 0 ? rest : (p.children as Child);
  return createWith(activeBackend(), type, p, children);
}

function createWith(b: RenderBackend, type: ElementType, props: Props, children: Child): Child {
  if (typeof type === "function") {
    // Component: run untracked so its setup reads don't subscribe a parent
    // effect; it calls h() again, reading the same active backend.
    return untrack(() => type({ ...props, children }));
  }
  if (type === Fragment) return children;

  const el = b.element(type);
  for (const key in props) {
    if (key === "children") continue;
    setProp(b, el, key, props[key]);
  }
  appendChildren(b, el, children);
  return el;
}

// ── Props ──────────────────────────────────────────────────────────────────

function setProp(b: RenderBackend, el: BNode, key: string, value: unknown): void {
  if (key === "ref") {
    if (typeof value === "function") (value as (e: BNode) => void)(el);
    return;
  }
  if (key.length > 2 && key[0] === "o" && key[1] === "n") {
    b.listen(el, key.slice(2).toLowerCase(), value as Handler);
    return;
  }
  if (typeof value === "function") {
    b.effect(() => applyProp(b, el, key, (value as () => unknown)()));
    return;
  }
  applyProp(b, el, key, value);
}

function applyProp(b: RenderBackend, el: BNode, key: string, value: unknown): void {
  if (key === "class" || key === "className") {
    b.setAttr(el, "class", value == null ? "" : String(value));
    return;
  }
  if (key === "style" && value && typeof value === "object") {
    for (const k in value as Record<string, string>) {
      b.setStyle(el, toKebab(k), String((value as Record<string, string>)[k]));
    }
    return;
  }
  b.setAttr(el, key, value);
}

function toKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

// ── Children / insertion ─────────────────────────────────────────────────

function appendChildren(b: RenderBackend, parent: BNode, children: Child): void {
  if (Array.isArray(children)) {
    for (const c of children) insert(b, parent, c);
  } else {
    insert(b, parent, children);
  }
}

/**
 * Insert `value` into `parent` (before `before`, or appended). A function value
 * is a dynamic binding: reserve a stable position with an anchor and re-reconcile
 * inside `b.effect`, so updates land exactly here regardless of sibling order.
 */
function insert(b: RenderBackend, parent: BNode, value: Child, before: BNode | null = null): void {
  if (typeof value === "function") {
    const anchor = b.anchor();
    b.insert(parent, anchor, before);
    let current: BNode[] = [];
    let currentText: BNode | null = null;
    b.effect(() => {
      const v = (value as () => Child)();
      // Fast path: a primitive replacing a single text node — just patch it.
      if (currentText !== null && (typeof v === "string" || typeof v === "number")) {
        b.setText(currentText, String(v));
        return;
      }
      const next = normalize(b, v);
      current = reconcile(b, parent, next, anchor, current);
      currentText = next.length === 1 && (typeof v === "string" || typeof v === "number") ? next[0] : null;
    });
    return;
  }
  for (const node of normalize(b, value)) b.insert(parent, node, before);
}

/**
 * Reconcile the DOM at this position from `prev` node order to `next`, keyed by
 * NODE IDENTITY: nodes present in both are reused (moved only if out of place),
 * gone nodes are removed, new ones inserted. `<For>` reuses row-node instances,
 * so this is what makes a reorder move existing DOM rather than rebuild it. An
 * O(n) heuristic (skips no-op moves via nextSibling); not LIS-minimal, but every
 * surviving row keeps its DOM + reactive scope.
 */
function reconcile(b: RenderBackend, parent: BNode, next: BNode[], anchor: BNode, prev: BNode[]): BNode[] {
  if (prev.length === 0) {
    for (const n of next) b.insert(parent, n, anchor);
    return next;
  }
  if (next.length === 0) {
    for (const n of prev) b.remove(parent, n);
    return next;
  }
  const keep = new Set(next);
  for (const n of prev) if (!keep.has(n)) b.remove(parent, n);
  // Place nodes right-to-left so each is inserted before its already-placed
  // successor; skip a node already sitting in the right spot.
  let after: BNode = anchor;
  for (let i = next.length - 1; i >= 0; i--) {
    const node = next[i]!;
    if (b.nextSibling(node) !== after) b.insert(parent, node, after);
    after = node;
  }
  return next;
}

/** Flatten a Child into concrete backend nodes. null/booleans render nothing. */
function normalize(b: RenderBackend, value: Child): BNode[] {
  if (value == null || value === true || value === false) return [];
  if (b.isNode(value)) return [value];
  if (Array.isArray(value)) return value.flatMap((v) => normalize(b, v));
  if (typeof value === "function") return normalize(b, (value as () => Child)());
  return [b.text(String(value))];
}

/**
 * Mount `code` into `container` using `backend`, inside a disposable root. The
 * binding effects close over `backend`, so later re-runs ignore the global.
 * Returns the root's dispose function.
 */
export function renderWith(backend: RenderBackend, code: () => Child, container: BNode): () => void {
  const prev = currentBackend;
  currentBackend = backend;
  try {
    return createRoot((dispose) => {
      insert(backend, container, code());
      return dispose;
    });
  } finally {
    currentBackend = prev;
  }
}
