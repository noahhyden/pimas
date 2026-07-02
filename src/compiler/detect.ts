/**
 * Compiler Phase A — reactive-binding DETECTION (#4 / #12 Phase A).
 *
 * Finds the JSX expression sites the thunk-eraser must wrap in `() => (…)` so
 * they hit the runtime's reactive branches (`engine.ts` setProp/insert
 * `typeof value === "function"`). This is a pure AST analysis over the JSX
 * BEFORE desugaring; it is kept separate so Phase B (templates) and Phase D
 * (resumability) can reuse the same classification (#12 "must not foreclose").
 *
 * The rule mirrors the runtime EXACTLY (a divergence would be a miscompile):
 * only INTRINSIC-element bindings are reactive at the DOM seam — component
 * props/children are opaque data passed straight through `createWith`, so they
 * are left to the author's hand-thunk convention (D#28). Within an intrinsic
 * element: children (→ insert) and attributes EXCEPT `ref` and `on*` (which the
 * runtime routes to ref-assign / listen, not to a reactive effect).
 *
 * Bias: when in doubt, WRAP. A false positive (wrapping a constant) is a
 * harmless one-shot effect; a false negative (missing a reactive read) is the
 * silent-staleness footgun (D#21). So we skip only what is PROVABLY safe to
 * leave alone: an expression that is already a function, or a bare literal.
 */
import ts from "typescript";

/** A [start, end) character range of an expression to wrap. */
export interface WrapRange {
  start: number;
  end: number;
}

/** Intrinsic (lowercase-leading identifier) tag — mirrors `createWith`. A
 *  member tag (`Foo.Bar`) or capitalized name is a component: excluded. */
function isIntrinsicTag(tag: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
}

/** Already a function (idempotent: never double-wrap) or a bare literal. */
function isProvablySafe(e: ts.Expression): boolean {
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return true;
  return (
    ts.isStringLiteral(e) ||
    ts.isNumericLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  );
}

/** The runtime's own attribute classification (engine.ts setProp): `ref` and
 *  `on*` are NOT reactive bindings. Matched byte-for-byte, quirks included. */
function isReactiveAttrName(name: string): boolean {
  if (name === "ref") return false;
  if (name.length > 2 && name[0] === "o" && name[1] === "n") return false;
  return true;
}

/** Collect the expression ranges to wrap, in source order. */
export function collectReactiveBindings(sf: ts.SourceFile): WrapRange[] {
  const out: WrapRange[] = [];

  const consider = (e: ts.Expression | undefined): void => {
    if (e && !isProvablySafe(e)) out.push({ start: e.getStart(sf), end: e.getEnd() });
  };

  const collectAttrs = (attrs: ts.JsxAttributes): void => {
    for (const p of attrs.properties) {
      // JsxSpreadAttribute ({...props}) can't be wrapped member-wise — skip.
      if (!ts.isJsxAttribute(p) || !p.initializer) continue;
      if (!ts.isJsxExpression(p.initializer)) continue; // string-literal attr — static
      if (!isReactiveAttrName(p.name.getText(sf))) continue;
      consider(p.initializer.expression);
    }
  };

  const collectChildren = (children: ts.NodeArray<ts.JsxChild>): void => {
    for (const c of children) if (ts.isJsxExpression(c)) consider(c.expression);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      if (isIntrinsicTag(node.openingElement.tagName)) {
        collectAttrs(node.openingElement.attributes);
        collectChildren(node.children); // component children stay opaque
      }
    } else if (ts.isJsxSelfClosingElement(node)) {
      if (isIntrinsicTag(node.tagName)) collectAttrs(node.attributes);
    } else if (ts.isJsxFragment(node)) {
      collectChildren(node.children);
    }
    // Recurse regardless, so nested elements (incl. those inside a wrapped
    // expression) are visited and wrapped independently.
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}
