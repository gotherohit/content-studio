import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { FolderField } from "./FolderField";

interface Props {
  onCreate: (title: string, dir: string) => Promise<void>;
  onClose: () => void;
}

/** The same rule the server applies, so the dialog can show where the project will land. */
function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
}

/** Creating a project is naming it and choosing the folder to put it in. */
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
          label="Put it in"
          value={dir}
          onChange={setDir}
          description="Choose a folder to put this project in"
          placeholder="Click Browse to choose a folder"
        />

        {dir.trim() && (
          <p className="muted small">
            The project gets its own folder here:{" "}
            <code>{dir.trim().replace(/[/\\]+$/, "") + "\\" + slug(title || "project")}</code>
            {" "}— so deleting the project later can only ever remove that folder, never the one you picked.
          </p>
        )}

        <p className="muted small">
          Everything for this project goes in it: <code>project.json</code>, a <code>sources/</code> folder for what you
          add, and any notebooks or scratch files you make. It is also the working directory for the Terminal, Code and
          Jupyter panes.
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
