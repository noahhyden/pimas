/**
 * The string backend: build a lightweight node tree, then serialize to HTML.
 *
 * Two things differ from the DOM backend, and they're the whole point of the
 * seam: nodes are plain objects (no `document`), and `effect` runs ONCE with no
 * subscription — a server render has nothing to update, so bindings are
 * evaluated a single time and the value is baked into the string.
 */
import { untrack } from "../reactive/index.js";
import type { RenderBackend } from "../dom/engine.js";

interface SEl {
  kind: 1;
  tag: string;
  attrs: Map<string, string>;
  children: SNode[];
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
  listen() {
    // No-op: a server render can't bind events. RESERVED (#30): for a handler
    // *descriptor* this is where we'll later emit `on:<type>="<ref>#…"` + a
    // per-root capture table so a qwikloader-style dispatcher can resume without
    // re-running components. Left inert now — islands (#29) client-render, so the
    // browser rebinds via the DOM backend; nothing to serialize yet.
  },
  nextSibling() {
    return null; // SSR runs once; reconcile never takes the move path
  },
  effect(run) {
    untrack(run); // run once, no subscription
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
