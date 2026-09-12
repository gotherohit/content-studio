// Content Studio, as a desktop app.
//
// The web build fought the browser at every turn: Colab, Drive and OneDrive refuse to be
// framed, local harnesses lose their cookies across origins, and a page cannot open a
// folder picker. Electron removes the fight rather than working around it. The Express
// server is unchanged and still runs on loopback; this process starts it, waits for it,
// and shows it in a window whose panes may host real Chromium views.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from "electron";
import { fork } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const DEV = !app.isPackaged && process.env.CS_DEV === "1";
/** The pane's browsing session: one persistent profile, so a sign-in survives a restart. */
const PARTITION = "persist:studio";

let win = null;
let server = null;
let port = 0;

/** The first free port at or after `from`, so a stale instance cannot wedge a new one. */
async function freePort(from) {
  for (let p = from; p < from + 40; p++) {
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (ok) return p;
  }
  throw new Error("No free port for the Content Studio server");
}

async function startServer() {
  port = await freePort(4700);
  server = fork(path.join(ROOT, "server", "index.js"), [], {
    cwd: ROOT,
    // Electron's own Node runs the server, so native modules match one ABI, not two.
    env: { ...process.env, API_PORT: String(port), ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  serveVault(server);
  server.stdout?.on("data", (b) => process.stdout.write(`[server] ${b}`));
  server.stderr?.on("data", (b) => process.stderr.write(`[server] ${b}`));
  server.on("exit", (code) => {
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("Content Studio", `The studio server stopped unexpectedly (code ${code}).`);
      app.quit();
    }
  });

  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/config`);
      if (r.ok) return;
    } catch { /* still coming up */ }
  }
  throw new Error("The studio server did not start in time");
}

/**
 * The server keeps API keys on disk and asks this process to encrypt them, because
 * safeStorage — DPAPI on Windows — is only reachable here. The ciphertext is tied to the
 * logged-in account, so another account on the same machine cannot read the keys even
 * with the file in hand. Plaintext crosses this channel and nothing else: never a
 * filesystem path, never a command.
 */
function serveVault(child) {
  child.on("message", (msg) => {
    if (msg?.type !== "vault") return;
    const reply = (out) => { try { child.send({ type: "vault:result", id: msg.id, ...out }); } catch { /* server gone */ } };
    try {
      if (msg.op === "available") return reply({ value: safeStorage.isEncryptionAvailable() });
      if (!safeStorage.isEncryptionAvailable()) return reply({ error: "encryption is not available" });
      if (msg.op === "encrypt") return reply({ value: safeStorage.encryptString(String(msg.value)).toString("base64") });
      if (msg.op === "decrypt") return reply({ value: safeStorage.decryptString(Buffer.from(String(msg.value), "base64")) });
      reply({ error: `unknown vault operation: ${msg.op}` });
    } catch (e) {
      reply({ error: e.message });
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0b0d12",
    show: false,
    autoHideMenuBar: true,
    title: "Content Studio",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // The panes that host Colab, a notebook or a local harness are real Chromium views.
      webviewTag: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  // A link meant for a new window belongs in the user's own browser, not a bare popup.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(DEV ? `http://127.0.0.1:5173/` : `http://127.0.0.1:${port}/`);
  if (DEV) win.webContents.openDevTools({ mode: "detach" });
}

/**
 * Panes are `<webview>` elements. They get the persistent profile, their popups go to the
 * pane rather than nowhere, and they may use the camera and microphone the user allows.
 */
function configureWebviews() {
  app.on("web-contents-created", (_e, contents) => {
    if (contents.getType() !== "webview") return;
    contents.setWindowOpenHandler(({ url }) => {
      win?.webContents.send("pane:popup", url);
      return { action: "deny" };
    });
  });

  const pane = session.fromPartition(PARTITION);
  pane.setPermissionRequestHandler((_wc, permission, done) => {
    done(["media", "clipboard-read", "clipboard-sanitized-write", "fullscreen", "notifications"].includes(permission));
  });
}

function wireUpdates() {
  if (DEV) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-downloaded", (info) => win?.webContents.send("update:ready", info?.version ?? ""));
  autoUpdater.on("error", (e) => console.error("update check failed:", e?.message));
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

ipcMain.handle("studio:info", () => ({ port, version: app.getVersion(), partition: PARTITION, dev: DEV }));
ipcMain.handle("studio:pickFolder", async (_e, title) => {
  const r = await dialog.showOpenDialog(win, {
    title: title || "Choose a folder for this project",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("studio:installUpdate", () => { app.isQuitting = true; autoUpdater.quitAndInstall(); });
ipcMain.handle("studio:openExternal", (_e, url) => shell.openExternal(url));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    configureWebviews();
    try {
      await startServer();
    } catch (e) {
      dialog.showErrorBox("Content Studio", e.message);
      return app.quit();
    }
    createWindow();
    wireUpdates();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on("before-quit", () => { app.isQuitting = true; try { server?.kill(); } catch { /* gone */ } });
  app.on("window-all-closed", () => app.quit());
}
