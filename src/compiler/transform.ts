/**
 * Compiler Phase A — the thunk-eraser TRANSFORM (#4 / #12 Phase A).
 *
 * Parses `.tsx`/`.jsx` with the TypeScript API (parser only — no TS emit), asks
 * `detect` for the reactive-binding ranges, and splices `() => (` / `)` around
 * each, RIGHT-TO-LEFT so earlier offsets never shift. JSX is left intact — the
 * downstream bundler (esbuild `jsx: automatic`) still owns desugaring, factory
 * choice, dev/prod, and source maps. Output is byte-identical to hand-written
 * thunk code, so compiled and hand-authored subtrees interoperate (D#14), and
 * the pass is idempotent (already-function expressions are skipped in detect).
 *
 * No lines are added (pure inline insertions), so line-based source maps stay
 * valid without our own mapping.
 */
import ts from "typescript";
import { collectReactiveBindings } from "./detect.js";

const OPEN = "() => (";
const CLOSE = ")";

/** Wrap every reactive JSX binding in `code` in a thunk. Pure source-to-source. */
export function transform(code: string, filename = "input.tsx"): string {
  const sf = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TSX);
  const ranges = collectReactiveBindings(sf);
  if (ranges.length === 0) return code;

  // One insertion per boundary; apply high offset → low so positions are stable.
  const edits: { pos: number; str: string }[] = [];
  for (const r of ranges) {
    edits.push({ pos: r.start, str: OPEN });
    edits.push({ pos: r.end, str: CLOSE });
  }
  // Descending by position. At an (impossible-in-practice) tie, insert the
  // CLOSE first so a wrapping OPEN ends up to its left — keeps nesting valid.
  edits.sort((a, b) => b.pos - a.pos || (a.str === CLOSE ? -1 : 1));

  let out = code;
  for (const e of edits) out = out.slice(0, e.pos) + e.str + out.slice(e.pos);
  return out;
}
