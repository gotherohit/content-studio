import { useEffect, useRef, useState } from "react";
import { Circle, Clapperboard, Ear, Mic, Square, Trash2, Volume2, VolumeX, X } from "lucide-react";
import type { Beat, BeatTake, BeatVoice, NoiseReduction } from "../types";
import { api } from "../api";
import {
  CLIP_DB, LEAD_SECONDS, QUIET_DB, formatSeconds, isBluetoothMic, levelDb, micConstraints, peakDb, recordingName, roomVerdict,
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
  onStartTake: (options: { deviceId?: string; sound: boolean }) => void;
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
  const samples = useRef<Float32Array<ArrayBuffer> | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  // Open the chosen microphone and keep a level meter on it for as long as the panel is open.
  useEffect(() => {
    let live = true;
    let ctx: AudioContext | null = null;
    let frame = 0;
    let opened: MediaStream | null = null;
    (async () => {
      try {
        opened = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId || undefined) });
        if (!live) { opened.getTracks().forEach((t) => t.stop()); return; }
        setStream(opened);
        setError(null);
        // Labels are only given once the microphone is allowed.
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
        ctx = new AudioContext();
        const node = ctx.createAnalyser();
        node.fftSize = 2048;
        ctx.createMediaStreamSource(opened).connect(node);
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
      opened?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
      setStream(null);
    };
  }, [deviceId]);

  useEffect(() => {
    if (phase !== "recording" && phase !== "quiet") return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    return () => window.clearInterval(timer);
  }, [phase === "idle" || phase === "saving"]); // eslint-disable-line react-hooks/exhaustive-deps

  const track = stream?.getAudioTracks()[0];
  const label = track?.label ?? "";
  const rate = track?.getSettings().sampleRate;

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
        <select value={deviceId} disabled={busy} onChange={(e) => { setDeviceId(e.target.value); lsSet("micDevice", e.target.value); setRoom(null); }}>
          <option value="">System default</option>
          {devices.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications").map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>
          ))}
        </select>
      </label>
      <div className="rec-meter" title={`${Math.round(level.rms)} dB`}>
        <span style={{ width: `${meter}%` }} className={clipping ? "clip" : ""} />
      </div>
      <div className="muted small rec-facts">
        {label && <span className="ellipsis">{label}</span>}
        {rate && <span>{rate / 1000} kHz</span>}
      </div>
      {isBluetoothMic(label) && <p className="rec-warn">This looks like a Bluetooth headset. Its microphone records at telephone quality — a USB or built-in microphone will sound far better.</p>}
      {clipping && <p className="rec-warn">Too loud: the level is hitting the top. Turn the microphone's gain down in Windows sound settings, or move back a little.</p>}
      {!clipping && phase === "recording" && loudest < QUIET_DB && elapsed > 3 && <p className="rec-warn">Very quiet: move closer to the microphone, or turn its gain up.</p>}

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
        <p className="muted small">The screen is laid out as it will be exported and recorded at full resolution while you scroll, point and talk. Esc stops. An export plays the take instead of the beat's picture.</p>
        {p.beat.take && phase === "idle" && (
          <>
            <video controls muted={p.beat.take.muted} src={api.recordingUrl(p.projectId, p.beat.take.video)} />
            <p className="muted small">{formatSeconds(p.beat.take.seconds)} · {p.beat.take.width} × {p.beat.take.height}{p.beat.take.muted ? " · muted" : ""}</p>
          </>
        )}
        <div className="row">
          <label className="check"><input type="checkbox" checked={sound} disabled={busy} onChange={(e) => setSound(e.target.checked)} /> Record my voice with it</label>
          <span className="grow" />
          <button className="primary small" disabled={busy || !!error && !stream} onClick={() => p.onStartTake({ deviceId: deviceId || undefined, sound })}>
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
            <button className="ghost small danger" onClick={() => p.onTake(undefined)} title="Remove this take (its files go to the Recycle Bin)"><Trash2 size={12} /> Remove take</button>
          </div>
        )}
      </div>

      {error && <div className="error-bar static">{error}</div>}
    </div>
  );
}
