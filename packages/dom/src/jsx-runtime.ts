/**
 * @pimas/dom/jsx-runtime — the automatic JSX runtime.
 *
 * TS's `react-jsx` transform compiles <div>{x}</div> into calls to `jsx` /
 * `jsxs` imported from here (because tsconfig sets jsxImportSource to
 * "@pimas/dom"). Both forward to `h`; children live on `props.children`.
 */
import { h, Fragment as _Fragment, type Child, type Props } from "./index.js";

export const Fragment = _Fragment;

export function jsx(type: Parameters<typeof h>[0], props: Props): Child {
  return h(type, props);
}

// `jsxs` is the static-children variant; `h` handles array children already.
export const jsxs = jsx;

/**
 * The JSX type namespace TS resolves through `jsxImportSource`. Permissive for
 * v1 — every intrinsic element accepts any props; tightened later.
 */
export namespace JSX {
  export type Element = Child;
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements {
    [name: string]: Record<string, unknown> & { children?: Child };
  }
}
