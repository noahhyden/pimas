/**
 * Supply-chain guard. pimas ships ZERO runtime dependencies — the published
 * tarball must never pull anything transitive into a consumer's install.
 *
 * This exists because a stray `npm install` has, more than once, hoisted
 * vitest/vite's transitive test-tooling (chai, rollup, postcss, tinypool, …)
 * into `dependencies`. This test runs in CI (the required `ci` check) and in the
 * publish workflow, so a corrupted package.json fails loudly and can never be
 * merged or published.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// vitest runs from the repo root; read package.json from there.
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

describe("package.json shape — supply-chain guard", () => {
  it("declares ZERO runtime dependencies", () => {
    // If this fails with vitest/vite packages listed, a stray `npm install`
    // corrupted package.json — reset `dependencies` to {} (or remove the key).
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("ships only dist + src in the published tarball", () => {
    expect(pkg.files).toEqual(["dist", "src"]);
  });

  it("keeps typescript as an OPTIONAL peer, not a runtime dep", () => {
    expect(pkg.peerDependencies?.typescript).toBeDefined();
    expect(pkg.peerDependenciesMeta?.typescript?.optional).toBe(true);
  });
});
