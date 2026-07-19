/**
 * Compiler Phase A — Vite plugin wrapper (#4 / #12 Phase A).
 *
 * The `transform` logic is covered by transform.test / e2e; this pins the thin
 * plugin hook around it: the `.tsx`/`.jsx` id gate, the `?query` stripping, the
 * null pass-through for non-JSX ids, and the pre-desugar `enforce` ordering.
 */
import { describe, it, expect } from "vitest";
import { pimasThunkVite } from "../../src/compiler/plugin";

const plugin = pimasThunkVite();
const run = (code: string, id: string) => plugin.transform(code, id);

describe("pimasThunkVite — plugin shape", () => {
  it("declares a pre-enforced named hook", () => {
    expect(plugin.name).toBe("pimas-thunk-eraser");
    expect(plugin.enforce).toBe("pre");
  });
});

describe("pimasThunkVite — id gate", () => {
  const SRC = "const x = <span>{count()}</span>;";

  it("transforms .tsx and .jsx ids", () => {
    for (const id of ["/a/comp.tsx", "/a/comp.jsx"]) {
      const out = run(SRC, id);
      expect(out).not.toBeNull();
      expect(out!.code).toContain("{() => (count())}");
      expect(out!.map).toBeNull();
    }
  });

  it("transforms a .tsx id carrying a ?query suffix", () => {
    const out = run(SRC, "/a/comp.tsx?vue&type=script");
    expect(out).not.toBeNull();
    expect(out!.code).toContain("{() => (count())}");
  });

  it("passes non-JSX ids through untouched (null)", () => {
    for (const id of ["/a/mod.ts", "/a/mod.js", "/a/style.css", "/a/data.json"]) {
      expect(run(SRC, id)).toBeNull();
    }
  });

  it("does not treat a .tsx substring in the query as a JSX id", () => {
    expect(run(SRC, "/a/mod.ts?foo=bar.tsx")).toBeNull();
  });
});
