import { useEffect, useId, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ArrowUp, FileText, Paperclip, PanelLeft, Square, X } from "lucide-react";
import { VajraSidebar } from "./VajraSidebar";
import { VajraMark } from "./VajraMark";
import type { Source } from "../types";
import { api, type AiStatus } from "../api";
import { research, exportResearch, type ResearchSession, type ToolActivity } from "../research";
import { MAX_ATTACHMENTS, MAX_TOTAL_CHARS, readResearchAttachment, type ResearchAttachment } from "../research-attachments";

interface Props {
  projectId?: string;
  projectTitle?: string;
  source: Source | null;
  sources?: Source[];
  hasLegacyChat?: boolean;
  onOpenSettings: () => void;
}
const renderMarkdown = (text: string) => DOMPurify.sanitize(marked.parse(text) as string);

export function AiPanel({ projectId, projectTitle, source, sources = [], hasLegacyChat, onOpenSettings }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const sidebarId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(true);
  const [sidebarChoice, setSidebarChoice] = useState<boolean | null>(null);
  const sidebarOpen = sidebarChoice ?? !compact;
  const closeSidebar = () => { setSidebarChoice(false); toggle.current?.focus(); };
  const [scope, setScope] = useState(projectId ? "project" : "global");
  const project = scope === "project" ? projectId || null : null;
  const [rows, setRows] = useState<Pick<ResearchSession, "id" | "title" | "status" | "updatedAt">[]>([]);
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ResearchAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [renameTitle, setRenameTitle] = useState<string | null>(null);
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
  const refreshModels = () => api.aiStatus().then((s) => { setStatus(s); setModel((m) => s.models.some((item) => item.ref === m) ? m : s.models.some((item) => item.ref === s.model) ? s.model || "" : s.models[0]?.ref || ""); }).catch((e) => setError(e.message));
  const refreshRows = () => research.list(project).then((r) => setRows(r.sessions));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 720));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (compact && sidebarOpen) host.current?.querySelector<HTMLInputElement>(".vajra-search input")?.focus();
  }, [compact, sidebarOpen]);

  useEffect(() => { refreshModels(); return () => { controller.current?.abort(); generation.current++; }; }, []);
  useEffect(() => {
    const version = ++generation.current;
    setLoading(true); setError(""); setSession(null); setRows([]); setPartial(""); setRenameTitle(null); setNotice("");
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
  useEffect(() => { if (textarea.current) { textarea.current.style.height = "auto"; textarea.current.style.height = `${Math.min(180, Math.max(76, textarea.current.scrollHeight))}px`; } }, [input]);
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
    if (compact) closeSidebar();
    setRenameTitle(null); setNotice("");
    const version = ++generation.current; setLoading(true); setError("");
    try { const s = await research.load(project, id); if (version === generation.current) { setSession(s); if (s.model) setModel(s.model); setPartial(""); follow.current = true; } }
    catch (e) { setError((e as Error).message); }
    finally { if (version === generation.current) setLoading(false); }
  }
  async function create(importLegacy = false) {
    const s = await research.create(project, importLegacy); setSession(s); setPartial(""); follow.current = true; await refreshRows(); return s;
  }
  async function newConversation(importLegacy = false) {
    if (compact) closeSidebar();
    setRenameTitle(null); setNotice("");
    setLoading(true); setError("");
    try { await create(importLegacy); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  async function send(text: string) {
    if ((!text.trim() && !attachments.length) || busy || loading || attaching) return;
    if (!selectedModel) { setError("Configure a model in Settings before sending."); return; }
    setBusy(true); setError(""); setNotice(""); setPartial(""); follow.current = true;
    const version = generation.current;
    const abort = new AbortController(); controller.current = abort;
    let selected = session;
    try {
      if (!selected) selected = await create();
      if (version !== generation.current) return;
      const message = text.trim() || `Review the attached ${attachments.length === 1 ? "file" : "files"}.`;
      const selectedAttachments = attachments;
      const selectedSourceId = context.startsWith("source:") ? context.slice(7) : source?.id;
      const selectedContext = project ? context.startsWith("source:") ? "source" : context : "none";
      await research.run(selected.id, { projectId: project, message, model: selectedModel, context: selectedContext, sourceId: selectedSourceId, attachments: selectedAttachments }, abort.signal, (event) => {
        if (version !== generation.current) return;
        if (event.session) {
          const saved = event.session;
          setSession(saved); setPartial("");
          setInput(""); setAttachments([]);
          setRows((items) => items.map((item) => item.id === saved.id ? { id: saved.id, title: saved.title, status: saved.status, updatedAt: saved.updatedAt } : item));
        }
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
  async function addFiles(files: FileList | File[]) {
    if (!files.length) return;
    if (files.length + attachments.length > MAX_ATTACHMENTS) { setError(`Attach up to ${MAX_ATTACHMENTS} files per message.`); return; }
    setAttaching(true); setError("");
    try {
      const next = await Promise.all(Array.from(files).map(readResearchAttachment));
      if ([...attachments, ...next].reduce((sum, item) => sum + item.content.length, 0) > MAX_TOTAL_CHARS) throw new Error("Attachments exceed the 90,000 character total. Remove or shorten a file.");
      setAttachments((items) => [...items, ...next]);
    } catch (e) { setError((e as Error).message); }
    finally { setAttaching(false); if (filePicker.current) filePicker.current.value = ""; }
  }
  async function stop() {
    if (!session) { controller.current?.abort(); return; }
    try { await research.stop(project, session.id); }
    catch (e) { setError((e as Error).message); }
  }
  async function rename() {
    if (!session || renameTitle == null) return;
    setLoading(true); setError("");
    try { setSession(await research.rename(project, session.id, renameTitle)); setRenameTitle(null); await refreshRows(); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  function download() {
    if (!session) return;
    const url = URL.createObjectURL(new Blob([exportResearch(session)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `vajra-${session.id}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function decide(activity: ToolActivity, allow: boolean) {
    if (!session || !activity.approval) return;
    try { await research.approve(project, session.id, activity.approval.id, allow); }
    catch (e) { setError((e as Error).message); }
  }
  const running = busy || session?.status === "running";
  const selectedModel = status?.models.some((item) => item.ref === model) ? model : "";
  const timeline = [
    ...(session?.messages || []).map((m, i) => ({ key: `m${i}`, time: m.createdAt || "", message: m, activity: null as ToolActivity | null })),
    ...(session?.activity || []).map((a) => ({ key: a.id, time: a.createdAt, message: null, activity: a })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  return <div ref={host} className={`vajra-shell ${compact ? "compact" : "wide"}`} onKeyDown={(e) => {
    if (!sidebarOpen || !compact) return;
    if (e.key === "Escape") { e.stopPropagation(); closeSidebar(); }
    if (e.key === "Tab") {
      const controls = host.current?.querySelectorAll<HTMLElement>(".vajra-sidebar button:not(:disabled), .vajra-sidebar input:not(:disabled), .vajra-sidebar select:not(:disabled)");
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }}>
    {sidebarOpen && <>
      {compact && <button className="vajra-sidebar-scrim" aria-label="Dismiss Vajra sidebar" onClick={closeSidebar} />}
      <VajraSidebar id={sidebarId} modal={compact} scope={scope} projectTitle={projectId ? projectTitle || "Current project" : undefined} rows={rows} selectedId={session?.id} disabled={running || loading} loading={loading} workspace={session?.workspace}
        onScope={setScope} onChoose={choose} onNew={() => newConversation()} onClose={closeSidebar}
        onSettings={() => { if (compact) closeSidebar(); onOpenSettings(); }} onFiles={() => session && api.reveal(session.workspace).catch((e) => setError(e.message))} />
    </>}
    <div className="panel-body ai research-agent">
    <div className="row vajra-heading"><button ref={toggle} className="icon-btn" title="Toggle Vajra sidebar" aria-controls={sidebarId} aria-expanded={sidebarOpen} onClick={() => setSidebarChoice(!sidebarOpen)}><PanelLeft size={17} /></button><span className="vajra-heading-mark"><VajraMark size={20} /></span><div className="vajra-conversation-title"><strong title={session?.title}>{session?.title || "Vajra"}</strong><span className="muted small" role="status">{session?.activity.some((a) => a.status === "approval") ? "Waiting for your review" : running ? "Working" : session?.status || "Ready"}{session?.progress ? ` · Step ${session.progress.step}/${session.progress.maxSteps}` : ""}</span></div>
      {session && <button className="ghost small" disabled={running || loading} onClick={() => setRenameTitle(session.title)}>Rename</button>}
      {session && <button className="ghost small" disabled={running || loading} onClick={download}>Export</button>}
    </div>
    {renameTitle !== null && <form className="row" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
      <input aria-label="Conversation title" value={renameTitle} maxLength={120} disabled={loading || running} onChange={(e) => setRenameTitle(e.target.value)} autoFocus />
      <button className="small" disabled={loading || running || !renameTitle.trim()}>Save title</button><button className="ghost small" type="button" onClick={() => setRenameTitle(null)}>Cancel</button>
    </form>}
    <div className="muted small research-location" title={session?.workspace}>{project ? "Saved with this project" : "Saved in your app home folder"}</div>
    {(error || session?.lastError) && <div className="error-bar" role="alert">{error || session?.lastError}</div>}
    {session?.status === "limited" && !notice && <div className="note-bar">Reached the step limit. Review the work and send Continue to proceed.</div>}
    {notice && <div className="note-bar">{notice}</div>}
    {!running && session && ["limited", "stopped", "interrupted", "error"].includes(session.status) && <div className="row between note-bar"><span>Saved progress is available.</span><button className="small" disabled={loading || !selectedModel} onClick={() => send("Continue the previous task from saved progress. Check the plan and previous tool results before repeating actions; finish outstanding work and report any blockers.")}>Continue</button></div>}
    {!!session?.plan?.length && <details className="vajra-plan" open><summary>Task plan · {session.plan.filter((s) => s.status === "complete").length}/{session.plan.length} complete</summary><ol>{session.plan.map((s, i) => <li key={i} data-status={s.status}><span aria-hidden="true">{s.status === "complete" ? "✓" : s.status === "in_progress" ? "→" : "○"}</span> {s.text}<span className="sr-only"> — {s.status.replaceAll("_", " ")}</span></li>)}</ol></details>}
    <div className="chat" ref={chat} onScroll={() => { const el = chat.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
      {!session?.messages.length && <div className="research-intro">
        <div className="vajra-intro-mark"><VajraMark size={56} /></div>
        <h3>Vajra</h3>
        <p>Your research, sources and work in one conversation.</p>
        {status && !status.models.length && <button className="ghost small vajra-setup" onClick={onOpenSettings}>Configure a model in Settings</button>}
        {project && hasLegacyChat && <button className="small" onClick={() => newConversation(true)} disabled={running || loading}>Import previous project chat</button>}
      </div>}
      {timeline.map((item) => item.activity ? <Activity key={item.key} activity={item.activity} onDecide={(allow) => decide(item.activity!, allow)} /> : item.message?.content ? <div key={item.key} className={`msg ${item.message.role}`}>
        {item.message.role === "user" ? <><p>{item.message.content}</p>{item.message.attachments?.map((file, index) => <span className="vajra-message-file" key={index}><FileText size={13} />{file.name}{file.truncated ? " · excerpt" : ""}</span>)}</> : <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.message.content) }} />}
        {item.message.interrupted && <span className="muted small">Interrupted response</span>}
      </div> : null)}
      {partial && <div className="msg assistant"><div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(partial) }} /></div>}
      {running && !partial && <span className="muted small" role="status">{session?.activity.some((a) => a.status === "approval") ? "Waiting for your review…" : "Researching…"}</span>}
    </div>
    <form className="vajra-composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
      <input ref={filePicker} className="sr-only" type="file" multiple accept=".txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.sh,.ps1,.sql,.svg,.mermaid,.mmd,.log,.pdf,text/*,application/pdf" aria-label="Choose files for Vajra" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); }} />
      {!!attachments.length && <div className="vajra-attachments">{attachments.map((file, index) => <span className="vajra-attachment" key={`${file.name}-${index}`} title={file.truncated ? "Only an excerpt will be sent" : file.name}><FileText size={14} /><span>{file.name}{file.truncated ? " · excerpt" : ""}</span><button type="button" aria-label={`Remove ${file.name}`} disabled={running} onClick={() => setAttachments((items) => items.filter((_, i) => i !== index))}><X size={13} /></button></span>)}</div>}
      <textarea ref={textarea} className="chat-input" placeholder="Ask Vajra anything…" value={input} rows={2} maxLength={16000} onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!running) send(input); } }} />
      <div className="vajra-composer-toolbar">
        <button type="button" className="vajra-attach-btn" title="Attach text or PDF" aria-label="Attach file" disabled={running || attaching} onClick={() => filePicker.current?.click()}><Paperclip size={17} /></button>
        <select aria-label="Research model" value={model} disabled={running} onFocus={refreshModels} onChange={(e) => setModel(e.target.value)}>
          <option value="">Choose model</option>{status?.models.map((m) => <option key={m.ref} value={m.ref}>{m.provider} — {m.model}</option>)}
        </select>
        {project && <select aria-label="Research context" value={context} disabled={running} onChange={(e) => setContext(e.target.value)}>
          <option value="current">Current source{source ? ` · ${source.title}` : ""}</option><option value="all">All project sources</option><option value="none">No source</option>
          {sources.map((s) => <option key={s.id} value={`source:${s.id}`}>{s.title}</option>)}
        </select>}
        {running ? <button className="vajra-send-btn stop" type="button" aria-label="Stop" title="Stop" onClick={() => void stop()}><Square size={15} fill="currentColor" /></button> : <button className="vajra-send-btn" type="submit" aria-label="Send" title="Send" disabled={loading || attaching || !selectedModel || (!input.trim() && !attachments.length)}><ArrowUp size={18} strokeWidth={2.4} /></button>}
      </div>
      <span className="sr-only">Writes and shell commands require review.</span>
    </form>
    </div>
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
        {proposal.edit && <div className="agent-edit-review"><span className="muted small">Replace this passage</span><pre className="agent-edit-before">{proposal.edit.before}</pre><span className="muted small">With</span><pre className="agent-edit-after">{proposal.edit.after || "(delete this passage)"}</pre></div>}
        {proposal.before != null && <details><summary>Current contents</summary><pre>{proposal.before}</pre></details>}
        <details open={!proposal.edit}><summary>Proposed contents</summary><pre>{proposal.after}</pre></details>
      </> : <><b>Run {proposal.shell} command</b><pre>{proposal.command}</pre><p className="muted small">Working folder: {proposal.cwd}. This runs with your account; the folder is not an OS sandbox.</p></>}
      <div className="row"><button className="primary small" disabled={deciding} onClick={() => decide(true)}>Allow once</button><button className="small" disabled={deciding} onClick={() => decide(false)}>Decline</button></div>
    </div>}
  </div>;
}
