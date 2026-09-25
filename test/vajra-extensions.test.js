import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import express from "express";
import { fileURLToPath } from "node:url";
import { createVajraExtensions } from "../server/vajra-extensions.js";
import { connectMcp } from "../server/vajra-mcp.js";
import { executeTool } from "../server/agent-tools.js";
import { createResearchAgent } from "../server/research-agent.js";
import { sse } from "../server/agent-model.js";

async function scratch(t) {
  const base = path.resolve(process.platform === "win32" ? "D:/test content studio" : os.tmpdir());
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "vajra-extensions-"));
  t.after(async () => { if (!root.startsWith(base + path.sep)) throw new Error("Invalid cleanup path"); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}
const fixture = fileURLToPath(new URL("./fixtures/vajra-mcp-server.mjs", import.meta.url));

test("skills and MCP settings are isolated by project and global scope", async (t) => {
  const root = await scratch(t), app = path.join(root, "app"), project = path.join(root, "project");
  await fs.mkdir(app); await fs.mkdir(project);
  const extensions = createVajraExtensions({ config: { appDir: () => app, dirOf: (id) => id === "scratch" ? project : null } });
  await extensions.putSkill(null, "global", "fact-check", "---\ndescription: Verify facts\n---\nCheck citations.");
  await extensions.putSkill("scratch", "project", "outline", "# Outline\nCreate a research outline.");
  assert.deepEqual((await extensions.listSkills(null)).map((s) => s.id), ["fact-check"]);
  assert.deepEqual((await extensions.listSkills("scratch")).map((s) => s.id), ["fact-check", "outline"]);
  assert.equal((await extensions.listSkills("scratch"))[0].description, "Verify facts");
  const skillContext = { signal: new AbortController().signal, skills: () => extensions.listSkills("scratch"), skillResource: (scope, id, file) => extensions.readSkillResource("scratch", scope, id, file) };
  assert.deepEqual((await executeTool("list_skills", {}, skillContext)).map((skill) => skill.id), ["fact-check", "outline"]);
  assert.match((await executeTool("read_skill", { scope: "global", id: "fact-check" }, skillContext)).content, /Check citations/);
  assert.match(await fs.readFile(path.join(project, ".ai", "skills", "outline", "SKILL.md"), "utf8"), /research outline/);
  await extensions.putServer("scratch", "project", { id: "fixture", label: "Fixture", transport: "stdio", command: process.execPath, args: [fixture] });
  assert.equal((await extensions.listServers("scratch")).length, 1);
  assert.equal((await extensions.listServers("scratch"))[0].trusted, true);
  assert.equal((await extensions.listServers(null)).length, 0);
  const mcpFile = path.join(project, ".ai", "mcp.json");
  const changed = JSON.parse(await fs.readFile(mcpFile, "utf8")); changed[0].command = "unreviewed-program";
  await fs.writeFile(mcpFile, JSON.stringify(changed));
  assert.equal((await extensions.listServers("scratch"))[0].trusted, false);
  await extensions.putServer("scratch", "project", { id: "fixture", label: "Fixture", transport: "stdio", command: process.execPath, args: [fixture] });
  assert.equal((await extensions.listServers("scratch"))[0].trusted, true);
  await assert.rejects(extensions.putServer("scratch", "project", { id: "bad", label: "Bad", transport: "stdio", command: "x", args: [], env: { API_KEY: "raw-secret" } }), /Secrets/);
  await assert.rejects(extensions.putServer("scratch", "project", { id: "bad", label: "Bad", transport: "http", url: "https://user:pass@example.com/mcp" }), /embedded credentials/);
  await assert.rejects(extensions.putServer("scratch", "project", { id: "bad", label: "Bad", transport: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer raw-secret" } }), /system environment variable/);
  await fs.writeFile(path.join(project, ".ai", "skills", "outline", "example.md"), "Support material");
  assert.equal((await extensions.readSkillResource("scratch", "project", "outline", "example.md")).content, "Support material");
  assert.equal((await executeTool("read_skill_resource", { scope: "project", id: "outline", path: "example.md" }, skillContext)).content, "Support material");
  await assert.rejects(extensions.readSkillResource("scratch", "project", "outline", "../example.md"), /inside/);
  await extensions.deleteSkill("scratch", "project", "outline");
  assert.equal((await extensions.listSkills("scratch")).length, 1);
  assert.equal(await fs.readFile(path.join(project, ".ai", "skills", "outline", "example.md"), "utf8"), "Support material");
});

test("grep finds bounded regex matches and apply_patch changes a project file only after review", async (t) => {
  const root = await scratch(t), workspace = path.join(root, "research"), projectDir = path.join(root, "project");
  await fs.mkdir(workspace); await fs.mkdir(projectDir);
  await fs.writeFile(path.join(projectDir, "code.ts"), "const value = 10;\nkeep();\n");
  await fs.writeFile(path.join(projectDir, ".env"), "value = secret\n");
  const signal = new AbortController().signal;
  const matches = await executeTool("grep", { pattern: "value\\s*=\\s*\\d+", path: "project/" }, { workspace, projectDir, signal });
  assert.deepEqual(matches.matches.map((m) => [m.path, m.line]), [["project/code.ts", 1]]);
  const patch = "--- a/code.ts\n+++ b/code.ts\n@@ -1,2 +1,2 @@\n-const value = 10;\n+const value = 20;\n keep();\n";
  const args = { path: "project/code.ts", patch };
  const ctx = { workspace, projectDir, signal, approve: async (proposal) => { assert.equal(proposal.kind, "write"); assert.equal(proposal.before, "const value = 10;\nkeep();\n"); assert.equal(proposal.after, "const value = 20;\nkeep();\n"); return false; } };
  await assert.rejects(executeTool("apply_patch", args, ctx), /declined/);
  assert.equal(await fs.readFile(path.join(projectDir, "code.ts"), "utf8"), "const value = 10;\nkeep();\n");
  await executeTool("apply_patch", args, { ...ctx, approve: async () => true });
  assert.equal(await fs.readFile(path.join(projectDir, "code.ts"), "utf8"), "const value = 20;\nkeep();\n");
  await assert.rejects(executeTool("apply_patch", { ...args, path: "project/.env" }, ctx), /protected/);
  await assert.rejects(executeTool("apply_patch", { ...args, path: "project/project.json" }, ctx), /protected/);
  await assert.rejects(executeTool("apply_patch", args, ctx), /did not match/);
});

test("HTTP MCP can discover and call tools with environment-backed headers", async (t) => {
  const workspace = await scratch(t), requests = [];
  process.env.VAJRA_MCP_TEST_TOKEN = "fixture-token";
  t.after(() => { delete process.env.VAJRA_MCP_TEST_TOKEN; });
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, token: req.headers.authorization });
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    if (request.id == null) { res.writeHead(202); res.end(); return; }
    const result = request.method === "initialize" ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "http-fixture", version: "1" } }
      : request.method === "tools/list" ? { tools: [{ name: "echo", inputSchema: { type: "object", properties: { message: { type: "string" } } } }] }
      : request.method === "tools/call" ? { content: [{ type: "text", text: request.params.arguments.message }] } : {};
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const connected = await connectMcp([{ id: "http", scope: "global", label: "HTTP fixture", transport: "http", url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: "Bearer ${VAJRA_MCP_TEST_TOKEN}" }, enabled: true }], { workspace, signal: new AbortController().signal });
  t.after(() => connected.close());
  assert.equal(connected.definitions.length, 1);
  const result = await connected.call("mcp_global_http_echo", { message: "remote" }, new AbortController().signal);
  assert.match(result.content, /remote/);
  assert.ok(requests.some((request) => request.token === "Bearer fixture-token"));
  await connected.close();
});

