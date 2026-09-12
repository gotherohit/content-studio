import { useEffect, useState } from "react";
import { CheckCircle2, Download, ExternalLink, RefreshCw, RotateCw, TriangleAlert } from "lucide-react";
import { desktop, type UpdateInfo } from "../desktop";

const RELEASES = "https://github.com/gotherohit/content-studio/releases";

/**
 * Updates, on demand.
 *
 * The app checks on its own at launch and every six hours, but that is no use the moment
 * a fix has just been pushed and you want it now. This asks immediately and shows the
 * answer arriving, including the case worth saying out loud — that there is nothing new.
 */
export function UpdateSettings() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  // Held in a local so the handlers below need not re-prove it is there.
  const bridge = desktop;

  useEffect(() => {
    if (!bridge) return;
    bridge.info().then((i) => setVersion(i.version)).catch(() => {});
    bridge.updateState().then(setInfo).catch(() => {});
    return bridge.onUpdateState(setInfo);
  }, [bridge]);

  if (!bridge) {
    return (
      <>
        <p className="muted small">Updates apply to the installed desktop app. This copy is running in a browser.</p>
        <p className="muted small"><a href={RELEASES} target="_blank" rel="noreferrer">Releases <ExternalLink size={11} /></a></p>
      </>
    );
  }

  const state = info?.state ?? "idle";
  const busy = state === "checking" || state === "downloading";

  return (
    <>
      <p className="muted small">
        Content Studio checks for a new version when it starts and every six hours. It downloads in the background and
        waits for you — it will never restart itself in the middle of a recording.
      </p>

      <div className="field">
        <span>This copy</span>
        <span className="mono small">{version ? `Content Studio ${version}` : "…"}</span>
      </div>

      <div className={`update-state ${state}`}>
        {state === "checking" && <><RefreshCw size={14} className="spin" /> Asking GitHub what the latest version is…</>}
        {state === "downloading" && <><Download size={14} /> Downloading {info?.version ?? "the update"}… {info?.percent ? `${info.percent}%` : ""}</>}
        {state === "ready" && <><CheckCircle2 size={14} /> {info?.version} is downloaded and ready to install.</>}
        {state === "current" && <><CheckCircle2 size={14} /> This is the latest version.</>}
        {state === "error" && <><TriangleAlert size={14} /> {info?.message ?? "The update check failed."}</>}
        {state === "unsupported" && <><TriangleAlert size={14} /> {info?.message ?? "This copy cannot update itself."}</>}
        {state === "idle" && <span className="muted small">No check yet in this session.</span>}
      </div>

      {state === "downloading" && (
        <div className="progress"><div className="bar" style={{ width: `${info?.percent ?? 0}%` }} /></div>
      )}

      <div className="row">
        {state === "ready" ? (
          <button className="primary" onClick={() => bridge.installUpdate()}>
            <RotateCw size={14} /> Restart and install {info?.version}
          </button>
        ) : (
          <button className="primary" disabled={busy || state === "unsupported"} onClick={() => bridge.checkForUpdates().then(setInfo)}>
            <RefreshCw size={14} /> {busy ? "Checking…" : "Check for updates"}
          </button>
        )}
        <a
          className="ghost button-like"
          href={RELEASES}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => { e.preventDefault(); bridge.openExternal(RELEASES); }}
        >What changed <ExternalLink size={12} /></a>
      </div>

      {state === "ready" && (
        <p className="muted small">
          If you would rather not stop now, quitting normally installs it too — the next launch is the new version.
        </p>
      )}
    </>
  );
}
