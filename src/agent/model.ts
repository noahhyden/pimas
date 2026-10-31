/** One-call model factory: a reactive root, an agent bridge, and store write provenance wired by default. */
import { createAgentBridge } from "./bridge.js";
import type { AgentBridge, AgentOptions, AgentRegistrar } from "./bridge.js";
import { onStoreWrite } from "../store/index.js";

export type Model<T extends object> = T & {
  /** The agent/preview surface: snapshot, speculate, call, graph, … */
  bridge: AgentBridge;
};

const defaultWriteTap: AgentOptions["writeTap"] = (record) =>
  onStoreWrite((e) => record(e.path.map(String).join(".")));

/** Build a model; `setup` runs inside the bridge root, so `expose` / `action` there and return what the caller reads. */
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
