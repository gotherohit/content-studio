export type HighlightColor = "yellow" | "green" | "pink" | "blue";

export interface Highlight {
  id: string;
  text: string;      // exact quote
  prefix: string;    // ~30 chars before, for anchoring
  suffix: string;    // ~30 chars after
  color: HighlightColor;
  comment: string;
  createdAt: string;
}

export type SourceKind = "web" | "file";
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

export type PaneKind = "source" | "highlights" | "notes" | "ai" | "code" | "canvas" | "terminal" | "jupyter" | "slides" | "window" | "browser" | "embed";
export type LayoutPreset = "1" | "2" | "3" | "4" | "1+2" | "2+1";
/** One pane. A Source pane may pin its own source; otherwise it follows the sidebar selection. */
export interface PaneConfig {
  kind: PaneKind;
  sourceId?: string | null;
}

export interface Layout {
  preset: LayoutPreset;
  panes: PaneConfig[];
  split: number;    // % width of the first column
  rowSplit: number; // % height of the top row (1+2, 2+1, 4)
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
  settings: { jupyterUrl: string; viewMode?: "original" | "reader"; embedUrl?: string; browserUrl?: string };
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
