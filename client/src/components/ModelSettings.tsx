import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Key, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, type AiProviders, type Provider, type ProviderPreset } from "../api";
import { desktop } from "../desktop";

const CUSTOM_ID = "__custom__";

/** For a gateway, a self-hosted model, or anything not on the list. */
const CUSTOM: ProviderPreset = { id: CUSTOM_ID, label: "Custom", kind: "openai", baseUrl: "", models: [] };

/**
 * Where keys and models are set up.
 *
 * A key typed here is sent once and stored in ~/.content-studio/credentials.json, which
 * sits outside the codebase and is never committed. It never comes back: a saved provider
 * shows only its last four characters, so nothing sensitive can end up in a screenshot or
 * a recording of this screen.
 */
export function ModelSettings() {
  const [state, setState] = useState<AiProviders | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProviderPreset | null>(null);
  const [key, setKey] = useState("");

  useEffect(() => { api.aiProviders().then(setState).catch((e) => setErr(e.message)); }, []);

  const guard = async (label: string, fn: () => Promise<AiProviders>) => {
    setBusy(label); setErr(null);
    try { setState(await fn()); } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };

  /** Only presets not already set up, so the list of things to add stays short. */
  const available = useMemo(
    () => (state ? state.presets.filter((p) => !state.providers.some((x) => x.id === p.id)) : []),
    [state],
  );

  async function add(preset: ProviderPreset, apiKey: string) {
    await guard("add", async () => {
      const saved = await api.saveProvider(preset.id, {
        label: preset.label, kind: preset.kind, baseUrl: preset.baseUrl,
        models: preset.models, keyless: Boolean(preset.keyless), apiKey,
      });
      // Ask the provider what it can run, so nobody has to type model names.
      try {
        const { models } = await api.providerModels(preset.id);
        if (models.length) return await api.saveProvider(preset.id, { models: order(models, preset) });
      } catch { /* a provider that cannot list its models keeps the preset's list */ }
      return saved;
    });
    setAdding(null);
    setKey("");
  }

  if (!state) return <p className="muted small">Loading providers…</p>;

  const usable = state.providers.filter((p) => p.hasKey || p.keyless);

  return (
    <div className="model-settings">
      <p className="muted small">
        Any Anthropic- or OpenAI-compatible endpoint works — a hosted provider, a gateway, or a model running on this
        machine. Keys are kept in <code>~/.content-studio/credentials.json</code>, outside the codebase, and are never
        shown again once saved.
      </p>

      {state.providers.length > 0 && (
        <table className="provider-table">
          <thead>
            <tr><th>Provider</th><th>Key</th><th>Models</th><th /></tr>
          </thead>
          <tbody>
            {state.providers.map((p) => (
              <ProviderRow
                key={p.id}
                provider={p}
                inUse={Boolean(state.defaultModel?.startsWith(p.id + "/"))}
                busy={busy === p.id}
                onKey={(apiKey) => guard(p.id, () => api.saveProvider(p.id, { apiKey }))}
                onRefresh={() => guard(p.id, async () => {
                  const { models } = await api.providerModels(p.id);
                  return api.saveProvider(p.id, { models });
                })}
                onRemove={() => guard(p.id, () => api.removeProvider(p.id))}
              />
            ))}
          </tbody>
        </table>
      )}

      <div className="field">
        <span>Model the AI pane uses</span>
        <select
          value={state.defaultModel ?? ""}
          onChange={(e) => guard("default", () => api.setDefaultModel(e.target.value || null))}
        >
          <option value="">Nothing selected</option>
          {usable.flatMap((p) =>
            p.models.map((m) => (
              <option key={p.id + "/" + m} value={p.id + "/" + m}>{p.label} — {m}</option>
            )),
          )}
        </select>
        {usable.length > 0 && !usable.some((p) => p.models.length) && (
          <span className="muted small">No models listed yet — use the refresh button above to ask a provider what it can run.</span>
        )}
      </div>

      <hr className="rule" />

      {adding?.id === CUSTOM_ID ? (
        <CustomProvider busy={busy === "add"} onAdd={add} onCancel={() => setAdding(null)} />
      ) : adding ? (
        <form className="add-provider" onSubmit={(e) => { e.preventDefault(); add(adding, key); }}>
          <div className="field">
            <span>{adding.label} API key</span>
            <input
              autoFocus
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={adding.keyless ? "Not needed for a local model" : "Paste the key — sent once, then hidden"}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="muted small">
              {adding.keyless
                ? "Expected at " + adding.baseUrl + ". Nothing is sent anywhere else."
                : "Sent to " + adding.baseUrl + " only."}
              {adding.keyUrl && (
                <>
                  {" "}
                  <a
                    href={adding.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => { const u = adding.keyUrl; if (desktop && u) { e.preventDefault(); desktop.openExternal(u); } }}
                  >Where to get one <ExternalLink size={11} /></a>
                </>
              )}
            </span>
          </div>
          <div className="row">
            <button className="primary" type="submit" disabled={busy === "add" || (!adding.keyless && !key.trim())}>
              {busy === "add" ? "Checking…" : "Add provider"}
            </button>
            <button className="ghost" type="button" onClick={() => { setAdding(null); setKey(""); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <span className="muted small">Add a provider</span>
          <div className="row wrap quick">
            {available.map((p) => (
              <button key={p.id} className="chip" onClick={() => { setAdding(p); setKey(""); }}>
                <Plus size={12} /> {p.label}
              </button>
            ))}
            <button className="chip" onClick={() => { setAdding(CUSTOM); setKey(""); }}>
              <Plus size={12} /> Something else
            </button>
          </div>
        </>
      )}

      {err && <div className="error-bar" onClick={() => setErr(null)}>{err}</div>}
    </div>
  );
}

/** Keep a provider's own recommendation first, rather than 300 model names alphabetically. */
function order(models: string[], preset: ProviderPreset): string[] {
  if (!preset.models.length) return models;
  const kept = preset.models.filter((m) => models.includes(m));
  return kept.length ? [...kept, ...models.filter((m) => !kept.includes(m))] : models;
}

function ProviderRow({ provider, inUse, busy, onKey, onRefresh, onRemove }: {
  provider: Provider;
  inUse: boolean;
  busy: boolean;
  onKey: (apiKey: string) => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");

  return (
    <tr className={inUse ? "in-use" : ""}>
      <td>
        <strong>{provider.label}</strong>
        <span className="muted small block ellipsis">{provider.kind} · {provider.baseUrl}</span>
      </td>
      <td>
        {replacing ? (
          <div className="row">
            <input type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="New key" autoComplete="off" />
            <button
              className="icon-btn"
              title="Save this key"
              disabled={!key.trim()}
              onClick={() => { onKey(key); setKey(""); setReplacing(false); }}
            ><Check size={14} /></button>
          </div>
        ) : provider.keyless ? (
          <span className="muted small">none needed</span>
        ) : provider.hasKey ? (
          <button className="ghost small" onClick={() => setReplacing(true)} title="Replace this key">
            <Key size={12} /> {provider.keyHint}{provider.fromEnv ? " (from .env)" : ""}
          </button>
        ) : (
          <button className="ghost small" onClick={() => setReplacing(true)}>Add a key</button>
        )}
      </td>
      <td><span className="muted small">{provider.models.length || "none"}</span></td>
      <td className="row">
        <button className="icon-btn" title="Ask this provider what it can run" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={14} />
        </button>
        <button className="icon-btn danger" title="Remove this provider and its key" disabled={busy} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

function CustomProvider({ busy, onAdd, onCancel }: {
  busy: boolean;
  onAdd: (preset: ProviderPreset, key: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"anthropic" | "openai">("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");

  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(baseUrl);
  const id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return (
    <form
      className="add-provider"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({ id, label: label.trim(), kind, baseUrl: baseUrl.trim(), models: [], keyless: local && !key.trim() }, key);
      }}
    >
      <div className="field">
        <span>Name</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My gateway" autoFocus />
      </div>
      <div className="field">
        <span>API shape</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as "anthropic" | "openai")}>
          <option value="openai">OpenAI-compatible (/chat/completions)</option>
          <option value="anthropic">Anthropic-compatible (/v1/messages)</option>
        </select>
      </div>
      <div className="field">
        <span>Base URL</span>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gateway.example.com/v1" spellCheck={false} />
        <span className="muted small">The part before <code>/chat/completions</code>. Include the version segment if the provider uses one.</span>
      </div>
      <div className="field">
        <span>API key {local && <span className="muted small">— optional for a model on this machine</span>}</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <div className="row">
        <button className="primary" type="submit" disabled={busy || !id || !baseUrl.trim()}>
          {busy ? "Checking…" : "Add provider"}
        </button>
        <button className="ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
