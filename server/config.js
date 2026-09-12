// Where projects live.
//
// App level   ~/.content-studio/   the project index and the page cache. Never inside
//                                  the codebase, never inside a project.
// Project     one folder, chosen by the user when the project is created. Its sources,
//             notes, notebooks and scratch files all sit together, so the folder can be
//             moved, backed up or opened by any other tool on its own.
//
// There is no default project location: a project only exists where the user put it,
// and the index below is simply a list of those folders.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const appDir = () => path.join(os.homedir(), ".content-studio");

export function createConfig(ROOT) {
  const APP = appDir();
  const file = path.join(APP, "config.json");
  const legacyFile = path.join(ROOT, "config.json");
  let cfg = { projects: {} };

  const persist = () => fs.writeFile(file, JSON.stringify(cfg, null, 2) + "\n");
  const cacheDir = () => path.join(APP, "cache");
  const get = () => ({ ...cfg, appDir: APP });

  async function load() {
    await fs.mkdir(APP, { recursive: true });
    await fs.mkdir(cacheDir(), { recursive: true });
    let raw = null;
    try { raw = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* not there yet */ }
    if (!raw) {
      try { raw = JSON.parse(await fs.readFile(legacyFile, "utf8")); } catch { /* first run */ }
    }
    cfg = { projects: raw?.projects ?? {} };
    // Earlier versions kept every project under one root; adopt whatever is still there.
    const oldRoot = raw?.projectsRoot || raw?.dataDir;
    if (oldRoot) await adoptLegacyLayout(oldRoot);
    await listDirs();
    await persist();
    await fs.rm(legacyFile, { force: true }).catch(() => {});
    return cfg;
  }

  /** Absolute folder for a project. */
  const dirOf = (id) => cfg.projects[id] ?? null;
  const fileOf = (id) => path.join(dirOf(id) ?? APP, "project.json");
  const sourcesOf = (id) => path.join(dirOf(id) ?? APP, "sources");

  /** The known projects, minus any whose folder has gone. */
  async function listDirs() {
    const found = new Map();
    let changed = false;
    for (const [id, dir] of Object.entries(cfg.projects)) {
      try { await fs.access(path.join(dir, "project.json")); found.set(id, dir); }
      catch { delete cfg.projects[id]; changed = true; }
    }
    if (changed) await persist();
    return found;
  }

  async function register(id, dir) {
    cfg.projects[id] = path.resolve(dir);
    await persist();
  }
  async function forget(id) {
    delete cfg.projects[id];
    await persist();
  }

  /** Move a project's folder somewhere else, keeping everything in it together. */
  async function moveProject(id, targetDir) {
    const from = dirOf(id);
    if (!from) throw new Error("That project is not in the index");
    const to = path.resolve(targetDir);
    if (path.resolve(from) === to) return to;
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.rename(from, to);
    } catch {
      await fs.cp(from, to, { recursive: true }); // rename fails across drives
      await fs.rm(from, { recursive: true, force: true });
    }
    await register(id, to);
    return to;
  }

  /** Bring folders made by earlier versions into the index and the current shape. */
  async function adoptLegacyLayout(oldRoot) {
    // <root>/projects/<id>/ became <root>/<id>/
    const nested = path.join(oldRoot, "projects");
    for (const entry of await fs.readdir(nested, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const from = path.join(nested, entry.name), to = path.join(oldRoot, entry.name);
      try {
        await fs.access(path.join(from, "project.json"));
        await fs.rename(from, to).catch(async () => { await fs.cp(from, to, { recursive: true }); await fs.rm(from, { recursive: true, force: true }); });
      } catch { /* skip */ }
    }
    await fs.rmdir(nested).catch(() => {});

    // the page cache used to live beside the projects; it is app level now
    for (const old of [path.join(oldRoot, ".cache"), path.join(oldRoot, "cache")]) {
      try {
        await fs.access(path.join(old, "sites"));
        await fs.cp(old, cacheDir(), { recursive: true, force: false, errorOnExist: false });
        await fs.rm(old, { recursive: true, force: true });
      } catch { /* nothing to move */ }
    }

    // index anything sitting in the old root that we do not know about yet
    for (const entry of await fs.readdir(oldRoot, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = path.join(oldRoot, entry.name);
      try {
        const p = JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf8"));
        if (p.id && !cfg.projects[p.id]) cfg.projects[p.id] = dir;
      } catch { /* not a project folder */ }
    }

    // files/ became sources/
    for (const dir of Object.values(cfg.projects)) {
      const files = path.join(dir, "files"), sources = path.join(dir, "sources");
      try {
        await fs.access(files);
        await fs.access(sources).then(() => null).catch(() => fs.rename(files, sources));
      } catch { /* nothing to move */ }
    }
  }

  return { load, get, appDir: () => APP, cacheDir, dirOf, fileOf, sourcesOf, listDirs, register, forget, moveProject };
}
