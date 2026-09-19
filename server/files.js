// The Files pane: browse a folder and edit its text files.
//
// A folder here can be anywhere the creator picks — a demo repo, the project itself — so
// every path is resolved inside the chosen root and checked again after symlinks are
// followed. Files are only ever read and overwritten, never created, renamed or deleted.
import fs from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 3000;

export class FilesError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** The real path of a file under `root`, or an error if it would leave it. */
export async function resolveInside(root, rel = "") {
  if (!root || !path.isAbsolute(root)) throw new FilesError(400, "Choose a folder with Browse");
  let realRoot;
  try { realRoot = await fs.realpath(root); } catch { throw new FilesError(404, `The folder ${root} no longer exists`); }
  const target = path.resolve(realRoot, rel || ".");
  const within = (p) => p === realRoot || p.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep);
  if (!within(target)) throw new FilesError(400, "That path is outside the chosen folder");
  let real;
  try { real = await fs.realpath(target); } catch { throw new FilesError(404, `${rel || "That file"} no longer exists`); }
  // A link inside the folder can still point outside it.
  if (!within(real)) throw new FilesError(400, "That path leads outside the chosen folder");
  return real;
}

export async function listDir(root, rel = "") {
  const dir = await resolveInside(root, rel);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const items = entries.slice(0, MAX_ENTRIES).map((e) => ({
    name: e.name,
    path: path.posix.join(...(rel ? rel.split(/[\\/]/) : []), e.name),
    dir: e.isDirectory(),
  }));
  items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : a.dir ? -1 : 1));
  return { items, truncated: entries.length > MAX_ENTRIES };
}

export async function statFile(root, rel) {
  const file = await resolveInside(root, rel);
  const st = await fs.stat(file);
  return { mtime: st.mtimeMs, size: st.size };
}

/**
 * Text only, with its line endings and byte-order mark reported so a save can put them
 * back: the editor works in "\n", and rewriting a CRLF file as LF would turn a one-line
 * edit into a change to every line.
 */
export async function readText(root, rel) {
  const file = await resolveInside(root, rel);
  const st = await fs.stat(file);
  if (st.isDirectory()) throw new FilesError(400, "That is a folder");
  if (st.size > MAX_BYTES) throw new FilesError(413, `${path.basename(file)} is larger than 2 MB — open it in another editor`);
  const buf = await fs.readFile(file);
  if (buf.subarray(0, 8000).includes(0)) throw new FilesError(415, `${path.basename(file)} is not a text file`);
  let text = buf.toString("utf8");
  const bom = text.startsWith("﻿");
  if (bom) text = text.slice(1);
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  return { content: text.replace(/\r\n/g, "\n"), mtime: st.mtimeMs, size: st.size, eol, bom };
}

/**
 * Overwrite a file the editor opened, refusing if it changed on disk since — another editor,
 * a git checkout, the AI pane. The write goes to a temporary file first, so a failure
 * part-way never leaves half a file behind.
 */
export async function writeText(root, rel, { content, mtime, eol = "\n", bom = false }) {
  const file = await resolveInside(root, rel);
  const st = await fs.stat(file);
  if (st.isDirectory()) throw new FilesError(400, "That is a folder");
  if (typeof content !== "string") throw new FilesError(400, "Nothing to save");
  if (Math.abs(st.mtimeMs - Number(mtime)) > 1) throw new FilesError(409, `${path.basename(file)} changed on disk since it was opened`);
  const body = (bom ? "﻿" : "") + (eol === "\r\n" ? content.replace(/\r?\n/g, "\r\n") : content);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temp, body, "utf8");
    await fs.rename(temp, file);
  } catch (e) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw new FilesError(500, `Could not save ${path.basename(file)}: ${e.code === "EBUSY" || e.code === "EPERM" ? "another program has it locked" : e.message}`);
  }
  return { mtime: (await fs.stat(file)).mtimeMs };
}
