/** Supply-chain guard: pimas ships ZERO runtime dependencies. */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const deps = Object.keys(pkg.dependencies ?? {});
if (deps.length) {
  console.error(`runtime "dependencies" must be EMPTY, found: ${deps.join(", ")}`);
  process.exit(1);
}
console.log("package.json guard OK: zero runtime deps.");
