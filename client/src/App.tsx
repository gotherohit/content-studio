import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Columns2, Columns3, EyeOff, Grid2x2, Maximize2, Minus, MonitorPlay, Moon, PanelLeftClose,
  PanelLeftOpen, Paperclip, Plus, Presentation, Square, SquareSplitHorizontal, SquareSplitVertical, Sun, X,
} from "lucide-react";
import { viewerForExt } from "./types";
import { desktop } from "./desktop";
import type { Beat, Highlight, Layout, LayoutPreset, PaneConfig, PaneKind, PaneView, Project, ProjectSummary, Source, Stage } from "./types";
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
import { NewProjectDialog } from "./components/NewProjectDialog";

const KINDS: { id: PaneKind; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "highlights", label: "Highlights" },
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
  /** Which beat was applied last, so Present mode knows where it is in the running order. */
  const [beatIndex, setBeatIndex] = useState(-1);
  /** The beat strip is inside the window, so anything capturing the window records it. */
  const [showHud, setShowHud] = useState(lsGet("hud", "1") === "1");
  const [presenterOpen, setPresenterOpen] = useState(false);
  const [scriptFor, setScriptFor] = useState<string | null>(null);
  /** Deleting can take a few seconds when Jupyter or a shell has to be shut down first. */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const presenterStateRef = useRef<() => void>(() => {});
  /** Read by the global key handler, which is registered before the beat helpers exist. */
  const goToBeatRef = useRef<(i: number) => void>(() => {});
  const [showSettings, setShowSettings] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [collapsed, setCollapsed] = useState(lsGet("collapsed", "0") === "1");
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
  const layout = project?.layout ?? DEFAULT_LAYOUT;
  const beats = project?.beats ?? [];
  // The presenter window's commands arrive outside React's render flow.
  const beatsRef = useRef(beats);
  const beatIndexRef = useRef(beatIndex);
  beatsRef.current = beats;
  beatIndexRef.current = beatIndex;

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
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.altKey && !typing) {
        if (e.key === "p") { setPresent((v) => !v); e.preventDefault(); }
        if (e.key === "b") { setCollapsed((v) => !v); e.preventDefault(); }
      }
      if (e.key === "Escape" && present && !document.fullscreenElement) setPresent(false);
      // While presenting, one key is the whole interface: the next beat.
      if (present && !typing && beats.length) {
        if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { goToBeatRef.current(Math.min(beats.length - 1, beatIndex + 1)); e.preventDefault(); }
        if (e.key === "ArrowLeft" || e.key === "PageUp") { goToBeatRef.current(Math.max(0, beatIndex - 1)); e.preventDefault(); }
        // Screen capture takes the whole window, so the strip has to be easy to banish.
        if (e.key === "h") { setShowHud((v) => { lsSet("hud", v ? "0" : "1"); return !v; }); e.preventDefault(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present, beats.length, beatIndex]);

  // ---- actions
  async function newProject(title: string, dir: string) {
    const p = normalize(await api.createProject(title, dir));
    await refreshList();
    setProject(p);
    setActiveSourceId(null);
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
    if (project?.id === id) { setProject(null); setActiveSourceId(null); setBeatIndex(-1); lsSet("lastProject", ""); }
    setSaveState("saved");
    refreshList();
  }

  const addSource = useCallback(async (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    if (!project) { setError("Create or open a project first."); return; }
    setLoading(true); setError(null);
    try {
      const a = await api.fetchArticle(target);
      const s: Source = {
        id: `src${Date.now().toString(36)}`,
        url: target, title: a.title || target, byline: a.byline, siteName: a.siteName, excerpt: a.excerpt,
        content: a.content, textContent: a.textContent, fetchedAt: a.fetchedAt, highlights: [], scripts: true,
      };
      mutate((p) => ({ ...p, sources: [...p.sources, s] }));
      setActiveSourceId(s.id);
      setUrl("");
    } catch (e) {
      setError((e as Error).message);
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
    if (target.kind === "file") return;
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

  const openLink = useCallback((link: string, newTab: boolean) => {
    if (newTab) { window.open(link, "_blank", "noreferrer"); return; }
    const existing = project?.sources.find((s) => s.url.split("#")[0] === link.split("#")[0]);
    if (existing) { setActiveSourceId(existing.id); return; }
    addSource(link);
  }, [project, addSource]);

  function copyHighlights() {
    if (!source) return;
    const md = [`## ${source.title}`, source.url, "", ...source.highlights.map((h) => `> ${h.text}\n${h.comment ? `\n${h.comment}\n` : ""}`)].join("\n");
    navigator.clipboard.writeText(md);
  }

  // ---- layout
  const setLayout = useCallback((fn: (l: Layout) => Layout) =>
    mutate((p) => ({ ...p, layout: fn({ ...DEFAULT_LAYOUT, ...(p.layout ?? {}) }) })), [mutate]);

  // ---- beats
  //
  // A beat is a step in the argument; its stage is the arrangement that serves it. The
  // stage is captured from whatever is on screen rather than filled in on a form, so
  // building one is: get it looking right, then save it.

  /** Everything about the current arrangement that can be put back later. */
  const captureStage = useCallback((): Stage => ({
    preset: layout.preset,
    panes: layout.panes.map((x) => ({ ...x })),
    views: { ...paneViews },
    split: layout.split,
    rowSplit: layout.rowSplit,
    activeSourceId,
    highlightId: selectedHl,
    viewMode: project?.settings.viewMode ?? "original",
    embedUrl: project?.settings.embedUrl,
    browserUrl: project?.settings.browserUrl,
  }), [layout, paneViews, activeSourceId, selectedHl, project?.settings]);

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

    setLayout(() => ({
      preset: stage.preset,
      // a pinned source that has been removed falls back to following the sidebar
      panes: stage.panes.map((x) => ({
        ...x,
        sourceId: x.sourceId && project?.sources.some((s) => s.id === x.sourceId) ? x.sourceId : null,
      })),
      split: stage.split,
      rowSplit: stage.rowSplit,
    }));
    setPaneViews(stage.views ?? {});
    setActiveSourceId(liveSource);

    const hl = liveSource && stage.highlightId
      ? project?.sources.find((s) => s.id === liveSource)?.highlights.some((h) => h.id === stage.highlightId)
      : false;
    if (stage.highlightId && !hl) missing.push("its highlight");
    setSelectedHl(hl ? stage.highlightId : null);
    if (hl) setScrollNonce((n) => n + 1);

    mutate((p) => ({
      ...p,
      settings: {
        ...p.settings,
        viewMode: stage.viewMode,
        embedUrl: stage.embedUrl ?? p.settings.embedUrl,
        browserUrl: stage.browserUrl ?? p.settings.browserUrl,
      },
    }));
    setError(missing.length ? `This beat could not restore ${missing.join(" or ")} — it may have been removed.` : null);
  }, [project, setLayout, mutate]);

  const goToBeat = useCallback((i: number) => {
    const list = project?.beats ?? [];
    if (i < 0 || i >= list.length) return;
    setBeatIndex(i);
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
    const offCmd = desktop.onPresenterCommand((cmd) => {
      if (cmd.type === "next") goToBeatRef.current(Math.min(beatsRef.current.length - 1, beatIndexRef.current + 1));
      if (cmd.type === "prev") goToBeatRef.current(Math.max(0, beatIndexRef.current - 1));
      if (cmd.type === "goto") goToBeatRef.current(cmd.index);
      if (cmd.type === "present") setPresent(cmd.on);
      // The window has just mounted and missed whatever was published before it existed.
      if (cmd.type === "sync") presenterStateRef.current();
    });
    return () => { offClosed(); offCmd(); };
  }, []);

  const publishPresenter = useCallback(() => {
    desktop?.publishPresenterState({
      projectTitle: project?.title ?? "",
      beats: beats.map((b) => ({ point: b.point, script: b.script ?? "" })),
      index: beatIndex,
      presenting: present,
    });
  }, [project?.title, beats, beatIndex, present]);
  presenterStateRef.current = publishPresenter;

  useEffect(() => { if (presenterOpen) publishPresenter(); }, [presenterOpen, publishPresenter]);

  function captureBeat() {
    const beat: Beat = {
      id: Math.random().toString(36).slice(2, 10),
      point: "",
      stage: captureStage(),
      createdAt: new Date().toISOString(),
    };
    mutate((p) => ({ ...p, beats: [...(p.beats ?? []), beat] }));
    setBeatIndex((project?.beats ?? []).length);
  }

  const editBeat = (id: string, fn: (b: Beat) => Beat) =>
    mutate((p) => ({ ...p, beats: (p.beats ?? []).map((b) => (b.id === id ? fn(b) : b)) }));

  function moveBeat(from: number, to: number) {
    mutate((p) => {
      const list = [...(p.beats ?? [])];
      if (to < 0 || to >= list.length) return p;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return { ...p, beats: list };
    });
    setBeatIndex(to);
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
    if (!project) return <div className="empty-state"><h2>No project open</h2><p>Create or open a project on the left.</p></div>;
    switch (pane.kind) {
      case "source": {
        // A pinned pane keeps its own source; an unpinned one follows the sidebar.
        const paneSource = (pane.sourceId ? project.sources.find((s) => s.id === pane.sourceId) : source) ?? null;
        return (
          <SourcePane
            source={paneSource}
            sources={project.sources}
            pinnedId={pane.sourceId ?? null}
            onPin={(sourceId) => setLayout((l) => ({ ...l, panes: l.panes.map((x, j) => (j === i ? { ...x, sourceId } : x)) }))}
            projectId={project.id}
            apiPort={config?.apiPort ?? 4700}
            mode={project.settings.viewMode ?? "original"}
            onMode={(viewMode) => mutate((p) => ({ ...p, settings: { ...p.settings, viewMode } }))}
            onToggleScripts={() => paneSource && updateSource(paneSource.id, (s) => ({ ...s, scripts: s.scripts === false }))}
            onAddHighlight={(h) => paneSource && addHighlight(paneSource.id, h)}
            onSelectHighlight={(id) => paneSource && selectFromPage(paneSource.id, id)}
            onOpenLink={openLink}
            onRefresh={() => paneSource && refreshSource(paneSource)}
            scrollToId={paneSource && paneSource.id === activeSourceId ? selectedHl : null}
            scrollNonce={scrollNonce}
            view={paneViews[i] ?? {}}
            onView={(v) => setPaneViews((m) => ({ ...m, [i]: v }))}
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
            selectedId={selectedHl}
            onSelect={selectFromCard}
            onUpdate={(h) => source && updateSource(source.id, (s) => ({ ...s, highlights: s.highlights.map((x) => (x.id === h.id ? h : x)) }))}
            onDelete={(id) => source && updateSource(source.id, (s) => ({ ...s, highlights: s.highlights.filter((x) => x.id !== id) }))}
            onCopyAll={copyHighlights}
          />
        );
      case "notes": return <NotesPanel value={project.notes} onChange={(notes) => mutate((p) => ({ ...p, notes }))} />;
      case "ai": return <AiPanel chat={project.chat} onChange={(chat) => mutate((p) => ({ ...p, chat }))} source={source} allSources={project.sources} onOpenSettings={() => setShowSettings(true)} />;
      case "code": return <CodePanel projectId={project.id} snippets={project.snippets} onChange={(snippets) => mutate((p) => ({ ...p, snippets }))} />;
      case "canvas": return <CanvasPanel key={project.id} canvas={project.canvas} onChange={(canvas) => mutate((p) => ({ ...p, canvas }))} dark={dark} />;
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
          onRemoveSource={(id) => { mutate((p) => ({ ...p, sources: p.sources.filter((s) => s.id !== id) })); if (activeSourceId === id) setActiveSourceId(null); }}
          onSettings={() => setShowSettings(true)}
          beatIndex={beatIndex}
          onCaptureBeat={captureBeat}
          onGoToBeat={goToBeat}
          onEditBeat={editBeat}
          onMoveBeat={moveBeat}
          onEditScript={setScriptFor}
          onRemoveBeat={(id) => { mutate((p) => ({ ...p, beats: (p.beats ?? []).filter((b) => b.id !== id) })); setBeatIndex(-1); }}
          captureStage={captureStage}
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
            <button className="ghost small" onClick={() => setPresent(true)} title="Present mode (Alt+P)"><Presentation size={14} /> Present</button>
          </header>
        )}

        {error && <div className="error-bar" onClick={() => setError(null)}>{error}<X size={14} /></div>}

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
