import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Source } from "../types";
import { api, type AiStatus } from "../api";
import { research, type ResearchSession, type ToolActivity } from "../research";

interface Props {
  projectId?: string;
  source: Source | null;
  hasLegacyChat?: boolean;
  onOpenSettings: () => void;
}
const renderMarkdown = (text: string) => DOMPurify.sanitize(marked.parse(text) as string);

export function AiPanel({ projectId, source, hasLegacyChat, onOpenSettings }: Props) {
  const [scope, setScope] = useState(projectId ? "project" : "global");
  const project = scope === "project" ? projectId || null : null;
  const [rows, setRows] = useState<Pick<ResearchSession, "id" | "title" | "status" | "updatedAt">[]>([]);
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [input, setInput] = useState("");
  const [partial, setPartial] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [model, setModel] = useState("");
  const [context, setContext] = useState("current");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const chat = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const refreshModels = () => api.aiStatus().then((s) => { setStatus(s); setModel((m) => m || s.model || ""); }).catch((e) => setError(e.message));
  const refreshRows = () => research.list(project).then((r) => setRows(r.sessions));

  useEffect(() => { refreshModels(); return () => { controller.current?.abort(); generation.current++; }; }, []);
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true); setError(""); setSession(null); setPartial("");
    research.list(project).then(async (result) => {
      if (version !== generation.current) return;
      setRows(result.sessions);
      if (result.sessions.length) {
        const loaded = await research.load(project, result.sessions[0].id);
        if (version === generation.current) { setSession(loaded); if (loaded.model) setModel(loaded.model); }
      }
    }).catch((e) => { if (version === generation.current) setError(e.message); })
      .finally(() => { if (version === generation.current) setLoading(false); });
  }, [project]);
  useEffect(() => { if (follow.current && chat.current) chat.current.scrollTop = chat.current.scrollHeight; }, [session, partial]);
  // A second pane can observe/approve a running session without owning its stream.
  useEffect(() => {
    if (!session || session.status !== "running" || busy) return;
    const version = generation.current;
    const timer = setInterval(() => research.load(project, session.id).then((s) => {
      if (version === generation.current) setSession(s);
    }).catch((e) => setError(e.message)), 1500);
    return () => clearInterval(timer);
  }, [session?.id, session?.status, busy, project]);

  async function choose(id: string) {
    const version = ++generation.current; setLoading(true); setError("");
    try { const s = await research.load(project, id); if (version === generation.current) { setSession(s); if (s.model) setModel(s.model); setPartial(""); follow.current = true; } }
    catch (e) { setError((e as Error).message); }
    finally { if (version === generation.current) setLoading(false); }
  }
  async function create(importLegacy = false) {
    const s = await research.create(project, importLegacy); setSession(s); setPartial(""); follow.current = true; await refreshRows(); return s;
  }
  async function newConversation(importLegacy = false) {
    setLoading(true); setError("");
    try { await create(importLegacy); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  async function send(text: string) {
    if (!text.trim() || busy || loading) return;
    setBusy(true); setError(""); setNotice(""); setPartial(""); follow.current = true;
    const version = generation.current;
    const abort = new AbortController(); controller.current = abort;
    let selected = session;
    try {
      if (!selected) selected = await create();
      if (version !== generation.current) return;
      setInput("");
      await research.run(selected.id, { projectId: project, message: text, model, context: project ? context : "none", sourceId: source?.id }, abort.signal, (event) => {
        if (version !== generation.current) return;
        if (event.session) { setSession(event.session); setPartial(""); }
        if (event.text) setPartial((p) => p + event.text);
        if (event.activity) {
          const activity = event.activity;
          setSession((s) => s && ({ ...s, activity: s.activity.some((a) => a.id === activity.id) ? s.activity.map((a) => a.id === activity.id ? activity : a) : [...s.activity, activity] }));
        }
        if (event.error) setError(event.error);
        if (event.notice) setNotice(event.notice);
      });
    } catch (e) { if (!abort.signal.aborted && version === generation.current) setError((e as Error).message); }
    finally {
      if (version === generation.current) {
        setBusy(false); controller.current = null;
        if (selected) await research.load(project, selected.id).then(setSession).catch((e) => setError(e.message));
        await refreshRows().catch((e) => setError(e.message));
      }
    }
  }
  async function stop() {
    if (!session) { controller.current?.abort(); return; }
    try { await research.stop(project, session.id); }
    catch (e) { setError((e as Error).message); }
  }
  async function decide(activity: ToolActivity, allow: boolean) {
    if (!session || !activity.approval) return;
    try { await research.approve(project, session.id, activity.approval.id, allow); }
    catch (e) { setError((e as Error).message); }
  }
  const running = busy || session?.status === "running";
  const timeline = [
    ...(session?.messages || []).map((m, i) => ({ key: `m${i}`, time: m.createdAt || "", message: m, activity: null as ToolActivity | null })),
    ...(session?.activity || []).map((a) => ({ key: a.id, time: a.createdAt, message: null, activity: a })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  return <div className="panel-body ai research-agent">
    <div className="row wrap">
      <select aria-label="Conversation location" value={scope} disabled={running || loading} onChange={(e) => setScope(e.target.value)}>
        {projectId && <option value="project">Project research</option>}<option value="global">Global research</option>
      </select>
      <select aria-label="Conversation" value={session?.id || ""} disabled={running || loading} onChange={(e) => choose(e.target.value)}>
        <option value="" disabled>{loading ? "Loading…" : "Choose a conversation"}</option>
        {rows.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      <button className="small" onClick={() => newConversation()} disabled={running || loading}>New</button>
      <button className="ghost small" onClick={onOpenSettings}>Settings</button>
      {session && <button className="ghost small" onClick={() => api.reveal(session.workspace).catch((e) => setError(e.message))}>Files</button>}
    </div>
    <div className="row wrap">
      <select aria-label="Research model" value={model} disabled={running} onFocus={refreshModels} onChange={(e) => setModel(e.target.value)}>
        <option value="">Choose a model</option>{status?.models.map((m) => <option key={m.ref} value={m.ref}>{m.provider} — {m.model}</option>)}
      </select>
      {project && <select aria-label="Research context" value={context} disabled={running} onChange={(e) => setContext(e.target.value)}>
        <option value="current">Current source</option><option value="all">All project sources</option><option value="none">No source context</option>
      </select>}
      {running && <button className="small danger" onClick={stop}>Stop</button>}
    </div>
    <div className="muted small research-location" title={session?.workspace}>{project ? "Saved with this project" : "Saved in your app home folder"} · read files · write files · shell · web research</div>
    {(error || session?.lastError) && <div className="error-bar" role="alert">{error || session?.lastError}</div>}
    {session?.status === "limited" && !notice && <div className="note-bar">Reached the step limit. Review the work and send Continue to proceed.</div>}
    {notice && <div className="note-bar">{notice}</div>}
    <div className="chat" ref={chat} onScroll={() => { const el = chat.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
      {!session?.messages.length && <div className="research-intro">
        <h3>Research, then make something useful</h3>
        <p>Ask a question, investigate sources, or create a research brief, diagram or script. You can review file changes and shell commands before they run.</p>
        <div className="row wrap quick">
          {["Research this topic and save a sourced brief", "Compare the evidence across my sources", "Create an editable Mermaid diagram explaining this topic"].map((p) => <button className="chip" key={p} onClick={() => setInput(p)}>{p}</button>)}
        </div>
        {project && hasLegacyChat && <button className="small" onClick={() => newConversation(true)} disabled={running || loading}>Import previous project chat</button>}
      </div>}
      {timeline.map((item) => item.activity ? <Activity key={item.key} activity={item.activity} onDecide={(allow) => decide(item.activity!, allow)} /> : item.message?.content ? <div key={item.key} className={`msg ${item.message.role}`}>
        {item.message.role === "user" ? <p>{item.message.content}</p> : <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.message.content) }} />}
        {item.message.interrupted && <span className="muted small">Interrupted response</span>}
      </div> : null)}
      {partial && <div className="msg assistant"><div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(partial) }} /></div>}
      {running && !partial && <span className="muted small" role="status">{session?.activity.some((a) => a.status === "approval") ? "Waiting for your review…" : "Researching…"}</span>}
    </div>
    <form onSubmit={(e) => { e.preventDefault(); send(input); }}>
      <textarea className="chat-input" placeholder="Ask a research question or describe what to create…" value={input} rows={3} maxLength={16000} onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!running) send(input); } }} />
      <div className="row between"><span className="muted small">Writes and shell commands require review.</span><button className="primary small" type="submit" disabled={running || loading || !model || !input.trim()}>Send</button></div>
    </form>
  </div>;
}

