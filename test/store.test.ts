import { describe, it, expect, vi } from "vitest";
import { createRoot, createEffect } from "pimas";
import { createStore, unwrap } from "pimas/store";

describe("createStore — fine-grained reactivity", () => {
  it("subscribes per field: an effect on one field ignores another's changes", () => {
    const [s, set] = createStore({ a: 1, b: 2 });
    const aSpy = vi.fn();
    const bSpy = vi.fn();
    createRoot(() => {
      createEffect(() => { s.a; aSpy(); });
      createEffect(() => { s.b; bSpy(); });
    });
    expect(aSpy).toHaveBeenCalledTimes(1);
    expect(bSpy).toHaveBeenCalledTimes(1);
    set("a", 10);
    expect(aSpy).toHaveBeenCalledTimes(2);
    expect(bSpy).toHaveBeenCalledTimes(1); // b untouched → not re-run
    expect(s.a).toBe(10);
  });

  it("does not notify when a field is set to an Object.is-equal value", () => {
    const [s, set] = createStore({ a: 1 });
    const spy = vi.fn();
    createRoot(() => createEffect(() => { s.a; spy(); }));
    expect(spy).toHaveBeenCalledTimes(1);
    set("a", 1); // equal → no notification
    expect(spy).toHaveBeenCalledTimes(1);
    set("a", 2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("tracks nested object fields fine-grained", () => {
    const [s, set] = createStore({ user: { name: "Ada", age: 36 } });
    const nameSpy = vi.fn();
    const ageSpy = vi.fn();
    createRoot(() => {
      createEffect(() => { s.user.name; nameSpy(); });
      createEffect(() => { s.user.age; ageSpy(); });
    });
    set("user", "name", "Grace");
    expect(s.user.name).toBe("Grace");
    expect(nameSpy).toHaveBeenCalledTimes(2);
    expect(ageSpy).toHaveBeenCalledTimes(1); // sibling field untouched
  });

  it("supports updater functions and root partial-merge", () => {
    const [s, set] = createStore({ count: 1, loading: true });
    set("count", (c) => c + 4);
    expect(s.count).toBe(5);
    set({ loading: false });
    expect(s.loading).toBe(false);
    expect(s.count).toBe(5);
  });

  it("array: length is reactive; editing an existing cell is fine-grained", () => {
    const [s, set] = createStore({ rows: [{ v: 1 }, { v: 2 }, { v: 3 }] });
    const lenSpy = vi.fn();
    const cellSpy = vi.fn();
    createRoot(() => {
      createEffect(() => { s.rows.length; lenSpy(); });
      createEffect(() => { s.rows[1]!.v; cellSpy(); });
    });
    set("rows", 1, "v", 20); // edit one cell — array length unchanged
    expect(s.rows[1]!.v).toBe(20);
    expect(cellSpy).toHaveBeenCalledTimes(2);
    expect(lenSpy).toHaveBeenCalledTimes(1); // length reader NOT re-run
    set("rows", (r) => [...r, { v: 4 }]); // append — length changes
    expect(s.rows.length).toBe(4);
    expect(lenSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps stable proxy identity for nested objects", () => {
    const [s] = createStore({ user: { name: "Ada" } });
    expect(s.user).toBe(s.user); // same proxy on every read → <For> keying works
  });

  it("unwrap returns the raw object (and passes primitives through)", () => {
    const raw = { a: 1 };
    const [s] = createStore(raw);
    expect(unwrap(s)).toBe(raw);
    expect(unwrap(5)).toBe(5);
  });

  it("batches a multi-field set into a single flush", () => {
    const [s, set] = createStore({ a: 1, b: 1 });
    const spy = vi.fn();
    createRoot(() => createEffect(() => { s.a; s.b; spy(); }));
    expect(spy).toHaveBeenCalledTimes(1);
    set({ a: 2, b: 2 }); // one merge → batched → one re-run, not two
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("makes key enumeration reactive to added keys", () => {
    const [s, set] = createStore<Record<string, number>>({ a: 1 });
    const spy = vi.fn();
    createRoot(() => createEffect(() => { Object.keys(s); spy(); }));
    expect(spy).toHaveBeenCalledTimes(1);
    set("b", 2); // new key → enumeration changed → re-run
    expect(spy).toHaveBeenCalledTimes(2);
    expect(Object.keys(s)).toEqual(["a", "b"]);
  });

  it("spreads and Object.assign without a proxy-invariant TypeError", () => {
    const [s] = createStore({ a: 1, b: { c: 2 } });
    const spread = { ...s };
    expect(spread.a).toBe(1);
    const copy = Object.assign({}, s) as { a: number };
    expect(copy.a).toBe(1);
  });

  it("ignores __proto__ writes (no prototype pollution)", () => {
    const [s, set] = createStore<Record<string, unknown>>({ a: 1 });
    set("__proto__" as never, { polluted: true } as never);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(s.a).toBe(1);
  });

  it("is read-only through the proxy (mutations must go through the setter)", () => {
    const [s] = createStore<{ a: number }>({ a: 1 });
    expect(() => {
      (s as { a: number }).a = 2;
    }).toThrow(/read-only/);
  });
});
