import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Columns2, Columns3, EyeOff, Grid2x2, Maximize2, Minus, MonitorPlay, Moon, PanelLeftClose,
  PanelLeftOpen, Paperclip, Plus, Presentation, Square, SquareSplitHorizontal, SquareSplitVertical, Sun, X,
} from "lucide-react";
import { viewerForExt } from "./types";
import { captureSummary, duplicateBeat, insertBeatAfter, moveBeatInList } from "./beats";
import { pruneLinks, type LinkEnd, type Relation } from "./links";
import { codeHighlight, codeSourceFor, joinPath, renameCodeRefs, renamedPath, samePath } from "./code";
import { samePage } from "../../server/public/pages.js";
import { desktop } from "./desktop";
import type { Beat, CanvasView, CodeView, Highlight, HighlightColor, Layout, LayoutPreset, PaneConfig, PaneKind, PaneView, Project, ProjectSummary, ReadingPosition, Source, Stage } from "./types";
import { api, type AppConfig } from "./api";
import { UpdateBanner } from "./components/UpdateBanner";
import { Sidebar } from "./components/Sidebar";
import { SourcePane } from "./components/SourcePane";
import { HighlightsPanel } from "./components/HighlightsPanel";
import { NotesPanel } from "./components/NotesPanel";
import { CodePanel } from "./components/CodePanel";
import { AiPanel } from "./components/AiPanel";
import { CanvasPanel } from "./components/CanvasPanel";
import { EmbedPane } from "./components/EmbedPane";
import { BrowserPane } from "./components/BrowserPane";
import { TerminalPane } from "./components/TerminalPane";
import { JupyterPane } from "./components/JupyterPane";
import { SlidesPane } from "./components/SlidesPane";
import { WindowPane } from "./components/WindowPane";
import { SettingsDialog } from "./components/SettingsDialog";
import { BeatScriptDialog } from "./components/BeatScriptDialog";
import { LinkDialog } from "./components/LinkDialog";
import { SourceMap } from "./components/SourceMap";
import { FilesPane } from "./components/FilesPane";
import { NewProjectDialog } from "./components/NewProjectDialog";

const KINDS: { id: PaneKind; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "highlights", label: "Highlights" },
  { id: "map", label: "Source map" },
  { id: "files", label: "Files" },
  { id: "notes", label: "Notes" },
  { id: "ai", label: "AI" },
  { id: "code", label: "Code" },
  { id: "terminal", label: "Terminal" },
  { id: "jupyter", label: "Jupyter" },
  { id: "slides", label: "Slides" },
  { id: "canvas", label: "Canvas" },
  { id: "browser", label: "Browser" },
  { id: "window", label: "Window" },
  { id: "embed", label: "Embed" },
];

const PRESETS: { id: LayoutPreset; label: string; count: number; Icon: typeof Square }[] = [
  { id: "1", label: "Single pane", count: 1, Icon: Square },
  { id: "2", label: "Two columns", count: 2, Icon: Columns2 },
  { id: "1+2", label: "One left, two right", count: 3, Icon: SquareSplitHorizontal },
  { id: "2+1", label: "Two left, one right", count: 3, Icon: SquareSplitVertical },
  { id: "3", label: "Three columns", count: 3, Icon: Columns3 },
  { id: "4", label: "Four panes", count: 4, Icon: Grid2x2 },
];

const DEFAULT_LAYOUT: Layout = { preset: "2", panes: [{ kind: "source" }, { kind: "highlights" }], split: 58, rowSplit: 50 };

