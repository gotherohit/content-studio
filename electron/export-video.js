// The ffmpeg side of exporting beats: what to run, and how to read what it says back.
//
// Everything here is pure, so the graph can be tested without encoding anything. One ffmpeg
// run makes the whole video: each beat is its captured picture, held for its length, with any
// video it shows played over the top where it sat on screen; the beats are then joined, cut
// to cut or through a transition. One run means one encode — no intermediate files, so
// nothing is compressed twice.
import fs from "node:fs";
import path from "node:path";
import { timeline } from "../server/public/export-timing.js";

/** The transitions ffmpeg can make, by the names the app stores. `cut` is none at all. */
export const XFADE = new Set(["fade", "fadeblack", "dissolve", "slideleft", "slideup", "wipeleft", "smoothleft", "circleopen", "zoomin", "pixelize"]);

const num = (n) => String(Math.round(n * 1000) / 1000);
/** Chroma subsampling needs even sizes. */
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
/** Even, and never past `n`: a crop rounded up would reach outside the picture. */
const evenDown = (n) => Math.max(0, Math.floor(n / 2) * 2);

/**
 * The part of a captured picture a vertical export keeps, in its pixels. The frame is kept in
 * fractions of the screen, so it lands on the same place whatever resolution it was captured at.
 * A capture's size is the layout times the zoom, so it is often odd: every edge is rounded
 * inwards, never out, or ffmpeg is asked for a row the picture does not have.
 */
export function cropBox(frame, picture) {
  const h = Math.max(2, evenDown(Math.min(picture.height, frame.h * picture.height)));
  const w = Math.max(2, evenDown(Math.min(picture.width, (h * 9) / 16)));
  const x = evenDown(Math.min(Math.max(0, frame.x * picture.width), picture.width - w));
  const y = evenDown(Math.min(Math.max(0, frame.y * picture.height), picture.height - h));
  return { x, y, w, h };
}

/**
 * The filter graph and inputs for one video.
 *
 * `beats`: [{ still, width, height, seconds, transition, crop?, take?, voice?, videos: [{ file, start, x, y, w, h, audio }] }]
 * where `width`/`height` are the still's pixels (or the take's) and a video's box is in those pixels too.
 * `take`: { file, lead, sound? } — a recording of the beat on screen, played instead of the still, with
 * its cleaned sound unless it was muted. `voice`: { file, delay } — narration recorded for the
 * beat, starting `delay` seconds in so an incoming transition does not fade its first words.
 * `out`: { width, height, fps }.
 */
