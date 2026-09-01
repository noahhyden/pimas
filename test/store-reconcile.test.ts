/**
 * reconcile — diff external data into a store preserving row identity.
 */
import { describe, it, expect, vi } from "vitest";
import { createRoot, createEffect } from "pimas";
import { createStore, reconcile, onStoreWrite } from "pimas/store";

describe("reconcile — store contract", () => {
  it("updates only the changed field of a matched row, keeping proxy identity", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: 1 }, { id: "b", v: 2 }] });
    const aSpy = vi.fn();
    const bSpy = vi.fn();
    createRoot(() => {
      createEffect(() => { s.rows[0]!.v; aSpy(); });
      createEffect(() => { s.rows[1]!.v; bSpy(); });
    });
    const r0 = s.rows[0];

    set("rows", reconcile([{ id: "a", v: 10 }, { id: "b", v: 2 }]));

    expect(s.rows[0]).toBe(r0);
    expect(s.rows[0]!.v).toBe(10);
    expect(aSpy).toHaveBeenCalledTimes(2);
    expect(bSpy).toHaveBeenCalledTimes(1);
  });

  it("adds rows (grow) while preserving existing identities", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: 1 }] });
    const r0 = s.rows[0];
    set("rows", reconcile([{ id: "a", v: 1 }, { id: "b", v: 2 }]));
    expect(s.rows.length).toBe(2);
    expect(s.rows[0]).toBe(r0);
    expect(s.rows[1]!.v).toBe(2);
  });

  it("removes rows (shrink) while preserving surviving identities", () => {
    const [s, set] = createStore({ rows: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const a = s.rows[0];
    const c = s.rows[2];
    set("rows", reconcile([{ id: "a" }, { id: "c" }]));
    expect(s.rows.length).toBe(2);
    expect(s.rows[0]).toBe(a);
    expect(s.rows[1]).toBe(c);
  });

  it("reorders same-length by moving the same references", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: 1 }, { id: "b", v: 2 }] });
    const a = s.rows[0];
    const b = s.rows[1];
    set("rows", reconcile([{ id: "b", v: 2 }, { id: "a", v: 1 }]));
    expect(s.rows[0]).toBe(b);
    expect(s.rows[1]).toBe(a);
  });

  it("recurses into a nested object, preserving its identity", () => {
    const [s, set] = createStore({ user: { name: "Ada", age: 36 } });
    const u = s.user;
    const nameSpy = vi.fn();
    const ageSpy = vi.fn();
    createRoot(() => {
      createEffect(() => { s.user.name; nameSpy(); });
      createEffect(() => { s.user.age; ageSpy(); });
    });
    set("user", reconcile({ name: "Grace", age: 36 }));
    expect(s.user).toBe(u);
    expect(s.user.name).toBe("Grace");
    expect(nameSpy).toHaveBeenCalledTimes(2);
    expect(ageSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT resurrect identity across a removal then re-add", () => {
    const [s, set] = createStore<{ rows: { id: string }[] }>({ rows: [{ id: "a" }] });
    const r0 = s.rows[0];
    set("rows", reconcile([]));
    set("rows", reconcile([{ id: "a" }]));
    expect(s.rows[0]).not.toBe(r0);
  });

  it("degrades a duplicate key in next to a fresh row (no reference reused twice)", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: 1 }] });
    set("rows", reconcile([{ id: "a", v: 2 }, { id: "a", v: 3 }]));
    expect(s.rows.length).toBe(2);
    expect(s.rows[0]!.v).toBe(2);
    expect(s.rows[1]!.v).toBe(3);
    expect(s.rows[0]).not.toBe(s.rows[1]);
  });

  it("key:null does a positional replace (no identity matching)", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: 1 }] });
    const r0 = s.rows[0];
    set("rows", reconcile([{ id: "a", v: 1 }], { key: null }));
    expect(s.rows[0]).not.toBe(r0);
  });

  it("falls back to a plain replace when the previous value isn't wrappable", () => {
    const [s, set] = createStore<{ rows: { id: string }[] | null }>({ rows: null });
    set("rows", reconcile([{ id: "a" }]));
    expect(s.rows?.[0]!.id).toBe("a");
  });

  it("emits one provenance write with the reconcile path", () => {
    const [, set] = createStore({ rows: [{ id: "a", v: 1 }] });
    const paths: unknown[] = [];
    const off = onStoreWrite((e) => paths.push(e.path));
    set("rows", reconcile([{ id: "a", v: 2 }]));
    expect(paths).toEqual([["rows"]]);
    off();
  });
});
