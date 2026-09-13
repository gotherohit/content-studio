// Content Studio, as a desktop app.
//
// The web build fought the browser at every turn: Colab, Drive and OneDrive refuse to be
// framed, local harnesses lose their cookies across origins, and a page cannot open a
// folder picker. Electron removes the fight rather than working around it. The Express
// server is unchanged and still runs on loopback; this process starts it, waits for it,
// and shows it in a window whose panes may host real Chromium views.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, session, shell } from "electron";
import { fork, spawnSync } from "node:child_process";
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
let presenter = null;
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
 * The presenter's own window.
 *
 * The studio window is what screen-capture software records, so nothing meant only for
 * the creator can live inside it. This is a second, small, always-on-top window for the
 * other monitor: which beat is running, the point it makes, what comes next, and the
 * clock. It holds no project state of its own — the studio window is the source of truth
 * and this relays commands back to it.
 */
function openPresenter() {
  if (presenter && !presenter.isDestroyed()) {
    presenter.show();
    presenter.focus();
    return true;
  }
  presenter = new BrowserWindow({
    width: 560,
    height: 320,
    minWidth: 360,
    minHeight: 200,
    title: "Content Studio — presenter",
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: "#0b0d12",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // above full-screen apps too, or it would vanish the moment the studio goes full screen
  presenter.setAlwaysOnTop(true, "screen-saver");
  presenter.on("closed", () => {
    presenter = null;
    win?.webContents.send("presenter:closed");
  });
  presenter.loadURL(DEV ? "http://127.0.0.1:5173/?presenter=1" : `http://127.0.0.1:${port}/?presenter=1`);

  // Put it on a different display than the studio window when there is one.
  const others = screen.getAllDisplays().filter((d) => d.id !== screen.getDisplayMatching(win.getBounds()).id);
  if (others.length) {
    const { x, y, width } = others[0].workArea;
    presenter.setPosition(Math.round(x + width / 2 - 280), Math.round(y + 60));
  }
  return true;
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

/**
 * Stop the studio server and everything it started.
 *
 * Killing only the process we forked leaves its own children running — above all
 * JupyterLab, which is rooted in a project folder and will then keep that folder
 * undeletable long after the app has closed. On Windows only a tree kill reaches them.
 */
function stopServer() {
  const child = server;
  server = null;
  if (!child) return;
  try {
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill();
    }
  } catch { /* already gone */ }
}

/** Ask the server to tidy up, and only force the issue if it will not. */
function quitServerGracefully(done) {
  const child = server;
  if (!child) return done();
  let finished = false;
  const finish = () => { if (finished) return; finished = true; clearTimeout(timer); stopServer(); done(); };
  // Generous, because stopping JupyterLab means asking the operating system what is
  // running; forcing the issue too early is how folders get left locked.
  const timer = setTimeout(finish, 8000);
  child.once("exit", finish);
  try { child.send({ type: "shutdown" }); } catch { finish(); }
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

/**
 * Updates, and what the app can say about them.
 *
 * One state object describes the whole business, so a banner and a settings panel cannot
 * disagree about it. Checks happen on launch and every six hours, but the point of
 * holding the state here is that the creator can ask at any moment and watch the answer
 * arrive — waiting six hours to find out whether a fix landed is not a feature.
 *
 * Nothing is ever applied without being asked for: a new version downloads in the
 * background and then waits, because restarting in the middle of a recording would be
 * worse than being a version behind.
 */
let update = { state: app.isPackaged ? "idle" : "unsupported", version: null, percent: 0, message: null };

function setUpdate(patch) {
  update = { ...update, ...patch };
  win?.webContents.send("update:state", update);
}

function wireUpdates() {
  if (!app.isPackaged) {
    setUpdate({ message: "Updates arrive in the installed app. This copy is running from source." });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => setUpdate({ state: "checking", message: null }));
  autoUpdater.on("update-available", (info) => setUpdate({ state: "downloading", version: info?.version ?? null, percent: 0 }));
  autoUpdater.on("update-not-available", () => setUpdate({ state: "current", version: app.getVersion(), percent: 0 }));
  autoUpdater.on("download-progress", (p) => setUpdate({ state: "downloading", percent: Math.round(p?.percent ?? 0) }));
  autoUpdater.on("update-downloaded", (info) => setUpdate({ state: "ready", version: info?.version ?? null, percent: 100 }));
  autoUpdater.on("error", (e) => {
    console.error("update check failed:", e?.message);
    setUpdate({ state: "error", message: e?.message ?? "The update check failed" });
  });

  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

/** A check the creator asked for, or the periodic one. Either way, never throws. */
async function check() {
  if (!app.isPackaged) return update;
  // A downloaded update is already the answer; checking again would only undo the state.
  if (update.state === "ready") return update;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    setUpdate({ state: "error", message: e?.message ?? "The update check failed" });
  }
  return update;
}

ipcMain.handle("studio:info", () => ({ port, version: app.getVersion(), partition: PARTITION, dev: DEV }));
ipcMain.handle("studio:pickFolder", async (_e, title) => {
  const r = await dialog.showOpenDialog(win, {
    title: title || "Choose a folder for this project",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("studio:openPresenter", () => openPresenter());
ipcMain.handle("studio:closePresenter", () => { presenter?.close(); return false; });
ipcMain.handle("studio:presenterOpen", () => Boolean(presenter && !presenter.isDestroyed()));
// The studio window publishes; the presenter window subscribes.
ipcMain.on("presenter:state", (_e, state) => {
  if (presenter && !presenter.isDestroyed()) presenter.webContents.send("presenter:state", state);
});
// The presenter window asks; the studio window acts.
ipcMain.on("presenter:command", (_e, cmd) => win?.webContents.send("presenter:command", cmd));

ipcMain.handle("studio:updateState", () => update);
ipcMain.handle("studio:checkForUpdates", () => check());
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

  // Quitting waits for the server to stop what it started — above all JupyterLab, which
  // otherwise outlives the app and keeps a project folder undeletable.
  let serverStopped = false;
  app.on("before-quit", (e) => {
    app.isQuitting = true;
    try { presenter?.destroy(); } catch { /* gone */ }
    if (serverStopped) return;
    e.preventDefault();
    quitServerGracefully(() => { serverStopped = true; app.quit(); });
  });
  app.on("window-all-closed", () => app.quit());
}
