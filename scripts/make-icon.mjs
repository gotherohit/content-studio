// Turns build/icon.svg into build/icon.ico (and icon.png) at every size Windows asks for.
//
//   node scripts/make-icon.mjs
//
// Rendering is done by the Chrome already on the machine, so the icon looks exactly like
// the mark in the app's own sidebar rather than an approximation of it.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const CHROME = [
  `${process.env.ProgramFiles}/Google/Chrome/Application/chrome.exe`,
  `${process.env["ProgramFiles(x86)"]}/Google/Chrome/Application/chrome.exe`,
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  `${process.env.ProgramFiles}/Microsoft/Edge/Application/msedge.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

async function findChrome() {
  for (const c of CHROME) {
    if (!c || c.includes("undefined")) continue;
    try { await fs.access(c); return c; } catch { /* next */ }
  }
  throw new Error("No Chrome or Edge found to render the icon with");
}

/** An .ico is a small directory followed by the images; modern ones may hold PNGs whole. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0); // 0 stands for 256
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);   // colour planes
    e.writeUInt16LE(32, 6);  // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const chrome = await findChrome();
const svg = await fs.readFile(path.join(ROOT, "build", "icon.svg"), "utf8");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cs-icon-"));
const images = [];

for (const size of SIZES) {
  const html = path.join(tmp, `${size}.html`);
  const png = path.join(tmp, `${size}.png`);
  await fs.writeFile(
    html,
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await run(chrome, [
    "--headless", "--disable-gpu", "--hide-scrollbars",
    "--default-background-color=00000000", "--force-device-scale-factor=1",
    `--window-size=${size},${size}`, `--screenshot=${png}`, `file:///${html.split("\\").join("/")}`,
  ]).catch(() => {}); // headless Chrome reports a non-zero exit even when it wrote the file
  images.push({ size, png: await fs.readFile(png) });
  if (size === 256) await fs.copyFile(png, path.join(ROOT, "build", "icon.png"));
}

await fs.writeFile(path.join(ROOT, "build", "icon.ico"), ico(images));
await fs.rm(tmp, { recursive: true, force: true });
console.log(`build/icon.ico written at ${SIZES.join(", ")}px`);
