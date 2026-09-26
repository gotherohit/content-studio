import type { SourceLink } from "./links";
/**
 * The first four are the passage colours a text highlight is offered. The rest are for
 * drawings — red for a mistake, black or white to read on a busy screenshot — and a drawing's
 * card, marker and map dot carry its colour like any other.
 */
export type HighlightColor = "yellow" | "green" | "pink" | "blue" | "red" | "orange" | "purple" | "black" | "white";
/** The colours a text highlight is offered: soft enough to read the words through. */
export const TEXT_COLORS: HighlightColor[] = ["yellow", "green", "pink", "blue"];

export interface Highlight {
  id: string;
  text: string;      // exact quote
  prefix: string;    // ~30 chars before, for anchoring
  suffix: string;    // ~30 chars after
  color: HighlightColor;
  comment: string;
  /** Preferred comment-card width; height follows the text and the current pane bounds. */
  noteWidth?: number;
  createdAt: string;
  /** For code: the first and last line, 1-based. `text` holds those lines, to find them again after edits. */
  lines?: [number, number];
  /** For a PDF: the page it is on, 1-based. Its quote is anchored inside that page's own text. */
  page?: number;
  /** A drawn shape instead of a marked quote. Everything else about it is the same. */
  shape?: Shape;
  /** What the shape is drawn on when it is not a page: an image, by its source. */
  onImage?: string;
  /** Prose blocks covered by a drawing, whose union follows responsive column changes. */
  blocks?: { text: string; prefix: string; suffix: string }[];
}

export type ShapeKind =
  | "marker" | "rect" | "oval" | "triangle" | "diamond" | "star" | "callout"
  | "line" | "arrow" | "darrow";

/** A palette colour, the drawing's own colour, or nothing at all. */
export type ShapePaint = HighlightColor | "match" | "none";
export type ShapeDash = "solid" | "dashed" | "dotted";

/** How a drawing is painted. Each field is optional: a drawing without it keeps its kind's default. */
export interface ShapeStyle {
  fill?: ShapePaint;
  /** 0 to 1. */
  fillOpacity?: number;
  stroke?: ShapePaint;
  /** Stroke width in pixels. */
  width?: number;
  dash?: ShapeDash;
}

/**
 * A drawn annotation, in fractions of whatever it was drawn on: a PDF page, an image, or the
 * paragraph its highlight is anchored to. A line runs from (x, y) by (w, h), so its width and
 * height may be negative; a box never is. The style travels with the geometry, so a beat that
 * shows the drawing shows it painted the same way.
 */
