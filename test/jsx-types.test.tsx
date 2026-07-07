import { describe, it, expect } from "vitest";

/**
 * Compile-time assertions for the typed JSX surface (#18). This function is never
 * CALLED — constructing JSX would need a live render backend. It exists so `tsc`
 * (via `npm run typecheck`, which includes `test/`) validates the `@ts-expect-error`
 * lines below on every run: a regression guard against the intrinsic-element types
 * silently loosening back to `any`.
 */
function _typeAssertions() {
  // @ts-expect-error misspelled element name is rejected
  const typo = <dvi />;
  // @ts-expect-error unknown attribute on a known element is rejected
  const badAttr = <button notARealAttribute="x" />;

  // Valid usage must NOT error:
  const dyn = <button class={() => "cls"} disabled onClick={() => {}} />; // thunk attr + bool + event
  const escapes = <div data-id="1" aria-label="go" role="button" />; // data-*/aria-*/global
  const custom = <my-widget foo="bar" />; // custom element (hyphenated tag)
  const svg = (
    <svg viewBox="0 0 10 10">
      <circle cx={5} cy={5} r={4} fill="red" />
      <path d="M0 0 L10 10" />
    </svg>
  );
  return [typo, badAttr, dyn, escapes, custom, svg];
}

describe("typed JSX (#18)", () => {
  it("intrinsic-element types catch typos/bad attrs and allow real usage", () => {
    // The substantive assertions are the `@ts-expect-error` checks in
    // `_typeAssertions`, enforced by `npm run typecheck`.
    expect(typeof _typeAssertions).toBe("function");
  });
});
