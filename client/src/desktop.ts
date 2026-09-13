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
