import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Crosshair, FileCode2, Folder, FolderOpen, Link2, Lock, PanelLeftClose, PanelLeftOpen, Save, Unlock } from "lucide-react";
import { api, type FsEntry, type FsText } from "../api";
import { desktop } from "../desktop";
import type { CodeView, HighlightColor, PaneView, Source } from "../types";
import { codeSourceFor, locateLines } from "../code";
import { CodeEditor, type CodePlace, type LineMark } from "./CodeEditor";

const COLORS: HighlightColor[] = ["yellow", "green", "pink", "blue"];
const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

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
  onError: (message: string) => void;
}

type Open = FsText & { path: string; key: string };

/**
 * A folder and its text files, for showing code on camera and making small edits.
 *
 * Saving is only ever explicit (Ctrl+S), a file changed on disk is never overwritten
 * silently, and the folder can be opened read-only. Nothing here creates, renames or
 * deletes a file.
 */
export function FilesPane(p: Props) {
  const [entries, setEntries] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<Open | null>(null);
  const [doc, setDoc] = useState("");
  const [conflict, setConflict] = useState(false);
  const [sel, setSel] = useState<[number, number] | undefined>();
  const [restore, setRestore] = useState<(CodePlace & { nonce: number }) | undefined>();
  const [showTree, setShowTree] = useState(lsGet("filesTree", "1") === "1");
  const [saving, setSaving] = useState(false);
  const placeRef = useRef<CodePlace>({ line: 1 });
  const latest = useRef(p);
  latest.current = p;
  const dirty = Boolean(file && doc !== file.content);
  const code = p.view.code;

  const load = async (dir: string) => {
    try {
      const { items } = await api.fsList(p.root, dir);
      setEntries((e) => ({ ...e, [dir]: items }));
    } catch (e) { p.onError((e as Error).message); }
  };
  useEffect(() => { setEntries({}); setExpanded(new Set()); load(""); }, [p.root]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(path: string, target: CodePlace = { line: 1 }, keepView = false) {
    if (dirty && file?.path !== path && !confirm(`Discard your unsaved changes to ${baseName(file!.path)}?`)) return;
    try {
      const text = await api.fsRead(p.root, path);
      setFile({ ...text, path, key: `${p.root}|${path}|${Date.now()}` });
      setDoc(text.content);
      setConflict(false);
      setSel(target.sel);
      placeRef.current = target;
      setRestore({ ...target, nonce: Date.now() });
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
        if (doc === file.content) {
          const text = await api.fsRead(p.root, file.path);
          setFile({ ...text, path: file.path, key: `${p.root}|${file.path}|${Date.now()}` });
          setDoc(text.content);
          setRestore({ ...placeRef.current, nonce: Date.now() });
        } else setConflict(true);
      } catch { /* a vanished file is reported when it is next saved */ }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [file, doc, p.root]);

  async function save() {
    if (!file || !dirty || saving) return;
    if (p.readOnly) { p.onError("This folder is open read-only. Unlock it in the Files toolbar to save."); return; }
    setSaving(true);
    try {
      const { mtime } = await api.fsWrite(p.root, file.path, { content: doc, mtime: file.mtime, eol: file.eol, bom: file.bom });
      setFile({ ...file, content: doc, mtime });
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

  const { sourceId, marks } = useMemo(() => (file ? marksFor(p.sources, p.root, file.path, doc) : { sourceId: null, marks: [] }), [p.sources, p.root, file, doc]);

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

  const tree = (dir: string, depth: number): React.ReactNode =>
    (entries[dir] ?? []).map((e) => (
      <div key={e.path}>
        <button
          className={`tree-item ${file?.path === e.path ? "active" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={e.path}
          onClick={() => {
            if (!e.dir) { open(e.path); return; }
            setExpanded((s) => { const n = new Set(s); if (n.has(e.path)) n.delete(e.path); else { n.add(e.path); if (!entries[e.path]) load(e.path); } return n; });
          }}
        >
          {e.dir ? (expanded.has(e.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="tree-spacer" />}
          {e.dir ? (expanded.has(e.path) ? <FolderOpen size={13} /> : <Folder size={13} />) : <FileCode2 size={13} />}
          <span className="ellipsis">{e.name}</span>
        </button>
        {e.dir && expanded.has(e.path) && tree(e.path, depth + 1)}
      </div>
    ));

  return (
    <div className={`files-pane ${p.presenting ? "presenting" : ""}`}>
      <div className="pane-toolbar">
        {!p.presenting && (
          <button className="icon-btn" onClick={toggleTree} title={showTree ? "Hide the folder" : "Show the folder"}>
            {showTree ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
        )}
        {!p.presenting && <button className="ghost small files-root" onClick={browse} title={`${p.root} — click to choose another folder`}><Folder size={13} /> {baseName(p.root) || p.root}</button>}
        <span className="grow ellipsis files-path" title={file?.path}>{file ? file.path : "Choose a file"}{dirty && !p.presenting && <span className="dirty-dot" title="Unsaved changes — Ctrl+S to save"> ●</span>}</span>
        {!p.presenting && file && sel && (
          <div className="code-sel-tools" title={`Highlight lines ${sel[0]}–${sel[1]}`}>
            <span className="muted small">{sel[0] === sel[1] ? `Line ${sel[0]}` : `Lines ${sel[0]}–${sel[1]}`}</span>
            {COLORS.map((c) => <button key={c} className={`swatch hl-${c}`} title={`Highlight in ${c}`} onClick={() => p.onHighlight(p.root, file.path, doc, sel, c, false)} />)}
            <button className="icon-btn" title="Highlight and link to a source" onClick={() => p.onHighlight(p.root, file.path, doc, sel, "yellow", true)}><Link2 size={13} /></button>
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
          <button className={`icon-btn ${p.readOnly ? "on" : ""}`} onClick={() => p.onReadOnly(!p.readOnly)} title={p.readOnly ? "Read-only: nothing here can be saved. Click to allow editing." : "Editing allowed. Click to make this folder read-only."}>
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
          <div className="files-tree">{entries[""] ? tree("", 0) : <div className="panel-empty">Loading…</div>}</div>
        )}
        <div className="files-editor">
          {file ? (
            <CodeEditor
              doc={doc}
              docKey={file.key}
              fileName={baseName(file.path)}
              readOnly={p.readOnly}
              dark={p.dark}
              fontScale={p.fontScale}
              marks={marks}
              focus={focus}
              restore={restore}
              onChange={setDoc}
              onSave={save}
              onPlace={(place) => {
                placeRef.current = place;
                setSel((s) => (s?.[0] === place.sel?.[0] && s?.[1] === place.sel?.[1] ? s : place.sel));
                latest.current.onPlace({ root: p.root, path: file.path, line: place.line, sel: place.sel, focus: latest.current.view.code?.focus });
              }}
              onMarkClick={(id) => sourceId && p.onMarkClick(sourceId, id)}
            />
          ) : (
            <div className="panel-empty">Pick a file on the left. Ctrl+S saves; nothing is saved by itself.</div>
          )}
        </div>
      </div>
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

  if (error) return <div className="panel-empty">{error}. The file may have moved; its highlights are still in the Highlights pane.</div>;
  if (!text) return <div className="panel-empty">Loading {path}…</div>;
  return (
    <div className="files-editor">
      <CodeEditor
        doc={text.content}
        docKey={`${root}|${path}|${text.mtime}`}
        fileName={baseName(path)}
        readOnly
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
