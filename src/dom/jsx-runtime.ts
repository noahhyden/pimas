/**
 * pimas/jsx-runtime — the automatic JSX runtime.
 *
 * TS's `react-jsx` transform compiles <div>{x}</div> into calls to `jsx` /
 * `jsxs` imported from here (because tsconfig sets jsxImportSource to
 * "pimas"). Both forward to `h`; children live on `props.children`.
 */
import { h, Fragment as _Fragment, type Child, type Props } from "./index.js";
import type { IntrinsicElements as PimasIntrinsicElements } from "./jsx-types.js";

export const Fragment = _Fragment;

export function jsx(type: Parameters<typeof h>[0], props: Props): Child {
  return h(type, props);
}

// `jsxs` is the static-children variant; `h` handles array children already.
export const jsxs = jsx;

/**
 * The JSX type namespace TS resolves through `jsxImportSource`. Intrinsic elements
 * are typed (see `./jsx-types.ts`): misspelled tags and unknown attributes on
 * well-known elements are caught, while thunks, `data-*`/`aria-*`, custom elements,
 * and `HandlerDescriptor` event handlers all stay allowed. (Issue #18.)
 */
export namespace JSX {
  export type Element = Child;
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements extends PimasIntrinsicElements {}
}
