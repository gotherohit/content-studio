// pdf.js loads character maps, standard fonts and its WASM decoders at runtime, by URL.
// Vite copies client/public verbatim, so put them there before dev or a build; the copy is
// generated, never committed.
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, "../node_modules/pdfjs-dist");
const to = resolve(here, "../public/pdfjs");

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(resolve(from, dir), resolve(to, dir), { recursive: true });
}
