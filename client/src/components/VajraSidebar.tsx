import { useEffect, useState } from "react";
import { FolderOpen, MessageSquare, Plus, Search, Settings, Plug, X } from "lucide-react";
import type { ResearchSession } from "../research";

interface Props {
  id: string;
  modal: boolean;
  scope: string;
  projectTitle?: string;
  rows: Pick<ResearchSession, "id" | "title" | "status" | "updatedAt">[];
  selectedId?: string;
  disabled: boolean;
  loading: boolean;
  workspace?: string;
  onScope: (scope: string) => void;
  onChoose: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onExtensions: () => void;
  onFiles: () => void;
  onClose: () => void;
}

export function VajraSidebar(p: Props) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [p.scope, p.projectTitle]);
  const rows = p.rows.filter((row) => row.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <nav id={p.id} className="vajra-sidebar" role={p.modal ? "dialog" : undefined} aria-modal={p.modal || undefined} aria-label="Vajra conversations">
    <div className="row between"><strong>Vajra</strong><button className="icon-btn" title="Close Vajra sidebar" onClick={p.onClose}><X size={15} /></button></div>
    <button className="primary small" disabled={p.disabled} onClick={() => { setQuery(""); p.onNew(); }}><Plus size={14} /> New conversation</button>
    <label className="vajra-workspace-label">Workspace
      <select aria-label="Conversation location" value={p.scope} disabled={p.disabled} onChange={(e) => p.onScope(e.target.value)}>
        {p.projectTitle && <option value="project">{p.projectTitle}</option>}
        <option value="global">Global research</option>
      </select>
    </label>
    <span className="muted small">{p.scope === "project" ? "Conversations saved with this project" : "Conversations saved in your app home"}</span>
    <label className="vajra-search"><Search size={14} /><input aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    <div className="vajra-conversation-list" aria-busy={p.loading}>
      {p.loading ? <p className="muted small">Loading conversations…</p> : rows.length ? rows.map((row) => <button key={row.id} className="vajra-conversation" aria-current={row.id === p.selectedId ? "page" : undefined} disabled={p.disabled} onClick={() => p.onChoose(row.id)} title={row.title}>
        <MessageSquare size={14} /><span><b>{row.title}</b><small>{row.status === "idle" ? "New conversation" : row.status}</small></span>
      </button>) : <p className="muted small">{query.trim() ? "No matching conversations." : "No conversations yet. Start one above."}</p>}
    </div>
    <div className="vajra-sidebar-footer">
      {p.workspace && <button className="ghost small" onClick={p.onFiles} title={p.workspace}><FolderOpen size={14} /> Research files</button>}
      <button className="ghost small" onClick={p.onExtensions}><Plug size={14} /> Skills &amp; MCP</button>
      <button className="ghost small" onClick={p.onSettings}><Settings size={14} /> Settings</button>
    </div>
  </nav>;
}
