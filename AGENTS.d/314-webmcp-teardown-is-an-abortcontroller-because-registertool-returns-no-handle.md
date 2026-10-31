## WebMCP teardown is an AbortController because registerTool returns no handle

Register with registerTool(tool, { signal }) and abort to unregister; keep the document.modelContext then navigator.modelContext lookup isolated in webmcp.ts as the spec still moves.
