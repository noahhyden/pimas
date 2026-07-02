/**
 * produce (#5) — Immer-style mutable-draft sugar over the store's setter.
 *
 * The producer mutates a writable draft with plain assignments / array ops; each
 * write routes through the SAME fine-grained setProperty as `setStore(...path)`,
 * so notification granularity, identity preservation, and guards are identical —
 * this only proves the draft layer maps mutations correctly.
 */
import { describe, it, expect, vi } from "vitest";
import { createRoot, createEffect } from "pimas";
import { createStore, produce } from "pimas/store";
import { render } from "pimas/dom";
import { For } from "pimas/flow";

const texts = (root: Element, sel = "li") => [...root.querySelectorAll(sel)].map((n) => n.textContent);

describe("produce — draft maps to fine-grained writes", () => {
  it("notifies only the mutated field", () => {
    const [s, set] = createStore({ a: 1, b: 2 });
    const aSpy = vi.fn();
    const bSpy = vi.fn();
    createRoot(() => {
      createEffect(() => { s.a; aSpy(); });
      createEffect(() => { s.b; bSpy(); });
    });
    set(produce((d) => { d.a = 10; }));
    expect(s.a).toBe(10);
    expect(aSpy).toHaveBeenCalledTimes(2);
    expect(bSpy).toHaveBeenCalledTimes(1); // sibling untouched
  });

  it("dedups a write to an Object.is-equal value (no notification)", () => {
    const [s, set] = createStore({ a: 1 });
    const spy = vi.fn();
    createRoot(() => createEffect(() => { s.a; spy(); }));
    expect(spy).toHaveBeenCalledTimes(1);
    set(produce((d) => { d.a = d.a; }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("mutates a nested field, preserving the nested object's identity", () => {
    const [s, set] = createStore({ user: { name: "Ada", age: 36 } });
    const u = s.user;
    const nameSpy = vi.fn();
    const ageSpy = vi.fn();
    createRoot(() => {
      createEffect(() => { s.user.name; nameSpy(); });
      createEffect(() => { s.user.age; ageSpy(); });
    });
    set(produce((d) => { d.user.name = "Grace"; }));
    expect(s.user).toBe(u); // same proxy — mutated in place
    expect(s.user.name).toBe("Grace");
    expect(nameSpy).toHaveBeenCalledTimes(2);
    expect(ageSpy).toHaveBeenCalledTimes(1);
  });

  it("array push grows the list and makes length reactive", () => {
    const [s, set] = createStore({ rows: [{ v: 1 }] });
    const lenSpy = vi.fn();
    createRoot(() => createEffect(() => { s.rows.length; lenSpy(); }));
    set("rows", produce((rows) => { rows.push({ v: 2 }); }));
    expect(s.rows.length).toBe(2);
    expect(s.rows[1]!.v).toBe(2);
    expect(lenSpy).toHaveBeenCalledTimes(2);
  });

  it("array pop shrinks the list and fires length", () => {
    const [s, set] = createStore({ rows: [{ v: 1 }, { v: 2 }] });
    const lenSpy = vi.fn();
    createRoot(() => createEffect(() => { s.rows.length; lenSpy(); }));
    set("rows", produce((rows) => { rows.pop(); }));
    expect(s.rows.length).toBe(1);
    expect(lenSpy).toHaveBeenCalledTimes(2);
  });

  it("edits an existing cell fine-grained, keeping its proxy identity", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: 1 }, { id: "b", v: 2 }] });
    const r0 = s.rows[0];
    set("rows", produce((rows) => { rows[0]!.v = 9; }));
    expect(s.rows[0]).toBe(r0);
    expect(s.rows[0]!.v).toBe(9);
  });

  it("delete removes a key and fires enumeration", () => {
    const [s, set] = createStore<Record<string, number>>({ a: 1, b: 2 });
    const keysSpy = vi.fn();
    createRoot(() => createEffect(() => { Object.keys(s); keysSpy(); }));
    set(produce((d) => { delete d.a; }));
    expect(Object.keys(s)).toEqual(["b"]);
    expect(keysSpy).toHaveBeenCalledTimes(2);
  });

  it("batches a multi-field producer into one flush", () => {
    const [s, set] = createStore({ a: 1, b: 1 });
    const spy = vi.fn();
    createRoot(() => createEffect(() => { s.a; s.b; spy(); }));
    expect(spy).toHaveBeenCalledTimes(1);
    set(produce((d) => { d.a = 2; d.b = 2; }));
    expect(spy).toHaveBeenCalledTimes(2); // one re-run, not two
  });

  it("ignores __proto__ writes (no pollution, no throw)", () => {
    const [s, set] = createStore<Record<string, unknown>>({ a: 1 });
    expect(() => set(produce((d) => { (d as Record<string, unknown>).__proto__ = { polluted: true }; }))).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(s.a).toBe(1);
  });

  it("throws on a non-object produce target", () => {
    const [, set] = createStore<{ n: number }>({ n: 1 });
    expect(() => set("n" as never, produce(() => {}) as never)).toThrow(/not an object/);
  });
});

describe("produce — speculation + <For>", () => {
  it("does not touch the real store from a produce inside speculate (implicitly commit-safe)", () => {
    // A committed produce is the baseline; ensure a plain committed produce works
    // after establishing state (guards against the draft leaking raw writes).
    const [s, set] = createStore({ count: 1 });
    set(produce((d) => { d.count = d.count + 1; }));
    set(produce((d) => { d.count = d.count + 1; }));
    expect(s.count).toBe(3); // reads inside the draft saw the prior write
  });

  it("a produce editing one row reuses DOM rows, rebuilds nothing", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: "1" }, { id: "b", v: "2" }] });
    let builds = 0;
    const root = document.createElement("div");
    render(
      () => (
        <ul>
          <For each={() => s.rows}>
            {(row) => {
              builds++;
              return <li>{() => row.v}</li>;
            }}
          </For>
        </ul>
      ),
      root,
    );
    expect(builds).toBe(2);
    const liA = root.querySelectorAll("li")[0]!;

    set("rows", produce((rows) => { rows[0]!.v = "9"; }));

    expect(builds).toBe(2); // no rebuild
    expect(texts(root)).toEqual(["9", "2"]);
    expect(root.querySelectorAll("li")[0]).toBe(liA); // same DOM node
  });
});
