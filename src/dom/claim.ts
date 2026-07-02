/**
 * pimas/hydrate — the CLAIM backend (resumability D-phase, D#31 / #6).
 *
 * Client-render-first (`render()`, D#29) discards the server's HTML
 * (`container.textContent = ""`) and rebuilds every node. `claim()` instead
 * ADOPTS the server DOM: it reuses the existing nodes, attaching reactive
 * bindings and event listeners in place, so a hydrated island ships no throwaway
 * markup and never rebuilds its tree. This is the STATE half of resumability;
 * `pimas/resume` is the (renderer-free) LISTENER half. For a claimed subtree,
 * claim is the superset — it wires both state and listeners from live closures —
 * so claim and resume must not both run on the same root.
 *
 * ── Why a plan tree, not a hydration cursor ──────────────────────────────────
 * The engine builds BOTTOM-UP: a child element (and its binding effects) is fully
 * created before its parent's `createWith` runs, and the outermost insert happens
 * last (engine.ts create-order, locked by test/create-order.test.tsx). A linear
 * "adopt the next server node" cursor inside element()/text() can't work — those
 * fire deepest-first with no position context. So the claim backend builds a
 * lightweight PLAN TREE of plain objects (identical in shape + order to the
 * string backend's SNode tree, and to the server HTML by construction), touching
 * NO real DOM. Reactive effects created during the build subscribe and first-run
 * into buffers on the (still unbound) plan nodes. Then a single top-down walk
 * matches each plan node to its server node, binds it, and flushes the buffers.
 * After binding, a later signal write re-runs the same effect — whose closure
 * holds THIS backend (engine threads `b` through each binding) — and forwards the
 * change straight to the adopted node. No node is created; identity is preserved.
 *
 * Correctness-first: any structural mismatch between the plan tree and the server
 * DOM bails the whole tree and degrades to a normal client render — never a
 * corrupted adoption. NO real DOM is mutated until the entire tree has matched.
 *
 * Slice 1 scope: static intrinsic elements, static attributes (left untouched —
 * already in the server HTML), DYNAMIC attributes/styles (`class={() => …}`),
 * event handlers, and reactive text children that are the sole dynamic content of
 * their slot (`<span>{() => n()}</span>`). OUT (later slices): control flow
 * (<Show>/<For>/<Switch>), adjacent static+dynamic text (`count: {() => n()}` —
 * the browser coalesces the two server text nodes), `ref`, and subtree-granular
 * fallback. `ref`/`onMount` receive plan nodes, not live DOM — don't use them in
 * a claimed subtree yet.
 */
import { createRoot, createEffect } from "../reactive/index.js";
import { renderWith, type Child, type Handler } from "./engine.js";
import { domBackend } from "./dom-backend.js";
import type { RenderBackend } from "./engine.js";

/** A plan node — built by the claim backend, lazily bound to a server node.
 *  `kind` mirrors the string backend's SNode tags (1 element / 2 text / 3 anchor). */
interface ClaimNode {
  kind: 1 | 2 | 3;
  tag?: string;
  children: ClaimNode[];
  dom: Node | null;
  pendingText?: string;
  pendingAttrs?: Map<string, unknown>;
  pendingStyles?: Map<string, string>;
  listeners?: Array<[string, Handler]>;
}

// True while the current setAttr/setStyle originates from a binding EFFECT (a
// dynamic attr) rather than the one-shot prop loop (a static attr). Only meaningful
// at build time (dom === null); once a node is bound, updates always apply live.
let inEffect = false;

const el = (tag: string): ClaimNode => ({ kind: 1, tag, children: [], dom: null });

