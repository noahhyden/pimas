/** pimas reactive core: headless signals, memos, effects and speculate; pair with `pimas-ui/react` or `pimas-ui/agent`. */
export {
  createSignal,
  createEffect,
  createMemo,
  batch,
  setScheduler,
  flushSync,
  untrack,
  speculate,
  speculationScratch,
  isTracking,
  onCleanup,
  subscribe,
  createRoot,
  catchError,
} from "./reactive.js";

export type { Accessor, Setter, Signal } from "./reactive.js";
