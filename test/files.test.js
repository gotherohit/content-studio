import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { RECYCLE_SCRIPT, createEntry, deleteEntry, listDir, readText, renameEntry, resolveInside, statFile, writeText } from "../server/files.js";

async function folder(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cs-files-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "cs-outside-"));
  t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "train.py"), "import torch\r\nprint('hi')\r\n");
  await fs.writeFile(path.join(root, "README.md"), "\uFEFF# Demo\n");
  await fs.writeFile(path.join(root, "model.bin"), Buffer.from([1, 0, 2, 0]));
  await fs.writeFile(path.join(outside, "secret.txt"), "keep out");
  return { root, outside };
}
const read = (...p) => fs.readFile(path.join(...p), "utf8");
const exists = (...p) => fs.access(path.join(...p)).then(() => true, () => false);

async function linkOut(t, root, outside) {
  try { await fs.symlink(outside, path.join(root, "escape"), "junction"); return true; } catch { t.skip("cannot create links here"); return false; }
}

test("paths cannot leave the chosen folder, by .. or by an absolute path", async (t) => {
  const { root, outside } = await folder(t);
  await assert.rejects(resolveInside(root, "../" + path.basename(outside) + "/secret.txt"), { status: 400 });
  await assert.rejects(resolveInside(root, path.join(outside, "secret.txt")), { status: 400 });
  await assert.rejects(resolveInside("relative/folder", "x"), { status: 400 });
  assert.equal(await resolveInside(root, "src/train.py"), await fs.realpath(path.join(root, "src", "train.py")));
});

test("a link inside the folder that points outside it is refused", async (t) => {
  const { root, outside } = await folder(t);
  if (!(await linkOut(t, root, outside))) return;
  await assert.rejects(readText(root, "escape/secret.txt"), { status: 400 });
});

test("folders list first, and a file reads with its line endings and byte-order mark noted", async (t) => {
  const { root } = await folder(t);
  const { items } = await listDir(root, "");
  assert.deepEqual(items.map((i) => `${i.dir ? "d" : "f"}:${i.path}`), ["d:src", "f:model.bin", "f:README.md"]);
  assert.deepEqual((await listDir(root, "src")).items.map((i) => i.path), ["src/train.py"]);
  const py = await readText(root, "src/train.py");
  assert.equal(py.content, "import torch\nprint('hi')\n");
  assert.equal(py.eol, "\r\n");
  const md = await readText(root, "README.md");
  assert.equal(md.content, "# Demo\n");
  assert.equal(md.bom, true);
  await assert.rejects(readText(root, "model.bin"), { status: 415, message: /binary/ });
});

test("a file of several megabytes opens and saves", async (t) => {
  const { root } = await folder(t);
  const big = "x".repeat(99) + "\n";
  await fs.writeFile(path.join(root, "big.log"), big.repeat(40000));
  const text = await readText(root, "big.log");
  assert.equal(text.content.length, 4_000_000);
  await writeText(root, "big.log", { content: text.content + "end\n", mtime: text.mtime });
  assert.equal((await fs.stat(path.join(root, "big.log"))).size, 4_000_004);
});

test("saving keeps the file's own line endings and byte-order mark", async (t) => {
  const { root } = await folder(t);
  const py = await readText(root, "src/train.py");
  await writeText(root, "src/train.py", { content: "import torch\nprint('bye')\n", mtime: py.mtime, eol: py.eol, bom: py.bom });
  assert.equal(await read(root, "src", "train.py"), "import torch\r\nprint('bye')\r\n");
  const md = await readText(root, "README.md");
  await writeText(root, "README.md", { content: "# Changed\n", mtime: md.mtime, eol: md.eol, bom: md.bom });
  assert.equal(await read(root, "README.md"), "\uFEFF# Changed\n");
  assert.deepEqual(await fs.readdir(path.join(root, "src")), ["train.py"]);
});

test("a file changed on disk since it was opened is not overwritten", async (t) => {
  const { root } = await folder(t);
  const opened = await readText(root, "src/train.py");
  await new Promise((r) => setTimeout(r, 20));
  await fs.writeFile(path.join(root, "src", "train.py"), "someone else's edit\n");
  await assert.rejects(writeText(root, "src/train.py", { content: "mine\n", mtime: opened.mtime }), { status: 409 });
  assert.equal(await read(root, "src", "train.py"), "someone else's edit\n");
  const now = await statFile(root, "src/train.py");
  await writeText(root, "src/train.py", { content: "mine\n", mtime: now.mtime });
  assert.equal(await read(root, "src", "train.py"), "mine\n");
});

test("a save never creates a file", async (t) => {
  const { root } = await folder(t);
  await assert.rejects(writeText(root, "new.txt", { content: "x", mtime: 0 }), { status: 404 });
  assert.equal(await exists(root, "new.txt"), false);
});