const claimBackend: RenderBackend = {
  element: (tag) => el(tag),
  text: (value) => ({ kind: 2, children: [], dom: null, pendingText: String(value) }),
  anchor: () => ({ kind: 3, children: [], dom: null }),
  isNode: (value) => typeof value === "object" && value !== null && "kind" in (value as object),

  setText(node, value) {
    const n = node as ClaimNode;
    if (n.dom) (n.dom as Text).data = value; // post-bind: live update (the fast path)
    else n.pendingText = value;
  },

  insert(parent, node, before) {
    const kids = (parent as ClaimNode).children;
    if (before == null) kids.push(node as ClaimNode);
    else {
      const i = kids.indexOf(before as ClaimNode);
      kids.splice(i < 0 ? kids.length : i, 0, node as ClaimNode);
    }
  },

  remove(parent, node) {
    const kids = (parent as ClaimNode).children;
    const i = kids.indexOf(node as ClaimNode);
    if (i >= 0) kids.splice(i, 1);
  },

  setAttr(node, key, value) {
    const n = node as ClaimNode;
    if (n.dom) domBackend.setAttr(n.dom, key, value); // bound → live update
    else if (inEffect) (n.pendingAttrs ??= new Map()).set(key, value); // dynamic → buffer
    // else: a static attr already present in the server HTML — leave it untouched.
  },

  setStyle(node, name, value) {
    const n = node as ClaimNode;
    if (n.dom) domBackend.setStyle(n.dom, name, value);
    else if (inEffect) (n.pendingStyles ??= new Map()).set(name, value);
  },

  listen(node, type, handler) {
    const n = node as ClaimNode;
    if (n.dom) domBackend.listen(n.dom, type, handler);
    else (n.listeners ??= []).push([type, handler]);
  },

  nextSibling: () => null, // slice 1 takes no reconcile move path

  effect(run) {
    const prev = inEffect;
    inEffect = true;
    try {
      createEffect(run); // runs once now — subscribes + first-runs into the buffers
    } finally {
      inEffect = prev;
    }
  },

  scheduleMount: (fn) => queueMicrotask(fn),
};

/** Match `plan.children` positionally against `plan.dom`'s live child nodes,
 *  binding each plan node to its server node. Returns false on any structural
 *  mismatch (→ the caller bails to a client render). Mutates no real DOM. */
function match(plan: ClaimNode): boolean {
  let cur = (plan.dom as Node).firstChild;
  for (const child of plan.children) {
    if (!cur) return false;
    if (child.kind === 1) {
      if (cur.nodeType !== 1 || (cur as Element).tagName.toLowerCase() !== child.tag) return false;
    } else if (child.kind === 2) {
      if (cur.nodeType !== 3) return false; // Text
    } else {
      if (cur.nodeType !== 8) return false; // Comment (the <!----> anchor)
    }
    child.dom = cur;
    if (child.kind === 1 && !match(child)) return false;
    cur = cur.nextSibling;
  }
  return true;
}

/** Apply every buffered mutation now that the whole tree has matched. */
function flushAll(plan: ClaimNode): void {
  for (const child of plan.children) {
    const dom = child.dom as Node;
    if (child.kind === 2 && child.pendingText !== undefined) (dom as Text).data = child.pendingText;
    if (child.pendingAttrs) for (const [k, v] of child.pendingAttrs) domBackend.setAttr(dom, k, v);
    if (child.pendingStyles) for (const [k, v] of child.pendingStyles) domBackend.setStyle(dom, k, v);
    if (child.listeners) for (const [t, h] of child.listeners) domBackend.listen(dom, t, h);
    if (child.kind === 1) flushAll(child);
  }
}

/**
 * Adopt the server-rendered DOM already inside `container` for the component
 * `code`, wiring reactivity in place instead of rebuilding. `code` must be the
 * SAME component tree the server rendered (so create-order aligns). Returns a
 * dispose function. On any structural desync it silently degrades to a normal
 * client render — identical to today's behavior, never a corrupted tree.
 */
export function claim(code: () => Child, container: Element): () => void {
  const root: ClaimNode = { kind: 1, tag: "#root", children: [], dom: container };
  const dispose = renderWith(claimBackend, code, root as unknown as Node);
  if (match(root)) {
    flushAll(root);
    return () => {
      dispose();
      container.textContent = "";
    };
  }
  // Desync → degrade to client-render-first (drop the server markup, rebuild).
  dispose();
  container.textContent = "";
  const disposeFresh = renderWith(domBackend, code, container);
  return () => {
    disposeFresh();
    container.textContent = "";
  };
}

/** Alias — the Qwik/React-familiar name for the same adopt-in-place operation. */
export const hydrate = claim;
