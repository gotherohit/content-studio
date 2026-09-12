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
    if (child) { try { child.kill(); } catch { /* ignore */ } child = null; }
    return status();
  }

  /** Streams `pip install jupyterlab` output. Returns a child process. */
  function install() {
    installed = null;
    return spawn(PY, ["-m", "pip", "install", "--upgrade", "jupyterlab"], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  }

  process.on("exit", stop);
  return { isInstalled, status, start, stop, install };
}