test("new files and folders are made, with folders on the way, and never replace anything", async (t) => {
  const { root } = await folder(t);
  assert.deepEqual(await createEntry(root, "notes.md"), { path: "notes.md", dir: false });
  assert.equal(await read(root, "notes.md"), "");
  assert.deepEqual(await createEntry(root, "lib/helpers/util.py"), { path: "lib/helpers/util.py", dir: false });
  assert.equal(await exists(root, "lib", "helpers", "util.py"), true);
  assert.deepEqual(await createEntry(root, "data", { dir: true }), { path: "data", dir: true });
  assert.equal((await fs.stat(path.join(root, "data"))).isDirectory(), true);
  await assert.rejects(createEntry(root, "src/train.py"), { status: 409 });
  assert.equal(await read(root, "src", "train.py"), "import torch\r\nprint('hi')\r\n");
  await assert.rejects(createEntry(root, "src", { dir: true }), { status: 409 });
});

test("names Windows cannot hold, and paths outside the folder, are refused before anything is made", async (t) => {
  const { root, outside } = await folder(t);
  for (const bad of ["a:b.py", "what?.md", "trailing.", "con.txt", "src/../../x.py", "", "  "]) {
    await assert.rejects(createEntry(root, bad), { status: 400 }, bad);
  }
  await assert.rejects(createEntry(root, path.join(outside, "planted.txt")), { status: 400 });
  assert.equal(await exists(outside, "planted.txt"), false);
  if (!(await linkOut(t, root, outside))) return;
  await assert.rejects(createEntry(root, "escape/planted.txt"), { status: 400 });
  assert.equal(await exists(outside, "planted.txt"), false);
});

test("renaming and moving, but never onto something that exists", async (t) => {
  const { root } = await folder(t);
  assert.deepEqual(await renameEntry(root, "README.md", "GUIDE.md"), { from: "README.md", path: "GUIDE.md" });
  assert.equal(await read(root, "GUIDE.md"), "\uFEFF# Demo\n");
  assert.deepEqual(await renameEntry(root, "src/train.py", "src/models/train.py"), { from: "src/train.py", path: "src/models/train.py" });
  assert.equal(await exists(root, "src", "models", "train.py"), true);
  await fs.writeFile(path.join(root, "other.md"), "other");
  await assert.rejects(renameEntry(root, "GUIDE.md", "other.md"), { status: 409 });
  assert.equal(await read(root, "other.md"), "other");
  assert.equal(await read(root, "GUIDE.md"), "\uFEFF# Demo\n");
  // Only the case changes: the same name to Windows, so allowed.
  assert.equal((await renameEntry(root, "GUIDE.md", "guide.md")).path, "guide.md");
  assert.ok((await fs.readdir(root)).includes("guide.md"));
});

test("a folder renames with its contents, but not into itself, and the root stays put", async (t) => {
  const { root, outside } = await folder(t);
  await renameEntry(root, "src", "code");
  assert.equal(await exists(root, "code", "train.py"), true);
  await assert.rejects(renameEntry(root, "code", "code/inner"), { status: 400 });
  await assert.rejects(renameEntry(root, "", "moved"), { status: 400 });
  await assert.rejects(renameEntry(root, "code/train.py", path.join(outside, "train.py")), { status: 400 });
  await assert.rejects(renameEntry(root, "missing.py", "found.py"), { status: 404 });
});

test("delete hands the real path to the Recycle Bin and never the folder itself", async (t) => {
  const { root, outside } = await folder(t);
  const sent = [];
  const trash = async (file) => { sent.push(file); await fs.rm(file, { recursive: true }); };
  assert.deepEqual(await deleteEntry(root, "src/train.py", { trash }), { path: "src/train.py" });
  assert.deepEqual(sent, [await fs.realpath(path.join(root, "src")) + path.sep + "train.py"]);
  await deleteEntry(root, "src", { trash });
  assert.equal(await exists(root, "src"), false);
  await assert.rejects(deleteEntry(root, "", { trash }), { status: 400 });
  await assert.rejects(deleteEntry(root, path.join(outside, "secret.txt"), { trash }), { status: 400 });
  assert.equal(await exists(outside, "secret.txt"), true);
  // A bin that fails to take it must not be reported as a delete.
  await assert.rejects(deleteEntry(root, "README.md", { trash: async () => {} }), { status: 500, message: /still there/ });
});

test("the Recycle Bin command is valid PowerShell", { skip: process.platform !== "win32" }, () => {
  // Parsed, never run: running it would put a file in the real Recycle Bin on every test run.
  const check = "$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:CS_SCRIPT, [ref]$null, [ref]$e); $e.Count";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", check], { env: { ...process.env, CS_SCRIPT: RECYCLE_SCRIPT }, encoding: "utf8" });
  assert.equal(r.stdout.trim(), "0", r.stderr);
});
