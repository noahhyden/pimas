/**
 * Pimas — public API.
 *
 * Phase 1 (now): the reactive core.
 * Phase 2 (next): the DOM renderer + JSX runtime will be re-exported here.
 */
export {
  createSignal,
  createEffect,
  createMemo,
  batch,
  untrack,
  onCleanup,
  createRoot,
} from "./reactive.js";

export type { Accessor, Setter, Signal, Owner } from "./reactive.js";
