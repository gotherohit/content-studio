import { useEffect, useRef, useState } from "react";
import { Circle, Clapperboard, Download, Ear, FolderOpen, Mic, Square, Trash2, Volume2, VolumeX, Wand2, X } from "lucide-react";
import type { Beat, BeatTake, BeatVoice, NoiseReduction } from "../types";
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
  onVoice: (voice: BeatVoice | undefined) => void;
  onTake: (take: BeatTake | undefined) => void;
  /** A take takes over the window, so the app runs it; this panel closes for it. */
  onStartTake: (options: { deviceId?: string; sound: boolean; gainDb: number }) => void;
  /** Write the take as an MP4 with its sound into the export folder; resolves to the file. */
  onSaveTake?: () => Promise<string | null>;
  onReveal?: (file: string) => void;
  onClose: () => void;
}

const lsGet = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const NOISE_LABEL: Record<NoiseReduction, string> = { off: "Off", light: "Light", strong: "Strong" };

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
      const made = await api.uploadRecording(p.projectId, recordingName("voice", p.beat.id), blob, p.noise, LEAD_SECONDS);
      if (!made.clean) throw new Error("No sound was recorded. Check the microphone's level.");
      p.onVoice({ file: made.file, clean: made.clean, seconds: made.seconds, noise: made.noise, lead: made.lead, loudness: made.loudness, recordedAt: new Date().toISOString() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  /** Try a different amount of noise reduction on what is already recorded. */
  async function reclean(noise: NoiseReduction) {
    p.onNoise(noise);
    setError(null);
    try {
      if (p.beat.voice && p.beat.voice.noise !== noise) {
        setPhase("saving");
        const made = await api.recleanRecording(p.projectId, p.beat.voice.file, noise, p.beat.voice.lead);
        p.onVoice({ ...p.beat.voice, clean: made.clean ?? p.beat.voice.clean, noise: made.noise, seconds: made.seconds, loudness: made.loudness });
      }
      if (p.beat.take?.clean && p.beat.take.noise !== noise) {
        setPhase("saving");
        const made = await api.recleanRecording(p.projectId, p.beat.take.file, noise, p.beat.take.lead);
        p.onTake({ ...p.beat.take, clean: made.clean, noise: made.noise });
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
  const clipping = loudest > CLIP_DB;

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
      {clipping && <p className="rec-warn">Too loud: the level is hitting the top. {gainDb > 0 ? "Turn the boost down, or press Auto." : "Turn the microphone's level down in Windows sound settings, or move back a little."}</p>}
      {!clipping && phase === "recording" && loudest < QUIET_DB && elapsed > 3 && <p className="rec-warn">Very quiet: move closer to the microphone, or turn the boost up.</p>}

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
        </div>
      </label>

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
            />
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
 * A take played back as the export will play it: the picture from after its silent lead-in,
 * with the cleaned sound beside it. The picture file has no sound of its own — the sound is
 * made separately so it can be cleaned again — so the two are kept together here. The
 * player's own download is turned off: it would save the silent picture file.
 */
function TakePlayer(p: { video: string; sound: string | null; lead: number }) {
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
  return (
    <>
      <video ref={video} controls controlsList="nodownload noplaybackrate" disablePictureInPicture src={p.video}
        onLoadedMetadata={(e) => { e.currentTarget.currentTime = p.lead; }}
        onPlay={() => sync(true)} onPause={() => audio.current?.pause()} onSeeked={() => sync(true)} onTimeUpdate={() => sync()}
        onEnded={() => audio.current?.pause()}
        onVolumeChange={(e) => { if (audio.current) { audio.current.volume = e.currentTarget.volume; audio.current.muted = e.currentTarget.muted; } }} />
      {p.sound && <audio ref={audio} preload="auto" src={p.sound} hidden />}
    </>
  );
}
