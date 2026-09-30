// Exporting beats: the studio window renders each beat, this process photographs it, and
// ffmpeg or Chromium's PDF printer turns the pictures into the file.
//
// The window is rendered at the output's resolution rather than photographed at the screen's
// and enlarged. Emulating a higher device pixel ratio is not enough: it does not reach the
// article frames, which live in other processes, and they came out soft. Page zoom does reach
// them — Chromium hands a zoom to every frame as a pixel ratio of its own — so the viewport
// is made the output's size in pixels and zoomed until its layout is the size of the screen
// the beats were built on. Everything, article frames included, is then drawn at full size.
import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { videoGraph, encoderArgs, parseProbe, progressSeconds, cropBox, outputSize, takeGraph, uniqueFile } from "./export-video.js";
import { beatsPdfHtml, PAGE } from "./export-pdf.js";

const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v"]);

const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

export function wireExport(getWin) {
  /** The pictures of the current export, and how the window was set before it started. */
  let job = null;
  let encoder = null;
  const outputs = new Set();

  const studio = (event) => {
    const win = getWin();
    if (!win || win.isDestroyed() || event.sender !== win.webContents) throw new Error("Exporting is only available in Studio");
    return win;
  };

  /** Render the window at `css` layout size, `zoom` times over; `null` puts it back. */
  async function render(win, css, zoom, restoreZoom) {
    const dbg = win.webContents.debugger;
    if (!css) {
      if (dbg.isAttached()) {
        try { await dbg.sendCommand("Emulation.clearDeviceMetricsOverride"); } catch { /* window going */ }
        try { dbg.detach(); } catch { /* already */ }
      }
      win.webContents.setZoomFactor(restoreZoom ?? 1);
      return;
    }
    if (!dbg.isAttached()) dbg.attach("1.3");
    // Pixels are pixels: a ratio of 1 whatever the display, so the zoom alone decides the output.
    await dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: Math.round(css.width * zoom), height: Math.round(css.height * zoom), deviceScaleFactor: 1, mobile: false,
    });
    win.webContents.setZoomFactor(zoom);
  }

  const dropJob = () => {
    if (job?.dir) fs.rm(job.dir, { recursive: true, force: true }, () => {});
    job = null;
  };
  app.on("before-quit", dropJob);
  // Pictures from an export the app did not live to finish — a crash, a forced quit. Only old
  // ones: a copy run from source beside the installed app shares this folder, and may be busy.
  try {
    const temp = app.getPath("temp");
    for (const name of fs.readdirSync(temp).filter((n) => n.startsWith("content-studio-export-"))) {
      const dir = path.join(temp, name);
      if (Date.now() - fs.statSync(dir).mtimeMs > 6 * 3600 * 1000) fs.rm(dir, { recursive: true, force: true }, () => {});
    }
  } catch { /* tidying up must never stop the app starting */ }

  const progress = (win, phase, fraction) => {
    if (win.isDestroyed()) return;
    win.setProgressBar(fraction == null ? -1 : Math.min(1, Math.max(0, fraction)));
    win.webContents.send("export:progress", { phase, fraction });
  };

  // Framing a vertical export: the screen laid out exactly as it will be exported, at 1:1.
  ipcMain.handle("export:view", async (event, css) => {
    const win = studio(event);
    if (!css) {
      await render(win, null, 0, job?.restoreZoom ?? 1);
      return;
    }
    if (!job?.framing) job = { framing: true, restoreZoom: win.webContents.getZoomFactor() };
    await render(win, css, 1);
  });

  ipcMain.handle("export:begin", async (event, { css, zoom }) => {
    const win = studio(event);
    if (encoder) throw new Error("An export is still being written. Wait for it, or cancel it.");
    const restoreZoom = job?.framing ? job.restoreZoom : win.webContents.getZoomFactor();
    dropJob();
    const safeZoom = Math.min(5, Math.max(1, Number(zoom) || 1));
    const dir = fs.mkdtempSync(path.join(app.getPath("temp"), "content-studio-export-"));
    job = { dir, zoom: safeZoom, restoreZoom, pictures: [] };
    await render(win, { width: Math.round(css.width), height: Math.round(css.height) }, safeZoom);
    return { zoom: safeZoom };
  });

  ipcMain.handle("export:frame", async (event, index) => {
    const win = studio(event);
    if (!job?.dir) throw new Error("The export has not started");
    const shot = await win.webContents.debugger.sendCommand("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const buf = Buffer.from(shot.data, "base64");
    const file = path.join(job.dir, `beat-${String(index + 1).padStart(3, "0")}.png`);
    fs.writeFileSync(file, buf);
    job.pictures[index] = { file, ...pngSize(buf) };
    return job.pictures[index];
  });

  ipcMain.handle("export:end", async (event) => {
    const win = studio(event);
    await render(win, null, 0, job?.restoreZoom ?? 1);
    if (job) job.framing = false;
    progress(win, "idle", null);
  });

  /** Where a video source's file is, refusing anything outside the project's sources folder. */
  const videoFile = (projectDir, name) => {
    const folder = path.resolve(String(projectDir || ""), "sources");
    const file = path.resolve(folder, String(name || ""));
    if (!file.startsWith(folder + path.sep) || !VIDEO_EXTS.has(path.extname(file).toLowerCase()) || !fs.existsSync(file)) {
      throw new Error(`The video ${name} is not in this project's sources folder any more.`);
    }
    return file;
  };
  /** A beat's own recording: its voice or its take, kept in the project's recordings folder. */
  const recordingFile = (projectDir, name) => {
    const folder = path.resolve(String(projectDir || ""), "recordings");
    const file = path.resolve(folder, String(name || ""));
    if (!file.startsWith(folder + path.sep) || !fs.existsSync(file)) {
      throw new Error(`The recording ${name} is not in this project's recordings folder any more.`);
    }
    return file;
  };
  const probe = (file) => parseProbe(spawnSync(ffmpegPath, ["-hide_banner", "-i", file], { encoding: "utf8", windowsHide: true }).stderr || "");

  ipcMain.handle("export:probe", (event, { projectDir, names }) => {
    studio(event);
    return Object.fromEntries((names ?? []).map((name) => {
      try { return [name, probe(videoFile(projectDir, name))]; } catch { return [name, { duration: null, audio: false }]; }
    }));
  });

  const prepareFolder = (folder) => {
    const dir = path.resolve(String(folder || ""));
    if (!path.isAbsolute(String(folder || ""))) throw new Error("Choose a folder to export to.");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  ipcMain.handle("export:video", async (event, plan) => {
    const win = studio(event);
    if (!job?.pictures?.length) throw new Error("There are no captured beats to export.");
    if (encoder) throw new Error("An export is already being written.");
    const out = { ...outputSize(plan.shape, plan.quality), fps: plan.fps === 60 ? 60 : 30 };
    const beats = plan.beats.map((beat, i) => {
      const picture = job.pictures[i];
      if (!picture) throw new Error(`Beat ${i + 1} was not captured.`);
      // A recorded take replaces the picture: it is the beat, played as it was recorded.
      const takeFile = beat.take ? recordingFile(plan.projectDir, beat.take.name) : null;
      const takeInfo = takeFile ? probe(takeFile) : null;
      const base = takeInfo?.width ? { width: takeInfo.width, height: takeInfo.height } : picture;
      return {
        still: picture.file, width: base.width, height: base.height,
        seconds: Math.min(3600, Math.max(0.5, Number(beat.seconds) || 5)),
        transition: beat.transition || "cut",
        crop: plan.shape === "vertical" ? cropBox(beat.frame, base) : undefined,
        take: takeFile ? {
          file: takeFile, lead: Math.max(0, Number(beat.take.lead) || 0),
          sound: !beat.take.muted && beat.take.clean ? recordingFile(plan.projectDir, beat.take.clean) : null,
          framing: beat.take.framing === "fill" ? "fill" : "fit",
        } : undefined,
        voice: beat.voice ? { file: recordingFile(plan.projectDir, beat.voice.name), delay: Math.max(0, Number(beat.voice.delay) || 0) } : undefined,
        videos: takeFile ? [] : (beat.videos ?? []).map((video) => {
          const file = videoFile(plan.projectDir, video.name);
          return {
            file, start: Math.max(0, Number(video.start) || 0), audio: probe(file).audio,
            // The page reported layout pixels; the picture is `zoom` times larger.
            x: video.rect.x * job.zoom, y: video.rect.y * job.zoom, w: video.rect.w * job.zoom, h: video.rect.h * job.zoom,
          };
        }),
      };
    });
    const { inputs, graph, total } = videoGraph(beats, out, Math.max(0, Number(plan.transitionSeconds) || 0));
    const folder = prepareFolder(plan.folder);
    const file = uniqueFile(folder, plan.name, ".mp4");
    const part = `${file}.part`;
    const script = path.join(job.dir, "graph.txt");
    fs.writeFileSync(script, graph);
    const args = ["-hide_banner", "-nostats", "-y", ...inputs, "-filter_complex_script", script, ...encoderArgs(out), "-f", "mp4", "-progress", "pipe:1", part];

    progress(win, "encode", 0);
    const result = await new Promise((resolve) => {
      let log = "";
      encoder = spawn(ffmpegPath, args, { windowsHide: true });
      encoder.stdout.on("data", (chunk) => {
        const seconds = progressSeconds(chunk);
        if (seconds != null) progress(win, "encode", total ? seconds / total : 0);
      });
      encoder.stderr.on("data", (chunk) => { log = (log + chunk).slice(-6000); });
      encoder.on("error", (e) => resolve({ error: e.message }));
      encoder.on("close", (code, signal) => resolve(code === 0 ? { ok: true } : { error: signal || encoder?.cancelled ? "cancelled" : log.trim().split("\n").slice(-6).join("\n") || `ffmpeg stopped (${code})` }));
    });
    encoder = null;
    progress(win, "idle", null);
    // The pictures are only good for this one run: a new export captures its beats again.
    dropJob();
    if (!result.ok) {
      // Only the partial file this export was writing, never anything that was already there.
      fs.rm(part, { force: true }, () => {});
      if (result.error === "cancelled") return { cancelled: true };
      throw new Error(`The video could not be written: ${result.error}`);
    }
    fs.renameSync(part, file);
    outputs.add(file);
    return { file, seconds: total };
  });

  ipcMain.handle("export:pdf", async (event, plan) => {
    const win = studio(event);
    if (!job?.pictures?.length) throw new Error("There are no captured beats to export.");
    const out = outputSize(plan.shape, plan.quality);
    progress(win, "pdf", 0);
    const pages = plan.beats.map((beat, i) => {
      const picture = job.pictures[i];
      if (!picture) throw new Error(`Beat ${i + 1} was not captured.`);
      let image = nativeImage.createFromPath(picture.file);
      if (plan.shape === "vertical") {
        const c = cropBox(beat.frame, picture);
        image = image.crop({ x: c.x, y: c.y, width: c.w, height: c.h });
      }
      image = image.resize({ width: out.width, height: out.height, quality: "best" });
      const name = `page-${String(i + 1).padStart(3, "0")}.jpg`;
      fs.writeFileSync(path.join(job.dir, name), image.toJPEG(92));
      progress(win, "pdf", (i + 1) / (plan.beats.length + 1));
      return name;
    });
    const html = path.join(job.dir, "beats.html");
    fs.writeFileSync(html, beatsPdfHtml(plan.title || "Beats", pages, plan.shape));
    const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
    try {
      await page.loadFile(html);
      const size = PAGE[plan.shape] ?? PAGE.landscape;
      const pdf = await page.webContents.printToPDF({
        printBackground: true, preferCSSPageSize: true, pageSize: { width: size.width, height: size.height },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      const file = uniqueFile(prepareFolder(plan.folder), plan.name, ".pdf");
      fs.writeFileSync(file, pdf);
      outputs.add(file);
      return { file, pages: pages.length };
    } finally {
      page.destroy();
      dropJob();
      progress(win, "idle", null);
    }
  });

  // One take on its own, with its sound: the picture file a take keeps has none, because the
  // sound is made from the original separately so it can be cleaned again.
  let takeWriting = false;
  ipcMain.handle("export:take", async (event, options) => {
    studio(event);
    if (takeWriting) throw new Error("A take is already being written.");
    const video = recordingFile(options.projectDir, options.video);
    const sound = options.clean ? recordingFile(options.projectDir, options.clean) : null;
    const seconds = Math.min(3600, Math.max(0.1, Number(options.seconds) || 0));
    const out = { ...outputSize("landscape", Number(options.quality) || 1080), fps: 30 };
    const framing = options.framing === "fill" ? "fill" : "fit";
    const { inputs, graph } = takeGraph({ video, sound, lead: Math.max(0, Number(options.lead) || 0), seconds, out, framing });
    const file = uniqueFile(prepareFolder(options.folder), options.name || "take", ".mp4");
    const part = `${file}.part`;
    takeWriting = true;
    try {
      const result = await new Promise((resolve) => {
        let log = "";
        const child = spawn(ffmpegPath, ["-hide_banner", "-nostats", "-y", ...inputs, "-filter_complex", graph, ...encoderArgs(out), "-f", "mp4", part], { windowsHide: true });
        child.stderr.on("data", (chunk) => { log = (log + chunk).slice(-6000); });
        child.on("error", (e) => resolve({ error: e.message }));
        child.on("close", (code) => resolve(code === 0 ? { ok: true } : { error: log.trim().split("\n").slice(-4).join("\n") || `ffmpeg stopped (${code})` }));
      });
      if (!result.ok) {
        fs.rm(part, { force: true }, () => {});
        throw new Error(result.error);
      }
      fs.renameSync(part, file);
      outputs.add(file);
      return { file };
    } finally {
      takeWriting = false;
    }
  });

  ipcMain.handle("export:cancel", (event) => {
    studio(event);
    if (encoder) { encoder.cancelled = true; encoder.kill(); }
  });

  // Only files this session wrote can be shown, so the page cannot open arbitrary folders.
  ipcMain.handle("export:reveal", (event, file) => {
    studio(event);
    if (outputs.has(file)) shell.showItemInFolder(file);
  });
}
