import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { FolderField } from "./FolderField";

interface Props {
  onCreate: (title: string, dir: string) => Promise<void>;
  onClose: () => void;
}

/** Creating a project is naming it and choosing the folder it will live in. */
export function NewProjectDialog({ onCreate, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = Boolean(title.trim() && dir.trim());

  async function create() {
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      await onCreate(title.trim(), dir.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <FolderPlus size={18} />
          <h3>New project</h3>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="How Git actually stores your code"
            onKeyDown={(e) => { if (e.key === "Enter" && ready) create(); }}
          />
        </label>

        <FolderField
          label="Folder"
          value={dir}
          onChange={setDir}
          description="Choose a folder for this project"
          placeholder="Click Browse to choose a folder"
        />

        <p className="muted small">
          Everything for this project goes in that folder: <code>project.json</code>, a <code>sources/</code> folder for
          what you add, and any notebooks or scratch files you make. It is also the working directory for the Terminal,
          Code and Jupyter panes.
        </p>

        {err && <div className="error-bar">{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create} disabled={busy || !ready}>{busy ? "Creating…" : "Create project"}</button>
        </div>
      </div>
    </div>
  );
}
