import { useEffect, useState } from "react";
import { research, type SearchStatus } from "../research";

export function SearchSettings() {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { research.searchStatus().then(setStatus).catch((e) => setError(e.message)); }, []);
  async function save(value: string) {
    setBusy(true); setError("");
    try { setStatus(await research.saveSearch(value)); setKey(""); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="model-settings">
    <h3>Research web search</h3>
    <p>The AI can search the web through Tavily. This requires a separate Tavily API key; your model provider's key does not enable search.</p>
    <p><a href="https://app.tavily.com" target="_blank" rel="noreferrer">Get a Tavily API key</a></p>
    <p className="muted small">Search queries are sent to Tavily. Reading a public page by URL works without a search key.</p>
    {status && <p>{status.unreadable ? "This account cannot decrypt the saved key. Paste it again." : status.hasKey ? `Saved key ${status.keyHint}` : "No search key saved."} {status.secure ? "Keys are encrypted using your Windows account." : "This server stores keys as text. Use the desktop app for OS encryption."}</p>}
    <form onSubmit={(e) => { e.preventDefault(); save(key); }}>
      <label className="field"><span>Tavily API key</span><input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder="Paste your key" /></label>
      <div className="row"><button type="submit" className="primary" disabled={busy || !key.trim()}>Save search key</button>
        {status?.hasKey && <button type="button" disabled={busy} onClick={() => save("")}>Remove key</button>}</div>
    </form>
    {error && <div className="error-bar" role="alert">{error}</div>}
  </div>;
}
