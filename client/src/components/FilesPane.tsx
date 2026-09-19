import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, Crosshair, FileCode2, FilePlus, Folder, FolderOpen, FolderPlus, Link2, Lock,
  PanelLeftClose, PanelLeftOpen, Pencil, RefreshCw, Save, Trash2, Unlock,
} from "lucide-react";
import { api, type FsEntry, type FsText } from "../api";
import { desktop } from "../desktop";
import type { CodeView, HighlightColor, PaneView, Source } from "../types";
import { codeSourceFor, joinPath, locateLines, renamedPath, samePath } from "../code";
import { CodeEditor, type CodePlace, type LineMark } from "./CodeEditor";

const COLORS: HighlightColor[] = ["yellow", "green", "pink", "blue"];
/** Above this, syntax colours cost more than they help. */
const PLAIN_BYTES = 5 * 1024 * 1024;
const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const joinRel = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const inside = (p: string, dir: string) => p.toLowerCase() === dir.toLowerCase() || p.toLowerCase().startsWith(dir.toLowerCase() + "/");

/** The highlighted lines of one file, found again in its current text. */
export function marksFor(sources: Source[], root: string, path: string, doc: string): { sourceId: string | null; marks: LineMark[] } {
  const source = codeSourceFor(sources, root, path);
  if (!source) return { sourceId: null, marks: [] };
  const marks = source.highlights.flatMap((h) => {
    const at = locateLines(doc, h);
    return at ? [{ id: h.id, from: at.lines[0], to: at.lines[1], color: h.color, stale: !at.found }] : [];
  });
  return { sourceId: source.id, marks };
}

interface Props {
  root: string;
  readOnly: boolean;
  view: PaneView;
  onView: (v: PaneView) => void;
  restoreNonce: number;
  /** Where the editor is now, for a beat to capture; not held in state, it changes on every scroll. */
  onPlace: (code: CodeView) => void;
  sources: Source[];
  selectedHl: string | null;
  scrollNonce: number;
  presenting: boolean;
  dark: boolean;
  fontScale: number;
  onRoot: (root: string) => void;
  onReadOnly: (readOnly: boolean) => void;
  onHighlight: (root: string, path: string, doc: string, lines: [number, number], color: HighlightColor, link: boolean) => void;
  onMarkClick: (sourceId: string, highlightId: string) => void;
  /** A file or folder was renamed: its highlights and the beats showing it follow. */
  onRenamed: (root: string, from: string, to: string) => void;
  onNotice: (text: string) => void;
  onError: (message: string) => void;
}

type Open = FsText & { path: string; key: string };
type Editing = { kind: "file" | "folder"; parent: string; value: string } | { kind: "rename"; path: string; value: string };
type Menu = { x: number; y: number; entry: FsEntry | null };

/**
 * A folder and its files: browse, edit, create, rename and delete, for showing code on camera
 * and the everyday file work around it.
 *
 * Saving is only ever explicit (Ctrl+S), a file changed on disk is never overwritten
 * silently, a create or rename never replaces anything, a delete goes to the Recycle Bin, and
 * the folder can be made read-only, which stops all of them.
 */
