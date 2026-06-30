/**
 * @pimas/dom/jsx-dev-runtime — dev variant of the automatic runtime.
 *
 * TS emits calls to `jsxDEV` (with extra source-location args) when compiling
 * in development mode. We ignore the debug args and delegate to `jsx`.
 */
import { jsx, Fragment } from "./jsx-runtime.js";
import type { Child, Props } from "./index.js";

export { Fragment };
export type { JSX } from "./jsx-runtime.js";

export function jsxDEV(
  type: Parameters<typeof jsx>[0],
  props: Props,
  _key?: unknown,
  _isStatic?: boolean,
  _source?: unknown,
  _self?: unknown,
): Child {
  return jsx(type, props);
}
