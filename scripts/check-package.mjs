/**
 * Supply-chain guard: pimas ships ZERO runtime dependencies.
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const problems = [];

const deps = Object.keys(pkg.dependencies ?? {});
if (deps.length) {
  problems.push(
    `runtime "dependencies" must be EMPTY — found ${deps.length}: ${deps.slice(0, 6).join(", ")}${deps.length > 6 ? " …" : ""}`,
  );
}

if (JSON.stringify(pkg.files) !== JSON.stringify(["dist", "src"])) {
  problems.push(`"files" must be ["dist","src"] — found ${JSON.stringify(pkg.files)}`);
}

if (!pkg.peerDependenciesMeta?.react?.optional) {
  problems.push(`react must remain an OPTIONAL peerDependency (only needed for pimas-ui/react)`);
}

if (problems.length) {
  console.error("package.json supply-chain guard FAILED:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("package.json guard OK — zero runtime deps, files=[dist,src], react optional peer.");
