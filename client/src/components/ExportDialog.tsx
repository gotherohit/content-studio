import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Crop, FileDown, FolderOpen, Film, Mic, X } from "lucide-react";
import type { Beat, ExportSettings, Project, TransitionKind } from "../types";
import { beatTimings, beatVideos, exportLength, formatLength, outputSize, TRANSITIONS } from "../exportPlan";
import { FolderField } from "./FolderField";
import { desktop } from "../desktop";

/** Where an export is: capturing beats happens with this dialog closed, so it only shows the rest. */
export type ExportRun =
  | { phase: "encode" | "pdf"; fraction: number }
  | { phase: "done"; file: string; kind: "video" | "pdf"; seconds?: number; pages?: number; problems: string[] }
  | { phase: "error"; message: string; problems: string[] };

interface Props {
  project: Project;
  settings: ExportSettings;
  onSettings: (patch: Partial<ExportSettings>) => void;
  onBeat: (id: string, patch: Partial<NonNullable<Beat["export"]>>) => void;
  /** Frame the beats for a vertical export, on the real layout. */
  onFrame: (index: number) => void;
  onRun: (lengths: Record<string, number | null>) => void;
  run: ExportRun | null;
  onCancel: () => void;
  onClose: () => void;
}

const sep = (dir: string) => (dir.includes("\\") ? "\\" : "/");
export const defaultExportFolder = (project: Project) => (project.dir ? `${project.dir}${sep(project.dir)}exports` : "");

/**
 * Exporting the beats as a video or a PDF.
 *
 * Every beat is shown in turn, exactly as Present mode shows it, and photographed at the
 * output's resolution; a video then holds each picture for its beat's length, plays any video
 * the beat shows from the second it was captured at, and joins the beats with transitions.
 */
