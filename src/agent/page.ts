import type { AgentBridge } from "./bridge.js";
import { detectModelContext, toWebMCP } from "./webmcp.js";
import type { WebMCPTool } from "./webmcp.js";
import { toolsForDescriptor } from "./webmcp-tools.js";

export interface PageAgent {
  bridge: AgentBridge;
  tools: Map<string, WebMCPTool>;
  snapshot: AgentBridge["snapshot"];
  speculate: AgentBridge["speculate"];
  call: AgentBridge["call"];
}

export interface PageAgentOptions {
  namespace?: string;
}

/** Install the browser-agent global whether or not WebMCP exists. */
export function installPageAgent(bridge: AgentBridge, opts: PageAgentOptions = {}): PageAgent {
  const tools = toolsForDescriptor(bridge, bridge.descriptor());
  const pageAgent: PageAgent = {
    bridge,
    tools,
    snapshot: bridge.snapshot.bind(bridge),
    speculate: bridge.speculate.bind(bridge),
    call: bridge.call.bind(bridge),
  };

  const target = globalThis as typeof globalThis & Record<string, unknown>;
  if (opts.namespace) {
    const root = (target.__pimas ??= {}) as Record<string, unknown>;
    root[opts.namespace] = pageAgent;
  } else {
    target["__pimas"] = pageAgent;
  }

  if (detectModelContext()) toWebMCP(bridge, { namespace: opts.namespace });

  return pageAgent;
}
