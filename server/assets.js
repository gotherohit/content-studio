// Files a creator adds to a project: slide decks, notebooks, PDFs, images, data,
// text. They live in the project's own sources/ folder, next to everything else the
// project owns, so the terminal, code snippets and Jupyter all see the same material.
import fs from "node:fs/promises";
import path from "node:path";
import { recycle } from "./files.js";

export const TYPES = {
  ".md": "text/markdown", ".markdown": "text/markdown", ".txt": "text/plain",
  ".ipynb": "application/json", ".json": "application/json",
  ".csv": "text/csv", ".tsv": "text/tab-separated-values",
  ".pdf": "application/pdf", ".html": "text/html", ".htm": "text/html",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".py": "text/plain", ".js": "text/plain", ".ts": "text/plain", ".sql": "text/plain",
  ".yaml": "text/plain", ".yml": "text/plain", ".sh": "text/plain", ".ps1": "text/plain",
};

export const DECK_EXTS = [".pptx", ".ppt", ".odp"];

/** How the client should display a file. */
export function viewerFor(ext) {
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if (ext === ".ipynb") return "notebook";
  if (ext === ".pdf") return "pdf";
  if (DECK_EXTS.includes(ext)) return "deck";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"].includes(ext)) return "image";
  if ([".mp4", ".webm"].includes(ext)) return "video";
  if ([".mp3", ".wav"].includes(ext)) return "audio";
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".csv", ".tsv"].includes(ext)) return "table";
  if ([".docx", ".xlsx"].includes(ext)) return "office";
  return "text";
}

/** Keep uploaded names safe inside the project folder. */
export function safeName(raw) {
  const base = path.basename(String(raw || "file")).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return base || "file";
}

export async function uniqueName(dir, name) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; ; i++) {
    try { await fs.access(path.join(dir, candidate)); } catch { return candidate; }
    candidate = `${stem}-${i}${ext}`;
  }
}

/**
 * Take a file out of a project's sources folder.
 *
 * The folder is the source of truth — anything in it is adopted as a source when the project
 * opens — so a source that is removed while its file stays behind simply comes back. It goes
 * to the Recycle Bin rather than being unlinked, because it is the creator's material.
 */
export async function removeAsset(dir, name, { trash = recycle } = {}) {
  const file = path.join(dir, name);
  try { await fs.access(file); } catch { return { removed: false }; }
  await trash(file);
  try { await fs.access(file); } catch { return { removed: true }; }
  throw new Error(`${name} is still there — another program may have it open`);
}
