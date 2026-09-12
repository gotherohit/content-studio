// API keys and the models they unlock.
//
// Keys live in ~/.content-studio/credentials.json — their own file, beside the project
// index but never in it, and never anywhere inside the codebase. A key that goes in
// never comes back out: the rest of the app asks this module to make a request, or asks
// whether a key exists, and gets a masked hint at most. That way a key cannot leak
// through the UI, a screenshot, a recording, or a commit.
//
// On the desktop each key is also encrypted at rest with the operating system's own
// facility — DPAPI on Windows, via Electron's safeStorage — so the ciphertext is bound
// to this Windows account. Someone who copies the file to another machine, or reads it
// from another account, gets nothing. Without the desktop shell there is nothing to
// encrypt with, and the file falls back to owner-only plaintext; `secure` says which.
import fs from "node:fs/promises";
import path from "node:path";
import { createVault } from "./vault.js";

/** What a provider speaks. Everything in the wild is one of these two shapes. */
export const KINDS = ["anthropic", "openai"];

/**
 * Ready-made providers, so adding one is a click and a paste rather than research.
 * `kind` is the wire protocol, not the company: most of these are OpenAI-compatible.
 */
export const PRESETS = [
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", keyUrl: "https://console.anthropic.com/settings/keys", models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"] },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", models: [] },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", models: [] },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys", models: [] },
  { id: "together", label: "Together", kind: "openai", baseUrl: "https://api.together.xyz/v1", keyUrl: "https://api.together.ai/settings/api-keys", models: [] },
  { id: "gemini", label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", models: [] },
  { id: "xai", label: "xAI", kind: "openai", baseUrl: "https://api.x.ai/v1", keyUrl: "https://console.x.ai/", models: [] },
  { id: "ollama", label: "Ollama (on this machine)", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", keyless: true, models: [] },
  { id: "lmstudio", label: "LM Studio (on this machine)", kind: "openai", baseUrl: "http://127.0.0.1:1234/v1", keyless: true, models: [] },
];

const safeId = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,40}$/i.test(id);

/** A key is shown as a hint, never in full, and only enough of it to recognise. */
const hint = (key) => (key && key.length > 8 ? `…${key.slice(-4)}` : key ? "…" : "");

export function createCredentials({ appDirFn, vault = createVault() }) {
  const file = () => path.join(appDirFn(), "credentials.json");
  let store = { providers: [], defaultModel: null };
  let secure = false;

  /**
   * A key is written as `apiKeyEnc` when it could be encrypted and `apiKey` when it could
   * not, so the file says what it holds rather than relying on a flag that a hand edit
   * could desynchronise from the data.
   */
  async function persist() {
    secure = await vault.available();
    const providers = [];
    for (const p of store.providers) {
      const { apiKey, ...rest } = p;
      if (!apiKey) { providers.push(rest); continue; }
      const sealed = await vault.encrypt(apiKey);
      providers.push(sealed ? { ...rest, apiKeyEnc: sealed } : { ...rest, apiKey });
    }
    const body = { encryption: secure ? "os" : "none", providers, defaultModel: store.defaultModel };
    // 0o600: this user only. Windows ignores the mode, but its own ACL on a profile
    // folder already limits the file to the account that owns it.
    await fs.writeFile(file(), JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
    await fs.chmod(file(), 0o600).catch(() => {});
  }

  async function load() {
    secure = await vault.available();
    let raw = null;
    try { raw = JSON.parse(await fs.readFile(file(), "utf8")); } catch { /* first run */ }

    const providers = [];
    let rewrite = false;
    for (const p of Array.isArray(raw?.providers) ? raw.providers : []) {
      const { apiKeyEnc, apiKey, ...rest } = p;
      if (apiKeyEnc) {
        const opened = await vault.decrypt(apiKeyEnc);
        // A blob this account cannot open is kept, not dropped: the provider simply has
        // no key until one is pasted again, and nothing vanishes from the file silently.
        providers.push(opened ? { ...rest, apiKey: opened } : { ...rest, apiKeyEnc, unreadable: true });
        continue;
      }
      // A key written before encryption was available gets sealed on the way through.
      if (apiKey && secure) rewrite = true;
      providers.push(apiKey ? { ...rest, apiKey } : rest);
    }

    store = { providers, defaultModel: raw?.defaultModel ?? null };
    await adoptEnv();
    if (rewrite) await persist();
    return store;
  }

  /**
   * An earlier Content Studio read ANTHROPIC_API_KEY from .env. Anyone upgrading keeps
   * working: the key is adopted once, and .env still wins for that provider afterwards
   * so a key in the environment is never silently replaced by a stale stored one.
   */
  async function adoptEnv() {
    const envKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
    if (!envKey || store.providers.some((p) => p.id === "anthropic")) return;
    const preset = PRESETS.find((p) => p.id === "anthropic");
    store.providers.push({ ...preset, apiKey: envKey, fromEnv: true, models: preset.models });
    store.defaultModel ??= `anthropic/${process.env.ANTHROPIC_MODEL || preset.models[0]}`;
    await persist();
  }

  const find = (id) => store.providers.find((p) => p.id === id) ?? null;

  /** Everything the UI is allowed to know. */
  const list = () => ({
    providers: store.providers.map((p) => ({
      id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl,
      models: p.models ?? [], keyless: Boolean(p.keyless),
      hasKey: Boolean(p.apiKey), keyHint: hint(p.apiKey), fromEnv: Boolean(p.fromEnv),
      unreadable: Boolean(p.unreadable),
    })),
    secure,
    defaultModel: store.defaultModel,
    presets: PRESETS.map(({ keyUrl, ...p }) => ({ ...p, keyUrl })),
  });

  /**
   * Add or change a provider. An absent `apiKey` leaves the stored one alone, so the UI
   * can edit a base URL or a model list without ever holding the key.
   */
  async function save(id, patch = {}) {
    if (!safeId(id)) throw new Error("A provider id may only contain letters, numbers, dashes and underscores");
    const kind = patch.kind ?? find(id)?.kind ?? "openai";
    if (!KINDS.includes(kind)) throw new Error(`Unknown provider kind: ${kind}`);

    const existing = find(id);
    const next = {
      id,
      label: patch.label ?? existing?.label ?? id,
      kind,
      baseUrl: (patch.baseUrl ?? existing?.baseUrl ?? "").replace(/\/+$/, ""),
      models: patch.models ?? existing?.models ?? [],
      keyless: patch.keyless ?? existing?.keyless ?? false,
      apiKey: patch.apiKey !== undefined && patch.apiKey !== "" ? patch.apiKey : existing?.apiKey,
      // once edited here, the stored value is the real one
      fromEnv: patch.apiKey ? false : existing?.fromEnv,
      unreadable: patch.apiKey ? false : existing?.unreadable,
      // A key sealed for another account must survive an edit made here — otherwise
      // renaming a provider from a session that cannot read it would destroy it.
      apiKeyEnc: patch.apiKey ? undefined : existing?.apiKeyEnc,
    };
    if (!next.baseUrl) throw new Error("A provider needs a base URL");

    store.providers = existing
      ? store.providers.map((p) => (p.id === id ? next : p))
      : [...store.providers, next];
    if (!store.defaultModel && next.models.length) store.defaultModel = `${id}/${next.models[0]}`;
    await persist();
    return list();
  }

  async function remove(id) {
    store.providers = store.providers.filter((p) => p.id !== id);
    if (store.defaultModel?.startsWith(`${id}/`)) store.defaultModel = null;
    await persist();
    return list();
  }

  async function setDefaultModel(ref) {
    if (ref && !resolve(ref)) throw new Error("That model is not available from any configured provider");
    store.defaultModel = ref || null;
    await persist();
    return list();
  }

  /**
   * Turn "provider/model" into something callable. Model ids may contain slashes
   * themselves — OpenRouter's look like "anthropic/claude-opus-5" — so only the first
   * segment is the provider.
   */
  function resolve(ref) {
    const wanted = ref || store.defaultModel;
    if (!wanted) return null;
    const cut = wanted.indexOf("/");
    if (cut < 1) return null;
    const provider = find(wanted.slice(0, cut));
    const model = wanted.slice(cut + 1);
    if (!provider || !model) return null;
    if (!provider.apiKey && !provider.keyless) return null;
    return { provider, model, ref: wanted };
  }

  const configured = () => store.providers.some((p) => p.apiKey || p.keyless);

  return { load, list, save, remove, setDefaultModel, resolve, configured, find };
}
