import type { ExportShape, TransitionKind, VerticalFrame } from "./types";

/**
 * The desktop bridge.
 *
 * Content Studio runs as an Electron app, and a few things are only possible there: a
 * pane that is a real Chromium view rather than an iframe, a native folder picker, and
 * updates. In a plain browser `desktop` is null and every caller falls back.
 */
/**
 * Where a new version has got to.
 *
 * `current` means a check finished and found nothing newer, which is worth distinguishing
 * from `idle` — nothing asked yet. `unsupported` is a copy running from source.
 */
export type UpdateState = "idle" | "checking" | "downloading" | "ready" | "current" | "error" | "unsupported";

export interface UpdateInfo {
  state: UpdateState;
  version: string | null;
  percent: number;
  message: string | null;
}

/** What the presenter window is told. It holds no project state of its own. */
export interface PresenterState {
  projectId: string;
  projectTitle: string;
  beats: { id: string; point: string; script: string }[];
  index: number;
  presenting: boolean;
}

export type PresenterCommand =
  /** Sent when the presenter window mounts: it has missed anything published before then. */
  | { type: "sync" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "goto"; index: number }
  | { type: "present"; on: boolean };

/** A video on screen in a captured beat, in layout pixels of the export's viewport. */
export interface ExportVideo {
  name: string;
  start: number;
  rect: { x: number; y: number; w: number; h: number };
}

export interface ExportPlanBeat {
  seconds: number;
  transition: TransitionKind;
  frame?: VerticalFrame;
  videos: ExportVideo[];
  /** Narration: its cleaned file in the recordings folder, and how far into the beat it starts. */
  voice?: { name: string; delay: number };
  /** A take, played instead of the still: its picture, its cleaned sound, and the lead-in to skip. */
  take?: { name: string; clean?: string; muted: boolean; lead: number };
}

export interface ExportPlan {
  projectDir: string;
  title: string;
  shape: ExportShape;
  quality: number;
  fps: number;
  transitionSeconds: number;
  folder: string;
  name: string;
  beats: ExportPlanBeat[];
}

export interface StudioBridge {
  isDesktop: true;
  captureSources(): Promise<{ id: string; name: string; thumbnail: string }[]>;
  chooseCapture(id: string): Promise<void>;
  startHandoff(hwnd: number): Promise<{ active: boolean; shortcut: boolean; hidden: boolean }>;
  returnToStudio(): Promise<void>;
  handoffState(): Promise<{ active: boolean; shortcut: boolean; hidden: boolean }>;
  onHandoffState(fn: (state: { active: boolean; shortcut: boolean; hidden: boolean }) => void): () => void;
  info(): Promise<{ port: number; version: string; partition: string; dev: boolean }>;
  pickFolder(title?: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  renderExplanationPdf(markdown: string): Promise<string>;
  /** Lay the window out at `css` size exactly, for framing a vertical export; `null` puts it back. */
  exportView(css: { width: number; height: number } | null): Promise<void>;
  /** The next screen-capture request records this window's own page. */
  recordSelf(): Promise<void>;
  /** Lay out and draw the window for a take, shrunk to fit on screen; `null` puts it back. */
  recordView(options: { css: { width: number; height: number }; zoom: number } | null): Promise<{ zoom: number } | void>;
  exportBegin(options: { css: { width: number; height: number }; zoom: number }): Promise<{ zoom: number }>;
  exportFrame(index: number): Promise<{ width: number; height: number }>;
  exportEnd(): Promise<void>;
  exportProbe(projectDir: string, names: string[]): Promise<Record<string, { duration: number | null; audio: boolean }>>;
  exportVideo(plan: ExportPlan): Promise<{ file: string; seconds: number } | { cancelled: true }>;
  exportPdf(plan: ExportPlan): Promise<{ file: string; pages: number }>;
  exportCancel(): Promise<void>;
  exportReveal(file: string): Promise<void>;
  onExportProgress(fn: (p: { phase: "encode" | "pdf" | "idle"; fraction: number | null }) => void): () => void;
  installUpdate(): Promise<void>;
  updateState(): Promise<UpdateInfo>;
  checkForUpdates(): Promise<UpdateInfo>;
  /** @returns a function that stops listening. */
  onUpdateState(fn: (info: UpdateInfo) => void): () => void;
  onPanePopup(fn: (url: string) => void): void;

  openPresenter(): Promise<boolean>;
  closePresenter(): Promise<boolean>;
  presenterOpen(): Promise<boolean>;
  publishPresenterState(state: PresenterState): void;
  onPresenterState(fn: (state: PresenterState) => void): () => void;
  sendPresenterCommand(cmd: PresenterCommand): void;
  onPresenterCommand(fn: (cmd: PresenterCommand) => void): () => void;
  onPresenterClosed(fn: () => void): () => void;
  onPresenterFailed(fn: (reason: string) => void): () => void;
}

/** True in the second window, which renders the presenter view instead of the studio. */
export const isPresenterWindow =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("presenter");

declare global {
  interface Window { studio?: StudioBridge }
}

export const desktop: StudioBridge | null = typeof window !== "undefined" ? window.studio ?? null : null;
export const isDesktop = Boolean(desktop);

/** The session partition every pane shares, so one sign-in serves them all. */
export const PANE_PARTITION = "persist:studio";
