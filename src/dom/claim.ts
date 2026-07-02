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
 * Handles: static intrinsic elements, static attributes (left untouched — already
 * in the server HTML), DYNAMIC attributes/styles (`class={() => …}`), event
 * handlers, reactive text children (`<span>{() => n()}</span>`), CONTROL FLOW
 * (<Show>/<For>/<Switch> — reorder/append/remove against the adopted DOM, slice 2),
 * `ref` (deferred to fire with the real ADOPTED node, not the plan node — slice 3a),
 * and adjacent text pieces the parser COALESCED into one server node (`{a}{sep}{b}`
 * → split back apart via `splitText`, slice 3b). OUT (remaining): subtree-granular
 * fallback, and D4 (restore from the serialized capture table without re-executing
 * components — needs the compiler; claim re-executes today).
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
  /** Back-pointer so `nextSibling(node)` (no parent arg from reconcile) can find
   *  the plan-space sibling. Set on every `insert`. */
  parent?: ClaimNode;
  dom: Node | null;
  pendingText?: string;
  pendingAttrs?: Map<string, unknown>;
  pendingStyles?: Map<string, string>;
  listeners?: Array<[string, Handler]>;
  /** `ref` callbacks, fired with the REAL adopted/materialized node — never the
   *  plan node — once `.dom` is bound. */
  refs?: Array<(node: Node) => void>;
}

// True while the current setAttr/setStyle originates from a binding EFFECT (a
// dynamic attr) rather than the one-shot prop loop (a static attr). Only meaningful
// at build time (dom === null); once a node is bound, updates always apply live.
let inEffect = false;

// False during the adoption build (everything is plan-only, no real DOM touched);
// flipped true once the whole tree has matched + flushed. Post-adoption re-runs
// (control-flow reconcile: add/move/remove rows) then mutate the REAL DOM. The
// module-level flag mirrors the string backend's single-render assumption (its
// module-level captureTable) — see the re-entrancy caveat on `claim`.
let live = false;

const el = (tag: string): ClaimNode => ({ kind: 1, tag, children: [], dom: null });

