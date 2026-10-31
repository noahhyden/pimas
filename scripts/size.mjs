/** Per-import gzip budgets. React is external — we measure our adapter, not React. */
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const fixtures = {
  "core: signal only": [`import { createSignal } from "./src/reactive/index.js"; createSignal(0);`, 770],
  "core: + speculate": [`import { createSignal, speculate } from "./src/reactive/index.js"; globalThis.x = [createSignal, speculate];`, 940],
  "store: createStore": [`import { createStore } from "./src/store/index.js"; globalThis.x = createStore;`, 1750],
  "agent: createModel": [`import { createModel } from "./src/agent/index.js"; globalThis.x = createModel;`, 2130],
  "agent: page": [`import { installPageAgent } from "./src/agent/page.js"; globalThis.x = installPageAgent;`, 1550],
  "react: usePimas": [`import { usePimas } from "./src/react/index.js"; globalThis.x = usePimas;`, 710],
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
    logLevel: "silent",
    external: ["react"],
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
