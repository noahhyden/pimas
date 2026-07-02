/**
 * pimas/compiler — 🔬 EXPERIMENTAL, build-time only (#4 / #12).
 *
 * Phase A: the thunk-eraser. Write `{count()}` / `class={active() ? …}`; the
 * compiler emits the `() => (…)` thunk the runtime already interprets — a pure
 * optimizer targeting the existing runtime functions (D#14), NOT a new dialect.
 * Compiled and hand-written thunk code interoperate. Zero runtime change: this
 * module is never imported by any runtime entry and never enters a shipped
 * bundle; it imports `typescript` (a peer dep) purely as a parser.
 */
export { transform } from "./transform.js";
export { collectReactiveBindings, type WrapRange } from "./detect.js";
export { pimasThunkVite } from "./plugin.js";
