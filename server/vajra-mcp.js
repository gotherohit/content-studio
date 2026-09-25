import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";

const alias = (server, name) => `mcp_${server.scope}_${server.id}_${name}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
const bounded = (value, max = 30000) => JSON.stringify(value ?? null).slice(0, max);
const expand = (value) => String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_all, name) => {
  if (!process.env[name]) throw new Error(`Environment variable ${name} is not set`);
  return process.env[name];
});

/** Connections are scoped to one Vajra run and closed when that run ends. */
export async function connectMcp(servers, { workspace, signal, onError = () => {} }) {
  const clients = [], definitions = [], calls = new Map();
  async function add(server) {
    const client = new Client({ name: "content-studio-vajra", version: "1.0.0" }, { capabilities: {} });
    let transport;
    try {
      if (server.transport === "stdio") {
        const env = { ...getDefaultEnvironment() };
        for (const [key, value] of Object.entries(server.env || {})) env[key] = expand(value);
        transport = new StdioClientTransport({ command: server.command, args: server.args || [], cwd: workspace, env, stderr: "pipe" });
      } else {
        const url = new URL(server.url);
        const headers = Object.fromEntries(Object.entries(server.headers || {}).map(([key, value]) => [key, expand(value)]));
        transport = new StreamableHTTPClientTransport(url, { fetch: async (input, init) => {
          const response = await fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...headers }, redirect: "manual" });
          if (response.status >= 300 && response.status < 400) throw new Error("MCP HTTP redirects are disabled");
          return response;
        } });
      }
      clients.push(client);
      await client.connect(transport, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      const discovered = []; let cursor;
      for (let page = 0; page < 5 && discovered.length < 40; page++) {
        const listed = await client.listTools(cursor ? { cursor } : {}, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
        discovered.push(...(listed.tools || []));
        cursor = listed.nextCursor;
        if (!cursor) break;
      }
      for (const tool of discovered.slice(0, 40)) {
        if (!tool.name || typeof tool.name !== "string") continue;
        const name = alias(server, tool.name);
        if (calls.has(name)) { onError(`${server.label}: duplicate tool alias ${name}`); continue; }
        calls.set(name, { client, server, original: tool.name });
        definitions.push({ name, description: `External MCP tool from ${server.label}: ${String(tool.description || tool.name).slice(0, 500)}`, parameters: tool.inputSchema?.type === "object" ? tool.inputSchema : { type: "object", properties: {} } });
      }
    } catch (error) {
      onError(`${server.label}: ${error.message}`);
      if (transport) await client.close().catch(() => {});
    }
  }
  await Promise.all(servers.filter((server) => server.enabled).map(add));
  return {
    definitions,
    has: (name) => calls.has(name),
    async call(name, args, signal) {
      const found = calls.get(name);
      if (!found) throw new Error("MCP tool is no longer available");
      const result = await found.client.callTool({ name: found.original, arguments: args }, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
      if (result.isError) throw new Error(`MCP tool failed: ${bounded(result.structuredContent || result.content, 2000)}`);
      return { server: found.server.label, tool: found.original, content: bounded(result.structuredContent || result.content) };
    },
    describe: (name) => { const found = calls.get(name); return found && { server: found.server.label, tool: found.original }; },
    close: () => Promise.allSettled(clients.map((client) => client.close())),
  };
}
