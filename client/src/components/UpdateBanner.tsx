import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { desktop } from "../desktop";

/**
 * A new version arrives quietly. It is downloaded in the background and only applied when
 * the user says so, because an update in the middle of a recording would be unwelcome.
 */
export function UpdateBanner() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => { desktop?.onUpdateReady((v) => setVersion(v || "")); }, []);
  if (!version) return null;

  return (
    <div className="update-banner">
      <Sparkles size={14} />
      <span>Content Studio {version} is ready.</span>
      <button className="primary small" onClick={() => desktop?.installUpdate()}>Restart to update</button>
      <button className="ghost small" onClick={() => setVersion(null)}>Later</button>
    </div>
  );
}
