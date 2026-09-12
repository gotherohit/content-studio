/**
 * The desktop bridge.
 *
 * Content Studio runs as an Electron app, and a few things are only possible there: a
 * pane that is a real Chromium view rather than an iframe, a native folder picker, and
 * updates. In a plain browser `desktop` is null and every caller falls back.
 */
export interface StudioBridge {
  isDesktop: true;
  info(): Promise<{ port: number; version: string; partition: string; dev: boolean }>;
  pickFolder(title?: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateReady(fn: (version: string) => void): void;
  onPanePopup(fn: (url: string) => void): void;
}

declare global {
  interface Window { studio?: StudioBridge }
}

export const desktop: StudioBridge | null = typeof window !== "undefined" ? window.studio ?? null : null;
export const isDesktop = Boolean(desktop);

/** The session partition every pane shares, so one sign-in serves them all. */
export const PANE_PARTITION = "persist:studio";
