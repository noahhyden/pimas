/**
 * pimas — the one-install facade.
 *
 * Re-exports the common surface so casual use is a single dependency:
 *   import { createSignal, createEffect } from "pimas";
 *
 * Power users (e.g. headless token engines) skip this and import the scoped
 * packages directly — `@pimas/reactive` alone has zero baggage. The facade is
 * pure re-export + `"sideEffects": false`, so a bundler shakes out whatever
 * you don't use.
 *
 * Phase 2 adds the DOM renderer re-export here:  export * from "@pimas/dom";
 */
export * from "@pimas/reactive";