export interface Shape extends ShapeStyle {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SourceKind = "web" | "file" | "code";
export type FileViewer = "markdown" | "notebook" | "pdf" | "deck" | "image" | "video" | "audio" | "html" | "table" | "office" | "text";

export interface SourceFile {
  name: string;
  ext: string;
  size: number;
  viewer: FileViewer;
}

/** A slide deck rendered to images (PowerPoint) or to a PDF (LibreOffice). */
export interface DeckRender {
  slides: string[];
  pdf?: string;
  renderer: "powerpoint" | "libreoffice" | "cache" | "none";
  error?: string;
}

export interface Source {
  id: string;
  /** Defaults to "web". A "file" source lives in the project's files/ folder. */
  kind?: SourceKind;
  file?: SourceFile;
  url: string;
  title: string;
  byline?: string | null;
  siteName?: string | null;
  excerpt?: string | null;
  content: string;      // sanitized readable HTML
  textContent: string;
  fetchedAt: string;
  highlights: Highlight[];
  /** Run the page's own JavaScript in Original view. Defaults to true. */
  scripts?: boolean;
  /** A code source: a file in a folder shown by the Files pane, never copied into the project. */
  code?: { root: string; path: string };
  /** The source whose link, or whose browsed page, this one was created from. */
  from?: string;
  /** The creator's own Markdown summary of what this source says. Never shown in Present mode. */
  summary?: string;
}

export interface Snippet {
  id: string;
  title: string;
  lang: "python" | "node" | "bash" | "powershell";
  code: string;
  lastOutput?: { stdout: string; stderr: string; code: number; ms: number };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type PaneKind = "source" | "highlights" | "map" | "files" | "notes" | "ai" | "code" | "canvas" | "terminal" | "jupyter" | "slides" | "window" | "browser" | "embed";
export type LayoutPreset = "1" | "2" | "3" | "4" | "1+2" | "2+1";
/** One pane. A Source pane may pin its own source; otherwise it follows the sidebar selection. */
export interface PaneConfig {
  kind: PaneKind;
  sourceId?: string | null;
  mode?: "original" | "reader";
}

export interface Layout {
  preset: LayoutPreset;
  panes: PaneConfig[];
  split: number;    // % width of the first column
  rowSplit: number; // % height of the top row (1+2, 2+1, 4)
}

/** Where the canvas is looking: one drawing can serve many beats if each frames its own part. */
export interface CanvasView {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/** What a Source pane is doing beyond which source it shows: paging a deck, say. */
export interface PaneView {
  canvasView?: CanvasView;
  sourceId?: string;
  mode?: "original" | "reader";
  position?: ReadingPosition;
  /**
   * Another page of the same site, browsed to inside the pane without becoming a source.
   * Undefined means the source's own page. Highlights only ever apply to the source's page.
   */
  page?: string;
  /** A Files pane, or a code source: which file, the top visible line, and the lines picked out. */
  code?: CodeView;
  slideshow?: boolean;
  slideIndex?: number;
  /** A Jupyter pane: the folder its notebooks were open in when this was captured. */
  jupyterRoot?: string;
}

export interface CodeView {
  root: string;
  path: string;
  /** The first line in view, 1-based. */
  line: number;
  sel?: [number, number];
  /** Dim every line outside `sel`, for pointing at code on camera. */
  focus?: boolean;
}

/** A content anchor plus its position within the viewport, rather than just pixels. */
export interface ReadingPosition {
  x: number;
  y: number;
  anchor?: number;
  text?: string;
  /** Which copy of `text` the anchor was, since pages repeat headings in their contents lists. */
  occurrence?: number;
  offset?: number;
  /** A passage visible when captured, for saying what was captured. Never used to restore. */
  seen?: string;
}

/**
 * A saved arrangement of the workspace.
 *
 * A stage stores references, never copies: the source it names, the highlight it scrolls
 * to and the notes it shows are the live ones, so improving your material improves every
 * stage that points at it. Only the arrangement is frozen.
 */
export interface Stage {
  preset: LayoutPreset;
  panes: PaneConfig[];
  views: Record<number, PaneView>;
  split: number;
  rowSplit: number;
  activeSourceId: string | null;
  /** Scrolled into view and flashed when the stage is applied. */
  highlightId: string | null;
  viewMode: "original" | "reader";
  embedUrl?: string;
  browserUrl?: string;
  /** The part of the canvas this beat is about. There is one canvas per project. */
  canvasView?: CanvasView;
}

/**
 * One step in the argument, and the stage that serves it.
 *
 * Beats are what turns a project from a pile of research into a runnable show: in Present
 * mode one key moves to the next, so while recording the only job left is talking.
 */
export interface Beat {
  id: string;
  /** One line: the point this segment makes. Shown to the presenter, never to the camera. */
  point: string;
  /**
   * What to say: Markdown, rendered in the presenter window on the other monitor. Never
   * drawn inside the studio window, so it cannot end up in a screen recording.
   */
  script?: string;
  /** What `script` was called before. Read once on load, then dropped. */
  note?: string;
  stage: Stage;
  createdAt: string;
}

export interface Project {
  id: string;
  /** Absolute folder holding this project's sources, notes and scratch files. */
  dir?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sources: Source[];
  notes: string;
  canvas: { elements: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> } | null;
  snippets: Snippet[];
  chat: ChatMessage[];
  slides: string;
  layout: Layout;
  beats: Beat[];
  /** Links between sources, usually from a highlighted passage. Backlinks are derived from these. */
  links?: SourceLink[];
  settings: {
    jupyterUrl: string; viewMode?: "original" | "reader"; embedUrl?: string; browserUrl?: string;
    /** The Files pane's folder; the project's own folder when unset. */
    filesRoot?: string;
    /** Opened read-only: nothing in the Files pane can be saved. */
    filesReadOnly?: boolean;
    /** The folder JupyterLab is rooted at; the project's own folder when unset. */
    jupyterRoot?: string;
    /** How each kind of drawing is painted when it is drawn next, as last set in the drawing menu. */
    drawStyles?: Partial<Record<ShapeKind, ShapeStyle>>;
  };
}

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
  sourceCount: number;
  dir: string;
}

/**
 * Which viewer a file uses, derived from its extension. Always computed rather than
 * trusted from a saved project, so sources added by older versions still render.
 */
export function viewerForExt(ext: string): FileViewer {
  const e = ext.toLowerCase();
  if ([".md", ".markdown"].includes(e)) return "markdown";
  if (e === ".ipynb") return "notebook";
  if (e === ".pdf") return "pdf";
  if ([".pptx", ".ppt", ".odp"].includes(e)) return "deck";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"].includes(e)) return "image";
  if ([".mp4", ".webm"].includes(e)) return "video";
  if ([".mp3", ".wav"].includes(e)) return "audio";
  if ([".html", ".htm"].includes(e)) return "html";
  if ([".csv", ".tsv"].includes(e)) return "table";
  if ([".docx", ".xlsx"].includes(e)) return "office";
  return "text";
}
