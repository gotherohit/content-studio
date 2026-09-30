import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { cropBox, encoderArgs, outputSize, parseProbe, progressSeconds, uniqueFile, videoGraph } from "../electron/export-video.js";
import { beatsPdfHtml, PAGE } from "../electron/export-pdf.js";

const still = (name, extra = {}) => ({ still: name, width: 1920, height: 1080, seconds: 2, transition: "cut", videos: [], ...extra });
const out = { width: 1920, height: 1080, fps: 30 };

test("a vertical crop is 9:16, even-sized, and inside the picture", () => {
  const c = cropBox({ x: 0.4, y: 0, h: 1 }, { width: 3413, height: 1920 });
  assert.equal(c.h, 1920);
  assert.equal(c.w, 1080);
  assert.equal(c.x % 2, 0);
  assert.ok(c.x + c.w <= 3413);
  const edge = cropBox({ x: 0.99, y: 0.9, h: 0.5 }, { width: 1920, height: 1080 });
  assert.ok(edge.x + edge.w <= 1920 && edge.y + edge.h <= 1080);
  assert.equal(edge.h, 540);
});

// A 1584 × 891 layout zoomed 3.25 times was captured at 5146 × 2895; rounding the height up
// to 2896 asked ffmpeg for a crop at y = -1, and the vertical export failed.
test("a crop of an odd-sized capture is rounded inwards, never past its edges", () => {
  for (const picture of [{ width: 5146, height: 2895 }, { width: 1921, height: 1081 }, { width: 3413, height: 1919 }]) {
    for (const frame of [{ x: 0, y: 0, h: 1 }, { x: 0.99, y: 0, h: 1 }, { x: 0.5, y: 0.99, h: 0.4 }, { x: 0.089, y: 0.135, h: 0.663 }]) {
      const c = cropBox(frame, picture);
      assert.ok(c.x >= 0 && c.y >= 0, JSON.stringify({ picture, frame, c }));
      assert.ok(c.x + c.w <= picture.width && c.y + c.h <= picture.height, JSON.stringify({ picture, frame, c }));
      assert.ok(c.w % 2 === 0 && c.h % 2 === 0 && c.x % 2 === 0 && c.y % 2 === 0);
    }
  }
});

test("a still is read once and held for its length, with silence under it", () => {
  const { inputs, graph, total } = videoGraph([still("a.png", { seconds: 2.5 })], out, 0.6);
  assert.deepEqual(inputs, ["-i", "a.png"]);
  assert.match(graph, /\[0:v\]loop=loop=74:size=1:start=0/);
  assert.match(graph, /anullsrc=r=48000:cl=stereo,atrim=duration=2\.5/);
  assert.match(graph, /\[v0\]null\[vout\]/);
  assert.equal(total, 2.5);
});

test("beats are cut together, or overlapped by the transition into them", () => {
  const { graph, total } = videoGraph([still("a.png", { seconds: 3 }), still("b.png", { seconds: 3, transition: "fade" }), still("c.png", { seconds: 2, transition: "cut" })], out, 1);
  assert.match(graph, /\[v0\]\[v1\]xfade=transition=fade:duration=1:offset=2\[vj1\]/);
  assert.match(graph, /\[a0\]\[a1\]acrossfade=d=1\[aj1\]/);
  assert.match(graph, /\[vj1\]\[v2\]concat=n=2:v=1:a=0/);
  assert.match(graph, /\[aj1\]\[a2\]concat=n=2:v=0:a=1/);
  assert.equal(total, 7);
});

test("a video plays over its own place in the picture, from the second it was captured at, with its sound", () => {
  const clip = { file: "clip.mp4", start: 3.25, x: 100.4, y: 50, w: 641, h: 361, audio: true };
  const quiet = { file: "b.webm", start: 0, x: 900, y: 50, w: 320, h: 180, audio: false };
  const { inputs, graph } = videoGraph([still("a.png", { seconds: 4, videos: [clip, quiet] })], out, 0);
  assert.deepEqual(inputs, ["-i", "a.png", "-ss", "3.25", "-t", "4", "-i", "clip.mp4", "-ss", "0", "-t", "4", "-i", "b.webm"]);
  assert.match(graph, /\[1:v\]setpts=PTS-STARTPTS,fps=30,scale=642:362/);
  assert.match(graph, /overlay=x=100:y=50:eof_action=repeat/);
  assert.match(graph, /\[1:a\]asetpts/);
  assert.doesNotMatch(graph, /\[2:a\]/);
  assert.match(graph, /apad=whole_dur=4,atrim=duration=4/);
});

test("two videos with sound on one beat are both heard", () => {
  const a = { file: "a.mp4", start: 0, x: 0, y: 0, w: 100, h: 100, audio: true };
  const { graph } = videoGraph([still("s.png", { videos: [a, { ...a, file: "b.mp4" }] })], out, 0);
  assert.match(graph, /\[s0_0\]\[s0_1\]amix=inputs=2:normalize=0/);
});

