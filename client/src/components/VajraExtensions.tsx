import { useEffect, useState } from "react";
import { research, type McpServer, type VajraSkill } from "../research";

const emptyServer = (): McpServer => ({ id: "", label: "", transport: "stdio", command: "", args: [], env: {}, url: "", enabled: true });

export function VajraExtensions({ projectId }: { projectId: string | null }) {
  const [scope, setScope] = useState<"global" | "project">(projectId ? "project" : "global");
  const [skills, setSkills] = useState<VajraSkill[]>([]), [servers, setServers] = useState<McpServer[]>([]);
  const [skillId, setSkillId] = useState(""), [content, setContent] = useState("");
  const [server, setServer] = useState<McpServer>(emptyServer);
  const [args, setArgs] = useState(""), [env, setEnv] = useState("{}"), [headers, setHeaders] = useState("{}");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const refresh = () => research.extensions(projectId).then((result) => { setSkills(result.skills); setServers(result.servers); });
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, [projectId]);
  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { const result = await action(); await refresh(); setNotice(typeof result === "string" ? result : success); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  function chooseSkill(skill: VajraSkill) { setScope(skill.scope); setSkillId(skill.id); setContent(skill.content); }
  function chooseServer(row: McpServer) { setScope(row.scope || "global"); setServer(row); setArgs((row.args || []).join("\n")); setEnv(JSON.stringify(row.env || {}, null, 2)); setHeaders(JSON.stringify(row.headers || {}, null, 2)); }
  return <div className="vajra-extension-settings">
    <p className="muted small">Skills are SKILL.md instructions that Vajra can read on demand. MCP servers expose external tools; every MCP call requires your review. Project extensions live in the project's .ai folder, while global extensions live in the app folder.</p>
    <label>Save in <select aria-label="Extension scope" value={scope} onChange={(e) => setScope(e.target.value as "global" | "project")}><option value="global">Global</option>{projectId && <option value="project">Current project</option>}</select></label>
    {error && <div className="error-bar" role="alert">{error}</div>}{notice && <div className="note-bar" role="status">{notice}</div>}
    <div className="vajra-extension-grid">
      <section><h4>Skills</h4><div className="row" style={{ flexWrap: "wrap" }}>{skills.map((skill) => <button className="ghost small" key={`${skill.scope}/${skill.id}`} onClick={() => chooseSkill(skill)}>{skill.id} · {skill.scope}</button>)}</div>
        <label>Skill id<input aria-label="Skill id" placeholder="research-review" value={skillId} onChange={(e) => setSkillId(e.target.value)} /></label>
        <label>SKILL.md<textarea aria-label="Skill instructions" rows={6} placeholder={"---\ndescription: Review evidence and citations\n---\n# Instructions"} value={content} onChange={(e) => setContent(e.target.value)} /></label>
        <div className="row"><button className="small" disabled={busy || !skillId || !content.trim()} onClick={() => act(() => research.saveSkill(projectId, scope, skillId, content), "Skill saved")}>Save skill</button><button className="ghost small" onClick={() => { setSkillId(""); setContent(""); }}>New</button><button className="ghost small" disabled={busy || !skills.some((item) => item.id === skillId && item.scope === scope)} onClick={() => act(async () => { await research.deleteSkill(projectId, scope, skillId); setSkillId(""); setContent(""); }, "Skill removed")}>Remove</button></div>
      </section>
      <section><h4>MCP servers</h4><div className="row" style={{ flexWrap: "wrap" }}>{servers.map((row) => <button className="ghost small" key={`${row.scope}/${row.id}`} onClick={() => chooseServer(row)}>{row.label} · {row.scope}{!row.trusted ? " · Review" : ""}</button>)}</div>
        {servers.some((row) => !row.trusted) && <p className="muted small">A server changed outside Settings. Select it and Save server to allow Vajra to connect.</p>}
        <div className="row"><label>Id<input aria-label="MCP id" placeholder="local-tools" value={server.id} onChange={(e) => setServer({ ...server, id: e.target.value })} /></label><label>Label<input aria-label="MCP label" value={server.label} onChange={(e) => setServer({ ...server, label: e.target.value })} /></label></div>
        <div className="row"><label>Transport<select aria-label="MCP transport" value={server.transport} onChange={(e) => setServer({ ...server, transport: e.target.value as "stdio" | "http" })}><option value="stdio">Local stdio</option><option value="http">Streamable HTTP</option></select></label><label><input type="checkbox" checked={server.enabled} onChange={(e) => setServer({ ...server, enabled: e.target.checked })} /> Enabled</label></div>
        {server.transport === "stdio" ? <><label>Command<input aria-label="MCP command" placeholder="npx or an executable path" value={server.command || ""} onChange={(e) => setServer({ ...server, command: e.target.value })} /></label><label>Arguments, one per line<textarea aria-label="MCP arguments" rows={2} value={args} onChange={(e) => setArgs(e.target.value)} /></label><label>Environment variables (JSON). Use {"${NAME}"} for a system variable.<textarea aria-label="MCP environment" rows={2} value={env} onChange={(e) => setEnv(e.target.value)} /></label></> : <><label>HTTP endpoint<input aria-label="MCP URL" placeholder="https://example.com/mcp" value={server.url || ""} onChange={(e) => setServer({ ...server, url: e.target.value })} /></label><label>HTTP headers (JSON). Values must reference system variables, e.g. Bearer {"${MCP_TOKEN}"}.<textarea aria-label="MCP headers" rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} /></label></>}
        <div className="row"><button className="small" disabled={busy || !server.id || !server.label} onClick={() => act(() => research.saveServer(projectId, scope, { ...server, args: args.split("\n").map((s) => s.trim()).filter(Boolean), env: JSON.parse(env), headers: JSON.parse(headers) }), "Server saved")}>Save server</button><button className="ghost small" onClick={() => { setServer(emptyServer()); setArgs(""); setEnv("{}"); setHeaders("{}"); }}>New</button><button className="ghost small" disabled={busy || !servers.some((item) => item.id === server.id && item.scope === scope)} onClick={() => act(async () => { await research.deleteServer(projectId, scope, server.id); setServer(emptyServer()); }, "Server removed")}>Remove</button><button className="ghost small" disabled={busy || !servers.some((item) => item.id === server.id && item.scope === scope)} onClick={() => act(async () => { const result = await research.testServer(projectId, scope, server.id); if (result.errors.length) throw new Error(result.errors.join("; ")); return `${result.tools.length} tools available: ${result.tools.map((tool) => tool.name).join(", ")}`; }, "Connection tested")}>Test connection</button></div>
      </section>
    </div>
  </div>;
}
