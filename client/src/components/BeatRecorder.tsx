import { useEffect, useRef, useState } from "react";
import { Circle, Clapperboard, Download, Ear, FolderOpen, Info, Mic, RotateCcw, SlidersHorizontal, Square, Trash2, Volume2, VolumeX, Wand2, X } from "lucide-react";
import { sameTuning, tuningFor, type CleanTuning } from "../../../server/public/cleaning.js";
import type { Beat, BeatTake, BeatVoice, NoiseReduction, TakeFraming } from "../types";
import { api } from "../api";
import {
  CLIP_DB, GAIN_MAX, GAIN_MIN, LEAD_SECONDS, QUIET_DB, autoGain, boostedMic, clampGain, formatSeconds, gainKey, isBluetoothMic, levelDb,
  micConstraints, peakDb, recordingName, roomVerdict,
} from "../recording";

interface Props {
  projectId: string;
  beat: Beat;
  index: number;
  noise: NoiseReduction;
  onNoise: (noise: NoiseReduction) => void;
  /** The project's custom cleaning settings, used when `noise` is `custom`; undefined puts the defaults back. */
  tuning?: CleanTuning;
  onTuning: (tuning: CleanTuning | undefined) => void;
  onVoice: (voice: BeatVoice | undefined) => void;
  onTake: (take: BeatTake | undefined) => void;
  /** How a take becomes 16:9 — the project's export setting, shared with the export dialog. */
  framing: TakeFraming;
  onFraming: (framing: TakeFraming) => void;
  /** A take takes over the window, so the app runs it; this panel closes for it. */
  onStartTake: (options: { deviceId?: string; sound: boolean; gainDb: number }) => void;
  /** Write the take as an MP4 with its sound into the export folder; resolves to the file. */
  onSaveTake?: () => Promise<string | null>;
  onReveal?: (file: string) => void;
  onClose: () => void;
}

const lsGet = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const NOISE_LABEL: Record<NoiseReduction, string> = { off: "Off", light: "Light", strong: "Strong", custom: "Custom" };

/** The settings behind the cleaning, in the order the sound goes through them. */
const TUNING: { key: keyof CleanTuning; label: string; min: number; max: number; step: number; show: (v: number) => string; scale?: number; info: string }[] = [
  { key: "rumble", label: "Rumble filter", min: 0, max: 150, step: 5, show: (v) => (v > 0 ? `${v} Hz` : "Off"),
    info: "Cuts everything below this pitch: desk bumps, traffic rumble, a fan's hum. A voice has almost nothing down there. Higher removes more rumble; above about 120 Hz a deep voice starts to sound thin." },
  { key: "speech", label: "Clean-up while you speak", min: 0, max: 100, step: 5, scale: 100, show: (v) => `${v}%`,
    info: "How much noise is taken out from under your voice. Higher is cleaner, but in a noisy room it makes some words dull or cuts into them. At 50% it can never take more than 6 dB off a word; at 100% nothing protects your voice." },
  { key: "pauseMix", label: "Clean-up in pauses", min: 0, max: 100, step: 5, scale: 100, show: (v) => `${v}%`,
    info: "How much noise is taken out between words, where there is no voice to harm. 100% leaves only what sounds like a voice." },
  { key: "pauseDb", label: "Pause volume", min: -40, max: 0, step: 1, show: (v) => (v < 0 ? `${v} dB` : "Unchanged"),
    info: "How far the gaps between words are turned down on top of that. 0 leaves them alone; −30 dB is silence. Very quiet pauses beside a noisy voice make the background come and go with your words — keep this closer to 0 if you hear that." },
  { key: "compress", label: "Even out loudness", min: 1, max: 5, step: 0.5, show: (v) => (v > 1 ? `${v}:1` : "Off"),
    info: "Brings loud and quiet words closer together so the whole recording sits at a steady level. Higher is steadier but less natural, and it lifts the noise under quiet words." },
  { key: "loudness", label: "Loudness", min: -23, max: -12, step: 1, show: (v) => `${v} LUFS`,
    info: "How loud the finished voice is. −16 LUFS is what YouTube plays at; louder than about −14 gains nothing, as YouTube turns it down." },
];