/** Both on the source's own page (undefined), or both on the same browsed page. */
const sameBrowsedPage = (a?: string, b?: string) => (!a && !b) || (Boolean(a && b) && samePage(a!, b!));
const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** Fill in fields that older project files may lack. */
function normalize(p: Project): Project {
  return {
    ...p,
    slides: p.slides ?? "",
    // a file source saved by an older version may carry a stale viewer
    sources: (p.sources ?? []).map((s) => (s.kind === "file" && s.file ? { ...s, file: { ...s.file, viewer: viewerForExt(s.file.ext) } } : s)),
    layout: {
      ...DEFAULT_LAYOUT,
      ...(p.layout ?? {}),
      // panes used to be a plain list of kinds
      panes: (p.layout?.panes ?? DEFAULT_LAYOUT.panes).map((x) =>
        typeof x === "string" ? { kind: x as PaneKind } : x,
      ),
    },
    // the script field was briefly called `note`
    links: p.links ?? [],
    beats: (p.beats ?? []).map((b) => (b.note && !b.script ? { ...b, script: b.note, note: undefined } : b)),
    settings: { viewMode: "original", ...(p.settings ?? {}), jupyterUrl: p.settings?.jupyterUrl ?? "http://localhost:8888" },
  };
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [selectedHl, setSelectedHl] = useState<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [paneViews, setPaneViews] = useState<Record<number, PaneView>>({});
  const [stageNonce, setStageNonce] = useState(0);
  const positions = useRef<Record<number, { projectId: string; sourceId: string; mode: string; page?: string; position: ReadingPosition }>>({});
  const canvasViews = useRef<Record<number, CanvasView>>({});
  /** Where each Files pane or code source is scrolled; reported on every scroll, so a ref. */
  const codeViews = useRef<Record<number, CodeView>>({});
  /** Where the canvas is looking now, and where a beat wants it pointed. */
  const canvasViewRef = useRef<CanvasView | null>(null);
  const [canvasTarget, setCanvasTarget] = useState<CanvasView | null>(null);
  const [canvasNonce, setCanvasNonce] = useState(0);
  /** Which beat was applied last, so Present mode knows where it is in the running order. */
  const [activeBeatId, setActiveBeatId] = useState<string | null>(null);
  const [beatUndo, setBeatUndo] = useState<{ projectId: string; label: string; apply: (p: Project) => Project } | null>(null);
  /** The beat strip is inside the window, so anything capturing the window records it. */
  const [showHud, setShowHud] = useState(lsGet("hud", "1") === "1");
  const [presenterOpen, setPresenterOpen] = useState(false);
  const [scriptFor, setScriptFor] = useState<string | null>(null);
  /** Deleting can take a few seconds when Jupyter or a shell has to be shut down first. */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const presenterStateRef = useRef<() => void>(() => {});
  /** Read by the global key handler, which is registered before the beat helpers exist. */
  const goToBeatRef = useRef<(i: number) => void>(() => {});
  const presentationKeyRef = useRef<(key: string) => boolean>(() => false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [collapsed, setCollapsed] = useState(lsGet("collapsed", "0") === "1");
  /** Collapsing the source summary is the creator's choice, and nothing reopens it for them. */
  const [summaryOpen, setSummaryOpen] = useState(lsGet("summaryOpen", "0") === "1");
  /** Where a link being made starts: a passage, or a whole source. */
  const [linkFrom, setLinkFrom] = useState<LinkEnd | null>(null);
  const [showMap, setShowMap] = useState(false);
  /** A short confirmation that a capture happened, or a warning about what it could not record. */
  const [notice, setNotice] = useState<{ text: string; kind: "ok" | "warn" | "fail" } | null>(null);
  const [dark, setDark] = useState(lsGet("dark", "1") === "1");
  const [fontScale, setFontScale] = useState(Number(lsGet("font", "1.05")));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [dragging, setDragging] = useState<null | "col" | "row">(null);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLElement>(null);
  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  const source = project?.sources.find((s) => s.id === activeSourceId) ?? null;
  const [globalLayout, setGlobalLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const layout = project?.layout ?? globalLayout;
  const beats = project?.beats ?? [];
  const beatIndex = beats.findIndex((beat) => beat.id === activeBeatId);
  // The presenter window's commands arrive outside React's render flow.
  const beatsRef = useRef(beats);
  const beatIndexRef = useRef(beatIndex);
  beatsRef.current = beats;
  beatIndexRef.current = beatIndex;
  presentationKeyRef.current = (key) => {
    if (!present) return false;
    const last = beatsRef.current.length - 1;
    if (key === "Escape") { setPresent(false); return true; }
    if (last < 0) return false;
    if (["ArrowRight", "PageDown", " "].includes(key)) goToBeatRef.current(Math.min(last, beatIndexRef.current + 1));
    else if (["ArrowLeft", "PageUp"].includes(key)) goToBeatRef.current(Math.max(0, beatIndexRef.current - 1));
    else if (key === "Home") goToBeatRef.current(0);
    else if (key === "End") goToBeatRef.current(last);
    else if (key === "h") setShowHud((v) => { lsSet("hud", v ? "0" : "1"); return !v; });
    else return false;
    return true;
  };

  const refreshList = useCallback(() => api.listProjects().then(setProjects), []);

  useEffect(() => {
    api.config().then(setConfig).catch((e) => setError(e.message));
    refreshList()
      .then(() => {
        const last = lsGet("lastProject", "");
        if (last) openProject(last).catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; lsSet("dark", dark ? "1" : "0"); }, [dark]);
  useEffect(() => lsSet("font", String(fontScale)), [fontScale]);
  useEffect(() => lsSet("collapsed", collapsed ? "1" : "0"), [collapsed]);
  useEffect(() => lsSet("summaryOpen", summaryOpen ? "1" : "0"), [summaryOpen]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.kind === "ok" ? 2500 : 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function openProject(id: string) {
    let p: Project;
    try {
      p = normalize(await api.getProject(id));
    } catch (e) {
      // its folder may have been moved or deleted outside the app
      setError(`Could not open that project: ${(e as Error).message}`);
      lsSet("lastProject", "");
      refreshList();
      return;
    }
    setProject(p);
    setActiveSourceId(p.sources[0]?.id ?? null);
    setPaneViews({});
    positions.current = {};
    canvasViews.current = {};
    setCanvasTarget(null);
    canvasViewRef.current = null;
    setActiveBeatId(null);
    setBeatUndo(null);
    setSelectedHl(null);
    lsSet("lastProject", id);
    adoptFolderFiles(p).catch(() => {});
  }

  /**
   * The project folder is the source of truth: anything dropped into its sources/
   * folder from Explorer or a script shows up as a source next time it is opened.
   */
  async function adoptFolderFiles(p: Project) {
    const onDisk = await api.listFiles(p.id);
    const known = new Set(p.sources.filter((s) => s.kind === "file").map((s) => s.file?.name));
    const added = onDisk
      .filter((f) => !known.has(f.name))
      .map((f, i): Source => ({
        id: `src${Date.now().toString(36)}${i}`,
        kind: "file",
        file: { ...f, viewer: viewerForExt(f.ext) },
        url: api.fileUrl(p.id, f.name),
        title: f.name, byline: null, siteName: null, excerpt: null,
        content: "", textContent: "", fetchedAt: new Date().toISOString(), highlights: [],
      }));
    const onDiskNames = new Set(onDisk.map((f) => f.name));
    const removed = p.sources.filter((s) => s.kind === "file" && !onDiskNames.has(s.file?.name ?? "")).length;
    if (added.length || removed) {
      mutate((cur) => ({
        ...cur,
        sources: [...cur.sources.filter((s) => s.kind !== "file" || onDiskNames.has(s.file?.name ?? "")), ...added],
      }));
    }
  }

  // ---- debounced autosave
  const mutate = useCallback((fn: (p: Project) => Project) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      if (next === prev) return prev;
      dirtyRef.current = true;
      setSaveState("dirty");
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        setSaveState("saving");
        try {
          await api.saveProject(next);
          dirtyRef.current = false;
          setSaveState("saved");
          refreshList();
        } catch (e) {
          setError(`Save failed: ${(e as Error).message}`);
          setSaveState("dirty");
        }
      }, 600);
      return next;
    });
  }, [refreshList]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable;
      if (e.altKey && !typing) {
        if (e.key === "p") { if (!present && beatIndexRef.current < 0 && beatsRef.current.length) goToBeatRef.current(0); setPresent((v) => !v); e.preventDefault(); }
        if (e.key === "b") { setCollapsed((v) => !v); e.preventDefault(); }
      }
      if (e.key === "Escape" && present && !document.fullscreenElement) setPresent(false);
      // While presenting, one key is the whole interface: the next beat.
      if (present && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (presentationKeyRef.current(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [present, beats.length, beatIndex]);

  // ---- actions
  async function newProject(title: string, dir: string) {
    const p = normalize(await api.createProject(title, dir));
    await refreshList();
    setProject(p);
    setActiveSourceId(null);
    setPaneViews({});
    positions.current = {};
    canvasViews.current = {};
    setCanvasTarget(null);
    canvasViewRef.current = null;
    setActiveBeatId(null);
    setBeatUndo(null);
    setSelectedHl(null);
    lsSet("lastProject", p.id);
  }

  async function deleteProject(id: string) {
    // A save queued a moment ago would otherwise land after the delete and recreate the
    // folder, so the project appears to come back.
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    dirtyRef.current = false;
    setDeletingId(id);
    setError(null);
    try {
      await api.deleteProject(id);
    } catch (e) {
      // Silence here was the bug: a delete that failed simply did nothing.
      setError((e as Error).message);
      return;
    } finally {
      setDeletingId(null);
    }
    if (project?.id === id) { setProject(null); setActiveSourceId(null); setActiveBeatId(null); setBeatUndo(null); lsSet("lastProject", ""); }
    setSaveState("saved");
    refreshList();
  }

  const addSource = useCallback(async (raw: string, from?: string): Promise<string | null> => {
    const target = raw.trim();
    if (!target) return null;
    if (!project) { setError("Create or open a project first."); return null; }
    setLoading(true); setError(null);
    try {
      const a = await api.fetchArticle(target);
      const s: Source = {
        id: `src${Date.now().toString(36)}`,
        url: target, title: a.title || target, byline: a.byline, siteName: a.siteName, excerpt: a.excerpt,
        content: a.content, textContent: a.textContent, fetchedAt: a.fetchedAt, highlights: [], scripts: true,
        ...(from ? { from } : {}),
      };
      mutate((p) => ({ ...p, sources: [...p.sources, s] }));
      setActiveSourceId(s.id);
      setUrl("");
      return s.id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [project, mutate]);

  /** Add slide decks, notebooks, PDFs, images or text as sources. */
  const addFiles = useCallback(async (files: FileList | File[]) => {
    if (!project) { setError("Create or open a project first."); return; }
    setLoading(true); setError(null);
    try {
      let lastId: string | null = null;
      for (const f of Array.from(files)) {
        const info = await api.uploadFile(project.id, f);
        const s: Source = {
          id: `src${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          kind: "file", file: info,
          url: api.fileUrl(project.id, info.name),
          title: info.name, byline: null, siteName: null, excerpt: null,
          content: "", textContent: "", fetchedAt: new Date().toISOString(), highlights: [],
        };
        mutate((p) => ({ ...p, sources: [...p.sources, s] }));
        lastId = s.id;
      }
      if (lastId) setActiveSourceId(lastId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [project, mutate]);

  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDropping(true); } };
    const leave = (e: DragEvent) => { if (e.relatedTarget === null) setDropping(false); };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDropping(false);
      addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, [addFiles]);

  const updateSource = useCallback((id: string, fn: (s: Source) => Source) =>
    mutate((p) => ({ ...p, sources: p.sources.map((s) => (s.id === id ? fn(s) : s)) })), [mutate]);

  async function refreshSource(target: Source) {
    if (target.kind === "file" || target.kind === "code") return;
    setLoading(true);
    try {
      const a = await api.fetchArticle(target.url, true);
      updateSource(target.id, (s) => ({ ...s, title: a.title || s.title, content: a.content, textContent: a.textContent, fetchedAt: a.fetchedAt }));
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }

  const addHighlight = useCallback((sourceId: string, h: Highlight) => {
    updateSource(sourceId, (s) => ({ ...s, highlights: [...s.highlights, h] }));
    setActiveSourceId(sourceId);
    setSelectedHl(h.id);
  }, [updateSource]);

  /** Called from a page or file view: show the matching card. */
  const selectFromPage = useCallback((sourceId: string, id: string) => {
    setActiveSourceId(sourceId);
    setSelectedHl(id);
    requestAnimationFrame(() => document.getElementById(`hlcard-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, []);

  /** Called from a card: scroll the source to that highlight. */
  const selectFromCard = useCallback((id: string) => {
    setSelectedHl(id);
    setScrollNonce((n) => n + 1);
  }, []);

  const openLink = useCallback((link: string, newTab: boolean, from?: string) => {
    if (newTab) { window.open(link, "_blank", "noreferrer"); return; }
    const existing = project?.sources.find((s) => samePage(s.url, link));
    if (existing) { setActiveSourceId(existing.id); return; }
    addSource(link, from);
  }, [project, addSource]);

  /** Keep a page browsed inside a pane as a source of its own, and show it in that pane. */
  const savePageAsSource = useCallback(async (link: string, from: string, paneIndex: number) => {
    const existing = project?.sources.find((s) => samePage(s.url, link));
    const id = existing?.id ?? await addSource(link, from);
    if (!id) return;
    setActiveSourceId(id);
    // A pinned pane would otherwise keep showing the page it was browsing from.
    setLayout((l) => ({ ...l, panes: l.panes.map((x, j) => (j === paneIndex && x.sourceId ? { ...x, sourceId: id } : x)) }));
    setNotice({ kind: "ok", text: existing ? "That page is already a source — showing it." : "Saved as a source." });
  }, [project, addSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- code
  /**
   * Highlight lines in the Files pane. The file becomes a code source the first time, so its
   * highlights can be linked, mapped and put in beats like any other.
   */
  function addCodeHighlight(root: string, path: string, doc: string, lines: [number, number], color: HighlightColor, link: boolean) {
    if (!project) return;
    const h = codeHighlight(doc, lines, color, `h${Date.now().toString(36)}`);
    const existing = codeSourceFor(project.sources, root, path);
    const sourceId = existing?.id ?? `src${Date.now().toString(36)}c`;
    mutate((p) => {
      const found = codeSourceFor(p.sources, root, path);
      if (found) return { ...p, sources: p.sources.map((s) => (s.id === found.id ? { ...s, highlights: [...s.highlights, h] } : s)) };
      const s: Source = {
        id: sourceId, kind: "code", code: { root, path }, url: joinPath(root, path), title: path,
        content: "", textContent: "", fetchedAt: new Date().toISOString(), highlights: [h],
      };
      return { ...p, sources: [...p.sources, s] };
    });
    const span = lines[0] === lines[1] ? `Line ${lines[0]}` : `Lines ${lines[0]}–${lines[1]}`;
    setNotice({ kind: "ok", text: `${span} highlighted${existing ? "" : " — the file is now a source, so it can be linked"}` });
    if (link) setLinkFrom({ sourceId, highlightId: h.id });
  }

  /**
   * A file or folder renamed in a Files pane. Its code sources, every beat showing it, and any
   * pane that has it open follow, so nothing is left pointing at the old name.
   */
  function renameFiles(root: string, from: string, to: string) {
    mutate((p) => ({ ...p, ...renameCodeRefs(p, root, from, to) }));
    // The selected source may have been merged into an older one for the same file.
    const active = project?.sources.find((s) => s.id === activeSourceId);
    const movedTo = active?.code && samePath(active.code.root, root) ? renamedPath(active.code.path, from, to) : null;
    if (project && movedTo) {
      const survivor = codeSourceFor(renameCodeRefs(project, root, from, to).sources, root, movedTo);
      if (survivor && survivor.id !== activeSourceId) setActiveSourceId(survivor.id);
    }
    const follow = (code?: CodeView) => {
      const moved = code && samePath(code.root, root) ? renamedPath(code.path, from, to) : null;
      return moved ? { ...code!, path: moved } : code;
    };
    setPaneViews((m) => Object.fromEntries(Object.entries(m).map(([i, v]) => [i, v.code ? { ...v, code: follow(v.code) } : v])));
    for (const [i, c] of Object.entries(codeViews.current)) codeViews.current[Number(i)] = follow(c)!;
  }

  // ---- links between sources
  function addLink(from: LinkEnd, to: LinkEnd, relation: Relation, note: string) {
    const link = { id: `lk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, from, to, relation, ...(note ? { note } : {}), createdAt: new Date().toISOString() };
    mutate((p) => ({ ...p, links: [...(p.links ?? []), link] }));
    setNotice({ kind: "ok", text: "Linked — it shows on both sources and on the map." });
  }
  const removeLink = (id: string) => mutate((p) => ({ ...p, links: (p.links ?? []).filter((l) => l.id !== id) }));
  /** Open one end of a link, scrolled to its passage when it has one. */
  const goToEnd = useCallback((end: LinkEnd) => {
    if (!project?.sources.some((s) => s.id === end.sourceId)) { setError("That source has been removed."); return; }
    setActiveSourceId(end.sourceId);
    setSelectedHl(end.highlightId ?? null);
    if (end.highlightId) setScrollNonce((n) => n + 1);
  }, [project?.sources]);

  function copyHighlights() {
    if (!source) return;
    const md = [`## ${source.title}`, source.url, "", ...source.highlights.map((h) => `> ${h.text}\n${h.comment ? `\n${h.comment}\n` : ""}`)].join("\n");
    navigator.clipboard.writeText(md);
  }

  // ---- layout
  const setLayout = useCallback((fn: (l: Layout) => Layout) => {
    if (!project) { setGlobalLayout(fn); return; }
    mutate((p) => ({ ...p, layout: fn({ ...DEFAULT_LAYOUT, ...(p.layout ?? {}) }) }));
  }, [mutate, project]);

  // ---- beats
  //
  // A beat is a step in the argument; its stage is the arrangement that serves it. The
  // stage is captured from whatever is on screen rather than filled in on a form, so
  // building one is: get it looking right, then save it.

  /** A Files pane's or code source's live place, with the focus setting it was given. */
  const codeFor = (pane: PaneConfig, i: number, sourceId: string | undefined, saved?: CodeView): CodeView | undefined => {
    const live = codeViews.current[i];
    const code = pane.kind === "source" ? project?.sources.find((s) => s.id === sourceId)?.code : undefined;
    const matches = live && (pane.kind === "files" || (code && live.path === code.path && live.root === code.root));
    // A focused beat is restored without a text selection, so its lines live only in the saved view.
    return matches ? { ...live, sel: live.sel ?? (saved?.focus ? saved.sel : undefined), focus: saved?.focus } : saved;
  };

  /** Everything about the current arrangement that can be put back later. */
  const captureStage = useCallback((): Stage => ({
    preset: layout.preset,
    panes: layout.panes.map((x) => ({ ...x })),
    views: Object.fromEntries(layout.panes.map((pane, i) => {
      const sourceId = pane.sourceId || activeSourceId || undefined;
      const view = paneViews[i]?.sourceId === sourceId || !paneViews[i]?.sourceId ? paneViews[i] ?? {} : {};
      const mode = view.mode ?? pane.mode ?? project?.settings.viewMode ?? "original";
      const live = positions.current[i];
      return [i, {
        ...view, sourceId, mode,
        canvasView: pane.kind === "canvas" ? canvasViews.current[i] : undefined,
        code: codeFor(pane, i, sourceId, view.code),
        position: pane.kind === "source" && live?.projectId === project?.id && live?.sourceId === sourceId && live?.mode === mode && sameBrowsedPage(live.page, view.page) ? { ...live.position } : undefined,
      }];
    })),
    split: layout.split,
    rowSplit: layout.rowSplit,
    activeSourceId,
    highlightId: selectedHl,
    viewMode: project?.settings.viewMode ?? "original",
    embedUrl: project?.settings.embedUrl,
    browserUrl: project?.settings.browserUrl,
    canvasView: canvasViewRef.current ?? undefined,
    // The whole project: a code source created since the last render must be found by codeFor.
  }), [layout, paneViews, activeSourceId, selectedHl, project]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Put a stage back on screen. References that have gone — a deleted source, a highlight
   * that is no longer there — are reported rather than silently ignored, because finding
   * out mid-take that a beat shows the wrong thing is the failure worth avoiding.
   */
  const applyStage = useCallback((stage: Stage) => {
    const missing: string[] = [];
    const liveSource = stage.activeSourceId && project?.sources.some((s) => s.id === stage.activeSourceId)
      ? stage.activeSourceId
      : (stage.activeSourceId ? (missing.push("its source"), null) : null);

    const panes = stage.panes.map((x, i) => {
      if (x.sourceId && !project?.sources.some((s) => s.id === x.sourceId)) missing.push(`the source in pane ${i + 1}`);
      return { ...x };
    });
    setPaneViews(stage.views ?? {});
    setStageNonce((n) => n + 1);
    setActiveSourceId(liveSource);
    setCanvasTarget(stage.canvasView ?? null);
    setCanvasNonce((n) => n + 1);

    const hl = liveSource && stage.highlightId
      ? project?.sources.find((s) => s.id === liveSource)?.highlights.some((h) => h.id === stage.highlightId)
      : false;
    if (stage.highlightId && !hl) missing.push("its highlight");
    // New beats restore each pane's viewport; the highlight is only an older beat's fallback.
    setSelectedHl(hl && !Object.values(stage.views ?? {}).some((v) => v.position) ? stage.highlightId : null);
    if (hl) setScrollNonce((n) => n + 1);

    mutate((p) => ({
      ...p,
      layout: { preset: stage.preset, panes, split: stage.split, rowSplit: stage.rowSplit },
      settings: {
        ...p.settings,
        viewMode: stage.viewMode,
        embedUrl: stage.embedUrl ?? p.settings.embedUrl,
        browserUrl: stage.browserUrl ?? p.settings.browserUrl,
      },
    }));
    setError(missing.length ? `This beat could not restore ${missing.join(" or ")} — it may have been removed.` : null);
  }, [project, mutate]);

  const goToBeat = useCallback((i: number) => {
    const list = project?.beats ?? [];
    if (i < 0 || i >= list.length) return;
    // Update the ref immediately as presenter/iframe commands may arrive before React renders.
    beatIndexRef.current = i;
    setActiveBeatId(list[i].id);
    applyStage(list[i].stage);
  }, [project?.beats, applyStage]);
  goToBeatRef.current = goToBeat;

  // ---- the presenter window
  //
  // It is a second window on the other monitor, outside whatever is capturing the studio.
  // The studio stays the source of truth: it publishes which beat is running, and acts on
  // what the presenter window asks for.
  useEffect(() => {
    if (!desktop) return;
    desktop.presenterOpen().then(setPresenterOpen).catch(() => {});
    const offClosed = desktop.onPresenterClosed(() => setPresenterOpen(false));
    const offFailed = desktop.onPresenterFailed((reason) =>
      setError(`The presenter window did not come up: ${reason}. Close it and open it again.`));
    const offCmd = desktop.onPresenterCommand((cmd) => {
      if (cmd.type === "next") goToBeatRef.current(Math.min(beatsRef.current.length - 1, beatIndexRef.current + 1));
      if (cmd.type === "prev") goToBeatRef.current(Math.max(0, beatIndexRef.current - 1));
      if (cmd.type === "goto") goToBeatRef.current(cmd.index);
      if (cmd.type === "present") { if (cmd.on && beatIndexRef.current < 0 && beatsRef.current.length) goToBeatRef.current(0); setPresent(cmd.on); }
      // The window has just mounted and missed whatever was published before it existed.
      if (cmd.type === "sync") presenterStateRef.current();
    });
    return () => { offClosed(); offFailed(); offCmd(); };
  }, []);

  const publishPresenter = useCallback(() => {
    desktop?.publishPresenterState({
      projectTitle: project?.title ?? "",
      projectId: project?.id ?? "",
      beats: beats.map((b) => ({ id: b.id, point: b.point, script: b.script ?? "" })),
      index: beatIndex,
      presenting: present,
    });
  }, [project?.id, project?.title, beats, beatIndex, present]);
  presenterStateRef.current = publishPresenter;

  useEffect(() => { if (presenterOpen) publishPresenter(); }, [presenterOpen, publishPresenter]);

  /** Say what a capture recorded, so a pane that had not reported its place is found now, not mid-take. */
  function reportCapture(stage: Stage, number: number, verb: string) {
    const summary = captureSummary(stage, layout.panes, project?.sources ?? []);
    if (summary.unplaced.length) {
      const panes = summary.unplaced.map((i) => i + 1).join(" and ");
      setNotice({ kind: "warn", text: `Beat ${number} ${verb}, but pane ${panes} had not reported where it is. Scroll it slightly, then use the camera on this beat to capture again.` });
    } else {
      setNotice({ kind: "ok", text: `Beat ${number} ${verb}${summary.where ? ` — ${summary.where}` : ""}` });
    }
  }

  function captureBeat() {
    if (!project) { setNotice({ kind: "fail", text: "Capture failed — open a project first." }); return; }
    try {
      const beat: Beat = {
        id: Math.random().toString(36).slice(2, 10),
        point: "",
        stage: captureStage(),
        createdAt: new Date().toISOString(),
      };
      const next = insertBeatAfter(project.beats ?? [], activeBeatId, beat);
      mutate((p) => ({ ...p, beats: insertBeatAfter(p.beats ?? [], activeBeatId, beat) }));
      setActiveBeatId(beat.id);
      reportCapture(beat.stage, next.findIndex((b) => b.id === beat.id) + 1, "captured");
    } catch (e) {
      setNotice({ kind: "fail", text: `Capture failed: ${(e as Error).message}` });
    }
  }

  const editBeat = (id: string, fn: (b: Beat) => Beat) =>
    mutate((p) => ({ ...p, beats: (p.beats ?? []).map((b) => (b.id === id ? fn(b) : b)) }));

  function moveBeat(from: number, to: number) {
    const id = beats[from]?.id;
    if (id) mutate((p) => ({ ...p, beats: moveBeatInList(p.beats ?? [], id, to) }));
  }

  function copyBeat(id: string) {
    const original = beats.find((beat) => beat.id === id);
    if (!original) return;
    const copy = duplicateBeat(original, crypto.randomUUID());
    mutate((p) => ({ ...p, beats: insertBeatAfter(p.beats ?? [], id, copy) }));
    setActiveBeatId(copy.id);
    applyStage(copy.stage);
  }

  function recaptureBeat(id: string) {
    const beat = beats.find((item) => item.id === id);
    if (!beat || !project) return;
    try {
      const previous = structuredClone(beat.stage);
      const stage = captureStage();
      setBeatUndo({ projectId: project.id, label: "Arrangement updated", apply: (p) => ({ ...p, beats: p.beats.map((b) => b.id === id ? { ...b, stage: previous } : b) }) });
      editBeat(id, (b) => ({ ...b, stage }));
      setActiveBeatId(id);
      reportCapture(stage, beats.findIndex((b) => b.id === id) + 1, "captured again");
    } catch (e) {
      setNotice({ kind: "fail", text: `Capture failed: ${(e as Error).message}` });
    }
  }

  function removeBeat(id: string) {
    const index = beats.findIndex((beat) => beat.id === id);
    const beat = beats[index];
    if (!beat || !project) return;
    const predecessor = beats[index - 1]?.id ?? null;
    setBeatUndo({ projectId: project.id, label: "Beat deleted", apply: (p) => {
      if (p.beats.some((b) => b.id === id)) return p;
      const next = [...p.beats];
      const at = predecessor ? next.findIndex((b) => b.id === predecessor) + 1 : 0;
      next.splice(at, 0, beat);
      return { ...p, beats: next };
    } });
    mutate((p) => ({ ...p, beats: p.beats.filter((beat) => beat.id !== id) }));
    // The displayed arrangement stays put; do not pretend a neighbouring beat is on screen.
    if (activeBeatId === id) setActiveBeatId(null);
  }

  function undoBeatEdit() {
    if (!beatUndo || project?.id !== beatUndo.projectId) return;
    mutate((p) => p.id === beatUndo.projectId ? beatUndo.apply(p) : p);
    setBeatUndo(null);
  }

  function setPreset(id: LayoutPreset) {
    const count = PRESETS.find((x) => x.id === id)!.count;
    setLayout((l) => {
      const panes = [...l.panes];
      const fillers: PaneKind[] = ["source", "highlights", "terminal", "notes"];
      while (panes.length < count) panes.push({ kind: fillers.find((k) => !panes.some((p) => p.kind === k)) ?? "notes" });
      return { ...l, preset: id, panes: panes.slice(0, count) };
    });
  }

  /**
   * Drag to resize. A full-size overlay captures the pointer while dragging, so
   * iframes (the original page, Jupyter) cannot swallow the mouse events, and the
   * CSS variable is written straight to the DOM for a frame-perfect drag. Project
   * state is only updated once, on release.
   */
  function startDrag(axis: "col" | "row", e: React.PointerEvent) {
    e.preventDefault();
    const grid = gridRef.current!;
    const box = grid.getBoundingClientRect();
    setDragging(axis);
    let pct = axis === "col" ? layout.split : layout.rowSplit;
    let frame = 0;

    const move = (ev: PointerEvent) => {
      const raw = axis === "col"
        ? ((ev.clientX - box.left) / box.width) * 100
        : ((ev.clientY - box.top) / box.height) * 100;
      pct = Math.min(85, Math.max(15, raw));
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        grid.style.setProperty(axis === "col" ? "--split" : "--row-split", `${pct}%`);
      });
    };
    const up = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(null);
      setLayout((l) => (axis === "col" ? { ...l, split: pct } : { ...l, rowSplit: pct }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function renderPane(pane: PaneConfig, i: number) {
    if (!project && pane.kind === "ai") return <AiPanel key="global" source={null} onOpenSettings={() => setShowSettings(true)} />;
    if (!project) return <div className="empty-state"><h2>No project open</h2><p>Create or open a project on the left, or choose AI for global research.</p></div>;
    switch (pane.kind) {
      case "source": {
        // A pinned pane keeps its own source; an unpinned one follows the sidebar.
        const paneSource = (pane.sourceId ? project.sources.find((s) => s.id === pane.sourceId) : source) ?? null;
        return (
          <SourcePane
            key={`${project.id}:${paneSource?.id ?? "empty"}`}
            source={paneSource}
            sources={project.sources}
            pinnedId={pane.sourceId ?? null}
            onPin={(sourceId) => setLayout((l) => ({ ...l, panes: l.panes.map((x, j) => (j === i ? { ...x, sourceId } : x)) }))}
            projectId={project.id}
            apiPort={config?.apiPort ?? 4700}
            mode={pane.mode ?? project.settings.viewMode ?? "original"}
            onMode={(mode) => setLayout((l) => ({ ...l, panes: l.panes.map((x, j) => j === i ? { ...x, mode } : x) }))}
            onToggleScripts={() => paneSource && updateSource(paneSource.id, (s) => ({ ...s, scripts: s.scripts === false }))}
            onAddHighlight={(h) => paneSource && addHighlight(paneSource.id, h)}
            onSelectHighlight={(id) => paneSource && selectFromPage(paneSource.id, id)}
            onOpenLink={(link, newTab) => openLink(link, newTab, paneSource?.id)}
            onSaveAsSource={(link) => paneSource && savePageAsSource(link, paneSource.id, i)}
            fromSource={paneSource?.from ? project.sources.find((s) => s.id === paneSource.from) ?? null : null}
            onShowSource={(id) => { if (pane.sourceId) setLayout((l) => ({ ...l, panes: l.panes.map((x, j) => (j === i ? { ...x, sourceId: id } : x)) })); setActiveSourceId(id); setSelectedHl(null); }}
            summaryOpen={summaryOpen}
            onSummaryOpen={setSummaryOpen}
            onSummary={(summary) => paneSource && updateSource(paneSource.id, (s) => ({ ...s, summary }))}
            onCodePlace={(code) => { codeViews.current[i] = code; }}
            dark={dark}
            onRefresh={() => paneSource && refreshSource(paneSource)}
            scrollToId={paneSource && paneSource.id === activeSourceId ? selectedHl : null}
            scrollNonce={scrollNonce}
            restoreNonce={stageNonce}
            presenting={present}
            onPresentationKey={(key) => { presentationKeyRef.current(key); }}
            view={paneViews[i] ?? {}}
            onView={(v) => setPaneViews((m) => ({ ...m, [i]: v }))}
            onPosition={(position, mode, page) => { if (paneSource) positions.current[i] = { projectId: project.id, sourceId: paneSource.id, mode, page, position }; }}
            fontScale={fontScale}
            busy={loading}
            config={config}
          />
        );
      }
      case "highlights":
        return (
          <HighlightsPanel
            source={source}
            sources={project.sources}
            links={project.links ?? []}
            selectedId={selectedHl}
            onSelect={selectFromCard}
            onUpdate={(h) => source && updateSource(source.id, (s) => ({ ...s, highlights: s.highlights.map((x) => (x.id === h.id ? h : x)) }))}
            onDelete={(id) => source && mutate((p) => {
              const sources = p.sources.map((s) => (s.id === source.id ? { ...s, highlights: s.highlights.filter((x) => x.id !== id) } : s));
              return { ...p, sources, links: pruneLinks(p.links ?? [], sources) };
            })}
            onCopyAll={copyHighlights}
            onLink={setLinkFrom}
            onRemoveLink={removeLink}
            onGo={goToEnd}
          />
        );
      case "files": {
        const root = paneViews[i]?.code?.root ?? project.settings.filesRoot ?? project.dir ?? "";
        return (
          <FilesPane
            key={`files-${i}-${project.id}`}
            root={root}
            readOnly={Boolean(project.settings.filesReadOnly)}
            view={paneViews[i] ?? {}}
            onView={(v) => setPaneViews((m) => ({ ...m, [i]: v }))}
            restoreNonce={stageNonce}
            onPlace={(code) => { codeViews.current[i] = code; }}
            sources={project.sources}
            selectedHl={selectedHl}
            scrollNonce={scrollNonce}
            presenting={present}
            dark={dark}
            fontScale={fontScale}
            onRoot={(dir) => {
              mutate((p) => ({ ...p, settings: { ...p.settings, filesRoot: dir } }));
              setPaneViews((m) => ({ ...m, [i]: { ...(m[i] ?? {}), code: undefined } }));
              delete codeViews.current[i];
            }}
            onReadOnly={(readOnly) => mutate((p) => ({ ...p, settings: { ...p.settings, filesReadOnly: readOnly } }))}
            onHighlight={addCodeHighlight}
            onMarkClick={(sourceId, highlightId) => {
              setActiveSourceId(sourceId);
              setSelectedHl(highlightId);
              requestAnimationFrame(() => document.getElementById(`hlcard-${highlightId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
            }}
            onRenamed={renameFiles}
            onNotice={(text) => setNotice({ kind: "ok", text })}
            onError={setError}
          />
        );
      }
      case "map":
        return (
          <SourceMap
            sources={project.sources}
            links={project.links ?? []}
            activeSourceId={activeSourceId}
            onOpen={(id) => { setActiveSourceId(id); setSelectedHl(null); }}
            onGo={goToEnd}
          />
        );
      case "notes": return <NotesPanel value={project.notes} onChange={(notes) => mutate((p) => ({ ...p, notes }))} />;
      case "ai": return <AiPanel key={project.id} projectId={project.id} hasLegacyChat={project.chat.length > 0} source={source} onOpenSettings={() => setShowSettings(true)} />;
      case "code": return <CodePanel projectId={project.id} snippets={project.snippets} onChange={(snippets) => mutate((p) => ({ ...p, snippets }))} />;
      case "canvas": return (
        <CanvasPanel
          key={project.id}
          canvas={project.canvas}
          onChange={(canvas, sceneChanged) => mutate((p) => p.id === project.id ? {
            ...p, canvas: sceneChanged || !p.canvas ? canvas : { ...p.canvas, appState: canvas.appState },
          } : p)}
          dark={dark}
          view={paneViews[i]?.canvasView ?? canvasTarget}
          viewNonce={canvasNonce}
          onView={(v) => { canvasViewRef.current = v; canvasViews.current[i] = v; }}
        />
      );
      case "terminal": return <TerminalPane key={`term-${i}-${project.id}`} dark={dark} projectId={project.id} />;
      case "jupyter": return <JupyterPane projectId={project.id} />;
      case "slides": return <SlidesPane value={project.slides} onChange={(slides) => mutate((p) => ({ ...p, slides }))} />;
      case "browser":
        return (
          <BrowserPane
            url={project.settings.browserUrl ?? ""}
            onChange={(browserUrl) => mutate((p) => ({ ...p, settings: { ...p.settings, browserUrl } }))}
          />
        );
      case "window": return <WindowPane />;
      case "embed": return <EmbedPane url={project.settings.embedUrl ?? ""} onChange={(embedUrl) => mutate((p) => ({ ...p, settings: { ...p.settings, embedUrl } }))} />;
    }
  }

  const gridStyle = { "--split": `${layout.split}%`, "--row-split": `${layout.rowSplit}%` } as React.CSSProperties;
  const hasCol = ["2", "1+2", "2+1"].includes(layout.preset) || layout.preset === "4";
  const hasRow = ["1+2", "2+1", "4"].includes(layout.preset);

  return (
    <div className={`app ${present ? "present" : ""} ${collapsed ? "collapsed" : ""}`}>
      <UpdateBanner onOpenSettings={() => setShowSettings(true)} />
      {!present && !collapsed && (
        <Sidebar
          projects={projects}
          project={project}
          activeSourceId={activeSourceId}
          onOpenProject={openProject}
          onNewProject={() => setShowNewProject(true)}
          onDeleteProject={deleteProject}
          deletingId={deletingId}
          onRenameProject={(title) => mutate((p) => ({ ...p, title }))}
          onOpenSource={(id) => { setActiveSourceId(id); setSelectedHl(null); }}
          onRemoveSource={(id) => {
            mutate((p) => { const sources = p.sources.filter((s) => s.id !== id); return { ...p, sources, links: pruneLinks(p.links ?? [], sources) }; });
            if (activeSourceId === id) setActiveSourceId(null);
          }}
          onSettings={() => setShowSettings(true)}
          onShowMap={() => setShowMap(true)}
          beatIndex={beatIndex}
          onCaptureBeat={captureBeat}
          onGoToBeat={goToBeat}
          onEditBeat={editBeat}
          onMoveBeat={moveBeat}
          onEditScript={setScriptFor}
          onRemoveBeat={removeBeat}
          onRecaptureBeat={recaptureBeat}
          onDuplicateBeat={copyBeat}
          undoLabel={beatUndo?.projectId === project?.id ? beatUndo?.label ?? null : null}
          onUndoBeat={undoBeatEdit}
          onRevealFolder={() => project?.dir && api.reveal(project.dir).catch((e) => setError(e.message))}
        />
      )}

      <div className="workspace">
        {!present && (
          <header className="topbar">
            <button className="icon-btn" onClick={() => setCollapsed((v) => !v)} title={`${collapsed ? "Show" : "Hide"} sidebar (Alt+B)`}>
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <form className="url-bar grow" onSubmit={(e) => { e.preventDefault(); addSource(url); }}>
              <Plus size={15} className="muted" />
              <input
                className="grow"
                placeholder="Paste an article or blog URL, with #section if you like, and press Enter"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
              />
              <button type="submit" className="primary small" disabled={loading || !url}>{loading ? "Fetching…" : "Add source"}</button>
            </form>
            <button className="ghost small" onClick={() => fileInput.current?.click()} title="Add a slide deck, notebook, PDF, image or text file">
              <Paperclip size={14} /> File
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
            />
            <div className="seg" title="Pane layout">
              {PRESETS.map(({ id, label, Icon }) => (
                <button key={id} className={layout.preset === id ? "active" : ""} onClick={() => setPreset(id)} title={label}><Icon size={15} /></button>
              ))}
            </div>
            <div className="toolbar-group">
              <button className="icon-btn" title="Smaller reader text" onClick={() => setFontScale((f) => Math.max(0.8, +(f - 0.1).toFixed(2)))}><Minus size={14} /></button>
              <span className="muted small" style={{ width: 28, textAlign: "center" }}>{Math.round(fontScale * 100)}</span>
              <button className="icon-btn" title="Larger reader text" onClick={() => setFontScale((f) => Math.min(1.8, +(f + 0.1).toFixed(2)))}><Plus size={14} /></button>
            </div>
            <span className={`save-pill ${saveState}`}>{saveState}</span>
            <button className="icon-btn" onClick={() => setDark((d) => !d)} title="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
            {desktop && (
              <button
                className={`ghost small ${presenterOpen ? "on" : ""}`}
                title={presenterOpen ? "Close the presenter window" : "Open a presenter window for your other monitor — it stays out of any screen capture"}
                onClick={() => (presenterOpen ? desktop?.closePresenter().then(() => setPresenterOpen(false)) : desktop?.openPresenter().then(setPresenterOpen))}
              ><MonitorPlay size={14} /> Presenter</button>
            )}
            <button className="ghost small" onClick={() => { if (beatIndex < 0 && beats.length) goToBeat(0); setPresent(true); }} title="Present mode (Alt+P)"><Presentation size={14} /> Present</button>
          </header>
        )}

        {error && <div className="error-bar" onClick={() => setError(null)}>{error}<X size={14} /></div>}
        {notice && !present && (
          <div className={`capture-notice ${notice.kind}`} role="status" onClick={() => setNotice(null)}>{notice.text}</div>
        )}

        <main
          ref={gridRef}
          className={`grid preset-${layout.preset.replace("+", "-")} ${dragging ? "dragging" : ""}`}
          style={gridStyle}
        >
          {layout.panes.map((pane, i) => (
            <section key={i} className={`pane pane-${i}`}>
              <div className="pane-head">
                <select
                  value={pane.kind}
                  onChange={(e) => setLayout((l) => ({ ...l, panes: l.panes.map((x, j) => (j === i ? { ...x, kind: e.target.value as PaneKind } : x)) }))}
                >
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </div>
              <div className="pane-body">{renderPane(pane, i)}</div>
            </section>
          ))}
          {hasCol && <div className="split-handle col" onPointerDown={(e) => startDrag("col", e)} title="Drag to resize" />}
          {hasRow && <div className="split-handle row" onPointerDown={(e) => startDrag("row", e)} title="Drag to resize" />}
          {dragging && <div className="drag-shield" />}
        </main>

        {present && showHud && beats.length > 0 && (
          <div className="beat-hud">
            <button className="icon-btn" title="Previous beat (←)" disabled={beatIndex <= 0} onClick={() => goToBeat(beatIndex - 1)}><ChevronLeft size={15} /></button>
            <span className="beat-hud-no">{beatIndex < 0 ? "—" : beatIndex + 1}/{beats.length}</span>
            <span className="beat-hud-point ellipsis">{beats[beatIndex]?.point || "no point written"}</span>
            <button className="icon-btn" title="Next beat (→ or Space)" disabled={beatIndex >= beats.length - 1} onClick={() => goToBeat(beatIndex + 1)}><ChevronRight size={15} /></button>
            <button className="icon-btn" title="Hide this strip (h) — it is inside the window, so a screen capture records it" onClick={() => { setShowHud(false); lsSet("hud", "0"); }}><EyeOff size={14} /></button>
          </div>
        )}

        {present && (
          <button className="exit-present" onClick={() => setPresent(false)} title="Exit present mode (Esc)">
            <Maximize2 size={13} /> Exit
          </button>
        )}
      </div>

      {dropping && (
        <div className="drop-overlay">
          <div className="drop-card"><Paperclip size={22} /> Drop files to add them as sources</div>
        </div>
      )}

      {scriptFor && beats.some((b) => b.id === scriptFor) && (
        <BeatScriptDialog
          beat={beats.find((b) => b.id === scriptFor)!}
          index={beats.findIndex((b) => b.id === scriptFor)}
          onChange={(script) => editBeat(scriptFor, (b) => ({ ...b, script }))}
          onClose={() => setScriptFor(null)}
        />
      )}

      {linkFrom && project && (
        <LinkDialog
          from={linkFrom}
          sources={project.sources}
          onSave={(to, relation, note) => { addLink(linkFrom, to, relation, note); setLinkFrom(null); }}
          onClose={() => setLinkFrom(null)}
        />
      )}

      {showMap && project && (
        <div className="modal-backdrop" onMouseDown={() => setShowMap(false)}>
          <div className="modal map-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Source map</h3>
              <span className="muted small grow">Click a source to open it · drag to move · scroll to zoom · put it in a pane with “Source map” to show it in a beat</span>
              <button className="icon-btn" onClick={() => setShowMap(false)}><X size={16} /></button>
            </div>
            <SourceMap
              sources={project.sources}
              links={project.links ?? []}
              activeSourceId={activeSourceId}
              onOpen={(id) => { setActiveSourceId(id); setSelectedHl(null); setShowMap(false); }}
              onGo={(end) => { goToEnd(end); setShowMap(false); }}
            />
          </div>
        </div>
      )}

      {showNewProject && (
        <NewProjectDialog onCreate={newProject} onClose={() => setShowNewProject(false)} />
      )}

      {showSettings && (
        <SettingsDialog
          project={project}
          onClose={() => setShowSettings(false)}
          onProjectMoved={(dir) => { setProject((p) => (p ? { ...p, dir } : p)); refreshList(); }}
          onOpenedFolder={(id) => { refreshList(); openProject(id); }}
        />
      )}
    </div>
  );
}
