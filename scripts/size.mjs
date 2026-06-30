/**
 * Per-import bundle-size guardrail.
 *
 * The point isn't total package size — it's "what does a REAL consumer import
 * actually cost?". Each fixture is a minimal realistic import; we bundle it
 * with esbuild (tree-shaking on), gzip, and compare to a byte budget. A
 * signal-only fixture that suddenly grows means tree-shaking broke or the
 * kernel bloated — exactly the regression we want to catch at landing time.
 *
 * Measures from SOURCE via alias, so no prior build is needed. Run: `npm run size`.
 */
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => resolve(root, "src", p);

// Resolve the public subpaths to source so we measure what ships, build-free.
const alias = {
  pimas: src("reactive/index.ts"),
  "pimas/dom": src("dom/index.ts"),
};

// name -> [fixture code, gzip byte budget | null]
const fixtures = {
  "core: signal only": [`import { createSignal } from "pimas"; createSignal(0);`, 800],
  "core: full surface": [`import * as R from "pimas"; globalThis.x = R;`, 1500],
  "dom: render + h": [`import { render, h } from "pimas/dom"; globalThis.x = [render, h];`, 1200],
};

let failed = false;
console.log("per-import size (min / gzip):\n");
for (const [name, [code, budget]] of Object.entries(fixtures)) {
  const out = await build({
    stdin: { contents: code, resolveDir: root, loader: "ts" },
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    treeShaking: true,
    alias,
    logLevel: "silent",
  });
  const raw = out.outputFiles[0].contents;
  const gz = gzipSync(raw).length;
  const over = budget != null && gz > budget;
  failed ||= over;
  const tag = over ? "FAIL" : "ok  ";
  const bud = budget != null ? `  (budget ${budget} gz)` : "";
  console.log(`  ${tag} ${name.padEnd(24)} ${raw.length} min / ${gz} gz${bud}`);
}
console.log("");
process.exit(failed ? 1 : 0);
