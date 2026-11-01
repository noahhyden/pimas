import { createMemo } from "../src/reactive/index.js";
import { createStore } from "../src/store/index.js";
import { createModel } from "../src/agent/index.js";
import { usePimas } from "../src/react/index.js";

const model = createModel((m) => {
  const [cart, setCart] = createStore({
    items: [{ id: "a", qty: 2, price: 5 }],
  });
  const total = createMemo(() =>
    cart.items.reduce((s, i) => s + i.qty * i.price, 0),
  );

  m.expose("total", total);
  m.action("setQty", (id: string, qty: number) => {
    const i = cart.items.findIndex((row) => row.id === id);
    if (i >= 0) setCart("items", i, "qty", qty);
  }, { params: ["id", "qty"] });

  return { cart, total };
});

export function Checkout({ draftQty }: { draftQty: number }) {
  const live = usePimas(model.total);
  const preview = model.bridge.speculate("setQty", "a", draftQty).total as number;

  return (
    <>
      <div>Now: {live}</div>
      <div>If you confirm: {preview}</div>
      <button onClick={() => model.bridge.call("setQty", "a", draftQty)}>
        Confirm
      </button>
    </>
  );
}