export function ExportDialog(p: Props) {
  const { project, settings: s } = p;
  const beats = project.beats ?? [];
  const [lengths, setLengths] = useState<Record<string, number | null>>({});
  const [probed, setProbed] = useState(false);

  const videoNames = useMemo(() => [...new Set(beats.flatMap((b) => beatVideos(b.stage, project.sources).map((v) => v.name)))], [beats, project.sources]);
  useEffect(() => {
    if (!desktop || !project.dir || !videoNames.length) { setProbed(true); return; }
    let live = true;
    desktop.exportProbe(project.dir, videoNames)
      .then((found) => { if (live) setLengths(Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.duration]))); })
      .catch(() => {})
      .finally(() => { if (live) setProbed(true); });
    return () => { live = false; };
  }, [project.dir, videoNames.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps

  const timings = beatTimings(beats, s, project.sources, lengths);
  const total = exportLength(timings, s.transitionSeconds);
  const out = outputSize(s.shape, s.quality);
  const busy = p.run?.phase === "encode" || p.run?.phase === "pdf";
  const video = s.format === "video";
  const folder = s.folder || defaultExportFolder(project);
  const framed = beats.filter((b) => b.export?.frame).length;
  const transitionName = (id: TransitionKind) => TRANSITIONS.find((t) => t.id === id)?.label ?? id;

  if (p.run && p.run.phase !== "error") {
    return (
      <div className="modal-backdrop">
        <div className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="modal-head">
            <h3 id="export-title">{p.run.phase === "done" ? "Exported" : p.run.phase === "pdf" ? "Writing the PDF…" : "Encoding the video…"}</h3>
            <span className="grow" />
            {p.run.phase === "done" && <button className="icon-btn" title="Close" onClick={p.onClose}><X size={16} /></button>}
          </div>
          {p.run.phase === "done" ? (
            <>
              <p className="export-file">{p.run.file}</p>
              <p className="muted small">
                {p.run.kind === "video"
                  ? `${formatLength(p.run.seconds ?? 0)} · ${out.width} × ${out.height} · H.264 and AAC in MP4, ready to upload to YouTube.`
                  : `${p.run.pages} page${p.run.pages === 1 ? "" : "s"}, one per beat.`}
              </p>
              {p.run.problems.length > 0 && <ul className="export-problems">{p.run.problems.map((x) => <li key={x}>{x}</li>)}</ul>}
              <div className="row export-actions">
                <span className="grow" />
                <button className="ghost" onClick={() => desktop?.exportReveal((p.run as { file: string }).file)}><FolderOpen size={14} /> Show in folder</button>
                <button className="primary" onClick={p.onClose}>Done</button>
              </div>
            </>
          ) : (
            <>
              <div className="export-bar"><span style={{ width: `${Math.round((p.run.fraction ?? 0) * 100)}%` }} /></div>
              <p className="muted small">{Math.round((p.run.fraction ?? 0) * 100)}% — the beats are captured; this part runs on its own and the studio is yours again.</p>
              <div className="row export-actions">
                <span className="grow" />
                {p.run.phase === "encode" && <button className="ghost" onClick={p.onCancel}>Cancel</button>}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && p.onClose()}>
      <div className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="export-title">Export beats</h3>
          <span className="grow" />
          <button className="icon-btn" title="Close" onClick={p.onClose}><X size={16} /></button>
        </div>

        <div className="export-grid">
          <label className="field"><span>Export as</span>
            <div className="seg">
              <button className={video ? "active" : ""} onClick={() => p.onSettings({ format: "video" })}><Film size={13} /> Video</button>
              <button className={!video ? "active" : ""} onClick={() => p.onSettings({ format: "pdf" })}><FileDown size={13} /> PDF</button>
            </div>
          </label>
          <label className="field"><span>Shape</span>
            <div className="seg">
              <button className={s.shape === "landscape" ? "active" : ""} onClick={() => p.onSettings({ shape: "landscape" })}>16:9</button>
              <button className={s.shape === "vertical" ? "active" : ""} onClick={() => p.onSettings({ shape: "vertical" })}>9:16 vertical</button>
            </div>
          </label>
          <label className="field"><span>Resolution</span>
            <select value={s.quality} onChange={(e) => p.onSettings({ quality: Number(e.target.value) as ExportSettings["quality"] })}>
              <option value={1080}>1080p</option>
              <option value={1440}>1440p</option>
              <option value={2160}>4K (2160p)</option>
            </select>
          </label>
          {video && (
            <label className="field"><span>Frame rate</span>
              <select value={s.fps} onChange={(e) => p.onSettings({ fps: Number(e.target.value) as 30 | 60 })}>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </label>
          )}
          <label className="field" title="Pages, videos and notebooks are given this long to load and settle before each beat is captured."><span>Wait for each beat</span>
            <span className="row"><input type="number" min={1} max={30} step={0.5} value={s.settle} onChange={(e) => p.onSettings({ settle: Number(e.target.value) })} /> s</span>
          </label>
        </div>

        {video && (
          <div className="export-grid">
            <label className="field"><span>Hold each beat</span>
              <span className="row"><input type="number" min={0.5} step={0.5} value={s.seconds} onChange={(e) => p.onSettings({ seconds: Number(e.target.value) })} /> s</span>
            </label>
            <label className="field"><span>Transition</span>
              <select value={s.transition} onChange={(e) => p.onSettings({ transition: e.target.value as TransitionKind })}>
                {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Transition length</span>
              <span className="row"><input type="number" min={0.1} max={3} step={0.1} value={s.transitionSeconds} disabled={s.transition === "cut" && !beats.some((b) => b.export?.transition && b.export.transition !== "cut")} onChange={(e) => p.onSettings({ transitionSeconds: Number(e.target.value) })} /> s</span>
            </label>
          </div>
        )}

        <div className="export-beats">
          <div className="export-beat head">
            <span>#</span><span>Point</span>
            {video && <span>Length</span>}
            {video && <span>Into this beat</span>}
            {s.shape === "vertical" && <span>Frame</span>}
          </div>
          {beats.map((beat, i) => {
            const t = timings[i];
            const clips = beatVideos(beat.stage, project.sources);
            return (
              <div className="export-beat" key={beat.id}>
                <span className="beat-no">{i + 1}</span>
                <span className="ellipsis" title={beat.point}>{beat.point || <span className="muted">no point written</span>}</span>
                {video && (
                  <span className="row" title={clips.length ? `Plays ${clips.map((c) => `${c.name} from ${formatLength(c.start)}`).join(" and ")}` : undefined}>
                    <input
                      type="number" min={0.5} step={0.5}
                      value={beat.export?.seconds ?? ""}
                      placeholder={String(t.seconds)}
                      onChange={(e) => p.onBeat(beat.id, { seconds: e.target.value ? Number(e.target.value) : undefined })}
                    />
                    {beat.take ? <span title={`Plays its take${beat.take.muted ? ", muted" : ""}`}><Clapperboard size={12} className="muted" /></span>
                      : clips.length > 0 && <Film size={12} className="muted" />}
                    {beat.voice && <span title="Plays its recorded voice"><Mic size={12} className="muted" /></span>}
                  </span>
                )}
                {video && (
                  i === 0 ? <span className="muted small">start</span> : (
                    <select value={beat.export?.transition ?? ""} onChange={(e) => p.onBeat(beat.id, { transition: (e.target.value || undefined) as TransitionKind | undefined })}>
                      <option value="">As set — {transitionName(s.transition)}</option>
                      {TRANSITIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  )
                )}
                {s.shape === "vertical" && (
                  <button className="ghost small" onClick={() => p.onFrame(i)} title="Choose the part of this beat a vertical video shows">
                    <Crop size={12} /> {beat.export?.frame ? "Framed" : "Centre"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {s.shape === "vertical" && (
          <div className="export-note">
            <Crop size={14} />
            <span className="grow">
              A vertical export shows a 9:16 part of the screen. {framed ? `${framed} of ${beats.length} beats are framed; the rest use the centre.` : "Every beat uses the centre until you frame it."}
            </span>
            <button className="ghost small" onClick={() => p.onFrame(0)}>Frame the beats on screen…</button>
          </div>
        )}

        <FolderField label="Save to" value={folder} onChange={(dir) => p.onSettings({ folder: dir })} description="Choose where the export is saved" />
        <label className="field"><span>File name</span>
          <input value={s.name} placeholder={project.title || "beats"} onChange={(e) => p.onSettings({ name: e.target.value })} />
        </label>

        {p.run?.phase === "error" && (
          <div className="error-bar static">{p.run.message}</div>
        )}

        <div className="row export-actions">
          <span className="muted small grow">
            {beats.length} beat{beats.length === 1 ? "" : "s"} · {out.width} × {out.height}
            {video ? ` · ${formatLength(total)} · MP4 (H.264, AAC)` : " · one page per beat"}
            {" · "}about {Math.round(beats.length * (s.settle + 0.5))} s to capture, while the window shows each beat
          </span>
          <button className="ghost" onClick={p.onClose}>Close</button>
          <button className="primary" disabled={!beats.length || !probed || !desktop} onClick={() => p.onRun(lengths)}>
            {video ? <Film size={14} /> : <FileDown size={14} />} Export
          </button>
        </div>
        {!desktop && <p className="muted small">Exporting needs the desktop app.</p>}
      </div>
    </div>
  );
}