export function FilesPane(p: Props) {
  const [entries, setEntries] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<FsEntry | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  // Enter commits and the input then loses focus; the ref makes sure only one of them acts.
  const editingRef = useRef<Editing | null>(null);
  const setEditing = (e: Editing | null) => { editingRef.current = e; setEditingState(e); };
  const [menu, setMenu] = useState<Menu | null>(null);
  const [file, setFile] = useState<Open | null>(null);
  const [dirty, setDirty] = useState(false);
  /** Bumped after edits settle, so highlights are looked for again in the new text. */
  const [edits, setEdits] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [sel, setSel] = useState<[number, number] | undefined>();
  const [restore, setRestore] = useState<(CodePlace & { nonce: number }) | undefined>();
  const [showTree, setShowTree] = useState(lsGet("filesTree", "1") === "1");
  const [saving, setSaving] = useState(false);
  const editor = useRef<{ getDoc: () => string } | null>(null);
  const placeRef = useRef<CodePlace>({ line: 1 });
  const editTimer = useRef(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const latest = useRef(p);
  latest.current = p;
  const code = p.view.code;
  const text = () => editor.current?.getDoc() ?? file?.content ?? "";

  const load = async (dir: string) => {
    try {
      const { items } = await api.fsList(p.root, dir);
      setEntries((e) => ({ ...e, [dir]: items }));
    } catch (e) {
      // A folder that has gone since it was listed simply drops out of the tree.
      if (dir) setEntries((e) => { const n = { ...e }; delete n[dir]; return n; });
      else p.onError((e as Error).message);
    }
  };
  const reloadTree = () => Promise.all(["", ...Object.keys(entries).filter(Boolean)].map(load));
  useEffect(() => { setEntries({}); setExpanded(new Set()); setSelected(null); load(""); }, [p.root]); // eslint-disable-line react-hooks/exhaustive-deps

  function loaded(path: string, content: FsText, target: CodePlace) {
    setFile({ ...content, path, key: `${p.root}|${path}|${Date.now()}` });
    setDirty(false);
    setConflict(false);
    placeRef.current = target;
    setRestore({ ...target, nonce: Date.now() });
  }

  async function open(path: string, target: CodePlace = { line: 1 }, keepView = false) {
    if (dirty && file?.path !== path && !confirm(`Discard your unsaved changes to ${baseName(file!.path)}?`)) return;
    try {
      const content = await api.fsRead(p.root, path);
      loaded(path, content, target);
      setSel(target.sel);
      if (!keepView) latest.current.onView({ ...latest.current.view, code: { root: p.root, path, line: target.line, sel: target.sel, focus: false } });
    } catch (e) { p.onError((e as Error).message); }
  }

  // A beat, or the pane mounting with one: open its file where it was.
  useEffect(() => {
    if (!code?.path) return;
    // Focused lines are already picked out by the dimming; a text selection on top of them
    // reads as a stray click on camera.
    const target = { line: code.line, sel: code.focus ? undefined : code.sel };
    if (file && file.path === code.path) { setSel(code.sel); setRestore({ ...target, nonce: Date.now() }); }
    else open(code.path, target, true);
  }, [p.restoreNonce, code?.root]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another editor, git or the AI pane may change the file. Reload it when there is nothing
  // here to lose; otherwise say so and let the creator choose.
  useEffect(() => {
    if (!file) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { mtime } = await api.fsStat(p.root, file.path);
        if (Math.abs(mtime - file.mtime) <= 1) return;
        if (latest.current.view.code?.path !== file.path) return;
        if (!dirty) loaded(file.path, await api.fsRead(p.root, file.path), placeRef.current);
        else setConflict(true);
      } catch { /* a vanished file is reported when it is next saved */ }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [file, dirty, p.root]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!file || !dirty || saving) return;
    if (p.readOnly) { p.onError("This folder is open read-only. Unlock it in the Files toolbar to save."); return; }
    setSaving(true);
    try {
      const content = text();
      const { mtime } = await api.fsWrite(p.root, file.path, { content, mtime: file.mtime, eol: file.eol, bom: file.bom });
      setFile({ ...file, content, mtime });
      setDirty(false);
    } catch (e) {
      if (/changed on disk/.test((e as Error).message)) setConflict(true);
      else p.onError((e as Error).message);
    } finally { setSaving(false); }
  }

  async function keepMine() {
    if (!file) return;
    try { const { mtime } = await api.fsStat(p.root, file.path); setFile({ ...file, mtime }); setConflict(false); }
    catch (e) { p.onError((e as Error).message); }
  }

  // ---- create, rename, delete
  const refuseReadOnly = () => { p.onError("This folder is open read-only. Unlock it in the Files toolbar first."); return true; };
  const folderFor = (entry: FsEntry | null) => (!entry ? "" : entry.dir ? entry.path : parentOf(entry.path));

  function startNew(kind: "file" | "folder", entry: FsEntry | null = selected) {
    if (p.readOnly && refuseReadOnly()) return;
    const parent = folderFor(entry);
    if (parent) { setExpanded((s) => new Set(s).add(parent)); if (!entries[parent]) load(parent); }
    setEditing({ kind, parent, value: "" });
  }
  function startRename(entry: FsEntry | null = selected) {
    if (!entry || (p.readOnly && refuseReadOnly())) return;
    setEditing({ kind: "rename", path: entry.path, value: entry.name });
  }

  async function commit() {
    const e = editingRef.current;
    setEditing(null);
    if (!e) return;
    // The name box is gone; without this, focus falls to the page and Ctrl+S reaches nothing.
    requestAnimationFrame(() => treeRef.current?.focus());
    const value = e.value.trim().replace(/\\/g, "/");
    if (!value) return;
    try {
      if (e.kind === "rename") {
        const to = joinRel(parentOf(e.path), value);
        if (to === e.path) return;
        const r = await api.fsRename(p.root, e.path, to);
        setExpanded((s) => new Set([...s].map((x) => renamedPath(x, r.from, r.path) ?? x)));
        setSelected((s) => (s ? { ...s, path: renamedPath(s.path, r.from, r.path) ?? s.path, name: baseName(renamedPath(s.path, r.from, r.path) ?? s.path) } : s));
        // The open file keeps its unsaved edits under its new name.
        if (file) {
          const moved = renamedPath(file.path, r.from, r.path);
          if (moved) setFile({ ...file, path: moved });
        }
        p.onRenamed(p.root, r.from, r.path);
        // Folders already listed are listed again under their new names; the old names are gone.
        const dirs = ["", ...Object.keys(entries).filter(Boolean).map((k) => renamedPath(k, r.from, r.path) ?? k)];
        setEntries((all) => Object.fromEntries(Object.entries(all).filter(([k]) => !k || !renamedPath(k, r.from, r.path))));
        await Promise.all(dirs.map(load));
        const parent = parentOf(r.path);
        if (parent) { setExpanded((s) => new Set(s).add(parent)); await load(parent); }
        p.onNotice(`Renamed to ${r.path}`);
      } else {
        const r = await api.fsCreate(p.root, joinRel(e.parent, value), e.kind === "folder");
        // Every folder on the way is shown, so the new entry is visible at once.
        const parts = r.path.split("/");
        const chain = parts.slice(0, r.dir ? parts.length : parts.length - 1).map((_, i) => parts.slice(0, i + 1).join("/"));
        setExpanded((s) => new Set([...s, ...chain]));
        await Promise.all(["", ...chain].map(load));
        setSelected({ name: baseName(r.path), path: r.path, dir: r.dir });
        if (!r.dir) await open(r.path);
      }
    } catch (err) { p.onError((err as Error).message); }
  }

  async function remove(entry: FsEntry | null = selected) {
    if (!entry || (p.readOnly && refuseReadOnly())) return;
    // Counted by file: a file can have more than one code source if others once had its name.
    const highlighted = new Set(p.sources
      .filter((s) => s.kind === "code" && s.code && samePath(s.code.root, p.root) && inside(s.code.path, entry.path) && s.highlights.length)
      .map((s) => s.code!.path.toLowerCase())).size;
    const openInside = file && inside(file.path, entry.path);
    const lines = [
      `Move ${entry.dir ? "the folder " : ""}${entry.path}${entry.dir ? " and everything in it" : ""} to the Recycle Bin?`,
      openInside && dirty ? `\nYour unsaved changes to ${baseName(file!.path)} will be lost.` : "",
      highlighted ? `\n${highlighted === 1 ? "A file here has" : `${highlighted} files here have`} highlights. They stay in the project, marked as missing, and come back if you restore it.` : "",
      "\nYou can restore it from the Recycle Bin.",
    ];
    if (!confirm(lines.join(""))) return;
    try {
      await api.fsDelete(p.root, entry.path);
      if (openInside) { setFile(null); setDirty(false); latest.current.onView({ ...latest.current.view, code: undefined }); }
      setSelected(null);
      await reloadTree();
      p.onNotice(`${entry.path} moved to the Recycle Bin`);
    } catch (err) { p.onError((err as Error).message); }
  }

  // The context menu closes on any click elsewhere, Escape, or the window losing focus.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); window.removeEventListener("blur", close); };
  }, [menu]);

  // Without edits the loaded text is exactly what the editor shows. Reading the editor instead
  // would find the previous file's text: the new one only reaches it after this render.
  const docForMarks = useMemo(() => (!file ? "" : dirty ? text() : file.content), [file, edits, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const { sourceId, marks } = useMemo(
    () => (file ? marksFor(p.sources, p.root, file.path, docForMarks) : { sourceId: null, marks: [] }),
    [p.sources, p.root, file, docForMarks],
  );

  // Choosing one of this file's highlights elsewhere scrolls to it here.
  useEffect(() => {
    const m = marks.find((x) => x.id === p.selectedHl);
    if (m) setRestore({ line: Math.max(1, m.from - 3), sel: [m.from, m.to], nonce: Date.now() });
  }, [p.scrollNonce, p.selectedHl]); // eslint-disable-line react-hooks/exhaustive-deps

  const focus = code?.focus && code.sel ? code.sel : null;
  const toggleTree = () => { setShowTree((v) => { lsSet("filesTree", v ? "0" : "1"); return !v; }); };
  const browse = async () => {
    const dir = desktop ? await desktop.pickFolder("Folder to show in the Files pane") : (await api.pickFolder("Folder to show in the Files pane", p.root)).dir;
    if (dir) p.onRoot(dir);
  };

  const input = (depth: number, icon: React.ReactNode) => editing && (
    <div className="tree-item editing" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="tree-spacer" />
      {icon}
      <input
        autoFocus
        className="tree-input"
        value={editing.value}
        placeholder={editing.kind === "folder" ? "folder name" : editing.kind === "file" ? "file name — a/b.py makes folders too" : ""}
        spellCheck={false}
        onFocus={(e) => { if (editing.kind === "rename") { const dot = e.target.value.lastIndexOf("."); e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length); } }}
        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(null);
        }}
        onBlur={() => commit()}
      />
    </div>
  );

  const newRow = (dir: string, depth: number) =>
    editing && editing.kind !== "rename" && editing.parent === dir
      ? input(depth, editing.kind === "folder" ? <Folder size={13} /> : <FileCode2 size={13} />)
      : null;

  const tree = (dir: string, depth: number): React.ReactNode => (
    <>
      {newRow(dir, depth)}
      {(entries[dir] ?? []).map((e) => (
        <div key={e.path}>
          {editing?.kind === "rename" && editing.path === e.path ? input(depth, e.dir ? <Folder size={13} /> : <FileCode2 size={13} />) : (
            <button
              className={`tree-item ${file?.path === e.path ? "active" : ""} ${selected?.path === e.path ? "selected" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={e.path}
              onClick={() => {
                setSelected(e);
                if (!e.dir) { open(e.path); return; }
                setExpanded((s) => { const n = new Set(s); if (n.has(e.path)) n.delete(e.path); else { n.add(e.path); if (!entries[e.path]) load(e.path); } return n; });
              }}
              onContextMenu={(ev) => { ev.preventDefault(); setSelected(e); setMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
            >
              {e.dir ? (expanded.has(e.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="tree-spacer" />}
              {e.dir ? (expanded.has(e.path) ? <FolderOpen size={13} /> : <Folder size={13} />) : <FileCode2 size={13} />}
              <span className="ellipsis">{e.name}</span>
            </button>
          )}
          {e.dir && expanded.has(e.path) && tree(e.path, depth + 1)}
        </div>
      ))}
    </>
  );

  const plain = Boolean(file && file.size > PLAIN_BYTES);

  return (
    <div
      className={`files-pane ${p.presenting ? "presenting" : ""}`}
      onKeyDown={(e) => {
        // The editor handles its own Ctrl+S; this covers focus anywhere else in the pane.
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !e.defaultPrevented) { e.preventDefault(); save(); }
      }}
    >
      <div className="pane-toolbar">
        {!p.presenting && (
          <button className="icon-btn" onClick={toggleTree} title={showTree ? "Hide the folder" : "Show the folder"}>
            {showTree ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
        )}
        {!p.presenting && <button className="ghost small files-root" onClick={browse} title={`${p.root} — click to choose another folder`}><Folder size={13} /> {baseName(p.root) || p.root}</button>}
        <span className="grow ellipsis files-path" title={file?.path}>
          {file ? file.path : "Choose a file"}
          {dirty && !p.presenting && <span className="dirty-dot" title="Unsaved changes — Ctrl+S to save"> ●</span>}
          {plain && !p.presenting && <span className="muted small" title="Syntax colours are off for files over 5 MB, to keep editing quick"> · large file, plain text</span>}
        </span>
        {!p.presenting && file && sel && (
          <div className="code-sel-tools" title={`Highlight lines ${sel[0]}–${sel[1]}`}>
            <span className="muted small">{sel[0] === sel[1] ? `Line ${sel[0]}` : `Lines ${sel[0]}–${sel[1]}`}</span>
            {COLORS.map((c) => <button key={c} className={`swatch hl-${c}`} title={`Highlight in ${c}`} onClick={() => p.onHighlight(p.root, file.path, text(), sel, c, false)} />)}
            <button className="icon-btn" title="Highlight and link to a source" onClick={() => p.onHighlight(p.root, file.path, text(), sel, "yellow", true)}><Link2 size={13} /></button>
          </div>
        )}
        {!p.presenting && file && (
          <button
            className={`icon-btn ${code?.focus ? "on" : ""}`}
            disabled={!code?.focus && !sel}
            title={code?.focus ? "Stop dimming the other lines" : sel ? "Dim every line except the selected ones — for pointing at code on camera" : "Select some lines to focus on them"}
            onClick={() => p.onView({ ...p.view, code: { ...(code ?? { root: p.root, path: file.path, line: 1 }), sel: code?.focus ? code.sel : sel, focus: !code?.focus } })}
          ><Crosshair size={14} /></button>
        )}
        {!p.presenting && (
          <button className={`icon-btn ${p.readOnly ? "on" : ""}`} onClick={() => p.onReadOnly(!p.readOnly)} title={p.readOnly ? "Read-only: nothing here can be saved, created, renamed or deleted. Click to allow changes." : "Changes allowed. Click to make this folder read-only."}>
            {p.readOnly ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
        )}
        {!p.presenting && file && !p.readOnly && (
          <button className="ghost small" onClick={save} disabled={!dirty || saving} title="Save (Ctrl+S)"><Save size={13} /> {saving ? "Saving…" : "Save"}</button>
        )}
      </div>
      {conflict && (
        <div className="error-bar files-conflict">
          <span>{file ? baseName(file.path) : "This file"} changed on disk while you were editing it.</span>
          <span className="row">
            <button className="ghost small" onClick={() => file && open(file.path, placeRef.current, true).then(() => setConflict(false))}>Load theirs, drop mine</button>
            <button className="ghost small" onClick={keepMine}>Keep mine — overwrite on save</button>
          </span>
        </div>
      )}
      <div className="files-body">
        {showTree && !p.presenting && (
          <div className="files-side">
            <div className="files-tree-tools">
              <button className="icon-btn" disabled={p.readOnly} title={p.readOnly ? "Read-only" : "New file"} onClick={() => startNew("file")}><FilePlus size={14} /></button>
              <button className="icon-btn" disabled={p.readOnly} title={p.readOnly ? "Read-only" : "New folder"} onClick={() => startNew("folder")}><FolderPlus size={14} /></button>
              <span className="grow" />
              <button className="icon-btn" title="Refresh the folder" onClick={() => reloadTree()}><RefreshCw size={13} /></button>
            </div>
            <div
              ref={treeRef}
              className="files-tree"
              tabIndex={0}
              onKeyDown={(e) => {
                if (editing) return;
                if (e.key === "F2") { e.preventDefault(); startRename(); }
                if (e.key === "Delete") { e.preventDefault(); remove(); }
              }}
              onContextMenu={(ev) => { if (ev.target === ev.currentTarget) { ev.preventDefault(); setSelected(null); setMenu({ x: ev.clientX, y: ev.clientY, entry: null }); } }}
            >
              {entries[""] ? tree("", 0) : <div className="panel-empty">Loading…</div>}
            </div>
          </div>
        )}
        <div className="files-editor">
          {file ? (
            <CodeEditor
              doc={file.content}
              docKey={file.key}
              fileName={baseName(file.path)}
              readOnly={p.readOnly}
              plain={plain}
              dark={p.dark}
              fontScale={p.fontScale}
              marks={marks}
              focus={focus}
              restore={restore}
              handle={editor}
              onChange={() => {
                setDirty(true);
                window.clearTimeout(editTimer.current);
                editTimer.current = window.setTimeout(() => setEdits((n) => n + 1), 400);
              }}
              onSave={save}
              onPlace={(place) => {
                placeRef.current = place;
                setSel((s) => (s?.[0] === place.sel?.[0] && s?.[1] === place.sel?.[1] ? s : place.sel));
                latest.current.onPlace({ root: p.root, path: file.path, line: place.line, sel: place.sel, focus: latest.current.view.code?.focus });
              }}
              onMarkClick={(id) => sourceId && p.onMarkClick(sourceId, id)}
            />
          ) : (
            <div className="panel-empty">Pick a file on the left, or make one with the new-file button. Ctrl+S saves; nothing is saved by itself.</div>
          )}
        </div>
      </div>
      {menu && (
        <div className="tree-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button disabled={p.readOnly} onClick={() => { setMenu(null); startNew("file", menu.entry); }}><FilePlus size={13} /> New file{menu.entry ? ` in ${baseName(folderFor(menu.entry)) || "the folder"}` : ""}</button>
          <button disabled={p.readOnly} onClick={() => { setMenu(null); startNew("folder", menu.entry); }}><FolderPlus size={13} /> New folder</button>
          {menu.entry && (
            <>
              <hr />
              <button disabled={p.readOnly} onClick={() => { setMenu(null); startRename(menu.entry); }}><Pencil size={13} /> Rename <span className="muted">F2</span></button>
              <button disabled={p.readOnly} className="danger" onClick={() => { setMenu(null); remove(menu.entry); }}><Trash2 size={13} /> Delete <span className="muted">Del</span></button>
            </>
          )}
          <hr />
          <button onClick={() => { setMenu(null); api.reveal(joinPath(p.root, folderFor(menu.entry))).catch((e) => p.onError(e.message)); }}><FolderOpen size={13} /> Show in Explorer</button>
          {p.readOnly && <span className="muted small tree-menu-note">Read-only — unlock to change files</span>}
        </div>
      )}
    </div>
  );
}

/** A code source in a Source pane: the file, read-only, with its highlights. */
export function CodeSourceView({ source, sources, dark, fontScale, selectedHl, scrollNonce, view, restoreNonce, onPlace, onMarkClick }: {
  source: Source;
  sources: Source[];
  dark: boolean;
  fontScale: number;
  selectedHl: string | null;
  scrollNonce: number;
  view: PaneView;
  restoreNonce: number;
  onPlace: (code: CodeView) => void;
  onMarkClick: (highlightId: string) => void;
}) {
  const [text, setText] = useState<FsText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restore, setRestore] = useState<(CodePlace & { nonce: number }) | undefined>();
  const { root, path } = source.code!;
  useEffect(() => {
    api.fsRead(root, path).then((t) => { setText(t); setError(null); }).catch((e) => setError((e as Error).message));
  }, [root, path]);
  const { marks } = useMemo(() => (text ? marksFor(sources, root, path, text.content) : { marks: [] as LineMark[] }), [sources, root, path, text]);
  useEffect(() => {
    const m = marks.find((x) => x.id === selectedHl);
    if (m) setRestore({ line: Math.max(1, m.from - 3), sel: [m.from, m.to], nonce: Date.now() });
    else if (view.code) setRestore({ line: view.code.line, sel: view.code.sel, nonce: Date.now() });
  }, [scrollNonce, selectedHl, restoreNonce, text]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="panel-empty">{error}. The file may have been moved or deleted; its highlights are still in the Highlights pane.</div>;
  if (!text) return <div className="panel-empty">Loading {path}…</div>;
  return (
    <div className="files-editor">
      <CodeEditor
        doc={text.content}
        docKey={`${root}|${path}|${text.mtime}`}
        fileName={baseName(path)}
        readOnly
        plain={text.size > PLAIN_BYTES}
        dark={dark}
        fontScale={fontScale}
        marks={marks}
        focus={view.code?.focus && view.code.sel ? view.code.sel : null}
        restore={restore}
        onPlace={(place) => onPlace({ root, path, line: place.line, sel: place.sel, focus: view.code?.focus })}
        onMarkClick={onMarkClick}
      />
    </div>
  );
}
