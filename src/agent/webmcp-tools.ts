import type { AgentBridge, AgentDescriptor } from "./bridge.js";
import type { WebMCPTool } from "./webmcp.js";

function envelope(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return { content: [{ type: "text", text }] };
}

function schemaFor(action: AgentDescriptor["actions"][string]): object {
  return action.params
    ? {
        type: "object",
        properties: Object.fromEntries(action.params.map((parameter) => [parameter, {}])),
        required: action.params,
      }
    : { type: "object", properties: { args: { type: "array", description: "positional arguments" } } };
}

function argvFor(action: AgentDescriptor["actions"][string], input: unknown): unknown[] {
  const bag = (input ?? {}) as Record<string, unknown>;
  return action.params
    ? action.params.map((parameter) => bag[parameter])
    : Array.isArray(bag.args)
      ? (bag.args as unknown[])
      : [];
}

export function toolsForDescriptor(
  bridge: AgentBridge,
  descriptor: AgentDescriptor,
  opts: { namespace?: string } = {},
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

  for (const [name, state] of Object.entries(descriptor.state)) {
    const tool: WebMCPTool = {
      name: `${prefix}get_${name}`,
      description: state.description ?? `Read the current value of "${name}".`,
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => envelope(bridge.read(name)),
    };
    tools.set(tool.name, tool);
  }

  for (const [name, action] of Object.entries(descriptor.actions)) {
    if (action.readOnly) continue;
    const tool: WebMCPTool = {
      name: `${prefix}simulate_${name}`,
      description: `Predict the state after ${name}(...) WITHOUT committing (L3 what-if).${action.description ? ` ${action.description}` : ""}`,
      inputSchema: schemaFor(action),
      annotations: { readOnlyHint: true },
      execute: async (input) => envelope(bridge.speculate(name, ...argvFor(action, input))),
    };
    tools.set(tool.name, tool);
  }

  const plan: WebMCPTool = {
    name: `${prefix}simulate_plan`,
    description:
      "Predict the state after applying several actions in order in ONE shadow (a multi-factor what-if). Commits nothing. A sensitivity sweep is N separate simulate_<action> calls, one per arg-set.",
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
      return envelope(bridge.speculatePlan(steps));
    },
  };
  tools.set(plan.name, plan);

  return tools;
}
