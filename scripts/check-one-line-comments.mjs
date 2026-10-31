/** Explanation in code is capped at ONE line; the rest belongs in AGENTS.d — the design and each exemption's rationale live in AGENTS.d/010-explanation-in-code-is-capped-at-one-line.md, not here. */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CODE_EXT = [".ts", ".tsx", ".mjs"];
const YAML_EXT = [".yml", ".yaml"];

// A run carrying one of these is tooling, not explanation, so it is never a violation.
const PRAGMAS = [
  "@ts-expect-error",
  "@ts-ignore",
  "eslint-disable",
  "prettier-ignore",
  "biome-ignore",
  "v8 ignore",
  "c8 ignore",
  "istanbul ignore",
  "@vitest-environment",
  "DO NOT EDIT",
  "AUTO-GENERATED",
  "SPDX-",
  "Copyright",
  "!/usr/bin",
];

const GENERATED = /DO NOT EDIT|AUTO-?GENERATED|THIS FILE IS GENERATED|@generated/i;

const isYaml = (p) => YAML_EXT.some((e) => p.endsWith(e));
const isCode = (p) => CODE_EXT.some((e) => p.endsWith(e));
const hasPragma = (lines) => lines.some((l) => PRAGMAS.some((p) => l.includes(p)));

/** Consecutive standalone comment line numbers grouped into runs longer than one line. */
function runs(linenos, lines) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      const body = run.map((n) => lines[n - 1]);
      if (!hasPragma(body)) out.push([run[0], `comment run spans ${run.length} lines`]);
    }
  };
  for (const n of linenos) {
    if (run.length && n === run[run.length - 1] + 1) {
      run.push(n);
      continue;
    }
    flush();
    run = [n];
  }
  flush();
  return out;
}

/** Multi-line JSDoc/block comments, and multi-line runs of standalone `//`. */
function codeViolations(text) {
  const out = [];
  const lines = text.split("\n");
  const standalone = [];
  let inBlock = false;
  let blockStart = 0;
  let blockLines = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const s = raw.trim();
    if (inBlock) {
      blockLines.push(raw);
      if (s.includes("*/")) {
        inBlock = false;
        if (blockLines.length > 1 && !hasPragma(blockLines)) {
          out.push([blockStart, `block comment spans ${blockLines.length} lines`]);
        }
      }
      continue;
    }
    if (s.startsWith("/*")) {
      blockLines = [raw];
      blockStart = i + 1;
      if (!s.slice(2).includes("*/")) inBlock = true;
      continue;
    }
    // Only a comment that OWNS its line is explanation; a trailing `//` is column-aligned annotation.
    if (s.startsWith("//")) standalone.push(i + 1);
  }
  return out.concat(runs(standalone, lines));
}

const BLOCK_SCALAR = /^(\s*)\S.*:\s*[|>][+\-0-9]*\s*(#.*)?$/;

/** Multi-line standalone `#` runs, skipping block-scalar bodies where `#` is literal content. */
function yamlViolations(text) {
  const lines = text.split("\n");
  const standalone = [];
  let inBlock = false;
  let parentIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (inBlock) {
      const indent = raw.length - raw.trimStart().length;
      if (raw.trim() === "" || indent > parentIndent) continue;
      inBlock = false;
    }
    const m = BLOCK_SCALAR.exec(raw);
    if (m) {
      parentIndent = m[1].length;
      inBlock = true;
      continue;
    }
    if (raw.trim().startsWith("#")) standalone.push(i + 1);
  }
  return runs(standalone, lines);
}

function tracked() {
  const out = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.mjs", "*.yml", "*.yaml"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

function scan(paths) {
  const found = new Map();
  for (const rel of paths) {
    if (!isCode(rel) && !isYaml(rel)) continue;
    const full = resolve(ROOT, rel);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    const text = readFileSync(full, "utf8");
    if (GENERATED.test(text.split("\n").slice(0, 40).join("\n"))) continue;
    const hits = isYaml(rel) ? yamlViolations(text) : codeViolations(text);
    if (hits.length) found.set(rel, hits);
  }
  return found;
}

/** Every violation, as printable lines. */
function report(found) {
  const out = [];
  for (const [path, hits] of [...found].sort()) {
    for (const [line, why] of hits) out.push(`  ${path}:${line}  ${why}`);
  }
  return out;
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const paths = files.length ? files.map((f) => relative(ROOT, resolve(f))) : tracked();

if (!paths.length) {
  console.error("one-line-comments: no files matched — refusing to pass vacuously");
  process.exit(1);
}

const found = scan(paths);
const codeScanned = paths.filter(isCode).length;
const yamlScanned = paths.filter(isYaml).length;
const bad = report(found);

if (bad.length) {
  console.error("one-line-comments: explanation in code is capped at ONE line.\n");
  console.error(bad.join("\n"));
  console.error(
    "\nA module, class or function gets a one-line doc comment or none, and a run of standalone\n" +
      "comments is one line. Move the rest into an AGENTS.d/ rule. A run carrying a real tooling\n" +
      `pragma (@ts-expect-error, eslint-disable, …) is exempt.\n\nScanned ${codeScanned} code file(s), ${yamlScanned} yaml file(s).`,
  );
  process.exit(1);
}

console.log(`one-line-comments: OK — ${codeScanned} code file(s) and ${yamlScanned} yaml file(s) scanned, 0 violations.`);
