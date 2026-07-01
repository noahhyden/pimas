/**
 * L3 what-if oracle (issue #13). `speculate(apply, read)` evaluates hypothetical
 * writes against a SHADOW of the graph — reads/memos see the hypothetical, the
 * real graph is never mutated, no effects fire, and it rolls back on exit.
 */
import { describe, it, expect, vi } from "vitest";
import { createSignal, createMemo, createEffect, createRoot, speculate, isSpeculating } from "pimas";
import { createStore } from "pimas/store";

describe("speculate — L3 what-if oracle (issue #13)", () => {
  it("predicts a derived value under a hypothetical write, then rolls back", () => {
    const [qty, setQty] = createSignal(2);
    const [price] = createSignal(5);
    const total = createMemo(() => qty() * price());

    expect(total()).toBe(10); // real

    const predicted = speculate(() => setQty(10), () => total());
    expect(predicted).toBe(50); // hypothetical: 10 * 5

    // Real graph untouched.
    expect(qty()).toBe(2);
    expect(total()).toBe(10);
    expect(isSpeculating()).toBe(false);
  });

  it("is glitch-free across a diamond (each memo computes once, correctly)", () => {
    const [a, setA] = createSignal(1);
    const b = createMemo(() => a() + 1);
    const c = createMemo(() => a() + 1);
    const dRuns = vi.fn();
    const d = createMemo(() => {
      dRuns();
      return b() + c();
    });

    expect(d()).toBe(4); // (1+1)+(1+1)
    dRuns.mockClear();

    const predicted = speculate(() => setA(10), () => d());
    expect(predicted).toBe(22); // (10+1)+(10+1)
    expect(dRuns).toHaveBeenCalledTimes(1); // computed once against the shadow

    expect(d()).toBe(4); // real value intact
  });

  it("does NOT fire effects during speculation", () => {
    const [n, setN] = createSignal(0);
    const effectSpy = vi.fn();
    createRoot(() => createEffect(() => effectSpy(n())));
    expect(effectSpy).toHaveBeenCalledTimes(1); // initial

    const predicted = speculate(() => setN(99), () => n() * 2);
    expect(predicted).toBe(198);
    expect(effectSpy).toHaveBeenCalledTimes(1); // no re-run — nothing committed
    expect(n()).toBe(0);
  });

  it("reads real store data during speculation but rejects store writes", () => {
    const [s, set] = createStore({ rows: [{ id: "r1", qty: 2 }, { id: "r2", qty: 3 }] });
    const [mult, setMult] = createSignal(1);
    const total = createMemo(() => s.rows.reduce((sum, r) => sum + r.qty, 0) * mult());

    expect(total()).toBe(5); // (2+3)*1

    // Hypothetical view-state change (signal), reading real store rows.
    const predicted = speculate(() => setMult(10), () => total());
    expect(predicted).toBe(50);
    expect(total()).toBe(5); // rolled back

    // A store write inside speculate is rejected (would mutate committed state).
    expect(() => speculate(() => set("rows", 0, "qty", 99), () => total())).toThrow(/copy-on-write/);
    expect(s.rows[0]!.qty).toBe(2); // untouched

    void set;
  });

  it("supports the real mutation helpers (functional signal updates) as hypotheticals", () => {
    const [dir, setDir] = createSignal<"asc" | "desc">("asc");
    const arrow = createMemo(() => (dir() === "asc" ? "up" : "down"));
    const toggle = () => setDir((d) => (d === "asc" ? "desc" : "asc"));

    const predicted = speculate(toggle, () => arrow());
    expect(predicted).toBe("down");
    expect(dir()).toBe("asc"); // real toggle never happened
  });

  it("rejects nested speculation", () => {
    expect(() =>
      speculate(
        () => {},
        () => speculate(() => {}, () => 1),
      ),
    ).toThrow(/nested/);
  });
});
