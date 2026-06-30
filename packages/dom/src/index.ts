/**
 * @pimas/dom — the DOM renderer.
 *
 * Turns components into REAL DOM nodes once, and wraps each *dynamic* binding
 * in an effect from @pimas/reactive so only that node updates when a signal
 * changes. No virtual DOM, no diffing of the static structure.
 *
 * Dynamic bindings are signalled by passing a FUNCTION (a thunk):
 *
 *   const [n, setN] = createSignal(0);
 *   h("button", { onClick: () => setN(n() + 1) },
 *     "count: ", () => n());     // <- thunk child: re-runs, updates just this text
 *
 * Static values (strings, numbers, nodes) are inserted once and never touched.
 * A future compiler (Phase 5) will let you drop the `() =>` and infer it; until
 * then the thunk is the explicit, honest marker of "this is reactive".
 */
import { createEffect, createRoot, untrack } from "@pimas/reactive";

/** Anything that can appear as a child in the tree. */
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

/**
 * Hyperscript: create a DOM node (or component output). Children come from the
 * rest args, or — when called by the JSX runtime — from `props.children`.
 */
export function h(type: ElementType, props?: Props | null, ...rest: Child[]): Child {
  const p = props ?? {};
  const children: Child = rest.length > 0 ? rest : (p.children as Child);

  // Component: call it (untracked, so its setup reads don't subscribe a parent
  // effect) and return whatever it renders.
  if (typeof type === "function") {
    return untrack(() => type({ ...p, children }));
  }

  // Fragment: just the resolved children, no wrapper.
  if (type === Fragment) {
    return children;
  }

  const el = document.createElement(type);
  for (const key in p) {
    if (key === "children") continue;
    setProp(el, key, p[key]);
  }
  appendChildren(el, children);
  return el;
}

/** Mount `code`'s output into `container`. Returns a dispose function. */
export function render(code: () => Child, container: Element): () => void {
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    insert(container, code());
  });
  return () => {
    dispose();
    container.textContent = "";
  };
}

// ── Props ──────────────────────────────────────────────────────────────────

function setProp(el: Element, key: string, value: unknown): void {
  // ref={el => ...}
  if (key === "ref") {
    if (typeof value === "function") (value as (e: Element) => void)(el);
    return;
  }
  // onClick / onInput / ... → addEventListener. The handler is the value
  // itself (not a thunk), so it is NOT treated as a dynamic binding.
  if (key.length > 2 && key[0] === "o" && key[1] === "n") {
    el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    return;
  }
  // A function value (anything but an event) is a dynamic binding: re-apply it
  // inside an effect so it updates when its signals change.
  if (typeof value === "function") {
    createEffect(() => applyAttr(el, key, (value as () => unknown)()));
    return;
  }
  applyAttr(el, key, value);
}

function applyAttr(el: Element, key: string, value: unknown): void {
  if (key === "class" || key === "className") {
    el.setAttribute("class", value == null ? "" : String(value));
    return;
  }
  if (key === "style" && value && typeof value === "object") {
    const style = (el as HTMLElement).style;
    for (const k in value as Record<string, string>) {
      style.setProperty(toKebab(k), String((value as Record<string, string>)[k]));
    }
    return;
  }
  // SVG props are read-only; always go through attributes there.
  if (key in el && !(el instanceof SVGElement)) {
    (el as unknown as Record<string, unknown>)[key] = value;
    return;
  }
  if (value == null || value === false) {
    el.removeAttribute(key);
  } else if (value === true) {
    el.setAttribute(key, "");
  } else {
    el.setAttribute(key, String(value));
  }
}

function toKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

// ── Children / insertion ─────────────────────────────────────────────────

function appendChildren(parent: Node, children: Child): void {
  if (Array.isArray(children)) {
    for (const c of children) insert(parent, c);
  } else {
    insert(parent, children);
  }
}

/**
 * Insert `value` into `parent` (before `before`, or appended). A function value
 * is a dynamic binding: we reserve a stable position with an anchor comment and
 * re-reconcile inside an effect, so updates land exactly here regardless of
 * sibling order.
 */
function insert(parent: Node, value: Child, before: Node | null = null): void {
  if (typeof value === "function") {
    const anchor = parent.insertBefore(document.createComment(""), before);
    let current: Node[] = [];
    createEffect(() => {
      current = reconcile(parent, normalize((value as () => Child)()), anchor, current);
    });
    return;
  }
  for (const node of normalize(value)) parent.insertBefore(node, before);
}

/**
 * Replace `oldNodes` with `newNodes` immediately before `anchor`. v1 is a naive
 * full swap — correct for dynamic text/element bindings. Keyed list diffing
 * (so unchanged rows aren't recreated) arrives with `<For>` in Phase 3.
 */
function reconcile(parent: Node, newNodes: Node[], anchor: Node, oldNodes: Node[]): Node[] {
  // Fast path: a single text node staying a single text node — just patch data
  // (avoids destroying/recreating the node, and avoids losing focus/selection).
  if (
    oldNodes.length === 1 &&
    newNodes.length === 1 &&
    oldNodes[0]!.nodeType === 3 &&
    newNodes[0]!.nodeType === 3
  ) {
    (oldNodes[0] as Text).data = (newNodes[0] as Text).data;
    return oldNodes;
  }
  for (const n of oldNodes) if (n.parentNode === parent) parent.removeChild(n);
  for (const n of newNodes) parent.insertBefore(n, anchor);
  return newNodes;
}

/** Flatten a Child value into concrete DOM nodes. null/booleans render nothing. */
function normalize(value: Child): Node[] {
  if (value == null || value === true || value === false) return [];
  if (value instanceof Node) return [value];
  if (Array.isArray(value)) return value.flatMap(normalize);
  if (typeof value === "function") return normalize((value as () => Child)());
  return [document.createTextNode(String(value))];
}
