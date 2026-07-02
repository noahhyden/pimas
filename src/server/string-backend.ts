/**
 * The string backend: build a lightweight node tree, then serialize to HTML.
 *
 * Two things differ from the DOM backend, and they're the whole point of the
 * seam: nodes are plain objects (no `document`), and `effect` runs ONCE with no
 * subscription — a server render has nothing to update, so bindings are
 * evaluated a single time and the value is baked into the string.
 */
import { untrack } from "../reactive/index.js";
import type { RenderBackend, CaptureEntry } from "../dom/engine.js";

interface SEl {
  kind: 1;
  tag: string;
  attrs: Map<string, string>;
  children: SNode[];
}

// `CaptureEntry` is the shared wire contract (see dom/engine.ts). An element's
// `on:<type>` attribute holds this entry's INDEX into the per-render table
// (index, not ref, so a ref containing `#`/spaces is never parsed out of HTML).

// Per-render capture table. `renderToString` brackets a render with
// beginCapture()/collectCapture(); `listen` pushes into it. Module-level is safe
// because a server render is synchronous and non-reentrant (D#31 create-order).
let captureTable: CaptureEntry[] | null = null;

/** Start collecting serialized handler descriptors for one render pass. */
export function beginCapture(): void {
  captureTable = [];
}

/** End the pass; return the collected table (empty if nothing was serialized). */
export function collectCapture(): CaptureEntry[] {
  const t = captureTable ?? [];
  captureTable = null;
  return t;
}
interface SText {
  kind: 2;
  value: string;
}
interface SAnchor {
  kind: 3;
}
export type SNode = SEl | SText | SAnchor;

// HTML void elements — self-closing, no children/closing tag.
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export const stringBackend: RenderBackend = {
  element(tag): SEl {
    return { kind: 1, tag, attrs: new Map(), children: [] };
  },
  text(value): SText {
    return { kind: 2, value };
  },
  anchor(): SAnchor {
    return { kind: 3 };
  },
  isNode(value) {
    return typeof value === "object" && value !== null && "kind" in (value as object);
  },
  ref() {
    // No live node on the server — a ref has nothing meaningful to receive.
  },
  setText(node, value) {
    (node as SText).value = value;
  },
  insert(parent, node, before) {
    const kids = (parent as SEl).children;
    if (before == null) kids.push(node as SNode);
    else {
      const i = kids.indexOf(before as SNode);
      kids.splice(i < 0 ? kids.length : i, 0, node as SNode);
    }
  },
  remove(parent, node) {
    const kids = (parent as SEl).children;
    const i = kids.indexOf(node as SNode);
    if (i >= 0) kids.splice(i, 1);
  },
  setAttr(el, key, value) {
    const attrs = (el as SEl).attrs;
    if (value == null || value === false) attrs.delete(key);
    else attrs.set(key, value === true ? "" : String(value));
  },
  setStyle(el, name, value) {
    const attrs = (el as SEl).attrs;
    attrs.set("style", (attrs.get("style") ?? "") + `${name}:${value};`);
  },
  listen(el, type, handler) {
    // A server render can't bind a live function. For resumability (#30) a
    // handler *descriptor* ({ref, load, capture}) IS serializable: emit an
    // `on:<type>` attribute carrying this handler's index into the per-render
    // capture table, and record {ref, capture}. A qwikloader-style dispatcher
    // (pimas/dom `resume`) later resolves ref → handler and invokes it with the
    // captured state — no component re-execution.
    if (typeof handler === "function") {
      // A bare closure can't cross the wire; under SSR it silently drops
      // interactivity. Warn (build-time diagnostic) — pass a HandlerDescriptor
      // to serialize it, or bind it client-side via islands (#29).
      console.warn(`pimas/server: on${type} closure can't serialize — use a HandlerDescriptor.`);
      return;
    }
    if (captureTable === null) {
      // A descriptor outside a renderToString pass has nowhere to record its
      // capture; ignore rather than emit a dangling attribute.
      console.warn(`pimas/server: on${type} descriptor ignored outside renderToString().`);
      return;
    }
    const index = captureTable.length;
    captureTable.push({ ref: handler.ref, capture: handler.capture ?? [] });
    (el as SEl).attrs.set(`on:${type}`, String(index));
  },
  nextSibling() {
    return null; // SSR runs once; reconcile never takes the move path
  },
  effect(run) {
    untrack(run); // run once, no subscription
  },
  scheduleMount() {
    // no-op on the server: run-once render, no live nodes to act on
  },
};

export function serialize(node: SNode): string {
  if (node.kind === 2) return escapeText(node.value);
  if (node.kind === 3) return "<!---->"; // anchor → empty comment (hydration marker)

  let attrs = "";
  for (const [k, v] of node.attrs) attrs += v === "" ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`;
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children.map(serialize).join("")}</${node.tag}>`;
}

export function newRoot(): SEl {
  return { kind: 1, tag: "#root", attrs: new Map(), children: [] };
}
