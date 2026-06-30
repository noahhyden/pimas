/**
 * The DOM backend: live, mutable nodes + persistent reactive effects.
 */
import { createEffect } from "../reactive/index.js";
import type { RenderBackend } from "./engine.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Tags that must be created in the SVG namespace. A runtime renderer can't know
// the parent context (children are built before parents), so we key off the tag
// name. Covers the common set; ambiguous tags (a/title/script/style) stay HTML.
const SVG_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse",
  "text", "tspan", "textPath", "defs", "use", "symbol", "marker", "mask",
  "clipPath", "pattern", "image", "linearGradient", "radialGradient", "stop",
  "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feMerge",
  "feMergeNode", "feFlood", "feComposite", "foreignObject", "view", "desc",
]);

export const domBackend: RenderBackend = {
  element(tag) {
    return SVG_TAGS.has(tag)
      ? document.createElementNS(SVG_NS, tag)
      : document.createElement(tag);
  },
  text(value) {
    return document.createTextNode(value);
  },
  anchor() {
    return document.createComment("");
  },
  isNode(value) {
    return value instanceof Node;
  },
  setText(node, value) {
    (node as Text).data = value;
  },
  insert(parent, node, before) {
    (parent as Node).insertBefore(node as Node, (before as Node) ?? null);
  },
  remove(parent, node) {
    if ((node as Node).parentNode === parent) (parent as Node).removeChild(node as Node);
  },
  setAttr(el, key, value) {
    const node = el as Element;
    // SVG properties are read-only — always go through attributes there.
    if (node instanceof SVGElement) {
      if (value == null || value === false) node.removeAttribute(key);
      else node.setAttribute(key, value === true ? "" : String(value));
      return;
    }
    // HTML: prefer the live property when one exists (value, checked, disabled…).
    if (key in node) {
      (node as unknown as Record<string, unknown>)[key] = value;
      return;
    }
    if (value == null || value === false) node.removeAttribute(key);
    else node.setAttribute(key, value === true ? "" : String(value));
  },
  setStyle(el, name, value) {
    (el as HTMLElement).style.setProperty(name, value);
  },
  listen(el, type, handler) {
    (el as Element).addEventListener(type, handler);
  },
  effect(run) {
    createEffect(run);
  },
};
