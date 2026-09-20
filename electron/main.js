// Content Studio, as a desktop app.
//
// The web build fought the browser at every turn: Colab, Drive and OneDrive refuse to be
// framed, local harnesses lose their cookies across origins, and a page cannot open a
// folder picker. Electron removes the fight rather than working around it. The Express
// server is unchanged and still runs on loopback; this process starts it, waits for it,
// and shows it in a window whose panes may host real Chromium views.
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, safeStorage, screen, session, shell } from "electron";
import { fork, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { wireHandoff } from "./handoff.js";

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

let serverExited = false;

async function startServer() {
  serverExited = false;
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
    serverExited = true;
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("Content Studio", `The studio server stopped unexpectedly (code ${code}).`);
      app.quit();
    }
  });

  // /api/health answers as soon as the server is listening and does nothing else. The wait
  // used to be on /api/config, which looks for browsers, PowerPoint and LibreOffice; on a
  // cold start — a fresh install being scanned, a machine still busy — that discovery took
  // longer than the app was prepared to wait, and it quit saying the server never started.
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch { /* still coming up */ }
    if (serverExited) throw new Error("The studio server stopped while starting up");
  }
  throw new Error("The studio server did not answer in a minute. Try launching Content Studio again.");
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
const presenterUrl = () => (DEV ? "http://127.0.0.1:5173/?presenter=1" : `http://127.0.0.1:${port}/?presenter=1`);

/**
 * Whether the presenter page actually came up.
 *
 * Its first act on mounting is to ask the studio for state, so that request is the proof
 * the page rendered. Before any beats arrive it still draws its toolbar, so a window that
 * stays blank has not loaded, has crashed, or never painted — never a missed message.
 * One reload recovers a transient failure; after that the studio says so, rather than
 * leaving the creator to reopen it until it happens to work.
 */
const presenterWatch = { mounted: false, retried: false, reported: false, timer: null };

function watchPresenter(target) {
  presenterWatch.mounted = false;
  presenterWatch.retried = false;
  presenterWatch.reported = false;
  const contents = target.webContents;

  const fail = (reason) => {
    clearTimeout(presenterWatch.timer);
    if (target.isDestroyed() || presenterWatch.mounted) return;
    if (!presenterWatch.retried) {
      presenterWatch.retried = true;
      contents.loadURL(presenterUrl());
      return;
    }
    if (!target.isVisible()) target.show();
    // A failed load can also finish as an error page; say so once, not once per event.
    if (presenterWatch.reported) return;
    presenterWatch.reported = true;
    win?.webContents.send("presenter:failed", reason);
  };

  // Having mounted once says nothing about the page now loading, so each load must prove itself.
  contents.on("did-start-loading", () => { presenterWatch.mounted = false; });
  contents.on("did-finish-load", () => {
    clearTimeout(presenterWatch.timer);
    presenterWatch.timer = setTimeout(() => {
      if (!presenterWatch.mounted) fail("its page loaded but never started");
    }, 6000);
  });
  contents.on("did-fail-load", (_e, code, description, _url, isMainFrame) => {
    // -3 is an aborted load, which is what our own retry does to the previous attempt.
    if (isMainFrame && code !== -3) fail(`its page failed to load (${description || code})`);
  });
  contents.on("render-process-gone", (_e, details) => {
    presenterWatch.mounted = false;
    fail(`its page stopped (${details?.reason ?? "unknown"})`);
  });
}

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
    // Shown once there is something to paint, so it never appears as an empty frame.
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const opened = presenter;
  // above full-screen apps too, or it would vanish the moment the studio goes full screen
  opened.setAlwaysOnTop(true, "screen-saver");
  opened.once("ready-to-show", () => { if (!opened.isDestroyed()) opened.show(); });
  // A page that never becomes ready must still be visible, or a failure looks like nothing.
  setTimeout(() => { if (!opened.isDestroyed() && !opened.isVisible()) opened.show(); }, 3000);
  opened.on("closed", () => {
    clearTimeout(presenterWatch.timer);
    if (presenter === opened) presenter = null;
    win?.webContents.send("presenter:closed");
  });
  watchPresenter(opened);
  opened.loadURL(presenterUrl());

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
  const endHandoff = wireHandoff(win, here, async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : undefined);
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "Could not switch to the app.");
    return result;
  });
  app.on("before-quit", endHandoff);
  let captureChoice = null;
  ipcMain.handle("studio:captureSources", async (event) => {
    if (event.sender !== win.webContents) throw new Error("Capture is only available in Studio");
    const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: { width: 240, height: 135 } });
    return sources.filter((source) => !BrowserWindow.getAllWindows().some((w) => w.getMediaSourceId() === source.id))
      .map((source) => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
  });
  ipcMain.handle("studio:chooseCapture", (event, id) => {
    if (event.sender !== win.webContents || typeof id !== "string" || !/^(window|screen):/.test(id)) throw new Error("Choose a capture from Studio's picker");
    if (captureChoice && Date.now() - captureChoice.at < 10000) throw new Error("Another capture is starting. Try again in a moment.");
    captureChoice = { id, at: Date.now() };
  });
  win.webContents.session.setDisplayMediaRequestHandler(async (request, callback) => {
    const choice = captureChoice;
    if (request.frame !== win.webContents.mainFrame) { callback({}); return; }
    captureChoice = null;
    if (!choice || Date.now() - choice.at > 10000) { callback({}); return; }
    try {
      const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find((s) => s.id === choice.id);
      callback(source ? { video: source } : {});
    } catch { callback({}); }
  });
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
/** Where the downloaded installer is, so the app can start it and say where it is. */
let installerFile = null;

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
  autoUpdater.logger = { info: updateLog, warn: updateLog, error: updateLog, debug: () => {} };

  autoUpdater.on("checking-for-update", () => setUpdate({ state: "checking", message: null }));
  autoUpdater.on("update-available", (info) => setUpdate({ state: "downloading", version: info?.version ?? null, percent: 0 }));
  autoUpdater.on("update-not-available", () => setUpdate({ state: "current", version: app.getVersion(), percent: 0 }));
  autoUpdater.on("download-progress", (p) => setUpdate({ state: "downloading", percent: Math.round(p?.percent ?? 0) }));
  autoUpdater.on("update-downloaded", (info) => {
    installerFile = info?.downloadedFile ?? null;
    setUpdate({ state: "ready", version: info?.version ?? null, percent: 100 });
  });
  autoUpdater.on("error", (e) => {
    console.error("update check failed:", e?.message);
    setUpdate({ state: "error", message: e?.message ?? "The update check failed" });
  });

  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

