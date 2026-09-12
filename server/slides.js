// Turning a slide deck into something a browser can show.
//
// PowerPoint itself is the only thing that renders .pptx faithfully, so when it is
// installed we drive it over COM to export every slide as a PNG. That keeps fonts,
// layout, charts and images exactly as designed. Build animations cannot survive a
// still image, so we also offer to open the real slideshow, which the Window pane
// can mirror and drive.
//
// Without PowerPoint we fall back to LibreOffice -> PDF, and failing that we say so.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, opts);
    let out = "";
    c.stdout?.on("data", (d) => (out += d));
    c.stderr?.on("data", (d) => (out += d));
    c.on("error", (e) => resolve({ ok: false, out: out + e.message }));
    c.on("close", (code) => resolve({ ok: code === 0, code, out }));
  });

/** Is PowerPoint automation available on this machine? */
export async function hasPowerPoint() {
  if (process.platform !== "win32") return false;
  const r = await run("powershell.exe", [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
    "try { $a = New-Object -ComObject PowerPoint.Application; $a.Quit(); 'yes' } catch { 'no' }",
  ]);
  return r.ok && /yes/.test(r.out);
}

const SOFFICE = ["soffice", "C:\\Program Files\\LibreOffice\\program\\soffice.exe", "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"];

export async function findSoffice() {
  for (const c of SOFFICE) {
    if (c.includes("\\")) { try { await fs.access(c); return c; } catch { continue; } }
    const r = await run(c, ["--version"]);
    if (r.ok) return c;
  }
  return null;
}

/**
 * Export every slide of a deck to PNG. Returns the slide image names in order.
 * Results are cached beside the deck so a second open is instant.
 */
export async function renderDeck(deckPath, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const existing = (await fs.readdir(outDir).catch(() => []))
    .filter((f) => /^slide\d+\.png$/i.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (existing.length) return { slides: existing, renderer: "cache" };

  if (await hasPowerPoint()) {
    // Export writes Slide1.png, Slide2.png … into the folder.
    // Exporting slide by slide is far more dependable than Presentation.Export,
    // which reports success while writing nothing.
    const ps = `
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try {
  $deck = $app.Presentations.Open('${deckPath.replace(/'/g, "''")}', $true, $false, $false)
  try {
    $w = [double]$deck.PageSetup.SlideWidth; $h = [double]$deck.PageSetup.SlideHeight
    $scale = [Math]::Min(1920.0 / $w, 1080.0 / $h)
    $pw = [int]($w * $scale); $ph = [int]($h * $scale)
    $i = 1
    foreach ($s in $deck.Slides) {
      $s.Export((Join-Path '${outDir.replace(/'/g, "''")}' ("slide{0}.png" -f $i)), 'PNG', $pw, $ph)
      $i++
    }
    Write-Output ("exported=" + ($i - 1))
  } finally { $deck.Close() }
} finally { $app.Quit() }
`;
    const r = await run("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
    const slides = (await fs.readdir(outDir).catch(() => []))
      .filter((f) => /^slide\d+\.png$/i.test(f))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (slides.length) return { slides, renderer: "powerpoint" };
    return { slides: [], renderer: "powerpoint", error: r.out.slice(-400) || "PowerPoint produced no slides" };
  }

  const soffice = await findSoffice();
  if (soffice) {
    const r = await run(soffice, ["--headless", "--convert-to", "pdf", "--outdir", outDir, deckPath]);
    const pdf = (await fs.readdir(outDir).catch(() => [])).find((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdf) return { slides: [], pdf, renderer: "libreoffice" };
    return { slides: [], renderer: "libreoffice", error: r.out.slice(-400) };
  }

  return { slides: [], renderer: "none" };
}

/** Open the real slideshow so animations and transitions play; mirror it with the Window pane. */
export async function openSlideshow(deckPath) {
  if (process.platform !== "win32") throw new Error("Opening a live slideshow needs Windows");
  const ps = `
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
$app.Visible = $true
$deck = $app.Presentations.Open('${deckPath.replace(/'/g, "''")}', $false, $false, $true)
$deck.SlideShowSettings.Run() | Out-Null
'started'
`;
  const r = await run("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]);
  if (!r.ok || !/started/.test(r.out)) throw new Error(r.out.slice(-300) || "Could not start the slideshow");
  return true;
}
