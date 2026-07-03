/**
 * Supply-chain guard, run in CI (the `ci` gate) and the publish workflow. pimas
 * ships ZERO runtime dependencies; the published tarball must never pull anything
 * transitive into a consumer's install.
 *
 * A stray `npm install` has more than once hoisted vitest/vite's transitive
 * tooling (chai, rollup, postcss, tinypool, …) into `dependencies`. This fails
 * the build loudly if that ever happens, so a corrupted package.json can neither
 * merge to main nor publish. Plain .mjs (not typechecked; Node globals native).
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const problems = [];

const deps = Object.keys(pkg.dependencies ?? {});
if (deps.length) problems.push(`runtime "dependencies" must be EMPTY (pimas ships zero) — found ${deps.length}: ${deps.slice(0, 6).join(", ")}${deps.length > 6 ? " …" : ""}`);

if (JSON.stringify(pkg.files) !== JSON.stringify(["dist", "src"])) problems.push(`"files" must be ["dist","src"] — found ${JSON.stringify(pkg.files)}`);

if (!pkg.peerDependenciesMeta?.typescript?.optional) problems.push(`typescript must remain an OPTIONAL peerDependency`);

if (problems.length) {
  console.error("package.json supply-chain guard FAILED:\n - " + problems.join("\n - ") + "\n\nFix: reset `dependencies` to {} (a stray `npm install` likely corrupted it).");
  process.exit(1);
}
console.log("package.json guard OK — zero runtime deps, files=[dist,src], typescript optional peer.");
