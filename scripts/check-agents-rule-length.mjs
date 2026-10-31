/** An AGENTS.d rule body is ONE line of at most 255 chars; markdown is never scanned by the one-line-comment guard, which is the hole rule prose grows through. No baseline: a baseline is itself a merge-conflict surface, and the burn-down lands with this guard. */
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULE = /AGENTS\.d\/\d{3}-[a-z0-9-]+\.md$/;
// 000-header.md is an authored navigation header, not a rule, and is exempt.
const HEADER = "000-header.md";
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
const HEADING = /^#+ .*\n/;
const MAX_LINES = 1;
const MAX_CHARS = 255;

function ruleFiles(argv) {
  const given = argv.filter((a) => !a.startsWith("--"));
  const all = given.length
    ? given.map((f) => relative(ROOT, resolve(f)))
    : execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  return all.filter((f) => RULE.test(f) && !f.endsWith(HEADER));
}

/** The rule text: frontmatter and the single leading heading stripped off. */
function bodyOf(text) {
  return text.replace(FRONTMATTER, "").trimStart().replace(HEADING, "").trim();
}

const paths = ruleFiles(process.argv.slice(2));
if (!paths.length) {
  console.error("check-agents-rule-length: no rule files matched — refusing to pass vacuously");
  process.exit(1);
}

const bad = [];
for (const rel of paths) {
  const full = resolve(ROOT, rel);
  if (!existsSync(full) || !statSync(full).isFile()) continue;
  const lines = bodyOf(readFileSync(full, "utf8")).split("\n").filter((l) => l.trim());
  const longest = Math.max(0, ...lines.map((l) => l.length));
  if (lines.length > MAX_LINES || longest > MAX_CHARS) bad.push([rel, lines.length, longest]);
}

console.log(`check-agents-rule-length: scanned ${paths.length} rule file(s)`);
if (!bad.length) {
  console.log(`  OK — every body is <= ${MAX_LINES} line and <= ${MAX_CHARS} chars`);
  process.exit(0);
}
for (const [rel, n, longest] of bad.sort((a, b) => b[2] - a[2])) {
  console.error(`  FAIL ${rel}: ${n} line(s), longest ${longest} chars`);
}
console.error(
  `\n${bad.length} rule(s) over the cap. A rule is one line of at most ${MAX_CHARS} chars: keep the trap\n` +
    "and its consequence, drop the measurements and the rationale essay. Long-form reasoning belongs\n" +
    "in docs/, not in an agent's always-loaded context.",
);
process.exit(1);
