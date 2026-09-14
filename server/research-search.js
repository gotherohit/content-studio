import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Separate search credentials, using the same vault instance as model credentials. */
export function createResearchSearch({ appDir, vault, fetchImpl = fetch }) {
  const file = path.join(appDir, "search.json");
  let stored = {}, key = "", secure = false;
  async function load() {
    secure = await vault.available();
    try { stored = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    key = stored.apiKeyEnc ? await vault.decrypt(stored.apiKeyEnc) || "" : stored.apiKey || "";
    if (key && secure && !stored.apiKeyEnc) await save(key);
  }
  const status = () => ({ provider: "tavily", hasKey: Boolean(key), keyHint: key ? `…${key.slice(-4)}` : "", secure,
    unreadable: Boolean(stored.apiKeyEnc && !key) });
  async function save(apiKey) {
    if (typeof apiKey !== "string" || apiKey.length > 1000) throw new Error("Enter a valid search API key");
    const next = apiKey.trim();
    const encrypted = next ? await vault.encrypt(next) : null;
    if (next && secure && !encrypted) throw new Error("Could not encrypt the key. The previous key was kept.");
    const body = next ? encrypted ? { apiKeyEnc: encrypted } : { apiKey: next } : {};
    const temporary = file + "." + randomUUID() + ".tmp";
    try { await fs.writeFile(temporary, JSON.stringify(body), { mode: 0o600, flag: "wx" }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    stored = body; key = next;
    return status();
  }
  async function search(query, signal) {
    if (!key) throw new Error("Web search needs a Tavily key. Add one in Settings → Web search. You can still read a public URL directly.");
    const response = await fetchImpl("https://api.tavily.com/search", {
      method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: String(query).slice(0, 1000), max_results: 6, search_depth: "basic", include_raw_content: false }),
    });
    if (!response.ok) throw new Error(`Search provider returned ${response.status}. Check your search key and quota in Settings.`);
    const data = await response.json();
    return { query, results: (data.results || []).map((r) => ({ title: r.title, url: r.url, content: String(r.content || "").slice(0, 2500) })) };
  }
  return { load, status, save, search, redact: (text) => key ? String(text).split(key).join("[key]") : String(text) };
}