export function videoGraph(beats, out, transitionSeconds) {
  const { fps } = out;
  const inputs = [];
  const lines = [];
  const input = (args) => { inputs.push(args); return inputs.length - 1; };
  const { overlaps } = timeline(beats, transitionSeconds);

  beats.forEach((beat, k) => {
    const frames = Math.max(1, Math.round(beat.seconds * fps));
    const length = frames / fps;
    let layer = `b${k}_0`;
    const sounds = [];
    if (beat.take) {
      // A take that ends before its beat holds its last frame; one that runs on is cut.
      // Its sound was cleaned with the lead-in cut off; the picture skips it here, so they agree.
      const take = input([...(beat.take.lead ? ["-ss", num(beat.take.lead)] : []), "-t", num(length), "-i", beat.take.file]);
      lines.push(`[${take}:v]setpts=PTS-STARTPTS,fps=${fps},tpad=stop_mode=clone:stop_duration=${num(length)},trim=duration=${num(length)},format=rgb24[${layer}]`);
      if (beat.take.sound) {
        const sound = input(["-t", num(length), "-i", beat.take.sound]);
        lines.push(`[${sound}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[t${k}]`);
        sounds.push(`[t${k}]`);
      }
    } else {
      // A still is read once and repeated in memory: looping the file would decode it every frame.
      const still = input(["-i", beat.still]);
      lines.push(`[${still}:v]loop=loop=${frames - 1}:size=1:start=0,setpts=N/(${fps}*TB),format=rgb24[${layer}]`);
    }
    if (beat.voice) {
      const voice = input(["-i", beat.voice.file]);
      const ms = Math.round(beat.voice.delay * 1000);
      lines.push(`[${voice}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${ms ? `,adelay=${ms}:all=1` : ""}[n${k}]`);
      sounds.push(`[n${k}]`);
    }
    // Under a voice, a video's own sound is turned down rather than talked over.
    const under = beat.voice || beat.take?.sound ? ",volume=0.3" : "";
    beat.videos.forEach((video, j) => {
      const clip = input(["-ss", num(video.start), "-t", num(length), "-i", video.file]);
      const next = `b${k}_${j + 1}`;
      lines.push(`[${clip}:v]setpts=PTS-STARTPTS,fps=${fps},scale=${even(video.w)}:${even(video.h)}:flags=lanczos,format=rgb24[m${k}_${j}]`);
      // A clip that ends early holds its last frame, as a paused player would.
      lines.push(`[${layer}][m${k}_${j}]overlay=x=${Math.round(video.x)}:y=${Math.round(video.y)}:eof_action=repeat:format=rgb[${next}]`);
      layer = next;
      if (video.audio) {
        lines.push(`[${clip}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${under}[s${k}_${j}]`);
        sounds.push(`[s${k}_${j}]`);
      }
    });

    const crop = beat.crop ? `crop=${beat.crop.w}:${beat.crop.h}:${beat.crop.x}:${beat.crop.y},` : "";
    // Converted to video colours once, with the HD matrix, and tagged as such on the way out.
    lines.push(`[${layer}]${crop}scale=${out.width}:${out.height}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,fps=${fps},settb=AVTB[v${k}]`);

    if (!sounds.length) {
      lines.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(length)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${k}]`);
    } else {
      // Everything a beat plays is heard: its voice, its take, and any videos on it.
      const mixed = sounds.length > 1 ? `${sounds.join("")}amix=inputs=${sounds.length}:normalize=0:duration=longest,` : sounds[0];
      lines.push(`${mixed}apad=whole_dur=${num(length)},atrim=duration=${num(length)},asetpts=PTS-STARTPTS[a${k}]`);
    }
  });

  // Join: a cut is a concatenation; anything else overlaps the two beats by its length.
  let video = "[v0]", audio = "[a0]", length = Math.round(beats[0].seconds * fps) / fps;
  for (let k = 1; k < beats.length; k++) {
    const own = Math.round(beats[k].seconds * fps) / fps;
    const d = overlaps[k];
    if (!d || !XFADE.has(beats[k].transition)) {
      lines.push(`${video}[v${k}]concat=n=2:v=1:a=0,fps=${fps},settb=AVTB[vj${k}]`);
      lines.push(`${audio}[a${k}]concat=n=2:v=0:a=1[aj${k}]`);
      length += own;
    } else {
      lines.push(`${video}[v${k}]xfade=transition=${beats[k].transition}:duration=${num(d)}:offset=${num(length - d)}[vj${k}]`);
      lines.push(`${audio}[a${k}]acrossfade=d=${num(d)}[aj${k}]`);
      length += own - d;
    }
    video = `[vj${k}]`;
    audio = `[aj${k}]`;
  }
  lines.push(`${video}null[vout]`);
  lines.push(`${audio}anull[aout]`);
  return { inputs: inputs.flat(), graph: lines.join(";\n"), total: length };
}

/**
 * Settings YouTube asks for: H.264 High, 4:2:0, a keyframe every second or so with B-frames,
 * AAC at 48 kHz, and the index at the front so processing can start before the upload ends.
 */
export function encoderArgs(out) {
  const preset = out.height * out.width > 2560 * 1440 ? "medium" : "slow";
  return [
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", preset, "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-r", String(out.fps), "-g", String(out.fps), "-bf", "2",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
  ];
}

/**
 * Inputs and graph for one take on its own, as an MP4: the picture from after its silent
 * lead-in, at an even size and a steady frame rate, and the cleaned sound — or silence, so
 * every player and editor sees a sound track. `-t` on both inputs keeps them the same length.
 */
export function takeGraph({ video, sound, lead, seconds }, fps = 30) {
  const length = num(Math.max(0.1, seconds));
  const inputs = [...(lead > 0 ? ["-ss", num(lead)] : []), "-t", length, "-i", video];
  if (sound) inputs.push("-t", length, "-i", sound);
  else inputs.push("-f", "lavfi", "-t", length, "-i", "anullsrc=r=48000:cl=stereo");
  const graph = [
    `[0:v]fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1,format=yuv420p,` +
      `tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length}[vout]`,
    `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${length}[aout]`,
  ].join(";");
  return { inputs, graph };
}

/** Length and whether there is sound, from what `ffmpeg -i` prints about a file. */
export function parseProbe(text) {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const v = /Stream #\d+:\d+[^\n]*: Video:[^\n]*?, (\d{2,5})x(\d{2,5})/.exec(text);
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    audio: /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:/.test(text),
    ...(v ? { width: Number(v[1]), height: Number(v[2]) } : {}),
  };
}

/** Seconds written so far, from ffmpeg's `-progress` lines; null when a chunk carries none. */
export function progressSeconds(chunk) {
  const all = [...String(chunk).matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  if (!all.length) return null;
  return Number(all[all.length - 1][1]) / 1e6;
}

/** Output pixels for a quality and shape: 1080 is 1920 × 1080 landscape, 1080 × 1920 upright. */
export function outputSize(shape, quality) {
  const short = [1080, 1440, 2160].includes(quality) ? quality : 1080;
  const long = Math.round((short * 16) / 9);
  return shape === "vertical" ? { width: short, height: long } : { width: long, height: short };
}

/** A name Windows accepts, never replacing a file that is already there. */
export function uniqueFile(folder, name, ext) {
  const base = String(name || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/, "").trim().slice(0, 120) || "beats";
  for (let n = 1; ; n++) {
    const file = path.join(folder, `${n === 1 ? base : `${base} (${n})`}${ext}`);
    if (!fs.existsSync(file) && !fs.existsSync(`${file}.part`)) return file;
  }
}