/** A line in ~/.content-studio/update.log, so a failed update can be explained afterwards. */
function updateLog(message) {
  try {
    const dir = path.join(app.getPath("home"), ".content-studio");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "update.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never be the reason an update fails.
  }
}

/** Windows 11 Smart App Control: 1 is enforcing, and it refuses to run unsigned installers. */
function smartAppControlOn() {
  if (process.platform !== "win32") return false;
  const key = String.raw`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy`;
  const r = spawnSync("reg", ["query", key, "/v", "VerifiedAndReputablePolicyState"], { encoding: "utf8" });
  return /VerifiedAndReputablePolicyState\s+REG_DWORD\s+0x1/i.test(r.stdout || "");
}

function startDetached(exe, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, args, { detached: true, stdio: "ignore" });
    } catch (e) {
      resolve({ ok: false, error: e });
      return;
    }
    child.once("error", (e) => resolve({ ok: false, error: e }));
    child.once("spawn", () => { child.unref(); resolve({ ok: true }); });
  });
}

/** elevate.exe returns the moment it has asked Windows, so only the process list proves it ran. */
async function installerRunning(name, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const r = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${name}`], { encoding: "utf8" });
    if ((r.stdout || "").includes(name)) return true;
    await new Promise((r2) => setTimeout(r2, 1000));
  }
  return false;
}

/**
 * Starting the installer, and only quitting once it is really running.
 *
 * electron-updater quits as soon as it has asked Windows, so anything that refuses the
 * installer afterwards leaves the app gone and nothing installed — which looks exactly
 * like pressing the button and nothing happening. Smart App Control does refuse it: it
 * blocks installers that are not code-signed, silently, including the elevated retry.
 */
async function installUpdate() {
  if (!installerFile || !fs.existsSync(installerFile)) {
    setUpdate({ state: "error", message: "The downloaded installer is no longer on disk. Check for updates again." });
    return update;
  }
  updateLog(`install requested: ${installerFile}`);
  const quit = () => { app.isQuitting = true; app.quit(); };
  const blocked = (why) => {
    updateLog(`install did not start: ${why}`);
    setUpdate({
      state: "error",
      message: smartAppControlOn()
        ? `Windows would not run the installer. Smart App Control is on, and it blocks installers that are not code-signed — this one is not. Turn it off in Windows Security → App & browser control, or install by hand from ${installerFile}`
        : `Windows would not run the installer (${why}). It is at ${installerFile}`,
    });
    return update;
  };

  const direct = await startDetached(installerFile, ["--updated"]);
  if (direct.ok) {
    updateLog("installer started");
    quit();
    return update;
  }
  updateLog(`direct start refused: ${direct.error?.code ?? direct.error?.message}`);
  // UNKNOWN is what Windows says when the installer needs elevation, and also when it is blocked.
  const elevate = path.join(process.resourcesPath, "elevate.exe");
  if (!fs.existsSync(elevate)) return blocked(direct.error?.code ?? "cannot start");
  const elevated = await startDetached(elevate, [installerFile, "--updated"]);
  if (!elevated.ok) return blocked(elevated.error?.code ?? "cannot start");
  if (!(await installerRunning(path.basename(installerFile), 25000))) return blocked("nothing started");
  updateLog("installer started with elevation");
  quit();
  return update;
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
ipcMain.on("presenter:command", (e, cmd) => {
  if (cmd?.type === "sync" && presenter && !presenter.isDestroyed() && e.sender === presenter.webContents) {
    presenterWatch.mounted = true;
    // A window that came up fine earns a fresh retry if it fails later in the session.
    presenterWatch.retried = false;
    presenterWatch.reported = false;
    clearTimeout(presenterWatch.timer);
  }
  win?.webContents.send("presenter:command", cmd);
});

ipcMain.handle("studio:updateState", () => update);
ipcMain.handle("studio:checkForUpdates", () => check());
ipcMain.handle("studio:installUpdate", () => installUpdate());
ipcMain.handle("studio:openExternal", (_e, url) => shell.openExternal(url));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    // focus() alone does not reveal a hidden window left by a background launch.
    win.show();
    win.focus();
  });

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
