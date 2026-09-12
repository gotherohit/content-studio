import { useEffect, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import { api } from "../api";
import type { Project } from "../types";
import { FolderField } from "./FolderField";

interface Props {
  project: Project | null;
  onClose: () => void;
  onProjectMoved: (dir: string) => void;
  onOpenedFolder: (id: string) => void;
}

/**
 * Folder actions for the project that is open, plus opening a project folder that
 * already exists on disk. There is nothing app-wide to configure here: a project only
 * lives where its own folder is.
 */
export function ProjectDialog({ project, onClose, onProjectMoved, onOpenedFolder }: Props) {
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
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <FolderOpen size={18} />
          <h3>Project folder</h3>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

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
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
