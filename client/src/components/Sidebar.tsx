import { useState } from "react";
import {
  ChevronDown, ChevronRight, Clapperboard, FileCode2, FileText, FolderOpen,
  Image, Plus, Presentation, Settings, Table2, Trash2, X,
} from "lucide-react";
import type { Project, ProjectSummary } from "../types";

interface Props {
  projects: ProjectSummary[];
  project: Project | null;
  activeSourceId: string | null;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onDeleteProject: (id: string) => void;
  onRenameProject: (title: string) => void;
  onOpenSource: (id: string) => void;
  onRemoveSource: (id: string) => void;
  onSettings: () => void;
  onRevealFolder: () => void;
}

const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** A small icon hinting what kind of source this is. */
function SourceIcon({ viewer }: { viewer?: string }) {
  const size = 14;
  if (viewer === "notebook") return <FileCode2 size={size} className="muted" />;
  if (viewer === "pdf" || viewer === "deck" || viewer === "office") return <Presentation size={size} className="muted" />;
  if (viewer === "image" || viewer === "video") return <Image size={size} className="muted" />;
  if (viewer === "table") return <Table2 size={size} className="muted" />;
  return <FileText size={size} className="muted" />;
}

/** A sidebar section that folds away, so either list can be hidden while recording. */
function Section({ id, title, count, actions, children }: {
  id: string; title: string; count?: number;
  actions?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(lsGet(`section:${id}`, "1") === "1");
  const toggle = () => { const next = !open; setOpen(next); lsSet(`section:${id}`, next ? "1" : "0"); };
  return (
    <div className={`sidebar-section ${open ? "open" : "closed"}`}>
      <div className="section-title">
        <button className="section-toggle" onClick={toggle} title={open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{title}</span>
          {count !== undefined && <span className="badge">{count}</span>}
        </button>
        <span className="row">{actions}</span>
      </div>
      {open && <div className="section-items">{children}</div>}
    </div>
  );
}

export function Sidebar(p: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Clapperboard size={18} />
        <span>Content Studio</span>
        <span className="grow" />
        <button className="icon-btn" title="Project folders" onClick={p.onSettings}><Settings size={15} /></button>
      </div>

      <Section
        id="projects"
        title="Projects"
        count={p.projects.length}
        actions={<button className="icon-btn" title="New project" onClick={p.onNewProject}><Plus size={15} /></button>}
      >
        {p.projects.map((s) => (
          <div key={s.id} className={`list-item ${p.project?.id === s.id ? "active" : ""}`} onClick={() => p.onOpenProject(s.id)} title={s.dir}>
            <span className="grow ellipsis">{s.title}</span>
            <span className="badge">{s.sourceCount}</span>
            <button
              className="icon-btn danger hover-only"
              title="Delete project"
              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${s.title}"?\n\nThis removes its folder and everything in it:\n${s.dir}`)) p.onDeleteProject(s.id); }}
            ><Trash2 size={13} /></button>
          </div>
        ))}
        {!p.projects.length && <div className="panel-empty">Create your first project.</div>}
      </Section>

      {p.project && (
        <>
          <div className="project-head">
            <input className="title-input" value={p.project.title} onChange={(e) => p.onRenameProject(e.target.value)} placeholder="Project name" />
            <button className="folder-line" onClick={p.onRevealFolder} title={`Open ${p.project.dir ?? ""} in Explorer`}>
              <FolderOpen size={12} />
              <span className="ellipsis">{p.project.dir ?? "no folder"}</span>
            </button>
          </div>

          <Section id="sources" title="Sources" count={p.project.sources.length}>
            {p.project.sources.map((s) => (
              <div key={s.id} className={`list-item ${p.activeSourceId === s.id ? "active" : ""}`} onClick={() => p.onOpenSource(s.id)} title={s.url}>
                <SourceIcon viewer={s.kind === "file" ? s.file?.viewer : undefined} />
                <span className="grow ellipsis">{s.title}</span>
                <span className="badge">{s.highlights.length}</span>
                <button className="icon-btn danger hover-only" title="Remove source" onClick={(e) => { e.stopPropagation(); p.onRemoveSource(s.id); }}><X size={13} /></button>
              </div>
            ))}
            {!p.project.sources.length && <div className="panel-empty">No sources yet. Paste a URL or drop a file.</div>}
          </Section>
        </>
      )}
    </aside>
  );
}
