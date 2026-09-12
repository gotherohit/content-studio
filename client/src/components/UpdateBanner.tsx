import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { desktop } from "../desktop";

/**
 * A new version announces itself once, quietly, and only when it is already downloaded
 * and one click from being installed. Everything else about updates lives in Settings,
 * where it can be asked for rather than waited for.
 */
export function UpdateBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    const apply = (s: { state: string; version: string | null }) =>
      setVersion(s.state === "ready" ? s.version : null);
    desktop.updateState().then(apply).catch(() => {});
    return desktop.onUpdateState(apply);
  }, []);

  if (!version || dismissed) return null;

  return (
    <div className="update-banner">
      <Sparkles size={14} />
      <span>Content Studio {version} is ready.</span>
      <button className="primary small" onClick={() => desktop?.installUpdate()}>Restart to update</button>
      <button className="ghost small" onClick={() => { setDismissed(true); onOpenSettings(); }}>Later</button>
    </div>
  );
}
