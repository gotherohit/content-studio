// Detects, installs and runs JupyterLab so it can be embedded in the app.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const PY = process.platform === "win32" ? "python" : "python3";
const PORT = Number(process.env.JUPYTER_PORT || 8890);

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

  async function isInstalled(force = false) {
    if (installed !== null && !force) return installed;
    const r = await run(PY, ["-m", "jupyter", "lab", "--version"]);
    installed = r.ok;
    return installed;
  }

  function status() {
    return { installed, running: Boolean(child), port: PORT, token, rootDir, url: child ? `http://localhost:${PORT}/lab?token=${token}` : null, log: log.slice(-4000) };
  }

  /** Roots JupyterLab at the project's own folder, so notebooks sit with its sources. */
  async function start(notebooksDir) {
    await fs.mkdir(notebooksDir, { recursive: true });
    // Jupyter's root cannot change without a restart, so switch folders by restarting.
    if (child && rootDir === notebooksDir) return status();
    if (child) stop();
    if (!(await isInstalled())) throw new Error("JupyterLab is not installed");
    rootDir = notebooksDir;
    token = crypto.randomBytes(12).toString("hex");
    log = "";
    const args = [
      "-m", "jupyter", "lab", "--no-browser", `--port=${PORT}`, `--ServerApp.token=${token}`, "--ServerApp.password=",
      "--ServerApp.tornado_settings={\"headers\":{\"Content-Security-Policy\":\"frame-ancestors *\"}}",
      "--ServerApp.allow_origin=*", "--ServerApp.disable_check_xsrf=True", `--ServerApp.root_dir=${notebooksDir}`,
    ];
    child = spawn(PY, args, { cwd: notebooksDir, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("exit", () => { child = null; });
    // wait until it answers
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const r = await fetch(`http://localhost:${PORT}/api/status?token=${token}`);
        if (r.ok) break;
      } catch { /* not up yet */ }
      if (!child) throw new Error(`Jupyter exited:\n${log.slice(-2000)}`);
    }
    return status();
  }

  function stop() {
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
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
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
    if (!child || !rootDir || !dir) return false;
    const within = path.resolve(rootDir) === path.resolve(dir)
      || path.resolve(rootDir).startsWith(path.resolve(dir) + path.sep);
    if (!within) return false;

    const port = PORT;
    stop();
    rootDir = null;
    // Killing is asynchronous on Windows; wait until nothing answers before reporting done.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try { await fetch(`http://localhost:${port}/api/status`); } catch { return true; }
    }
    return true;
  }

  /** Streams `pip install jupyterlab` output. Returns a child process. */
  function install() {
    installed = null;
    return spawn(PY, ["-m", "pip", "install", "--upgrade", "jupyterlab"], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  }

  process.on("exit", stop);
  return { isInstalled, status, start, stop, install, releaseUnder };
}
