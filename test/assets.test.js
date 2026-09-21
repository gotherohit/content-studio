import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { removeAsset } from "../server/assets.js";

async function sourcesFolder(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cs-sources-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "slides.pdf"), "%PDF-1.4 scratch");
  return dir;
}
const exists = (...p) => fs.access(path.join(...p)).then(() => true, () => false);

// The real deletion goes to the Recycle Bin; a test that ran it would fill the real one.
const bin = (sent) => async (file) => { sent.push(file); await fs.rm(file, { recursive: true }); };

test("removing a source takes its file out of the project folder", async (t) => {
  const dir = await sourcesFolder(t);
  const sent = [];
  assert.deepEqual(await removeAsset(dir, "slides.pdf", { trash: bin(sent) }), { removed: true });
  assert.deepEqual(sent, [path.join(dir, "slides.pdf")], "and it goes to the Recycle Bin, not into thin air");
  // Left behind, the folder would hand it straight back as a source on the next open.
  assert.equal(await exists(dir, "slides.pdf"), false);
});

test("a file that has already gone is not an error", async (t) => {
  const dir = await sourcesFolder(t);
  const sent = [];
  assert.deepEqual(await removeAsset(dir, "never-there.md", { trash: bin(sent) }), { removed: false });
  assert.deepEqual(sent, []);
});

test("a file another program holds open is reported, never silently left", async (t) => {
  const dir = await sourcesFolder(t);
  await assert.rejects(removeAsset(dir, "slides.pdf", { trash: async () => {} }), /still there/);
  assert.equal(await exists(dir, "slides.pdf"), true);
});
