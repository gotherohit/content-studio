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

export interface StudioBridge {
  isDesktop: true;
  info(): Promise<{ port: number; version: string; partition: string; dev: boolean }>;
  pickFolder(title?: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  installUpdate(): Promise<void>;
  updateState(): Promise<UpdateInfo>;
  checkForUpdates(): Promise<UpdateInfo>;
  /** @returns a function that stops listening. */
  onUpdateState(fn: (info: UpdateInfo) => void): () => void;
  onPanePopup(fn: (url: string) => void): void;
}

declare global {
  interface Window { studio?: StudioBridge }
}

export const desktop: StudioBridge | null = typeof window !== "undefined" ? window.studio ?? null : null;
export const isDesktop = Boolean(desktop);

/** The session partition every pane shares, so one sign-in serves them all. */
export const PANE_PARTITION = "persist:studio";
