import type { CleanTuning } from "../../server/public/cleaning.js";
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
  /** Server-owned Vajra conversations attached to this passage, in creation order. */
  vajraSessions?: string[];
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
  /** A video source: the second it was paused at, where a beat starts it and an export plays it from. */
  videoTime?: number;
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
  /** How this beat is exported. Every field is optional: the project's export settings fill the rest. */
  export?: BeatExport;
  /** Narration recorded over this beat. An export plays it, and the beat lasts as long as it. */
  voice?: BeatVoice;
  /** The beat recorded on screen, played in an export instead of its still picture. */
  take?: BeatTake;
}

/** How much steady background noise is taken out of a recording. */
/** A preset, or `custom`: the project's own tuning (`settings.cleaning`). */
export type NoiseReduction = "off" | "light" | "strong" | "custom";
export type { CleanTuning } from "../../server/public/cleaning.js";

/**
 * A recording kept in the project's recordings folder. `file` is the original, kept so it can
 * be cleaned again; `clean` is its sound as used. `lead` is the silent second recorded first,
 * which the cleaning learns the room from and which is not played.
 */
export interface BeatRecording {
  file: string;
  clean?: string;
  seconds: number;
  noise: NoiseReduction;
  /** The tuning a `custom` recording was cleaned with, to tell when the settings have moved on. */
  tuning?: CleanTuning;
  lead: number;
  /** Loudness of the voice before it was brought to the target, in LUFS. */
  loudness?: number;
  recordedAt: string;
}

export type BeatVoice = BeatRecording & { clean: string };

export interface BeatTake extends BeatRecording {
  /** The picture, remuxed so it has a length. */
  video: string;
  width: number;
  height: number;
  /** Recorded or played without its sound; the beat's narration, if any, plays under it. */
  muted: boolean;
}

/**
 * The ways one beat can give way to the next in an exported video. The names are ffmpeg's
 * `xfade` transitions, except `cut`, which is no transition at all.
 */
export type TransitionKind =
  | "cut" | "fade" | "fadeblack" | "dissolve" | "slideleft" | "slideup" | "wipeleft"
  | "smoothleft" | "circleopen" | "zoomin" | "pixelize";

/** The part of the 16:9 screen a vertical export shows, in fractions of it. Its width follows from 9:16. */
export interface VerticalFrame {
  x: number;
  y: number;
  h: number;
}

export interface BeatExport {
  /** How long the beat is on screen, in seconds. A beat showing a video defaults to the rest of the video. */
  seconds?: number;
  /** How this beat takes over from the one before it. */
  transition?: TransitionKind;
  /** The part of the screen this beat shows in a vertical export. */
  frame?: VerticalFrame;
}

export type ExportShape = "landscape" | "vertical";

/** The last export's choices, kept with the project so the next one starts from them. */
export type TakeFraming = "fit" | "fill";

export interface ExportSettings {
  format: "video" | "pdf";
  shape: ExportShape;
  /** Output height of a landscape export, or width of a vertical one: 1080, 1440 or 2160. */
  quality: 1080 | 1440 | 2160;
  fps: 30 | 60;
  /** How long a beat without a video is held. */
  seconds: number;
  transition: TransitionKind;
  transitionSeconds: number;
  /** How long each beat is given to load and settle before it is captured. */
  settle: number;
  /** The folder the file is written to; the project's exports folder when empty. */
  folder: string;
  /**
   * How a take — the whole window, whatever its shape — becomes 16:9: `fit` keeps all of it
   * with bars where the shapes differ, as a screen recorder does; `fill` has no bars and trims
   * a thin slice at two edges. Used by exports and by a take saved as MP4.
   */
  takeFraming: TakeFraming;
  name: string;
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
    /** The choices made in the last export of the beats. */
    export?: Partial<ExportSettings>;
    /** How much background noise recordings for this project's beats have taken out. */
    noise?: NoiseReduction;
    /** The custom cleaning settings, used when `noise` is `custom`. */
    cleaning?: CleanTuning;
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
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(e)) return "video";
  if ([".mp3", ".wav"].includes(e)) return "audio";
  if ([".html", ".htm"].includes(e)) return "html";
  if ([".csv", ".tsv"].includes(e)) return "table";
  if ([".docx", ".xlsx"].includes(e)) return "office";
  return "text";
}
