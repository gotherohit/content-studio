// The Files pane: browse a folder, and read, save, create, rename and delete its files.
//
// A folder here can be anywhere the creator picks — a demo repo, the project itself — so
// every path is resolved inside the chosen root and checked again after symlinks are
// followed. Nothing is ever overwritten by a create or a rename, and a delete goes to the
// Recycle Bin, never straight off the disk.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

/** CodeMirror only draws what is on screen, so size is limited by memory, not by the editor. */
export const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 3000;

export class FilesError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function realRootOf(root) {
  if (!root || !path.isAbsolute(root)) throw new FilesError(400, "Choose a folder with Browse");
  try { return await fs.realpath(root); } catch { throw new FilesError(404, `The folder ${root} no longer exists`); }
}

const within = (realRoot, p) => p === realRoot || p.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep);
const sameFile = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** The real path of an existing file under `root`, or an error if it would leave it. */
export async function resolveInside(root, rel = "") {
  const realRoot = await realRootOf(root);
  const target = path.resolve(realRoot, rel || ".");
  if (!within(realRoot, target)) throw new FilesError(400, "That path is outside the chosen folder");
  let real;
  try { real = await fs.realpath(target); } catch { throw new FilesError(404, `${rel || "That file"} no longer exists`); }
  // A link inside the folder can still point outside it.
  if (!within(realRoot, real)) throw new FilesError(400, "That path leads outside the chosen folder");
  return real;
}

/**
 * A new name under `root`. The nearest folder that already exists is resolved through its
 * links, so a new file cannot be placed through a junction that leads elsewhere.
 */
async function resolveNew(root, rel) {
  const realRoot = await realRootOf(root);
  const clean = String(rel || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean) throw new FilesError(400, "Give it a name");
  for (const part of clean.split("/")) {
    if (part === "." || part === "..") throw new FilesError(400, "A name cannot contain . or .. as a folder");
    if (/[<>:"|?*\u0000-\u001f]/.test(part)) throw new FilesError(400, `“${part}” contains a character Windows does not allow in a name`);
    if (/[. ]$/.test(part)) throw new FilesError(400, `“${part}” ends with a dot or a space, which Windows does not allow`);
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(part)) throw new FilesError(400, `“${part}” is a name Windows reserves`);
  }
  const target = path.resolve(realRoot, clean);
  if (!within(realRoot, target)) throw new FilesError(400, "That path is outside the chosen folder");
  let existing = path.dirname(target);
  for (;;) {
    try { await fs.access(existing); break; } catch { existing = path.dirname(existing); }
  }
  const realExisting = await fs.realpath(existing);
  if (!within(realRoot, realExisting)) throw new FilesError(400, "That path leads outside the chosen folder");
  return { target: path.join(realExisting, path.relative(existing, target)), rel: clean, realRoot };
}

const relOf = (realRoot, file) => path.relative(realRoot, file).split(path.sep).join("/");

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
  if (st.size > MAX_BYTES) throw new FilesError(413, `${path.basename(file)} is ${Math.round(st.size / 1048576)} MB — larger than the 50 MB the Files pane opens`);
  const buf = await fs.readFile(file);
  // Saving a binary file as text would corrupt it, whatever its size.
  if (buf.subarray(0, 8000).includes(0)) throw new FilesError(415, `${path.basename(file)} is a binary file — open it in the program that made it`);
  let text = buf.toString("utf8");
  const bom = text.startsWith("\uFEFF");
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
  const body = (bom ? "\uFEFF" : "") + (eol === "\r\n" ? content.replace(/\r?\n/g, "\r\n") : content);
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

/** A new, empty file or folder. Folders on the way are made; an existing name is never replaced. */
export async function createEntry(root, rel, { dir = false } = {}) {
  const { target, realRoot } = await resolveNew(root, rel);
  try { await fs.access(target); throw new FilesError(409, `${relOf(realRoot, target)} already exists`); }
  catch (e) { if (e instanceof FilesError) throw e; }
  await fs.mkdir(dir ? target : path.dirname(target), { recursive: true });
  if (!dir) {
    // "wx" fails rather than truncating, should something appear in the meantime.
    try { await fs.writeFile(target, "", { flag: "wx" }); }
    catch (e) { throw new FilesError(e.code === "EEXIST" ? 409 : 500, e.code === "EEXIST" ? `${relOf(realRoot, target)} already exists` : e.message); }
  }
  return { path: relOf(realRoot, target), dir };
}

/**
 * Rename or move within the folder. Never onto something that exists — except the same file
 * with its case changed, which Windows treats as the same name.
 */
export async function renameEntry(root, from, to) {
  const source = await resolveInside(root, from);
  const { target, realRoot } = await resolveNew(root, to);
  if (source === realRoot) throw new FilesError(400, "The folder itself cannot be renamed here");
  if (within(source, target) && source !== target && !sameFile(source, target)) throw new FilesError(400, "A folder cannot be moved into itself");
  let exists = false;
  try { await fs.access(target); exists = true; } catch { /* free */ }
  if (exists && !sameFile(await fs.realpath(target), source)) throw new FilesError(409, `${relOf(realRoot, target)} already exists`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try { await fs.rename(source, target); }
  catch (e) { throw new FilesError(500, `Could not rename: ${e.code === "EBUSY" || e.code === "EPERM" ? "another program has it open" : e.message}`); }
  return { from: relOf(realRoot, source), path: relOf(realRoot, target) };
}

// The path travels in the environment, so no quoting of it can go wrong.
export const RECYCLE_SCRIPT = [
  "Add-Type -AssemblyName Microsoft.VisualBasic",
  "$p = $env:CS_RECYCLE_PATH",
  // One statement: joined with "; ", an else on its own is not valid PowerShell.
  "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
].join("; ");

/** Send a path to the Recycle Bin, so a misclick can be undone from there. */
export function recycle(file) {
  if (process.platform !== "win32") return Promise.reject(new FilesError(501, "Deleting is only supported on Windows, where it uses the Recycle Bin"));
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", RECYCLE_SCRIPT], { env: { ...process.env, CS_RECYCLE_PATH: file }, windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => reject(new FilesError(500, `Could not reach the Recycle Bin: ${e.message}`)));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new FilesError(500, `Could not move it to the Recycle Bin: ${err.trim().split("\n")[0] || `exit ${code}`}`))));
  });
}

export async function deleteEntry(root, rel, { trash = recycle } = {}) {
  const file = await resolveInside(root, rel);
  const realRoot = await realRootOf(root);
  if (file === realRoot) throw new FilesError(400, "The folder itself cannot be deleted here");
  await trash(file);
  try { await fs.access(file); throw new FilesError(500, `${path.basename(file)} is still there — another program may have it open`); }
  catch (e) { if (e instanceof FilesError) throw e; }
  return { path: relOf(realRoot, file) };
}