test("a missing MCP environment variable reports a connection error without stopping other tools", async (t) => {
  const workspace = await scratch(t), errors = [];
  const connected = await connectMcp([
    { id: "missing", scope: "global", label: "Missing token", transport: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${VAJRA_UNSET_TOKEN_TEST}" }, enabled: true },
    { id: "fixture", scope: "global", label: "Fixture", transport: "stdio", command: process.execPath, args: [fixture], enabled: true },
  ], { workspace, signal: new AbortController().signal, onError: (message) => errors.push(message) });
  t.after(() => connected.close());
  assert.match(errors.join(" "), /VAJRA_UNSET_TOKEN_TEST/);
  assert.equal(connected.definitions.length, 1);
  await connected.close();
});

test("local stdio MCP tools are discovered, invoked and closed", async (t) => {
  const workspace = await scratch(t), errors = [];
  const connected = await connectMcp([{ id: "fixture", scope: "global", label: "Fixture", transport: "stdio", command: process.execPath, args: [fixture], enabled: true }], { workspace, signal: new AbortController().signal, onError: (error) => errors.push(error) });
  t.after(() => connected.close());
  assert.deepEqual(errors, []);
  assert.equal(connected.definitions.length, 1);
  assert.equal(connected.definitions[0].name, "mcp_global_fixture_echo");
  const result = await connected.call("mcp_global_fixture_echo", { message: "hello" }, new AbortController().signal);
  assert.match(result.content, /hello/);
  await connected.close();
});

test("agent advertises MCP tools and waits for a per-call approval", async (t) => {
  const root = await scratch(t), home = path.join(root, "home"); await fs.mkdir(home);
  const config = { appDir: () => home, dirOf: () => null };
  const extension = createVajraExtensions({ config });
  await extension.putServer(null, "global", { id: "fixture", label: "Fixture", transport: "stdio", command: process.execPath, args: [fixture] });
  let rounds = 0;
  const agent = createResearchAgent({ config, credentials: { list: () => ({ providers: [] }), find: () => null, resolve: () => ({ provider: { kind: "openai" }, model: "fixture", ref: "fixture/model" }) }, search: { status: () => ({ hasKey: false }) }, readProject: async () => ({}),
    step: async ({ tools }) => {
      assert.ok(tools.some((tool) => tool.name === "mcp_global_fixture_echo"));
      return ++rounds === 1 ? { role: "assistant", content: "", toolCalls: [{ id: "call1", name: "mcp_global_fixture_echo", arguments: JSON.stringify({ message: "approved" }) }] } : { role: "assistant", content: "Done", toolCalls: [] };
    } });
  const app = express(); app.use(express.json()); app.use("/api/research", agent.router);
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/research`;
  const post = async (endpoint, body) => (await fetch(base + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  const session = await post("/sessions", {});
  const response = await fetch(base + `/sessions/${session.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Use echo", model: "fixture/model" }) });
  let sawApproval = false, completed = false;
  for await (const data of sse(response.body)) {
    if (!data) continue;
    const event = JSON.parse(data);
    if (event.activity?.approval) {
      assert.equal(event.activity.approval.kind, "mcp");
      assert.equal(event.activity.approval.server, "Fixture");
      assert.deepEqual(event.activity.approval.arguments, { message: "approved" });
      sawApproval = true;
      const result = await post(`/sessions/${session.id}/approval`, { approvalId: event.activity.approval.id, allow: true });
      assert.equal(result.ok, true);
    }
    if (event.done) { completed = true; assert.equal(event.session.status, "complete"); }
  }
  assert.equal(sawApproval && completed, true);
  const stored = JSON.parse(await fs.readFile(path.join(home, "conversations", session.id + ".json"), "utf8"));
  assert.match(stored.messages.find((message) => message.role === "tool").content, /approved/);
});

test("imported MCP configuration is not connected until saved in Settings", async (t) => {
  const home = await scratch(t);
  await fs.writeFile(path.join(home, "mcp.json"), JSON.stringify([{ id: "imported", label: "Imported", transport: "stdio", command: process.execPath, args: [fixture], enabled: true }]));
  const config = { appDir: () => home, dirOf: () => null };
  const extensions = createVajraExtensions({ config });
  assert.equal((await extensions.listServers(null))[0].trusted, false);
  let advertised = null;
  const agent = createResearchAgent({ config, credentials: { list: () => ({ providers: [] }), find: () => null, resolve: () => ({ provider: { kind: "openai" }, model: "fixture", ref: "fixture/model" }) }, search: { status: () => ({ hasKey: false }) }, readProject: async () => ({}), step: async ({ tools }) => { advertised = tools.map((tool) => tool.name); return { role: "assistant", content: "Done", toolCalls: [] }; } });
  const app = express(); app.use(express.json()); app.use("/api/research", agent.router);
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/research`;
  const post = async (route, body) => (await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  const session = await post("/sessions", {});
  const response = await fetch(base + `/sessions/${session.id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Check servers", model: "fixture/model" }) });
  const notices = [];
  for await (const data of sse(response.body)) if (data) { const event = JSON.parse(data); if (event.notice) notices.push(event.notice); }
  assert.equal(advertised.includes("mcp_global_imported_echo"), false);
  assert.match(notices.join(" "), /changed outside Settings/);
});
