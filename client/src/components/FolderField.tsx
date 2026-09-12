import { useState } from "react";
import { FolderSearch } from "lucide-react";
import { api } from "../api";
import { desktop } from "../desktop";

interface Props {
  label: string;
  value: string;
  onChange: (dir: string) => void;
  description?: string;
  placeholder?: string;
}

/**
 * A folder chosen with the operating system's own dialog. A browser cannot hand a real
 * path to the server, so Browse asks the server to open the native picker; the box stays
 * editable for anyone who would rather paste a path.
 */
export function FolderField({ label, value, onChange, description, placeholder }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function browse() {
    setBusy(true); setErr(null);
    try {
      // On the desktop the dialog belongs to the window; in a browser the server opens it.
      const dir = desktop
        ? await desktop.pickFolder(description ?? label)
        : (await api.pickFolder(description ?? label, value)).dir;
      if (dir) onChange(dir);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <span>{label}</span>
      <div className="folder-field">
        <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} placeholder={placeholder} />
        <button type="button" className="ghost" onClick={browse} disabled={busy}>
          <FolderSearch size={14} /> {busy ? "Choosing…" : "Browse"}
        </button>
      </div>
      {busy && <span className="muted small">A folder dialog has opened on your desktop.</span>}
      {err && <span className="small" style={{ color: "var(--danger)" }}>{err}</span>}
    </div>
  );
}
