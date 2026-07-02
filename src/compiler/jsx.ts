/**
 * Shared JSX classification for the compiler passes (#4 / #12).
 *
 * Phase A (thunk-eraser) and Phase D (resumability) must agree BYTE-FOR-BYTE on
 * what is an intrinsic element, an event attribute, and a function expression —
 * a divergence between them, or from the runtime (engine.ts setProp), would be a
 * miscompile. One source of truth lives here so the two passes can't drift.
 */
import ts from "typescript";

/** Intrinsic (lowercase-leading identifier) tag — mirrors `createWith`. A
 *  member tag (`Foo.Bar`) or a capitalized name is a component. */
export function isIntrinsicTag(tag: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
}

/** The runtime's event-attribute test (engine.ts setProp), byte-for-byte. */
export function isEventAttrName(name: string): boolean {
  return name.length > 2 && name[0] === "o" && name[1] === "n";
}

/** The runtime's ref-attribute test (engine.ts setProp). */
export function isRefAttrName(name: string): boolean {
  return name === "ref";
}

/** A function expression — already a thunk/handler; never (double-)wrapped. */
export function isFunctionExpr(e: ts.Expression): e is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(e) || ts.isFunctionExpression(e);
}