const claimBackend: RenderBackend = {
  element: (tag) => el(tag),
  text: (value) => ({ kind: 2, children: [], dom: null, pendingText: String(value) }),
  anchor: () => ({ kind: 3, children: [], dom: null }),
  isNode: (value) => typeof value === "object" && value !== null && "kind" in (value as object),

  ref(node, callback) {
    const n = node as ClaimNode;
    if (n.dom) callback(n.dom); // already bound (a post-adoption node) → fire now
    else (n.refs ??= []).push(callback as (node: Node) => void); // defer to adoption
  },

  setText(node, value) {
    const n = node as ClaimNode;
    if (n.dom) (n.dom as Text).data = value; // post-bind: live update (the fast path)
    else n.pendingText = value;
  },

  insert(parent, node, before) {
    const p = parent as ClaimNode;
    const n = node as ClaimNode;
    const b4 = (before as ClaimNode | null) ?? null;
    n.parent = p;
    const kids = p.children;
    // A reconcile move re-inserts an existing node — drop its old slot first so
    // the plan array (and the real DOM below) don't duplicate it.
    const at = kids.indexOf(n);
    if (at >= 0) kids.splice(at, 1);
    if (b4 == null) kids.push(n);
    else {
      const i = kids.indexOf(b4);
      kids.splice(i < 0 ? kids.length : i, 0, n);
    }
    // Post-adoption (live) with a bound parent: reflect into real DOM. A node with
    // no bound `.dom` is new (a fresh <For> row) — create its real subtree first.
    if (live && p.dom) {
      if (n.dom == null) materialize(n);
      domBackend.insert(p.dom, n.dom, b4 ? b4.dom : null);
    }
  },

  remove(parent, node) {
    const p = parent as ClaimNode;
    const n = node as ClaimNode;
    const i = p.children.indexOf(n);
    if (i >= 0) p.children.splice(i, 1);
    if (live && n.dom && p.dom) domBackend.remove(p.dom, n.dom);
  },

  setAttr(node, key, value) {
    const n = node as ClaimNode;
    if (n.dom) domBackend.setAttr(n.dom, key, value); // bound → live update
    // Buffer a dynamic attr (inEffect) OR any attr on a node built post-adoption
    // (live: a fresh <For> row has no server HTML, so even its static attrs must
    // be created). A static attr during the adoption build is already in the HTML.
    else if (inEffect || live) (n.pendingAttrs ??= new Map()).set(key, value);
  },

  setStyle(node, name, value) {
    const n = node as ClaimNode;
    if (n.dom) domBackend.setStyle(n.dom, name, value);
    else if (inEffect || live) (n.pendingStyles ??= new Map()).set(name, value);
  },

  listen(node, type, handler) {
    const n = node as ClaimNode;
    if (n.dom) domBackend.listen(n.dom, type, handler);
    else (n.listeners ??= []).push([type, handler]);
  },

  nextSibling(node) {
    // Plan-space next sibling — reconcile compares this against `after` (also a
    // ClaimNode) to skip no-op moves. insert/remove keep the plan array in lockstep
    // with the real DOM, so plan adjacency ≡ DOM adjacency.
    const n = node as ClaimNode;
    const p = n.parent;
    if (!p) return null;
    const i = p.children.indexOf(n);
    return i >= 0 && i + 1 < p.children.length ? p.children[i + 1] : null;
  },

  effect(run) {
    // `inEffect` marks writes that come from a binding effect (dynamic attrs) vs
    // the one-shot prop loop (static attrs, already in the server HTML). The core
    // restores this node's backend around every run, so re-runs already build
    // through the claim backend — no need to re-establish it here.
    createEffect(() => {
      const prev = inEffect;
      inEffect = true;
      try {
        run();
      } finally {
        inEffect = prev;
      }
    });
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
      // Adjacent JSX text pieces (`{a} sep {b}`) are distinct plan nodes, but the
      // browser COALESCES them into one server Text node on parse. If this plan
      // text is a proper prefix of the server node, split the node so each plan
      // text binds to its own piece (and the remainder matches the next sibling).
      const want = child.pendingText ?? "";
      const data = (cur as Text).data;
      if (data !== want) {
        if (want !== "" && data.length > want.length && data.startsWith(want)) {
          (cur as Text).splitText(want.length); // cur := prefix (== want); remainder := next sibling
        } else {
          return false; // genuine content divergence → bail to a client render
        }
      }
    } else {
      if (cur.nodeType !== 8) return false; // Comment (the <!----> anchor)
    }
    child.dom = cur;
    if (child.kind === 1 && !match(child)) return false;
    cur = cur.nextSibling;
  }
  return true;
}

/** Build a REAL DOM subtree for a plan node created post-adoption (a fresh
 *  control-flow row, which has no server markup to adopt). Mirrors `flushAll` but
 *  CREATES nodes via the DOM backend and binds `.dom` so later effect re-runs (the
 *  row's own reactive text/attrs) forward to the live node. */
function materialize(node: ClaimNode): Node {
  let dom: Node;
  if (node.kind === 2) {
    dom = document.createTextNode(node.pendingText ?? "");
  } else if (node.kind === 3) {
    dom = document.createComment("");
  } else {
    dom = domBackend.element(node.tag!) as Node;
    if (node.pendingAttrs) for (const [k, v] of node.pendingAttrs) domBackend.setAttr(dom, k, v);
    if (node.pendingStyles) for (const [k, v] of node.pendingStyles) domBackend.setStyle(dom, k, v);
    if (node.listeners) for (const [t, h] of node.listeners) domBackend.listen(dom, t, h);
    for (const child of node.children) dom.appendChild(materialize(child));
  }
  node.dom = dom;
  if (node.refs) for (const r of node.refs) r(dom);
  return dom;
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
    if (child.refs) for (const r of child.refs) r(dom); // fire refs with the ADOPTED node
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
  live = false; // the build phase touches no real DOM
  const root: ClaimNode = { kind: 1, tag: "#root", children: [], dom: container };
  const dispose = renderWith(claimBackend, code, root as unknown as Node);
  if (match(root)) {
    flushAll(root);
    live = true; // adopted — post-adoption reconcile now mutates the real DOM
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
