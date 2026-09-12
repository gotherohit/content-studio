import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createCredentials } from "./credentials.js";
import { streamChat, listModels } from "./ai.js";
import { createConfig } from "./config.js";
import { createSiteProxy } from "./site.js";
import { attachTerminal } from "./terminal.js";
import { createJupyter } from "./jupyter.js";
import { createInput } from "./input.js";
import { TYPES, viewerFor, safeName, uniqueName } from "./assets.js";
import { renderDeck, openSlideshow, hasPowerPoint, findSoffice } from "./slides.js";
import { pickFolder } from "./picker.js";
import { createBrowser } from "./browser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PORT = Number(process.env.API_PORT || 4700);

const config = createConfig(ROOT);
await config.load();
const credentials = createCredentials({ appDirFn: () => config.appDir() });
await credentials.load();
const site = createSiteProxy({ cacheDirFn: () => path.join(config.cacheDir(), "sites"), port: PORT });
const jupyter = createJupyter();
const input = createInput();
const browser = createBrowser({ profileDirFn: () => path.join(config.appDir(), "browser") });
await site.loadRegistry();

const safeId = (id) => /^[a-zA-Z0-9_-]+$/.test(id);
const sourcesDir = (id) => config.sourcesOf(id);
/** Rendered slide images and other derived files, kept out of the user's way. */
const derivedDir = (id, name) => path.join(config.dirOf(id), ".rendered", safeName(name));

/**
 * This server can run code, drive the mouse and keyboard, and read and write files,
 * all without a password, because it is meant to serve exactly one person: whoever is
 * sitting at this machine. So it listens on loopback only, and every request is checked
 * to have come from there. Without this, anyone sharing your network could take over
 * the desktop.
 */
const HOST = process.env.HOST || "127.0.0.1";
const isLoopback = (addr = "") =>
  addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr.startsWith("127.");

const app = express();
app.use((req, res, next) => {
  if (isLoopback(req.socket.remoteAddress)) return next();
  res.status(403).type("text/plain").send("Content Studio only accepts connections from this computer.");
});
app.use(site.middleware); // requests for <site>.localhost are proxied pages
// Same-machine only, so a wide-open CORS policy would still be a way in from a web page.
app.use(cors({ origin: (o, cb) => cb(null, !o || /^https?:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$/i.test(o)) }));

// Registered before the JSON parser: the raw body IS the file.
app.put("/api/projects/:id/sources/:name", express.raw({ type: "*/*", limit: "1gb" }), async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "bad id" });
  const dir = sourcesDir(req.params.id);
  await fs.mkdir(dir, { recursive: true });
  const name = await uniqueName(dir, safeName(req.params.name));
  await fs.writeFile(path.join(dir, name), req.body);
  res.json(await describeSource(req.params.id, name));
});

app.use(express.json({ limit: "20mb" }));
app.use((err, _req, res, next) => (err instanceof SyntaxError ? res.status(400).json({ error: "Invalid JSON body" }) : next(err)));

// ---------- app settings ----------
app.get("/api/config", async (_req, res) => {
  const cfg = config.get();
  res.json({
    appDir: cfg.appDir,
    apiPort: PORT, root: ROOT,
    canControlWindows: input.available(),
    browser: await browser.detect(),
    powerPoint: await hasPowerPoint(),
    libreOffice: Boolean(await findSoffice()),
  });
});

// ---------- projects ----------
const readProject = async (id) => JSON.parse(await fs.readFile(config.fileOf(id), "utf8"));

async function listProjects() {
  const out = [];
  for (const [id, dir] of await config.listDirs()) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf8"));
      out.push({ id: p.id, title: p.title, updatedAt: p.updatedAt, sourceCount: (p.sources || []).length, dir });
    } catch { /* folder went away */ }
  }
  return out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

app.get("/api/projects", async (_req, res) => res.json(await listProjects()));

app.post("/api/projects", async (req, res) => {
  const title = req.body?.title || "Untitled project";
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Every project lives where the user chose; there is no default location.
  if (!req.body?.dir) return res.status(400).json({ error: "Choose a folder for this project" });
  if (!path.isAbsolute(req.body.dir)) return res.status(400).json({ error: "Choose a folder with Browse" });
  const dir = path.resolve(req.body.dir);
  const now = new Date().toISOString();
  const project = {
    id, title, createdAt: now, updatedAt: now,
    sources: [], notes: "# Script / talking points\n\n", canvas: null,
    snippets: [{ id: "s1", lang: "python", title: "Example", code: "print('hello from the harness')" }],
    chat: [], slides: "",
    layout: { preset: "2", panes: [{ kind: "source" }, { kind: "highlights" }], split: 58, rowSplit: 50 },
    settings: { viewMode: "original" },
  };
  await fs.mkdir(path.join(dir, "sources"), { recursive: true });
  await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
  await config.register(id, dir);
  res.json({ ...project, dir });
});

