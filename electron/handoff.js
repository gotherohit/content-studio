import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";

const SHORTCUT = "CommandOrControl+Shift+F12";

/** A handoff owns no project state and never injects pointer or keyboard events. */
export function wireHandoff(studio, here, request) {
  let toolbar = null;
  let active = false;
  let busy = false;
  let shortcut = false;
  let generation = 0;
  const state = () => ({ active, shortcut, hidden: Boolean(active && toolbar && !toolbar.isVisible()) });
  const publish = () => {
    if (!studio.isDestroyed()) studio.webContents.send("handoff:state", state());
  };
  function finish(focus = false) {
    generation++;
    active = false;
    if (shortcut) globalShortcut.unregister(SHORTCUT);
    shortcut = false;
    const old = toolbar;
    toolbar = null;
    old?.destroy();
    publish();
    if (focus && !studio.isDestroyed()) {
      if (studio.isMinimized()) studio.restore();
      studio.show();
      studio.focus();
    }
  }
  function allowed(event) {
    return event.sender === studio.webContents || event.sender === toolbar?.webContents;
  }
  ipcMain.handle("handoff:state", (event) => {
    if (!allowed(event)) throw new Error("Unavailable outside Studio");
    return state();
  });
  ipcMain.handle("handoff:return", (event) => {
    if (!allowed(event)) throw new Error("Unavailable outside Studio");
    finish(true);
  });
  ipcMain.handle("handoff:hide", (event) => {
    if (!allowed(event)) throw new Error("Unavailable outside Studio");
    if (!shortcut) throw new Error("The return shortcut is unavailable. Keep the toolbar visible.");
    toolbar?.hide();
    publish();
  });
  ipcMain.handle("handoff:start", async (event, hwnd) => {
    if (event.sender !== studio.webContents) throw new Error("Unavailable outside Studio");
    if (busy || active) throw new Error("Return to Studio before starting another interaction.");
    if (!Number.isSafeInteger(hwnd) || hwnd <= 0) throw new Error("Choose an application window first.");
    busy = true;
    const token = ++generation;
    try {
      const targets = await request("/api/input/targets");
      const target = targets.windows?.find((w) => Number(w.id) === hwnd);
      const own = BrowserWindow.getAllWindows().some((w) => {
        const handle = w.getNativeWindowHandle();
        return Number(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()) === hwnd;
      });
      if (!targets.available || !target || own) throw new Error("That app is no longer available. Rescan and choose another window.");
      if (token !== generation) throw new Error("Interaction cancelled.");
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      const bar = new BrowserWindow({
        width: 440, height: 92, x: Math.round(area.x + (area.width - 440) / 2), y: area.y + 12,
        frame: false, resizable: false, minimizable: false, maximizable: false,
        alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, backgroundColor: "#151923",
        webPreferences: { preload: path.join(here, "handoff-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      toolbar = bar;
      bar.setAlwaysOnTop(true, "screen-saver");
      bar.on("closed", () => { if (toolbar === bar) finish(true); });
      shortcut = globalShortcut.register(SHORTCUT, () => finish(true));
      await bar.loadFile(path.join(here, "handoff.html"), { query: { shortcut: String(shortcut) } });
      if (token !== generation) throw new Error("Interaction cancelled.");
      // Creating/showing another Studio window can enqueue an activation event on
      // Windows. Show the toolbar before the final native focus transfer.
      bar.showInactive();
      const handle = studio.getNativeWindowHandle();
      const fromHwnd = Number(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE());
      await request("/api/input", { type: "focus", hwnd, fromHwnd });
      if (token !== generation) throw new Error("Interaction cancelled.");
      active = true;
      publish();
      return state();
    } catch (error) {
      finish();
      throw error;
    } finally { busy = false; }
  });
  // Alt-Tab back is also a return; nothing should remain floating over the next take.
  studio.on("focus", () => { if (active) finish(); });
  studio.on("closed", () => finish());
  studio.webContents.on("render-process-gone", () => finish());
  studio.webContents.on("did-start-navigation", (_e, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) finish();
  });
  return () => finish();
}
