/**
 * pimas — the reactive core (the package's main entry, `import ... from "pimas"`).
 *
 * The DOM renderer lives at the `pimas/dom` subpath, not here — so a headless
 * consumer (e.g. a Node-side token engine) that imports only `pimas` never
 * pulls in any DOM code.
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
