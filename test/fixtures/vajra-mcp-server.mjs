let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n"); buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.id == null) continue;
    let result;
    if (request.method === "initialize") result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } };
    else if (request.method === "tools/list") result = { tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } }] };
    else if (request.method === "tools/call") result = { content: [{ type: "text", text: request.params.arguments.message }] };
    else result = {};
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  }
});
