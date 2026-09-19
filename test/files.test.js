import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listDir, readText, resolveInside, statFile, writeText } from "../server/files.js";

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

test("paths cannot leave the chosen folder, by .. or by an absolute path", async (t) => {
  const { root, outside } = await folder(t);
  await assert.rejects(resolveInside(root, "../" + path.basename(outside) + "/secret.txt"), { status: 400 });
  await assert.rejects(resolveInside(root, path.join(outside, "secret.txt")), { status: 400 });
  await assert.rejects(resolveInside("relative/folder", "x"), { status: 400 });
  assert.equal(await resolveInside(root, "src/train.py"), await fs.realpath(path.join(root, "src", "train.py")));
});

test("a link inside the folder that points outside it is refused", async (t) => {
  const { root, outside } = await folder(t);
  try { await fs.symlink(outside, path.join(root, "escape"), "junction"); } catch { t.skip("cannot create links here"); return; }
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
  await assert.rejects(readText(root, "model.bin"), { status: 415 });
});

test("saving keeps the file's own line endings and byte-order mark", async (t) => {
  const { root } = await folder(t);
  const py = await readText(root, "src/train.py");
  await writeText(root, "src/train.py", { content: "import torch\nprint('bye')\n", mtime: py.mtime, eol: py.eol, bom: py.bom });
  assert.equal(await fs.readFile(path.join(root, "src", "train.py"), "utf8"), "import torch\r\nprint('bye')\r\n");
  const md = await readText(root, "README.md");
  await writeText(root, "README.md", { content: "# Changed\n", mtime: md.mtime, eol: md.eol, bom: md.bom });
  assert.equal(await fs.readFile(path.join(root, "README.md"), "utf8"), "\uFEFF# Changed\n");
  assert.deepEqual((await fs.readdir(path.join(root, "src"))), ["train.py"]);
});

test("a file changed on disk since it was opened is not overwritten", async (t) => {
  const { root } = await folder(t);
  const opened = await readText(root, "src/train.py");
  await new Promise((r) => setTimeout(r, 20));
  await fs.writeFile(path.join(root, "src", "train.py"), "someone else's edit\n");
  await assert.rejects(writeText(root, "src/train.py", { content: "mine\n", mtime: opened.mtime }), { status: 409 });
  assert.equal(await fs.readFile(path.join(root, "src", "train.py"), "utf8"), "someone else's edit\n");
  const now = await statFile(root, "src/train.py");
  await writeText(root, "src/train.py", { content: "mine\n", mtime: now.mtime });
  assert.equal(await fs.readFile(path.join(root, "src", "train.py"), "utf8"), "mine\n");
});

test("files are never created by a save", async (t) => {
  const { root } = await folder(t);
  await assert.rejects(writeText(root, "new.txt", { content: "x", mtime: 0 }), { status: 404 });
  await assert.rejects(fs.access(path.join(root, "new.txt")));
});
