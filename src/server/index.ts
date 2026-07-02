/**
 * pimas/server — render a component to an HTML string (SSR / static prerender).
 *
 * Runs the SAME component code as pimas/dom, but through the string backend:
 * bindings evaluate once and bake into the markup. This is the Phase-4 path for
 * generating noahhyden.com's static HTML.
 */
import { renderWith, STATE_SCRIPT_TYPE, type Child } from "../dom/engine.js";
import { encode } from "../dom/wire.js";
import { stringBackend, serialize, newRoot, beginCapture, collectCapture } from "./string-backend.js";

export { STATE_SCRIPT_TYPE };
// The type-tagged codec (D#32) — re-exported for island prop serialization (#7).
export { encode, decode } from "../dom/wire.js";

/**
 * Render `code` to an HTML string.
 *
 * If any serializable handler descriptors were rendered (see the string
 * backend's `listen`), a `<script type="application/pimas-state">` carrying the
 * capture table is appended so the client `resume()` dispatcher can wire events
 * without re-running components. Pages with NO handlers emit nothing extra —
 * the 0-KB-JS static-page guarantee is preserved.
 */
export function renderToString(code: () => Child): string {
  const root = newRoot();
  beginCapture();
  const dispose = renderWith(stringBackend, code, root);
  const html = root.children.map(serialize).join("");
  dispose();
  const table = collectCapture();
  if (table.length === 0) return html;
  // `encode` type-tags values JSON can't carry (Dates/Maps/typed rows round-trip)
  // and escapes `<` so a captured "</script>" can't break out of the tag.
  return `${html}<script type="${STATE_SCRIPT_TYPE}">${encode(table)}</script>`;
}
