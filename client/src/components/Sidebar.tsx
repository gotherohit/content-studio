import { useState } from "react";
import {
  ArrowDown, ArrowUp, Camera, ChevronDown, ChevronRight, Clapperboard, FileCode2, FileText, FolderOpen,
  Copy, Image, Network, Plus, Presentation, ScrollText, Settings, Table2, Trash2, Undo2, X,
} from "lucide-react";
import type { Beat, Project, ProjectSummary } from "../types";

interface Props {
  projects: ProjectSummary[];
  project: Project | null;
  activeSourceId: string | null;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onDeleteProject: (id: string) => void;
  /** Shown as busy: shutting Jupyter and any shells down first can take a few seconds. */
  deletingId: string | null;
  onRenameProject: (title: string) => void;
  onOpenSource: (id: string) => void;
  onRemoveSource: (id: string) => void;
  onSettings: () => void;
  /** Show every source and how they connect. */
  onShowMap: () => void;
  onRevealFolder: () => void;
  beatIndex: number;
  onCaptureBeat: () => void;
  onGoToBeat: (i: number) => void;
  onEditBeat: (id: string, fn: (b: Beat) => Beat) => void;
  onMoveBeat: (from: number, to: number) => void;
  onRemoveBeat: (id: string) => void;
  onEditScript: (id: string) => void;
  onRecaptureBeat: (id: string) => void;
  onDuplicateBeat: (id: string) => void;
  undoLabel: string | null;
  onUndoBeat: () => void;
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

/**
 * One beat. The point is editable in place, because it is written while arranging the
 * screen rather than in a separate step, and re-capture replaces the arrangement without
 * disturbing the text.
 */
function BeatRow({ beat, index, active, last, onGo, onPoint, onRecapture, onMove, onRemove, onScript, onDuplicate }: {
  beat: Beat; index: number; active: boolean; last: boolean;
  onGo: () => void;
  onPoint: (point: string) => void;
  onRecapture: () => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onScript: () => void;
  onDuplicate: () => void;
}) {
  return (
    <div className={`list-item beat-row ${active ? "active" : ""}`}>
      <div className="beat-heading">
      <button className="beat-no" title={`Show beat ${index + 1}`} aria-current={active ? "step" : undefined} onClick={onGo}>{index + 1}</button>
      <input
        className="beat-point grow"
        value={beat.point}
        aria-label={`Beat ${index + 1} point`}
        placeholder={`Beat ${index + 1} — add your point`}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onPoint(e.target.value)}
      />
      </div>
      <div className="beat-actions">
      <button className="ghost small beat-show" onClick={onGo} title="Restore this beat's saved arrangement">{active ? "Restore" : "Show"}</button>
      <span className="grow" />
      <button
        className={beat.script?.trim() ? "icon-btn has-script" : "icon-btn"}
        title={beat.script?.trim() ? "Edit what to say here" : "Write what to say here"}
        onClick={(e) => { e.stopPropagation(); onScript(); }}
      ><ScrollText size={12} /></button>
      <button className="icon-btn" title="Move up" disabled={index === 0} onClick={onMove.bind(null, -1)}><ArrowUp size={12} /></button>
      <button className="icon-btn" title="Move down" disabled={last} onClick={onMove.bind(null, 1)}><ArrowDown size={12} /></button>
      <button className="icon-btn" title="Duplicate beat" onClick={onDuplicate}><Copy size={12} /></button>
      <button className="icon-btn" title="Replace this beat's arrangement with what is on screen" onClick={onRecapture}><Camera size={12} /></button>
      <button className="icon-btn danger" title="Delete beat" onClick={onRemove}><X size={12} /></button>
      </div>
    </div>
  );
}

/** The summary's first line, without Markdown markers, as the source's one-line note. */
const firstLine = (summary?: string) => summary?.split("\n").map((line) => line.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";

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
          <div key={s.id} className={`list-item ${p.project?.id === s.id ? "active" : ""} ${p.deletingId === s.id ? "busy" : ""}`} onClick={() => p.onOpenProject(s.id)} title={s.dir}>
            <span className="grow ellipsis">{s.title}</span>
            {p.deletingId === s.id
              ? <span className="muted small">deleting…</span>
              : <span className="badge">{s.sourceCount}</span>}
            <button
              className="icon-btn danger hover-only"
              title="Delete project"
              disabled={p.deletingId === s.id}
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

          <Section
            id="sources"
            title="Sources"
            count={p.project.sources.length}
            actions={<button className="ghost small" title="See how your sources connect, and click through them" onClick={p.onShowMap} disabled={!p.project.sources.length}><Network size={13} /> Map</button>}
          >
            {p.project.sources.map((s) => (
              <div key={s.id} className={`list-item ${p.activeSourceId === s.id ? "active" : ""}`} onClick={() => p.onOpenSource(s.id)} title={s.url}>
                <SourceIcon viewer={s.kind === "code" ? "notebook" : s.kind === "file" ? s.file?.viewer : undefined} />
                <span className="grow source-title">
                  <span className="ellipsis">{s.title}</span>
                  {firstLine(s.summary) && <span className="source-summary-line ellipsis">{firstLine(s.summary)}</span>}
                </span>
                <span className="badge">{s.highlights.length}</span>
                <button className="icon-btn danger hover-only" title="Remove source" onClick={(e) => { e.stopPropagation(); p.onRemoveSource(s.id); }}><X size={13} /></button>
              </div>
            ))}
            {!p.project.sources.length && <div className="panel-empty">No sources yet. Paste a URL or drop a file.</div>}
          </Section>

          <Section
            id="beats"
            title="Beats"
            count={p.project.beats?.length ?? 0}
            actions={
              <button className="ghost small" title="Save what is on screen as a beat" onClick={p.onCaptureBeat}>
                <Plus size={13} /> Beat
              </button>
            }
          >
            {p.undoLabel && <div className="beat-undo" role="status"><span>{p.undoLabel}</span><button className="ghost small" onClick={p.onUndoBeat}><Undo2 size={12} /> Undo</button></div>}
            {(p.project.beats ?? []).map((b, i) => (
              <BeatRow
                key={b.id}
                beat={b}
                index={i}
                active={p.beatIndex === i}
                last={i === (p.project?.beats?.length ?? 0) - 1}
                onGo={() => p.onGoToBeat(i)}
                onPoint={(point) => p.onEditBeat(b.id, (x) => ({ ...x, point }))}
                onRecapture={() => p.onRecaptureBeat(b.id)}
                onDuplicate={() => p.onDuplicateBeat(b.id)}
                onMove={(delta) => p.onMoveBeat(i, i + delta)}
                onRemove={() => p.onRemoveBeat(b.id)}
                onScript={() => p.onEditScript(b.id)}
              />
            ))}
            {!(p.project.beats ?? []).length && (
              <div className="panel-empty">
                Arrange the panes for one point you want to make, then press the camera to save it as a beat. In Present
                mode, → moves to the next one.
              </div>
            )}
          </Section>
        </>
      )}
    </aside>
  );
}
