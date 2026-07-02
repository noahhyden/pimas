/**
 * Compiler Phase A — thunk-eraser transform (#4 / #12 Phase A).
 * Table-driven: authored source → transform() → assert the emitted thunks.
 */
import { describe, it, expect } from "vitest";
import { transform } from "../../src/compiler/transform";

const t = (s: string) => transform(s, "f.tsx");

describe("thunk-eraser — wraps reactive intrinsic bindings", () => {
  it("wraps a bare call child", () => {
    expect(t("const x = <span>{count()}</span>;")).toContain("<span>{() => (count())}</span>");
  });

  it("wraps a member-on-call and a store read", () => {
    expect(t("const x = <span>{user().name}</span>;")).toContain("{() => (user().name)}");
    expect(t("const x = <li>{s.rows[i].status}</li>;")).toContain("{() => (s.rows[i].status)}");
  });

  it("wraps a reactive attribute expression (ternary in class)", () => {
    expect(t('const x = <div class={active() ? "on" : "off"} />;')).toContain(
      'class={() => (active() ? "on" : "off")}',
    );
  });

  it("wraps string-concat / template children", () => {
    expect(t("const x = <li>{i() + ': ' + it.n}</li>;")).toContain("{() => (i() + ': ' + it.n)}");
    expect(t("const x = <div>{`w:${w()}`}</div>;")).toContain("{() => (`w:${w()}`)}");
  });
});

describe("thunk-eraser — leaves the right things alone", () => {
  it("does not wrap a bare literal child or a literal-valued attr", () => {
    expect(t('const x = <span>{"hi"}</span>;')).toBe('const x = <span>{"hi"}</span>;');
    expect(t("const x = <span>{42}</span>;")).toBe("const x = <span>{42}</span>;");
    expect(t('const x = <button type="button">go</button>;')).toBe('const x = <button type="button">go</button>;');
  });

  it("does not wrap event handlers or ref (runtime routes them elsewhere)", () => {
    const src = "const x = <button onClick={() => setN(n() + 1)} ref={(el) => (r = el)}>go</button>;";
    expect(t(src)).toBe(src);
  });

  it("does not double-wrap an existing thunk (idempotent)", () => {
    const src = "const x = <span>{() => count()}</span>;";
    expect(t(src)).toBe(src);
    const once = t("const x = <span>{count()}</span>;");
    expect(t(once)).toBe(once); // running the pass twice is a no-op
  });

  it("leaves component attributes and children opaque (author's convention)", () => {
    expect(t("const x = <Counter value={[a, b]} />;")).toBe("const x = <Counter value={[a, b]} />;");
    expect(t("const x = <Show>{active()}</Show>;")).toBe("const x = <Show>{active()}</Show>;");
    // a member-tag component (Foo.Bar) is also excluded
    expect(t("const x = <Ns.Widget on={live()} />;")).toBe("const x = <Ns.Widget on={live()} />;");
  });

  it("leaves JSX spread untouched (can't wrap members)", () => {
    expect(t("const x = <div {...props} />;")).toBe("const x = <div {...props} />;");
  });

  it("returns the source unchanged when there is nothing to wrap", () => {
    const src = "const x = 1 + 2;";
    expect(t(src)).toBe(src);
  });
});

describe("thunk-eraser — nesting", () => {
  it("wraps an outer expression and an inner intrinsic binding independently", () => {
    const out = t("const x = <div>{cond() ? <b>{y()}</b> : null}</div>;");
    expect(out).toContain("{() => (cond() ? <b>{() => (y())}</b> : null)}");
  });
});