/**
 * Recording for one beat: narration spoken over it, or a take of it on screen.
 *
 * It sits in a corner rather than over the middle, because the beat is on screen while the
 * voice is recorded and the creator is talking about it. Every recording starts with a second
 * of silence, which the cleaning uses to learn the room.
 */
export function BeatRecorder(p: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(lsGet("micDevice"));
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState({ rms: -100, peak: -100 });
  const [loudest, setLoudest] = useState(-100);
  const [room, setRoom] = useState<number | null | "measuring">(null);
  const [phase, setPhase] = useState<"idle" | "quiet" | "recording" | "saving">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(true);
  const [gainDb, setGainDb] = useState(() => clampGain(Number(lsGet(gainKey(lsGet("micDevice")))) || 0));
  const [auto, setAuto] = useState(false);
  const [micLabel, setMicLabel] = useState({ label: "", rate: 0 });
  const [saved, setSaved] = useState<{ state: "saving" } | { state: "done"; file: string } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const clippedAt = useRef(0);
  const samples = useRef<Float32Array<ArrayBuffer> | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const boost = useRef<ReturnType<typeof boostedMic> | null>(null);
  const gainRef = useRef(gainDb);
  gainRef.current = gainDb;

  // Open the chosen microphone, boosted, and keep a level meter on it for as long as the panel
  // is open. The meter listens after the boost: it shows what will be recorded.
  useEffect(() => {
    let live = true;
    let frame = 0;
    let opened: MediaStream | null = null;
    let boosted: ReturnType<typeof boostedMic> | null = null;
    (async () => {
      try {
        opened = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId || undefined) });
        if (!live) { opened.getTracks().forEach((t) => t.stop()); return; }
        const track = opened.getAudioTracks()[0];
        setMicLabel({ label: track?.label ?? "", rate: track?.getSettings().sampleRate ?? 0 });
        boosted = boostedMic(opened, gainRef.current);
        await boosted.ctx.resume();
        boost.current = boosted;
        setStream(boosted.stream);
        setError(null);
        // Labels are only given once the microphone is allowed.
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
        const node = boosted.ctx.createAnalyser();
        node.fftSize = 2048;
        boosted.node.connect(node);
        analyser.current = node;
        samples.current = new Float32Array(node.fftSize);
        const tick = () => {
          node.getFloatTimeDomainData(samples.current!);
          const rms = levelDb(samples.current!), peak = peakDb(samples.current!);
          setLevel({ rms, peak });
          setLoudest((was) => Math.max(was - 0.15, peak));
          if (peak > CLIP_DB) clippedAt.current = performance.now();
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        if (!live) return;
        const err = e as Error;
        setError(err.name === "NotFoundError" ? "No microphone was found. Plug one in, then close and open this again."
          : err.name === "OverconstrainedError" ? "That microphone is no longer there. Choose another."
          : `The microphone could not be opened: ${err.message}`);
      }
    })();
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      analyser.current = null;
      boost.current = null;
      boosted?.close();
      opened?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [deviceId]);

  function changeGain(db: number) {
    const next = clampGain(db);
    setGainDb(next);
    boost.current?.setGain(next);
    lsSet(gainKey(deviceId || undefined), String(next));
    // A clip heard at the old boost says nothing about the new one.
    setLoudest(-100);
    clippedAt.current = 0;
  }

  /** Listen while the person talks as they will on camera, and set the boost from it. */
  async function autoLevel() {
    const node = analyser.current;
    if (!node || !samples.current) return;
    setAuto(true);
    setError(null);
    const peaks: number[] = [];
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      node.getFloatTimeDomainData(samples.current);
      peaks.push(peakDb(samples.current));
      await new Promise((r) => setTimeout(r, 50));
    }
    const next = autoGain(peaks, gainRef.current);
    if (next == null) setError("No voice was heard. Press Auto and talk for five seconds, as you will when recording.");
    else changeGain(next);
    setAuto(false);
  }

  useEffect(() => {
    if (phase !== "recording" && phase !== "quiet") return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    return () => window.clearInterval(timer);
  }, [phase === "idle" || phase === "saving"]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = stream ? micLabel.label : "";
  const rate = stream ? micLabel.rate : 0;

  async function checkRoom() {
    const node = analyser.current;
    if (!node || !samples.current) return;
    setRoom("measuring");
    const levels: number[] = [];
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      node.getFloatTimeDomainData(samples.current);
      levels.push(levelDb(samples.current));
      await new Promise((r) => setTimeout(r, 50));
    }
    // The quieter half: a cough or a click should not decide what the room sounds like.
    levels.sort((a, b) => a - b);
    const median = levels[Math.floor(levels.length / 4)] ?? -100;
    setRoom(median);
    p.onNoise(roomVerdict(median).noise);
  }

  function startVoice() {
    if (!stream) return;
    setError(null);
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 256000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => void saveVoice(new Blob(chunks, { type: mime }));
    recorder.current = rec;
    rec.start(250);
    setElapsed(0);
    setPhase("quiet");
    window.setTimeout(() => setPhase((ph) => (ph === "quiet" ? "recording" : ph)), LEAD_SECONDS * 1000);
  }

  const stopVoice = () => { setPhase("saving"); recorder.current?.stop(); };

  async function saveVoice(blob: Blob) {
    try {
      const made = await api.uploadRecording(p.projectId, recordingName("voice", p.beat.id), blob, p.noise, LEAD_SECONDS, undefined, p.noise === "custom" ? current : undefined);
      if (!made.clean) throw new Error("No sound was recorded. Check the microphone's level.");
      p.onVoice({ file: made.file, clean: made.clean, seconds: made.seconds, noise: made.noise, tuning: made.tuning, lead: made.lead, loudness: made.loudness, recordedAt: new Date().toISOString() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  // What the chosen level does, setting by setting; for `custom`, the project's own.
  const current = tuningFor(p.noise, p.tuning);
  /** Whether a recording was cleaned with something other than what is chosen now. */
  const stale = (rec: { noise: NoiseReduction; tuning?: CleanTuning } | undefined, noise = p.noise, tune = current) =>
    Boolean(rec) && (rec!.noise !== noise || (noise === "custom" && !sameTuning(rec!.tuning, tune)));

  /** Clean what is already recorded again, from its original, with a different level or tuning. */
  async function reclean(noise: NoiseReduction, tune: CleanTuning = tuningFor(noise, p.tuning)) {
    p.onNoise(noise);
    setError(null);
    const custom = noise === "custom" ? tune : undefined;
    try {
      if (p.beat.voice && stale(p.beat.voice, noise, tune)) {
        setPhase("saving");
        const made = await api.recleanRecording(p.projectId, p.beat.voice.file, noise, p.beat.voice.lead, custom);
        p.onVoice({ ...p.beat.voice, clean: made.clean ?? p.beat.voice.clean, noise: made.noise, tuning: made.tuning, seconds: made.seconds, loudness: made.loudness });
      }
      if (p.beat.take?.clean && stale(p.beat.take, noise, tune)) {
        setPhase("saving");
        const made = await api.recleanRecording(p.projectId, p.beat.take.file, noise, p.beat.take.lead, custom);
        p.onTake({ ...p.beat.take, clean: made.clean, noise: made.noise, tuning: made.tuning });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const verdict = typeof room === "number" ? roomVerdict(room) : null;
  const meter = Math.max(0, Math.min(100, ((level.rms + 70) / 70) * 100));
  // Held for a few seconds, and shown in a space that is always there: a warning that came and
  // went with every loud word moved everything under it, and the buttons slid out from under
  // the pointer.
  const clipping = clippedAt.current > 0 && performance.now() - clippedAt.current < 4000;
  const tooQuiet = !clipping && phase === "recording" && loudest < QUIET_DB && elapsed > 3;
  const waiting = Boolean((p.beat.voice && stale(p.beat.voice)) || (p.beat.take?.clean && stale(p.beat.take)));
  const setTune = (key: keyof CleanTuning, value: number) => {
    p.onTuning({ ...current, [key]: value });
    if (p.noise !== "custom") p.onNoise("custom");
  };

  return (
    <div className="beat-recorder" role="dialog" aria-label={`Record for beat ${p.index + 1}`}>
      <div className="modal-head">
        <Mic size={15} />
        <h3>Beat {p.index + 1} — record</h3>
        <span className="grow" />
        <button className="icon-btn" title="Close" disabled={phase === "recording" || phase === "quiet"} onClick={p.onClose}><X size={15} /></button>
      </div>
      {p.beat.point && <p className="muted small ellipsis">{p.beat.point}</p>}

      <label className="field"><span>Microphone</span>
        <select value={deviceId} disabled={busy || auto} onChange={(e) => {
          setDeviceId(e.target.value); lsSet("micDevice", e.target.value); setRoom(null);
          setGainDb(clampGain(Number(lsGet(gainKey(e.target.value || undefined))) || 0));
        }}>
          <option value="">System default</option>
          {devices.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications").map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>
          ))}
        </select>
      </label>
      <div className="rec-meter" title={`${Math.round(level.rms)} dB`}>
        <span style={{ width: `${meter}%` }} className={clipping ? "clip" : ""} />
      </div>
      <label className="field"><span>Microphone boost</span>
        <div className="row rec-gain">
          <input type="range" min={GAIN_MIN} max={GAIN_MAX} step={1} value={gainDb} disabled={busy || auto} aria-label="Microphone boost in decibels"
            onChange={(e) => changeGain(Number(e.target.value))} onDoubleClick={() => changeGain(0)} title="Double-click to reset" />
          <span className="rec-gain-value">{gainDb > 0 ? "+" : ""}{gainDb} dB</span>
          <button className="ghost small" disabled={!stream || busy || auto} onClick={() => void autoLevel()} title="Talk for five seconds as you will on camera; the boost is set from your voice">
            <Wand2 size={12} /> {auto ? "Listening… talk normally" : "Auto"}
          </button>
        </div>
      </label>
      <div className="muted small rec-facts">
        {label && <span className="ellipsis">{label}</span>}
        {rate && <span>{rate / 1000} kHz</span>}
      </div>
      {isBluetoothMic(label) && <p className="rec-warn">This looks like a Bluetooth headset. Its microphone records at telephone quality — a USB or built-in microphone will sound far better.</p>}
      <p className={`rec-status ${clipping || tooQuiet ? "warn" : ""}`} role="status">
        {clipping ? `Too loud: the level is hitting the top. ${gainDb > GAIN_MIN ? "Turn the boost down, or press Auto." : "Turn the microphone's level down in Windows sound settings, or move back a little."}`
          : tooQuiet ? "Very quiet: move closer to the microphone, or turn the boost up."
          : "Talk as you will on camera. The bar should stay short of the end."}
      </p>

      <div className="row rec-room">
        <button className="ghost small" disabled={!stream || busy || room === "measuring"} onClick={checkRoom} title="Stay quiet for three seconds while the microphone listens to the room">
          <Ear size={13} /> {room === "measuring" ? "Listening… stay quiet" : "Check the room"}
        </button>
        {verdict && <span className={`small rec-verdict ${verdict.tone}`}>{verdict.label} ({Math.round(room as number)} dB). {verdict.advice}</span>}
      </div>

      <label className="field"><span>Background noise reduction</span>
        <div className="seg">
          {(["off", "light", "strong"] as NoiseReduction[]).map((n) => (
            <button key={n} className={p.noise === n ? "active" : ""} disabled={busy} onClick={() => void reclean(n)}>{NOISE_LABEL[n]}</button>
          ))}
          <button className={p.noise === "custom" ? "active" : ""} disabled={busy} title="Your own settings, below"
            onClick={() => { if (!p.tuning) p.onTuning({ ...current }); p.onNoise("custom"); }}>{NOISE_LABEL.custom}</button>
        </div>
      </label>
      <details className="rec-tune">
        <summary><SlidersHorizontal size={12} /> Fine-tune the cleaning</summary>
        <p className="muted small">These are what {p.noise === "custom" ? "your custom setting" : NOISE_LABEL[p.noise]} does. Move one and the setting becomes Custom.</p>
        {TUNING.map((t) => {
          const value = Math.round(current[t.key] * (t.scale ?? 1) * 100) / 100;
          return (
            <div className="rec-tune-row" key={t.key}>
              <div className="row">
                <span className="rec-tune-label">{t.label}</span>
                <button className={`icon-btn rec-info ${info === t.key ? "active" : ""}`} title={t.info} aria-label={`What ${t.label} does`} aria-expanded={info === t.key}
                  onClick={() => setInfo(info === t.key ? null : t.key)}><Info size={12} /></button>
                <span className="grow" />
                <span className="rec-gain-value">{t.show(value)}</span>
              </div>
              <input type="range" min={t.min} max={t.max} step={t.step} value={value} disabled={busy} aria-label={t.label}
                onChange={(e) => setTune(t.key, Number(e.target.value) / (t.scale ?? 1))} />
              {info === t.key && <p className="muted small rec-info-text">{t.info}</p>}
            </div>
          );
        })}
        <div className="row">
          {waiting && (
            <button className="primary small" disabled={busy} onClick={() => void reclean("custom", current)} title="Clean this beat's recording again, from its original, with these settings">
              Clean again with these settings
            </button>
          )}
          <span className="grow" />
          <button className="ghost small" disabled={busy || (p.noise === "light" && !p.tuning)} title="Back to Light, the default, and forget the custom settings"
            onClick={() => { p.onTuning(undefined); void reclean("light"); }}><RotateCcw size={12} /> Reset to defaults</button>
        </div>
      </details>

      <div className="rec-block">
        <div className="rec-title"><Mic size={13} /> Voice over this beat</div>
        {phase === "quiet" && <p className="rec-live quiet">● Stay quiet — listening to the room</p>}
        {phase === "recording" && <p className="rec-live">● Speak now — {formatSeconds(elapsed - LEAD_SECONDS)}</p>}
        {phase === "saving" && <p className="muted small">Cleaning the sound…</p>}
        {p.beat.voice && phase === "idle" && (
          <>
            <audio controls src={api.recordingUrl(p.projectId, p.beat.voice.clean)} />
            <p className="muted small">{formatSeconds(p.beat.voice.seconds)} · noise reduction {NOISE_LABEL[p.beat.voice.noise].toLowerCase()} · the beat lasts as long as this</p>
          </>
        )}
        <div className="row">
          {phase === "quiet" || phase === "recording"
            ? <button className="primary small rec-stop" onClick={stopVoice}><Square size={12} /> Stop</button>
            : <button className="primary small" disabled={!stream || busy} onClick={startVoice}><Circle size={12} /> {p.beat.voice ? "Record again" : "Record voice"}</button>}
          {p.beat.voice && phase === "idle" && <button className="ghost small danger" onClick={() => p.onVoice(undefined)} title="Remove this recording (its files go to the Recycle Bin)"><Trash2 size={12} /> Remove</button>}
        </div>
      </div>

      <div className="rec-block">
        <div className="rec-title"><Clapperboard size={13} /> Take — record this beat on screen</div>
        <p className="muted small">Everything in the window is recorded while you scroll, point and talk, and fitted into 16:9 — with bars if the window is another shape. Esc stops. An export plays the take instead of the beat's picture.</p>
        {p.beat.take && phase === "idle" && (
          <>
            <TakePlayer
              video={api.recordingUrl(p.projectId, p.beat.take.video)}
              sound={p.beat.take.clean && !p.beat.take.muted ? api.recordingUrl(p.projectId, p.beat.take.clean) : null}
              lead={p.beat.take.lead}
              framing={p.framing}
            />
            <div className="row rec-framing">
              <span className="muted small">In 16:9</span>
              <div className="seg" role="group" aria-label="How the take fills 16:9">
                <button className={p.framing === "fit" ? "active" : ""} onClick={() => p.onFraming("fit")}
                  title="All of the window, with bars where its shape is not 16:9 — as a screen recorder records it">Fit — whole window</button>
                <button className={p.framing === "fill" ? "active" : ""} onClick={() => p.onFraming("fill")}
                  title="No bars: fills 16:9, trimming a thin slice at two edges when the window is another shape">Fill — no bars</button>
              </div>
            </div>
            <p className="muted small">{formatSeconds(p.beat.take.seconds)} · {p.beat.take.width} × {p.beat.take.height} · {p.beat.take.muted || !p.beat.take.clean ? "no sound" : "with your voice"}</p>
          </>
        )}
        <div className="row">
          <label className="check"><input type="checkbox" checked={sound} disabled={busy} onChange={(e) => setSound(e.target.checked)} /> Record my voice with it</label>
          <span className="grow" />
          <button className="primary small" disabled={busy || auto || !!error && !stream} onClick={() => p.onStartTake({ deviceId: deviceId || undefined, sound, gainDb })}>
            <Circle size={12} /> {p.beat.take ? "New take" : "Record a take"}
          </button>
        </div>
        {p.beat.take && phase === "idle" && (
          <div className="row">
            {p.beat.take.clean && (
              <button className="ghost small" onClick={() => p.onTake({ ...p.beat.take!, muted: !p.beat.take!.muted })}>
                {p.beat.take.muted ? <><Volume2 size={12} /> Use its sound</> : <><VolumeX size={12} /> Mute it</>}
              </button>
            )}
            {p.onSaveTake && (
              <button className="ghost small" disabled={saved?.state === "saving"} title="Write this take as an MP4 (H.264 and AAC) with its sound, into the export folder"
                onClick={async () => {
                  setSaved({ state: "saving" });
                  setError(null);
                  try {
                    const file = await p.onSaveTake!();
                    setSaved(file ? { state: "done", file } : null);
                  } catch (e) {
                    setSaved(null);
                    setError(`The MP4 could not be written: ${(e as Error).message}`);
                  }
                }}>
                <Download size={12} /> {saved?.state === "saving" ? "Writing MP4…" : "Save as MP4"}
              </button>
            )}
            <button className="ghost small danger" onClick={() => p.onTake(undefined)} title="Remove this take (its files go to the Recycle Bin)"><Trash2 size={12} /> Remove take</button>
          </div>
        )}
        {saved?.state === "done" && (
          <p className="muted small rec-saved">
            <span className="ellipsis">Saved {saved.file.split(/[\\/]/).pop()}</span>
            {p.onReveal && <button className="ghost small" onClick={() => p.onReveal!(saved.file)}><FolderOpen size={12} /> Show in folder</button>}
          </p>
        )}
      </div>

      {error && <div className="error-bar static">{error}</div>}
    </div>
  );
}

/**
 * A take played back as the export will play it: fitted or filled into 16:9, from after its silent lead-in,
 * with the cleaned sound beside it. The picture file has no sound of its own — the sound is
 * made separately so it can be cleaned again — so the two are kept together here. The
 * player's own download is turned off: it would save the silent picture file.
 */
function TakePlayer(p: { video: string; sound: string | null; lead: number; framing: TakeFraming }) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const sync = (force = false) => {
    const v = video.current, a = audio.current;
    if (!v || !a) return;
    const at = v.currentTime - p.lead;
    if (at < 0 || v.paused) { a.pause(); if (at < 0) a.currentTime = 0; return; }
    if (force || Math.abs(a.currentTime - at) > 0.12) a.currentTime = at;
    if (a.paused) void a.play().catch(() => {});
  };
  // Shown in a 16:9 box, fitted or filled the way the video will be made.
  return (
    <div className={`take-frame ${p.framing}`}>
      <video ref={video} controls controlsList="nodownload noplaybackrate" disablePictureInPicture src={p.video}
        onLoadedMetadata={(e) => { e.currentTarget.currentTime = p.lead; }}
        onPlay={() => sync(true)} onPause={() => audio.current?.pause()} onSeeked={() => sync(true)} onTimeUpdate={() => sync()}
        onEnded={() => audio.current?.pause()}
        onVolumeChange={(e) => { if (audio.current) { audio.current.volume = e.currentTarget.volume; audio.current.muted = e.currentTarget.muted; } }} />
      {p.sound && <audio ref={audio} preload="auto" src={p.sound} hidden />}
    </div>
  );
}
