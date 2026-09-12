import { useEffect, useState } from "react";
import { Download, FolderOpen, Settings, Sparkles, X } from "lucide-react";
import { api } from "../api";
import type { Project } from "../types";
import { FolderField } from "./FolderField";
import { ModelSettings } from "./ModelSettings";
import { UpdateSettings } from "./UpdateSettings";

interface Props {
  project: Project | null;
  onClose: () => void;
  onProjectMoved: (dir: string) => void;
  onOpenedFolder: (id: string) => void;
  /** Which section to land on, for the AI pane's "set one up" link. */
  initialTab?: Tab;
}

type Tab = "models" | "folders" | "updates";

/**
 * Content Studio's own settings, as opposed to a project's.
 *
 * Only two things are genuinely app-wide: the models it can talk to, and the keys that
 * unlock them. Everything else about a project — above all where it lives — belongs to
 * that project's own folder, so the folder actions sit in their own section rather than
 * pretending to be global defaults.
 */
export function SettingsDialog({ project, onClose, onProjectMoved, onOpenedFolder, initialTab = "models" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Settings size={18} />
          <h3>Content Studio settings</h3>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="tab-bar">
          <button className={tab === "models" ? "tab active" : "tab"} onClick={() => setTab("models")}>
            <Sparkles size={13} /> Models and keys
          </button>
          <button className={tab === "folders" ? "tab active" : "tab"} onClick={() => setTab("folders")}>
            <FolderOpen size={13} /> Project folders
          </button>
          <button className={tab === "updates" ? "tab active" : "tab"} onClick={() => setTab("updates")}>
            <Download size={13} /> Updates
          </button>
        </div>

        {tab === "models" && <ModelSettings />}
        {tab === "folders" && (
          <FolderSettings project={project} onProjectMoved={onProjectMoved} onOpenedFolder={onOpenedFolder} />
        )}
        {tab === "updates" && <UpdateSettings />}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Where the open project lives, and how to adopt a project folder that already exists. */
function FolderSettings({ project, onProjectMoved, onOpenedFolder }: {
  project: Project | null;
  onProjectMoved: (dir: string) => void;
  onOpenedFolder: (id: string) => void;
}) {
  const [dir, setDir] = useState(project?.dir ?? "");
  const [openDir, setOpenDir] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => setDir(project?.dir ?? ""), [project?.dir]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null); setNote(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };

  return (
    <>
      <p className="muted small">
        There is no app-wide project location by design: a project only lives where you put its folder.
      </p>

      {project ? (
        <>
          <FolderField
            label={`Folder for “${project.title}”`}
            value={dir}
            onChange={setDir}
            description={`Where should “${project.title}” live?`}
          />
          <div className="row">
            <button
              disabled={!!busy || !dir.trim() || dir.trim() === project.dir}
              onClick={() => guard("move", async () => {
                const r = await api.setProjectFolder(project.id, dir.trim());
                onProjectMoved(r.dir);
                setNote(`Moved to ${r.dir}`);
              })}
            >{busy === "move" ? "Moving…" : "Move project here"}</button>
            <button className="ghost" disabled={!project.dir} onClick={() => project.dir && api.reveal(project.dir).catch((e) => setErr(e.message))}>
              Open in Explorer
            </button>
          </div>
        </>
      ) : (
        <p className="muted small">Open a project to manage its folder.</p>
      )}

      <hr className="rule" />

      <FolderField
        label="Open a project folder that already exists"
        value={openDir}
        onChange={setOpenDir}
        description="Choose a folder containing project.json"
        placeholder="Click Browse to find one"
      />
      <div className="row">
        <button
          className="ghost"
          disabled={!!busy || !openDir.trim()}
          onClick={() => guard("open", async () => {
            const r = await api.openProjectFolder(openDir.trim());
            onOpenedFolder(r.id);
            setNote(`Opened “${r.title}”`);
            setOpenDir("");
          })}
        >{busy === "open" ? "Opening…" : "Open project"}</button>
      </div>

      {note && <div className="note-bar">{note}</div>}
      {err && <div className="error-bar">{err}</div>}
    </>
  );
}
