// Detects, installs and runs JupyterLab so it can be embedded in the app.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";

const PY = process.platform === "win32" ? "python" : "python3";
const PORT = Number(process.env.JUPYTER_PORT || 8890);

export async function availablePort(preferred = PORT) {
  for (let port = preferred; port < Math.min(preferred + 40, 65536); port++) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("No free loopback port for JupyterLab");
}

export function launchArguments(port, token, root) {
  return ["-m", "jupyterlab", "--no-browser", `--port=${port}`, "--ServerApp.port_retries=0",
    "--ServerApp.ip=127.0.0.1", `--IdentityProvider.token=${token}`, "--ServerApp.password=",
    '--ServerApp.tornado_settings={"headers":{"Content-Security-Policy":"frame-ancestors http://127.0.0.1:* http://localhost:*"}}',
    "--ServerApp.allow_origin_pat=^https?://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?$", `--ServerApp.root_dir=${root}`,
    `--LabApp.workspaces_dir=${path.join(root, ".jupyter", "workspaces")}`];
}

/**
 * Find any JupyterLab rooted at exactly this folder, whoever started it.
 *
 * A Jupyter started by an earlier run of the app outlives it — the app is closed, the
 * server it forked is gone, and JupyterLab is still sitting in the project folder keeping
 * Windows from ever deleting it. Nothing in this process knows about that one, so the
 * only way to find it is to ask the operating system.
 *
 * Matching on the exact `--ServerApp.root_dir=<folder>` keeps this precise: it can only
 * hit a server rooted at the folder being deleted.
 */
function findRootedAt(dir) {
  return new Promise((resolve) => {
    const done = (out) => resolve([...out.matchAll(/\d+/g)].map((m) => Number(m[0])).filter(Boolean));
    if (process.platform === "win32") {
      const script =
        'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ("*--ServerApp.root_dir=" + $env:CS_ROOT_DIR + "*") } | ForEach-Object { $_.ProcessId }';
      const c = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
        env: { ...process.env, CS_ROOT_DIR: dir },
      });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.on("error", () => resolve([]));
      c.on("close", () => done(out));
      return;
    }
    const c = spawn("pgrep", ["-f", `--ServerApp.root_dir=${dir}`]);
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("error", () => resolve([]));
    c.on("close", () => done(out));
  });
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { shell: false });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("error", () => resolve({ ok: false, out }));
    c.on("close", (code) => resolve({ ok: code === 0, out }));
  });
}

export function createJupyter() {
  let child = null;
  let token = null;
  let installed = null; // cached
  let log = "";
  let rootDir = null;
  let port = PORT;
  let ready = false;
  let generation = 0;
  let pending = Promise.resolve();

  async function isInstalled(force = false) {
    if (installed !== null && !force) return installed;
    const r = await run(PY, ["-m", "jupyterlab", "--version"]);
    installed = r.ok;
    return installed;
  }

  function status() {
    return { installed, running: Boolean(child && ready), port, rootDir, url: child && ready ? `http://127.0.0.1:${port}/lab?token=${token}` : null, log: token ? log.slice(-4000).split(token).join("[token]") : log.slice(-4000) };
  }

  /** Roots JupyterLab at the project's own folder, so notebooks sit with its sources. */
  function start(notebooksDir) {
    const next = pending.then(() => startNow(notebooksDir));
    pending = next.catch(() => {});
    return next;
  }

  async function startNow(notebooksDir) {
    if (!notebooksDir) throw new Error("Open a valid project before starting JupyterLab");
    notebooksDir = path.resolve(notebooksDir);
    await fs.mkdir(notebooksDir, { recursive: true });
    // Jupyter's root cannot change without a restart, so switch folders by restarting.
    if (child && ready && rootDir === notebooksDir) return status();
    if (child) stop();
    const version = ++generation;
    if (!(await isInstalled())) throw new Error("JupyterLab is not installed");
    port = await availablePort();
    if (version !== generation) throw new Error("Jupyter startup cancelled");
    rootDir = notebooksDir;
    token = crypto.randomBytes(12).toString("hex");
    log = "";
    const current = spawn(PY, launchArguments(port, token, notebooksDir), { cwd: notebooksDir, windowsHide: true, detached: process.platform !== "win32", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    child = current; ready = false;
    const append = (d) => { if (child === current) log = (log + d).slice(-16000); };
    current.stdout.on("data", append);
    current.stderr.on("data", append);
    current.on("error", (e) => { append(e.message); if (child === current) { child = null; ready = false; } });
    current.on("exit", () => { if (child === current) { child = null; ready = false; } });
    // wait until it answers
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/status?token=${token}`, { signal: AbortSignal.timeout(1000) });
        if (r.ok && child === current && version === generation) { ready = true; return status(); }
      } catch { /* not up yet */ }
      if (version !== generation) throw new Error("Jupyter startup cancelled");
      if (child !== current) throw new Error(`Jupyter exited:\n${status().log.slice(-2000)}`);
    }
    stop();
    throw new Error(`Jupyter did not become ready within the startup timeout.\n${status().log.slice(-2000)}`);
  }

  function stop() {
    generation++; ready = false;
    if (child) { killTree(child.pid); child = null; }
    return status();
  }

  /**
   * `python -m jupyter lab` launches the real server as a grandchild, so killing the
   * process we spawned leaves JupyterLab running — and still rooted in the project folder.
   */
  function killTree(pid) {
    if (!pid) return;
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else process.kill(-pid, "SIGKILL");
    } catch { /* already gone */ }
  }

  /**
   * Let go of a folder that is about to be deleted.
   *
   * JupyterLab is rooted at the project folder and runs with it as its working directory,
   * and Windows will not delete a folder a process is sitting in. Deleting a project
   * therefore has to stop the server the app itself started.
   */
  async function releaseUnder(dir) {
    if (!dir) return false;
    let released = false;

    // The server this run started, if it is rooted in the folder.
    if (child && rootDir) {
      const here = path.resolve(rootDir);
      const target = path.resolve(dir);
      if (here === target || here.startsWith(target + path.sep)) {
        stop();
        rootDir = null;
        released = true;
      }
    }

    // And any left behind by an earlier run, which this process knows nothing about.
    for (const pid of await findRootedAt(path.resolve(dir))) {
      killTree(pid);
      released = true;
    }
    if (!released) return false;

    // Killing is asynchronous on Windows; wait until nothing is rooted there any more.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if ((await findRootedAt(path.resolve(dir))).length === 0) break;
    }
    return true;
  }

  /**
   * Stop for good, on the way out.
   *
   * `python -m jupyter lab` hands off to `jupyter-lab.exe` and exits, which re-parents the
   * real server out of our process tree — so a tree kill no longer reaches it. Matching on
   * the folder it is rooted at does, and that is the difference between the app closing
   * cleanly and leaving a project folder undeletable for the rest of the day.
   */
  async function shutdown() {
    const where = rootDir;
    stop();
    rootDir = null;
    if (!where) return;
    for (const pid of await findRootedAt(path.resolve(where))) killTree(pid);
  }

  /** Streams `pip install jupyterlab` output. Returns a child process. */
  function install() {
    installed = null;
    return spawn(PY, ["-m", "pip", "install", "--upgrade", "jupyterlab"], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  }

  process.on("exit", stop);
  return { isInstalled, status, start, stop, shutdown, install, releaseUnder };
}
