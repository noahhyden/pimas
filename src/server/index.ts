/**
 * pimas/server — render a component to an HTML string (SSR / static prerender).
 *
 * Runs the SAME component code as pimas/dom, but through the string backend:
 * bindings evaluate once and bake into the markup. This is the Phase-4 path for
 * generating noahhyden.com's static HTML.
 */
import { renderWith, type Child } from "../dom/engine.js";
import { stringBackend, serialize, newRoot } from "./string-backend.js";

/** Render `code` to an HTML string. */
export function renderToString(code: () => Child): string {
  const root = newRoot();
  const dispose = renderWith(stringBackend, code, root);
  const html = root.children.map(serialize).join("");
  dispose();
  return html;
}
