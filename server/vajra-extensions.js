import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { resolveWorkspacePath } from "./agent-tools.js";

const idOk = (id) => typeof id === "string" && /^[a-z][a-z0-9_-]{0,39}$/.test(id);
const regular = async (file) => {
  const stat = await fs.lstat(file).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("Extension files must be regular files.");
  return stat;
};
async function safeFolder(folder, create = false) {
  if (create) await fs.mkdir(folder, { recursive: true });
  const stat = await fs.lstat(folder).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Extension folders cannot be links or junctions.");
  return Boolean(stat);
}
async function atomic(file, content) {
  await safeFolder(path.dirname(file), true);
  await regular(file);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, content, { flag: "wx", mode: 0o600 }); await fs.rename(tmp, file); }
  finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
}
const description = (content) => {
  const match = content.match(/^---\s*\n[\s\S]*?^description:\s*(.+)$/m);
  return (match?.[1] || content.replace(/^---[\s\S]*?---/, "").split("\n").find((line) => line.trim() && !line.startsWith("#")) || "Custom skill").trim().slice(0, 240);
};

export function createVajraExtensions({ config }) {
  const trustFile = () => path.join(config.appDir(), "mcp-trust.json");
  const trustKey = (projectId, scope, id) => `${scope}/${scope === "project" ? projectId : "global"}/${id}`;
  const fingerprint = (row) => createHash("sha256").update(JSON.stringify(validateServer(row))).digest("hex");
  async function readTrust() {
    const file = trustFile(), stat = await regular(file);
    if (!stat) return {};
    if (stat.size > 30000) throw new Error("MCP trust store is too large");
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid MCP trust store");
    return value;
  }
  function roots(projectId) {
    const global = config.appDir();
    if (!projectId) return { global, project: null };
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) throw new Error("Invalid project id");
    const project = config.dirOf(projectId);
    if (!project) throw new Error("Project not found");
    return { global, project: path.join(project, ".ai") };
  }
  function target(projectId, scope) {
    const found = roots(projectId);
    if (scope !== "global" && scope !== "project") throw new Error("Choose global or project scope");
    if (scope === "project" && !found.project) throw new Error("Open a project to save project extensions");
    return found[scope];
  }
  async function skillsAt(root, scope) {
    const folder = path.join(root, "skills");
    if (!(await safeFolder(root)) || !(await safeFolder(folder))) return [];
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch((e) => { if (e.code === "ENOENT") return []; throw e; });
    const skills = [];
    for (const entry of entries) {
      if (!idOk(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name, "SKILL.md");
      const stat = await regular(file);
      if (!stat || stat.size > 30000) continue;
      const content = await fs.readFile(file, "utf8");
      skills.push({ id: entry.name, scope, description: description(content), content });
    }
    return skills;
  }
  async function listSkills(projectId) {
    const { global, project } = roots(projectId);
    return [...await skillsAt(global, "global"), ...(project ? await skillsAt(project, "project") : [])];
  }
  async function putSkill(projectId, scope, id, content) {
    if (!idOk(id) || typeof content !== "string" || !content.trim() || content.length > 30000 || content.includes("\0")) throw new Error("Use a lowercase skill id and SKILL.md text up to 30,000 characters.");
    const root = target(projectId, scope), folder = path.join(root, "skills", id);
    await safeFolder(root, true);
    await safeFolder(path.join(root, "skills"), true);
    const existing = await fs.lstat(folder).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error("Skill folder must be a regular directory");
    await atomic(path.join(folder, "SKILL.md"), content);
    return { id, scope, description: description(content), content };
  }
  async function deleteSkill(projectId, scope, id) {
    if (!idOk(id)) throw new Error("Invalid skill id");
    const folder = path.join(target(projectId, scope), "skills", id);
    await safeFolder(path.dirname(folder));
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid skill folder");
    // Only remove a managed SKILL.md; preserve any supporting files the user may have added.
    await fs.unlink(path.join(folder, "SKILL.md"));
    if (!(await fs.readdir(folder)).length) await fs.rmdir(folder);
    return { ok: true };
  }
  async function readSkillResource(projectId, scope, id, relative) {
    if (!idOk(id) || typeof relative !== "string" || !relative || relative.length > 300) throw new Error("Invalid skill resource");
    const folder = path.join(target(projectId, scope), "skills", id);
    if (!(await safeFolder(folder))) throw new Error("Skill not found");
    const file = await resolveWorkspacePath(folder, relative);
    const stat = await regular(file);
    if (!stat || stat.size > 30000) throw new Error("Read a text skill resource smaller than 30 KB");
    const content = await fs.readFile(file, "utf8");
    if (content.includes("\0")) throw new Error("Binary skill resources are unavailable");
    return { id, scope, path: relative, content };
  }
  async function readServers(root) {
    if (!(await safeFolder(root))) return [];
    const file = path.join(root, "mcp.json"), stat = await regular(file);
    if (!stat) return [];
    if (stat.size > 30000) throw new Error("MCP settings are too large");
    const rows = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(rows) || rows.length > 8) throw new Error("Invalid MCP settings");
    return rows.map(validateServer);
  }
  async function listServers(projectId) {
    const { global, project } = roots(projectId);
    const trust = await readTrust();
    return [...(await readServers(global)).map((row) => ({ ...row, scope: "global" })), ...(project ? (await readServers(project)).map((row) => ({ ...row, scope: "project" })) : [])]
      .map((row) => ({ ...row, trusted: trust[trustKey(projectId, row.scope, row.id)] === fingerprint(row) }));
  }
  function validateServer(input) {
    if (!idOk(input?.id) || typeof input.label !== "string" || !input.label.trim() || input.label.length > 80) throw new Error("Enter a lowercase server id and label");
    if (!["stdio", "http"].includes(input.transport)) throw new Error("Choose stdio or HTTP transport");
    if (input.transport === "stdio") {
      if (typeof input.command !== "string" || !input.command.trim() || input.command.length > 500 || !Array.isArray(input.args) || input.args.length > 24 || input.args.some((a) => typeof a !== "string" || a.length > 500)) throw new Error("Enter a command and up to 24 arguments");
      if (input.env && (typeof input.env !== "object" || Array.isArray(input.env) || Object.entries(input.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.length > 1000))) throw new Error("Invalid environment variables");
      if (Object.entries(input.env || {}).some(([key, value]) => /(key|token|secret|password|credential)/i.test(key) && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value))) throw new Error("Secrets must reference a system environment variable, such as ${MY_TOKEN}.");
    } else {
      let url;
      try { url = new URL(input.url); } catch { throw new Error("Enter a valid MCP URL"); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP(S) URL without embedded credentials");
      if (input.headers && (typeof input.headers !== "object" || Array.isArray(input.headers) || Object.entries(input.headers).some(([key, value]) => !/^[A-Za-z0-9-]{1,80}$/.test(key) || typeof value !== "string" || value.length > 300 || !/^(?:Bearer )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)))) throw new Error("HTTP header values must reference a system environment variable, for example Bearer ${MCP_TOKEN}.");
    }
    return { id: input.id, label: input.label.trim(), transport: input.transport, enabled: input.enabled !== false,
      ...(input.transport === "stdio" ? { command: input.command.trim(), args: input.args, env: input.env || {} } : { url: input.url, headers: input.headers || {} }) };
  }
  async function putServer(projectId, scope, input) {
    const root = target(projectId, scope), row = validateServer(input), rows = await readServers(root);
    await safeFolder(root, true);
    const index = rows.findIndex((item) => item.id === row.id);
    if (index < 0 && rows.length >= 8) throw new Error("Maximum eight MCP servers per scope");
    if (index < 0) rows.push(row); else rows[index] = row;
    await atomic(path.join(root, "mcp.json"), JSON.stringify(rows, null, 2));
    const trust = await readTrust();
    trust[trustKey(projectId, scope, row.id)] = fingerprint(row);
    await atomic(trustFile(), JSON.stringify(trust, null, 2));
    return { ...row, scope, trusted: true };
  }
  async function deleteServer(projectId, scope, id) {
    if (!idOk(id)) throw new Error("Invalid server id");
    const root = target(projectId, scope), rows = await readServers(root);
    await safeFolder(root, true);
    await atomic(path.join(root, "mcp.json"), JSON.stringify(rows.filter((row) => row.id !== id), null, 2));
    const trust = await readTrust(); delete trust[trustKey(projectId, scope, id)];
    await atomic(trustFile(), JSON.stringify(trust, null, 2));
    return { ok: true };
  }
  return { listSkills, putSkill, deleteSkill, readSkillResource, listServers, putServer, deleteServer };
}
