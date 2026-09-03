import type { AgentDescriptor } from "./bridge.js";
import type { WebMCPTool } from "./webmcp.js";

export interface WebMCPBridgeSurface {
  snapshot(): { state: Record<string, unknown>; actions: string[] } | Promise<{ state: Record<string, unknown>; actions: string[] }>;
  descriptor(): AgentDescriptor | Promise<AgentDescriptor>;
  call(name: string, ...args: unknown[]): unknown;
  speculate(name: string, ...args: unknown[]): unknown;
  speculatePlan(steps: Array<[string, ...unknown[]]>): unknown;
  speculateSweep?(name: string, argsList: unknown[][]): unknown;
}

export function envelope(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return { content: [{ type: "text", text }] };
}

export function schemaFor(action: AgentDescriptor["actions"][string]): object {
  return (
    action.input ??
    (action.params
      ? {
          type: "object",
          properties: Object.fromEntries(action.params.map((parameter) => [parameter, {}])),
          required: action.params,
        }
      : { type: "object", properties: { args: { type: "array", description: "positional arguments" } } })
  );
}

export function argvFor(action: AgentDescriptor["actions"][string], input: unknown): unknown[] {
  const bag = (input ?? {}) as Record<string, unknown>;
  return action.params
    ? action.params.map((parameter) => bag[parameter])
    : Array.isArray(bag.args)
      ? (bag.args as unknown[])
      : [];
}

export function toolsForDescriptor(
  bridge: WebMCPBridgeSurface,
  descriptor: AgentDescriptor,
  opts: { namespace?: string; readTools?: boolean; simulateTools?: boolean } = {},
): Map<string, WebMCPTool> {
  const tools = new Map<string, WebMCPTool>();
  const prefix = opts.namespace ? `${opts.namespace}.` : "";

  for (const [name, action] of Object.entries(descriptor.actions)) {
    const tool: WebMCPTool = {
      name: `${prefix}${name}`,
      description: action.description ?? name,
      inputSchema: schemaFor(action),
      annotations: action.readOnly ? { readOnlyHint: true } : undefined,
      execute: async (input) => envelope(await bridge.call(name, ...argvFor(action, input))),
    };
    tools.set(tool.name, tool);
  }

  if (opts.readTools !== false) {
    for (const [name, state] of Object.entries(descriptor.state)) {
      const tool: WebMCPTool = {
        name: `${prefix}get_${name}`,
        description: state.description ?? `Read the current value of "${name}".`,
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => envelope((await bridge.snapshot()).state[name]),
      };
      tools.set(tool.name, tool);
    }
  }

  if (opts.simulateTools !== false) {
    for (const [name, action] of Object.entries(descriptor.actions)) {
      if (action.readOnly) continue;
      const tool: WebMCPTool = {
        name: `${prefix}simulate_${name}`,
        description: `Predict the state after ${name}(...) WITHOUT committing (L3 what-if).${action.description ? ` ${action.description}` : ""}`,
        inputSchema: schemaFor(action),
        annotations: { readOnlyHint: true },
        execute: async (input) => envelope(await bridge.speculate(name, ...argvFor(action, input))),
      };
      tools.set(tool.name, tool);
    }

    const plan: WebMCPTool = {
      name: `${prefix}simulate_plan`,
      description:
        "Predict the state after applying several actions in order in ONE shadow (a multi-factor what-if). Commits nothing.",
      inputSchema: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            description: "Ordered steps applied in the shadow.",
            items: {
              type: "object",
              properties: {
                action: { type: "string", description: "action name" },
                args: { type: "array", description: "positional arguments" },
              },
              required: ["action"],
            },
          },
        },
        required: ["steps"],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const raw = ((input ?? {}) as { steps?: Array<{ action: string; args?: unknown[] }> }).steps ?? [];
        const steps = raw.map((step) => [step.action, ...(step.args ?? [])] as [string, ...unknown[]]);
        return envelope(await bridge.speculatePlan(steps));
      },
    };
    tools.set(plan.name, plan);

    const sweep: WebMCPTool = {
      name: `${prefix}simulate_sweep`,
      description:
        "Run one independent what-if of an action per arg-set (a sensitivity sweep). Returns the predicted state at each point. Commits nothing.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: "action name to sweep" },
          argsList: {
            type: "array",
            description: "list of positional-argument arrays, one per sweep point",
            items: { type: "array" },
          },
        },
        required: ["action", "argsList"],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const bag = (input ?? {}) as { action?: string; argsList?: unknown[][] };
        const action = bag.action as string;
        const argsList = bag.argsList ?? [];
        const result = bridge.speculateSweep
          ? await bridge.speculateSweep(action, argsList)
          : await Promise.all(argsList.map((args) => bridge.speculate(action, ...args)));
        return envelope(result);
      },
    };
    tools.set(sweep.name, sweep);
  }

  return tools;
}