function Activity({ activity, onDecide }: { activity: ToolActivity; onDecide: (allow: boolean) => Promise<void> }) {
  const [deciding, setDeciding] = useState(false);
  const proposal = activity.approval;
  async function decide(allow: boolean) { setDeciding(true); try { await onDecide(allow); } finally { setDeciding(false); } }
  return <div className={`agent-tool ${proposal ? "needs-review" : ""}`}>
    <details open={Boolean(proposal)}><summary><b>{activity.name.replaceAll("_", " ")}</b><span>{activity.status}</span></summary>
      <pre>{activity.arguments}</pre>
      {activity.output && <pre>{activity.output}</pre>}
    </details>
    {proposal && <div className="agent-approval">
      {proposal.kind === "write" ? <>
        <b>{proposal.before == null ? "Create" : "Update"} {proposal.path}</b>
        {proposal.before != null && <details><summary>Current contents</summary><pre>{proposal.before}</pre></details>}
        <details open><summary>Proposed contents</summary><pre>{proposal.after}</pre></details>
      </> : <><b>Run {proposal.shell} command</b><pre>{proposal.command}</pre><p className="muted small">Working folder: {proposal.cwd}. This runs with your account; the folder is not an OS sandbox.</p></>}
      <div className="row"><button className="primary small" disabled={deciding} onClick={() => decide(true)}>Allow once</button><button className="small" disabled={deciding} onClick={() => decide(false)}>Decline</button></div>
    </div>}
  </div>;
}
