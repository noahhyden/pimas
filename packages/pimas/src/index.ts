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
 * Re-exports the reactive core and the DOM renderer.
 */
export * from "@pimas/reactive";
export * from "@pimas/dom";
