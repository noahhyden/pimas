/**
 * One-call model factory. Owns a reactive root, an agent bridge, and (by default)
 * store write provenance so `explain()` works without extra wiring.
 *
 * `setup` registers what an agent (or a preview UI) can read and call, and
 * returns the object you use from React: accessors, setters, memos.
 */
import { createAgentBridge } from "./bridge.js";
import type { AgentBridge, AgentOptions, AgentRegistrar } from "./bridge.js";
import { onStoreWrite } from "../store/index.js";

export type Model<T extends object> = T & {
  /** The agent/preview surface: snapshot, speculate, call, graph, … */
  bridge: AgentBridge;
};

const defaultWriteTap: AgentOptions["writeTap"] = (record) =>
  onStoreWrite((e) => record(e.path.map(String).join(".")));

/**
 * Build a model. `setup` runs inside the bridge root: `expose` / `action` there,
 * return the values your UI will read.
 *
 * ```ts
 * const model = createModel((m) => {
 *   const [cart, setCart] = createStore({ items: [{ id: "a", qty: 2, price: 5 }] });
 *   const total = createMemo(() => cart.items.reduce((s, i) => s + i.qty * i.price, 0));
 *   m.expose("total", total);
 *   m.action("setQty", (id: string, qty: number) => { … }, { params: ["id", "qty"] });
 *   return { cart, total };
 * });
 *
 * model.total()                         // live
 * model.bridge.speculate("setQty", "a", 10)  // predicted, nothing committed
 * ```
 */
export function createModel<T extends object>(
  setup: (r: AgentRegistrar) => T,
  opts: AgentOptions = {},
): Model<T> {
  let api!: T;
  const { writeTap, ...rest } = opts;
  const bridge = createAgentBridge((r) => {
    api = setup(r);
  }, { ...rest, writeTap: writeTap ?? defaultWriteTap });
  return { ...api, bridge };
}
