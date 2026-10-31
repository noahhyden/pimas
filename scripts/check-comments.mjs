/** Guards: explanation in code is capped at ONE line, and an AGENTS.d rule body is one line of at most 255 chars. */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRAGMAS = ["@ts-expect-error", "@ts-ignore", "v8 ignore", "@vitest-environment"];
const RULE = /AGENTS\.d\/\d{3}-[a-z0-9-]+\.md$/;
const MAX_CHARS = 255;

const isYaml = (p) => /\.ya?ml$/.test(p);
const isCode = (p) => /\.(ts|tsx|mjs)$/.test(p);
const isRule = (p) => RULE.test(p) && !p.endsWith("000-header.md");
const hasPragma = (lines) => lines.some((l) => PRAGMAS.some((p) => l.includes(p)));
const read = (rel) => {
  const full = resolve(ROOT, rel);
  return existsSync(full) && statSync(full).isFile() ? readFileSync(full, "utf8") : null;
};

/** Consecutive standalone comment line numbers grouped into runs longer than one line. */
function runs(linenos, lines) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > 1 && !hasPragma(run.map((n) => lines[n - 1]))) out.push([run[0], `comment run spans ${run.length} lines`]);
  };
  for (const n of linenos) {
    if (run.length && n === run[run.length - 1] + 1) run.push(n);
    else {
      flush();
      run = [n];
    }
  }
  flush();
  return out;
}

/** Multi-line block comments, and runs of standalone `//` (code) or `#` (yaml). */
function commentViolations(text, yaml) {
  const out = [];
  const lines = text.split("\n");
  const standalone = [];
  let block = null;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (block) {
      block.lines.push(lines[i]);
      if (s.includes("*/")) {
        if (block.lines.length > 1 && !hasPragma(block.lines)) out.push([block.start, `block comment spans ${block.lines.length} lines`]);
        block = null;
      }
    } else if (!yaml && s.startsWith("/*")) {
      block = { start: i + 1, lines: [lines[i]] };
      if (s.slice(2).includes("*/")) block = null;
    } else if (s.startsWith(yaml ? "#" : "//")) standalone.push(i + 1);
  }
  return out.concat(runs(standalone, lines));
}

/** Rule body: frontmatter and the single leading heading stripped, blank lines dropped. */
function ruleViolations(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "").trimStart().replace(/^#+ .*\n/, "").trim();
  const lines = body.split("\n").filter((l) => l.trim());
  const longest = Math.max(0, ...lines.map((l) => l.length));
  return lines.length > 1 || longest > MAX_CHARS ? [[1, `rule body is ${lines.length} line(s), longest ${longest} chars (cap 1 line, ${MAX_CHARS} chars)`]] : [];
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const paths = args.length
  ? args.map((f) => relative(ROOT, resolve(f)))
  : execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

const code = paths.filter(isCode);
const yaml = paths.filter(isYaml);
const rules = paths.filter(isRule);
const empty = args.length ? !code.length && !yaml.length && !rules.length : !code.length || !yaml.length || !rules.length;
if (empty) {
  console.error(`check-comments: nothing matched (${code.length} code, ${yaml.length} yaml, ${rules.length} rule) — refusing to pass vacuously`);
  process.exit(1);
}

const bad = [];
const scan = (files, fn) => {
  for (const rel of files) {
    const text = read(rel);
    if (text !== null) for (const [line, why] of fn(text)) bad.push(`  ${rel}:${line}  ${why}`);
  }
};
scan(code, (t) => commentViolations(t, false));
scan(yaml, (t) => commentViolations(t, true));
scan(rules, ruleViolations);

const counts = `${code.length} code file(s), ${yaml.length} yaml file(s), ${rules.length} rule file(s)`;
if (bad.length) {
  console.error("check-comments: explanation in code is capped at ONE line, and a rule body is one line.\n");
  console.error(bad.sort().join("\n"));
  console.error(
    "\nA module, class or function gets a one-line doc comment or none, and a run of standalone\n" +
      "comments is one line. Move the rest into an AGENTS.d/ rule, itself one line of at most 255 chars:\n" +
      "keep the trap and its consequence, drop the rationale essay. A run carrying a tooling pragma\n" +
      `(@ts-expect-error, v8 ignore, …) is exempt.\n\nScanned ${counts}.`,
  );
  process.exit(1);
}
console.log(`check-comments: OK — scanned ${counts}, 0 violations.`);
