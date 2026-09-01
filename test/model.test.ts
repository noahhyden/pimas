import { describe, it, expect } from "vitest";
import { createMemo } from "pimas";
import { createStore } from "pimas/store";
import { createModel } from "pimas/agent";

describe("createModel", () => {
  function cart() {
    return createModel((m) => {
      const [s, set] = createStore({
        items: [{ id: "a", qty: 2, price: 5 }],
      });
      const total = createMemo(() => s.items.reduce((sum, i) => sum + i.qty * i.price, 0));
      m.expose("total", total);
      m.expose("qty", () => s.items[0]!.qty);
      m.action(
        "setQty",
        (id: unknown, qty: unknown) => {
          const i = s.items.findIndex((row) => row.id === id);
          if (i >= 0) set("items", i, "qty", qty as number);
        },
        { params: ["id", "qty"] },
      );
      return { s, total };
    });
  }

  it("returns the setup object plus a bridge", () => {
    const model = cart();
    expect(model.total()).toBe(10);
    expect(model.bridge.snapshot().state.total).toBe(10);
    model.bridge.dispose();
  });

  it("speculate predicts without committing; call commits", () => {
    const model = cart();
    expect(model.bridge.speculate("setQty", "a", 10)).toEqual({ total: 50, qty: 10 });
    expect(model.total()).toBe(10);
    expect(model.s.items[0]!.qty).toBe(2);

    model.bridge.call("setQty", "a", 10);
    expect(model.total()).toBe(50);
    model.bridge.dispose();
  });

  it("wires store provenance by default so explain() names the path", () => {
    const model = cart();
    model.bridge.call("setQty", "a", 3);
    const cause = model.bridge.explain();
    expect(cause?.action).toBe("setQty");
    expect(cause?.changed).toContain("total");
    expect(cause?.writes.some((w) => w.includes("qty"))).toBe(true);
    model.bridge.dispose();
  });
});