app.get("/api/projects/:id", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "bad id" });
  try { res.json({ ...(await readProject(req.params.id)), dir: config.dirOf(req.params.id) }); }
  catch { res.status(404).json({ error: "not found" }); }
});

app.put("/api/projects/:id", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "bad id" });
  const { dir: _ignored, ...rest } = req.body || {};
  const project = { ...rest, id: req.params.id, updatedAt: new Date().toISOString() };
  await fs.mkdir(sourcesDir(project.id), { recursive: true });
  await fs.writeFile(config.fileOf(project.id), JSON.stringify(project, null, 2));
  res.json({ ok: true, updatedAt: project.updatedAt });
});

app.delete("/api/projects/:id", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "bad id" });
  const dir = config.dirOf(req.params.id);
  if (req.query.keepFiles === "1") await config.forget(req.params.id);
  else { await fs.rm(dir, { recursive: true, force: true }); await config.forget(req.params.id); }
  res.json({ ok: true });
});

/** Put this project's folder somewhere else, moving everything in it. */
app.put("/api/projects/:id/folder", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "bad id" });
  const { dir } = req.body || {};
  if (!dir) return res.status(400).json({ error: "dir required" });
  // A relative path would silently resolve against the server's own directory.
  if (!path.isAbsolute(dir)) return res.status(400).json({ error: "Give a full path, for example D:\\Videos\\my-project" });
  try { res.json({ dir: await config.moveProject(req.params.id, dir) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/** Adopt a project folder that already exists on disk. */
app.post("/api/projects/open", async (req, res) => {
  const { dir } = req.body || {};
  if (!dir) return res.status(400).json({ error: "dir required" });
  if (!path.isAbsolute(dir)) return res.status(400).json({ error: "Give a full path to the project folder" });
  try {
    const target = path.resolve(dir);
    const p = JSON.parse(await fs.readFile(path.join(target, "project.json"), "utf8"));
    await config.register(p.id, target);
    res.json({ id: p.id, title: p.title, dir: target });
  } catch (e) {
    res.status(400).json({ error: `No project.json in that folder (${e.message})` });
  }
});

/** Open the operating system's folder dialog and return what the user picked. */
app.post("/api/pick-folder", async (req, res) => {
  try {
    const dir = await pickFolder({
      description: req.body?.description || "Choose a folder",
      startIn: req.body?.startIn || "",
    });
    res.json({ dir });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/reveal", async (req, res) => {
  const { dir } = req.body || {};
  if (!dir) return res.status(400).json({ error: "dir required" });
  if (process.platform === "win32") spawn("explorer.exe", [path.resolve(dir)], { detached: true }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [path.resolve(dir)], { detached: true }).unref();
  res.json({ ok: true });
});

/** Ask the target what it says, so the Embed pane can explain a refusal instead of framing a blank. */
app.post("/api/site/probe", async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "http(s) url required" });
  try {
    res.json(await site.probe(url));
  } catch (e) {
    res.json({ status: 0, statusText: e.message, contentType: "", location: null, body: "" });
  }
});

// ---------- browser pane ----------
app.get("/api/browser/status", async (_req, res) => { await browser.detect(); res.json(browser.status()); });
app.post("/api/browser/stop", (_req, res) => { browser.stop(); res.json({ ok: true }); });

// ---------- sources ----------
app.post("/api/fetch", async (req, res) => {
  const { url, refresh } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "http(s) url required" });
  try {
    const { article, title } = await site.extract(url, { refresh: Boolean(refresh) });
    res.json({
      url, title,
      byline: article?.byline ?? null, siteName: article?.siteName ?? null, excerpt: article?.excerpt ?? null,
      content: article?.content || "<p>(No readable article found; use Original view.)</p>",
      textContent: article?.textContent || "",
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.use("/api", express.static(path.join(here, "public")));

app.post("/api/site/register", (req, res) => {
  const { url, mode = "app" } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "http(s) url required" });
  try { res.json({ url: site.register(url, mode === "read" ? "read" : "app") }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

async function describeSource(id, name) {
  const ext = path.extname(name).toLowerCase();
  const st = await fs.stat(path.join(sourcesDir(id), name)).catch(() => null);
  return { name, ext, size: st?.size ?? 0, viewer: viewerFor(ext) };
}

app.get("/api/projects/:id/sources", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "bad id" });
  const dir = sourcesDir(req.params.id);
  await fs.mkdir(dir, { recursive: true });
  const out = [];
  for (const name of await fs.readdir(dir)) {
    if (name.startsWith(".")) continue;
    const st = await fs.stat(path.join(dir, name)).catch(() => null);
    if (st?.isFile()) out.push(await describeSource(req.params.id, name));
  }
  res.json(out.sort((a, b) => a.name.localeCompare(b.name)));
});

app.get("/api/projects/:id/sources/:name", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).end();
  const name = safeName(req.params.name);
  const type = TYPES[path.extname(name).toLowerCase()];
  if (type) res.type(type);
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.sendFile(path.join(sourcesDir(req.params.id), name), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

app.delete("/api/projects/:id/sources/:name", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).end();
  const name = safeName(req.params.name);
  await fs.rm(path.join(sourcesDir(req.params.id), name), { force: true });
  await fs.rm(derivedDir(req.params.id, name), { recursive: true, force: true });
  res.json({ ok: true });
});

// ---------- slide decks ----------
app.post("/api/projects/:id/deck/:name/render", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "bad id" });
  const name = safeName(req.params.name);
  try {
    const result = await renderDeck(path.join(sourcesDir(req.params.id), name), derivedDir(req.params.id, name));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/:id/deck/:name/:slide", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).end();
  const file = path.join(derivedDir(req.params.id, safeName(req.params.name)), safeName(req.params.slide));
  res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

/** Run the real slideshow so transitions and build animations play. */
app.post("/api/projects/:id/deck/:name/present", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "bad id" });
  try {
    await openSlideshow(path.join(sourcesDir(req.params.id), safeName(req.params.name)));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- desktop input ----------
app.get("/api/input/targets", async (_req, res) => {
  if (!input.available()) return res.json({ available: false, windows: [], screens: [] });
  try {
    const r = await input.send({ type: "windows" });
    res.json({ available: true, windows: r.windows || [], screens: r.screens || [] });
  } catch (e) {
    res.json({ available: false, error: e.message, windows: [], screens: [] });
  }
});

app.post("/api/input", async (req, res) => {
  try { res.json(await input.send(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- code runner ----------
const RUNNERS = {
  python: { cmd: process.platform === "win32" ? "python" : "python3", ext: ".py", args: (f) => [f] },
  node: { cmd: "node", ext: ".mjs", args: (f) => [f] },
  bash: { cmd: "bash", ext: ".sh", args: (f) => [f] },
  powershell: { cmd: "powershell", ext: ".ps1", args: (f) => ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f] },
};

app.post("/api/run", async (req, res) => {
  const { lang = "python", code = "", timeoutMs = 30000, projectId } = req.body || {};
  const runner = RUNNERS[lang];
  if (!runner) return res.status(400).json({ error: `unsupported lang ${lang}` });
  const cwd = projectId && safeId(projectId) ? config.dirOf(projectId) : config.appDir();
  await fs.mkdir(cwd, { recursive: true });
  const file = path.join(cwd, `.snippet${runner.ext}`);
  await fs.writeFile(file, code);
  const started = Date.now();
  const child = spawn(runner.cmd, runner.args(file), { cwd, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const timer = setTimeout(() => child.kill(), timeoutMs);
  child.on("error", (e) => { clearTimeout(timer); res.json({ stdout, stderr: `${stderr}\n${e.message}`, code: -1, ms: Date.now() - started }); });
  child.on("close", async (code) => {
    clearTimeout(timer);
    await fs.rm(file, { force: true }).catch(() => {});
    res.json({ stdout, stderr, code, ms: Date.now() - started });
  });
});

// ---------- jupyter ----------
app.get("/api/jupyter/status", async (_req, res) => { await jupyter.isInstalled(); res.json(jupyter.status()); });
app.post("/api/jupyter/start", async (req, res) => {
  const id = req.body?.projectId;
  const dir = id && safeId(id) ? config.dirOf(id) : config.appDir();
  try { res.json(await jupyter.start(dir)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/jupyter/stop", (_req, res) => res.json(jupyter.stop()));
app.post("/api/jupyter/install", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const c = jupyter.install();
  c.stdout.on("data", (d) => send({ text: String(d) }));
  c.stderr.on("data", (d) => send({ text: String(d) }));
  c.on("error", (e) => { send({ error: e.message }); res.end(); });
  c.on("close", async (code) => { send({ done: true, code, installed: await jupyter.isInstalled(true) }); res.end(); });
});

// ---------- AI ----------
//
// Any Anthropic- or OpenAI-compatible endpoint can be pointed at from Settings. Keys are
// held in ~/.content-studio/credentials.json and never travel back to the browser.
const DEFAULT_SYSTEM =
  "You are a research assistant for a YouTube creator who explains news and blog posts and adds their own analysis. " +
  "Be concrete, cite what in the source you rely on, flag claims that need verification, and suggest angles, " +
  "counterpoints and examples the creator could show on screen.";

app.get("/api/ai/status", (_req, res) => {
  const { providers, defaultModel } = credentials.list();
  res.json({
    configured: credentials.configured(),
    model: defaultModel,
    models: providers.flatMap((p) => (p.hasKey || p.keyless ? p.models.map((m) => ({ ref: `${p.id}/${m}`, provider: p.label, model: m })) : [])),
  });
});

app.get("/api/ai/providers", (_req, res) => res.json(credentials.list()));

app.put("/api/ai/providers/:id", async (req, res) => {
  try {
    res.json(await credentials.save(req.params.id, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/ai/providers/:id", async (req, res) => res.json(await credentials.remove(req.params.id)));

app.put("/api/ai/default-model", async (req, res) => {
  try {
    res.json(await credentials.setDefaultModel(req.body?.model ?? null));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** What can this provider actually run? Also the cheapest proof that a key works. */
app.post("/api/ai/providers/:id/models", async (req, res) => {
  const provider = credentials.find(req.params.id);
  if (!provider) return res.status(404).json({ error: "No such provider" });
  try {
    res.json({ models: await listModels({ ...provider, apiKey: req.body?.apiKey || provider.apiKey }) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/ai", async (req, res) => {
  const { messages = [], context = "", system = "", model = null } = req.body || {};
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}

`);

  const picked = credentials.resolve(model);
  if (!picked) {
    send({ error: "No model is set up yet. Open Settings and add a provider and key." });
    return res.end();
  }

  // If the creator closes the pane or asks something else, stop paying for the old answer.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    const systemPrompt = (system || DEFAULT_SYSTEM) + (context ? `

<source_material>
${context}
</source_material>` : "");
    const final = await streamChat({
      provider: picked.provider,
      model: picked.model,
      system: systemPrompt,
      messages,
      onText: (text) => send({ text }),
      signal: abort.signal,
    });
    send({ done: true, model: picked.ref, ...final });
  } catch (e) {
    if (!abort.signal.aborted) send({ error: e.message });
  }
  res.end();
});

// ---------- static client (production) ----------
const dist = path.join(ROOT, "client", "dist");
app.use(express.static(dist));
app.get(/^\/(?!api).*/, async (_req, res) => {
  try {
    await fs.access(path.join(dist, "index.html"));
    res.sendFile(path.join(dist, "index.html"));
  } catch {
    res.status(404).send("Client not built. Run `npm run dev` (dev) or `npm run build` first.");
  }
});

// An error in one request must not take the whole studio down mid-recording.
app.use((err, _req, res, _next) => {
  console.error("request failed:", err?.message);
  if (!res.headersSent) res.status(500).json({ error: err?.message || "server error" });
});
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e?.message || e));

const server = http.createServer(app);
browser.attach(server);
attachTerminal(server, { cwdFor: (projectId) => (projectId && safeId(projectId) ? config.dirOf(projectId) : config.appDir()) });
// Local apps embedded through the proxy do their real work over websockets.
server.on("upgrade", (req, socket, head) => {
  // The terminal is a shell; this check matters more here than anywhere else.
  if (!isLoopback(socket.remoteAddress)) return socket.destroy();
  const p = new URL(req.url, "http://localhost").pathname;
  if (p === "/api/term" || p === "/api/browser") return;
  if (!site.handleUpgrade(req, socket, head)) socket.destroy();
});
server.listen(PORT, HOST, () => {
  console.log(`API on http://localhost:${PORT}  app data: ${config.appDir()}  (model: ${credentials.list().defaultModel ?? "none configured"})`);
  if (!isLoopback(HOST)) console.warn(`WARNING: HOST=${HOST} exposes a shell and desktop control to your network.`);
});
