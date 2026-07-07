/**
 * pimas/dom — the DOM renderer (public entry).
 *
 * Turns components into REAL DOM nodes once; each *dynamic* binding is wrapped in
 * an effect so only that node updates when a signal changes. No virtual DOM, no
 * diffing. The rendering logic lives in `engine.ts` and is backend-agnostic;
 * this entry just supplies the DOM backend and the `render` mount point.
 *
 * Dynamic bindings are signalled by passing a FUNCTION (a thunk):
 *
 *   const [n, setN] = createSignal(0);
 *   <button onClick={() => setN(n() + 1)}>count: {() => n()}</button>
 *
 * Static values (strings, numbers, nodes) are inserted once and never touched.
 */
import { renderWith, setDefaultBackend, type Child } from "./engine.js";
import { domBackend } from "./dom-backend.js";

// Make the DOM backend the default so `h()` works during a normal render.
setDefaultBackend(domBackend);

/** Mount `code`'s output into `container`. Returns a dispose function. */
export function render(code: () => Child, container: Element): () => void {
  const dispose = renderWith(domBackend, code, container);
  return () => {
    dispose();
    container.textContent = "";
  };
}

export { h, Fragment, onMount } from "./engine.js";
export { model, modelChecked, modelNumber } from "./form.js";
export type {
  Child,
  Props,
  Component,
  RenderBackend,
  Handler,
  HandlerDescriptor,
  EventHandler,
} from "./engine.js";