test("a vertical export crops each beat to its frame before scaling", () => {
  const crop = cropBox({ x: 0.5, y: 0, h: 1 }, { width: 1920, height: 1080 });
  const { graph } = videoGraph([still("a.png", { crop })], { width: 1080, height: 1920, fps: 30 }, 0);
  assert.match(graph, new RegExp(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=1080:1920`));
});

test("the encoder makes what YouTube asks for", () => {
  const args = encoderArgs(out).join(" ");
  for (const want of ["-c:v libx264", "-profile:v high", "-pix_fmt yuv420p", "-colorspace bt709", "-c:a aac", "-ar 48000", "-movflags +faststart"]) {
    assert.ok(args.includes(want), want);
  }
  assert.ok(encoderArgs({ width: 3840, height: 2160, fps: 60 }).includes("medium"));
  assert.deepEqual(outputSize("vertical", 1440), { width: 1440, height: 2560 });
});

test("ffmpeg's report is read for length, sound and progress", () => {
  const text = "Input #0, mov,mp4\n  Duration: 00:01:02.50, start: 0.000000\n  Stream #0:0[0x1](und): Video: h264\n  Stream #0:1[0x2](eng): Audio: aac (LC)";
  assert.deepEqual(parseProbe(text), { duration: 62.5, audio: true });
  assert.deepEqual(parseProbe("Duration: 00:00:05.00\n Stream #0:0: Video: vp9"), { duration: 5, audio: false });
  assert.equal(progressSeconds("frame=10\nout_time_us=1500000\nout_time_us=2500000\n"), 2.5);
  assert.equal(progressSeconds("progress=continue\n"), null);
});

test("an export never replaces a file that is already there", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-export-"));
  try {
    assert.equal(uniqueFile(dir, 'My: "video"?', ".mp4"), path.join(dir, "My- -video--.mp4"));
    fs.writeFileSync(path.join(dir, "Talk.mp4"), "");
    assert.equal(uniqueFile(dir, "Talk", ".mp4"), path.join(dir, "Talk (2).mp4"));
    assert.equal(uniqueFile(dir, "", ".pdf"), path.join(dir, "beats.pdf"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a beats PDF has one full-bleed page per beat, and its text stays inert", () => {
  const html = beatsPdfHtml('Talk <script>alert("x")</script>', ["page-001.jpg", "page 002.jpg"], "vertical");
  assert.match(html, /@page\{size:7\.5in 13\.333in;margin:0\}/);
  assert.equal((html.match(/<img /g) ?? []).length, 2);
  assert.match(html, /src="page%20002\.jpg"/);
  assert.doesNotMatch(html, /<script>/);
  assert.deepEqual(PAGE.landscape, { width: 13.333, height: 7.5 });
});

// The graph is only worth anything if ffmpeg accepts it: encode a tiny real one.
test("ffmpeg accepts the graph and writes a video of the promised length", { skip: !ffmpegPath || !fs.existsSync(ffmpegPath) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-export-"));
  try {
    const run = (args) => spawnSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
    run(["-f", "lavfi", "-i", "color=c=red:s=320x180", "-frames:v", "1", path.join(dir, "a.png")]);
    run(["-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", path.join(dir, "b.png")]);
    run(["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=3", "-f", "lavfi", "-i", "sine=duration=3", "-shortest", "-pix_fmt", "yuv420p", path.join(dir, "clip.mp4")]);
    const small = { width: 320, height: 180, fps: 30 };
    const clip = { file: path.join(dir, "clip.mp4"), start: 1, x: 20, y: 20, w: 160, h: 90, audio: true };
    const beats = [
      { still: path.join(dir, "a.png"), width: 320, height: 180, seconds: 1, transition: "cut", videos: [clip] },
      { still: path.join(dir, "b.png"), width: 320, height: 180, seconds: 1, transition: "fade", videos: [] },
      { still: path.join(dir, "a.png"), width: 320, height: 180, seconds: 0.5, transition: "cut", videos: [] },
    ];
    const { inputs, graph, total } = videoGraph(beats, small, 0.4);
    fs.writeFileSync(path.join(dir, "graph.txt"), graph);
    const file = path.join(dir, "out.mp4");
    const r = run([...inputs, "-filter_complex_script", path.join(dir, "graph.txt"), ...encoderArgs(small), file]);
    assert.equal(r.status, 0, r.stderr);
    const info = spawnSync(ffmpegPath, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr;
    const probed = parseProbe(info);
    assert.ok(Math.abs(probed.duration - total) < 0.1, `${probed.duration} vs ${total}`);
    assert.equal(probed.audio, true);
    assert.match(info, /Video: h264 \(High\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
