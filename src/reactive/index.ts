/**
 * pimas — reactive core. Headless: signals, memos, effects, speculate.
 * No DOM. Pair with `pimas-ui/react` to bind a model into a React tree,
 * or `pimas-ui/agent` to expose it to an agent.
 */
export {
  createSignal,
  createEffect,
  createMemo,
  batch,
  setScheduler,
  flushSync,
  untrack,
  speculate,
  isSpeculating,
  speculationScratch,
  getListener,
  onCleanup,
  subscribe,
  createRoot,
  catchError,
} from "./reactive.js";

export type { Accessor, Setter, Signal, Owner } from "./reactive.js";
