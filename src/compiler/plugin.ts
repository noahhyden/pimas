/**
 * Compiler Phase A — Vite plugin (#4 / #12 Phase A).
 *
 * The thunk-eraser must run BEFORE the bundler desugars JSX (so attribute-vs-
 * child and the ref/on* name test are structurally explicit), leaving JSX
 * intact for esbuild's `jsx: automatic` to finish. `enforce: "pre"` guarantees
 * that ordering. The return type is structural (no vite import) so a consumer's
 * `pimas/compiler` types don't drag in a bundler dependency. Covers Vite +
 * Vitest; raw-esbuild users wrap the exported `transform` in their own onLoad.
 */
import { transform } from "./transform.js";

const JSX_FILE = /\.[jt]sx$/;

/** A Vite plugin (its `transform` hook runs pre-desugar). */
export function pimasThunkVite(): {
  name: string;
  enforce: "pre";
  transform(code: string, id: string): { code: string; map: null } | null;
} {
  return {
    name: "pimas-thunk-eraser",
    enforce: "pre",
    transform(code, id) {
      if (!JSX_FILE.test(id.split("?")[0]!)) return null;
      return { code: transform(code, id), map: null };
    },
  };
}
