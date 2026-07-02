/**
 * reconcile (#5) — diff external data into a store preserving row identity.
 *
 * Two layers: the store-level contract (fine-grained notifications + preserved
 * proxy identity), and the DOM-level payoff (a server-refreshed keyed <For>
 * reuses/moves its rows instead of tearing them down and rebuilding).
 */
import { describe, it, expect, vi } from "vitest";
import { createRoot, createEffect } from "pimas";
import { createStore, reconcile, onStoreWrite } from "pimas/store";
import { render } from "pimas/dom";
import { For } from "pimas/flow";

const texts = (root: Element, sel = "li") => [...root.querySelectorAll(sel)].map((n) => n.textContent);

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

    expect(s.rows[0]).toBe(r0); // same proxy — matched by key, mutated in place
    expect(s.rows[0]!.v).toBe(10);
    expect(aSpy).toHaveBeenCalledTimes(2); // changed field notified
    expect(bSpy).toHaveBeenCalledTimes(1); // untouched row stayed silent
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
    expect(s.rows[1]).toBe(c); // c reused, not rebuilt
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
    expect(ageSpy).toHaveBeenCalledTimes(1); // unchanged nested field silent
  });

  it("does NOT resurrect identity across a removal then re-add", () => {
    const [s, set] = createStore<{ rows: { id: string }[] }>({ rows: [{ id: "a" }] });
    const r0 = s.rows[0];
    set("rows", reconcile([]));
    set("rows", reconcile([{ id: "a" }]));
    expect(s.rows[0]).not.toBe(r0); // a genuinely new object → new proxy
  });

  it("degrades a duplicate key in next to a fresh row (no reference reused twice)", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: 1 }] });
    set("rows", reconcile([{ id: "a", v: 2 }, { id: "a", v: 3 }]));
    expect(s.rows.length).toBe(2);
    expect(s.rows[0]!.v).toBe(2); // the one matched row, updated
    expect(s.rows[1]!.v).toBe(3); // the dup fell through to a new row
    expect(s.rows[0]).not.toBe(s.rows[1]); // never the same proxy at two slots
  });

  it("key:null does a positional replace (no identity matching)", () => {
    const [s, set] = createStore({ rows: [{ id: "a", v: 1 }] });
    const r0 = s.rows[0];
    set("rows", reconcile([{ id: "a", v: 1 }], { key: null }));
    expect(s.rows[0]).not.toBe(r0); // opted out of keying → fresh proxy
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

describe("reconcile — <For> reuse (the payoff)", () => {
  it("a server-refresh with one changed field reuses DOM rows, rebuilds nothing", () => {
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
    expect(texts(root)).toEqual(["1", "2"]);
    const liA = root.querySelectorAll("li")[0]!;

    set("rows", reconcile([{ id: "a", v: "9" }, { id: "b", v: "2" }]));

    expect(builds).toBe(2); // ← no row body re-ran
    expect(texts(root)).toEqual(["9", "2"]); // only the changed cell updated
    expect(root.querySelectorAll("li")[0]).toBe(liA); // same DOM node
  });

  it("a reorder refresh moves the same DOM nodes rather than rebuilding", () => {
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
    const liA = root.querySelectorAll("li")[0]!; // a's node

    set("rows", reconcile([{ id: "b", v: "2" }, { id: "a", v: "1" }]));

    expect(builds).toBe(2); // no rebuild on reorder
    expect(texts(root)).toEqual(["2", "1"]);
    expect(root.querySelectorAll("li")[1]).toBe(liA); // a's node, moved to slot 1
  });
});
