import type { DeckRender, Project, ProjectSummary, Snippet, SourceFile } from "./types";

/** Parse a JSON response, turning a down or non-JSON API into a readable error. */
async function j<T>(r: Response): Promise<T> {
  const text = await r.text();
  let body: { error?: string } | null = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) throw new Error(body?.error || `${r.status} ${r.statusText || "request failed"}`);
  if (body === null) throw new Error("The API server is not responding. Is `npm run dev` still running?");
  return body as T;
}

export interface JupyterStatus { installed: boolean | null; running: boolean; url: string | null; log: string; port: number }

/** POST and read a text/event-stream, calling onText for each text chunk. Resolves with the final event. */
async function sse(url: string, body: unknown, onText: (t: string) => void): Promise<Record<string, unknown>> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "", last: Record<string, unknown> = {};
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      const ev = JSON.parse(part.slice(6));
      if (ev.text) onText(ev.text);
      if (ev.error) throw new Error(ev.error);
      last = ev;
    }
  }
  return last;
}

export interface AppConfig {
  appDir?: string; apiPort: number; root?: string;
  canControlWindows?: boolean; powerPoint?: boolean; libreOffice?: boolean;
}

/** A model, addressed as "<provider>/<model>". Model ids may contain slashes of their own. */
export type ModelRef = string;

/** What the server will say about a provider. Never the key itself. */
export interface Provider {
  id: string; label: string; kind: "anthropic" | "openai"; baseUrl: string;
  models: string[]; keyless: boolean; hasKey: boolean; keyHint: string; fromEnv: boolean;
  /** Its stored key was encrypted for a different account or machine and cannot be read. */
  unreadable: boolean;
}
export interface ProviderPreset {
  id: string; label: string; kind: "anthropic" | "openai"; baseUrl: string;
  models: string[]; keyless?: boolean; keyUrl?: string;
}
export interface ProviderPatch {
  label: string; kind: "anthropic" | "openai"; baseUrl: string; models: string[]; keyless: boolean; apiKey: string;
}
export interface AiProviders {
  providers: Provider[];
  defaultModel: ModelRef | null;
  presets: ProviderPreset[];
  /** Whether stored keys are encrypted by the operating system rather than kept as text. */
  secure: boolean;
}
export interface AiStatus {
  configured: boolean;
  model: ModelRef | null;
  models: { ref: ModelRef; provider: string; model: string }[];
}
export interface SiteProbe { status: number; statusText: string; contentType: string; location: string | null; body: string }
export interface InputTarget { id: string | number; title: string; x: number; y: number; w: number; h: number; cx?: number; cy?: number; cw?: number; ch?: number }

export const api = {
  config: () => fetch("/api/config").then((r) => j<AppConfig>(r)),
  /** Open the operating system's folder dialog; resolves with null if dismissed. */
  pickFolder: (description: string, startIn = "") =>
    fetch("/api/pick-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description, startIn }) }).then((r) => j<{ dir: string | null }>(r)),

  /** Move this project's whole folder somewhere else. */
  setProjectFolder: (id: string, dir: string) =>
    fetch(`/api/projects/${id}/folder`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir }) }).then((r) => j<{ dir: string }>(r)),
  openProjectFolder: (dir: string) =>
    fetch("/api/projects/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir }) }).then((r) => j<{ id: string; title: string; dir: string }>(r)),
  reveal: (dir: string) =>
    fetch("/api/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir }) }).then((r) => j<{ ok: true }>(r)),

  renderDeck: (projectId: string, name: string) =>
    fetch(`/api/projects/${projectId}/deck/${encodeURIComponent(name)}/render`, { method: "POST" }).then((r) => j<DeckRender>(r)),
  deckSlideUrl: (projectId: string, name: string, slide: string) =>
    `/api/projects/${projectId}/deck/${encodeURIComponent(name)}/${encodeURIComponent(slide)}`,
  presentDeck: (projectId: string, name: string) =>
    fetch(`/api/projects/${projectId}/deck/${encodeURIComponent(name)}/present`, { method: "POST" }).then((r) => j<{ ok: true }>(r)),

  listProjects: () => fetch("/api/projects").then((r) => j<ProjectSummary[]>(r)),
  createProject: (title: string, dir?: string) =>
    fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, dir }) }).then((r) => j<Project>(r)),
  getProject: (id: string) => fetch(`/api/projects/${id}`).then((r) => j<Project>(r)),
  saveProject: (p: Project) =>
    fetch(`/api/projects/${p.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }).then((r) => j<{ ok: true; updatedAt: string }>(r)),
  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
  fetchArticle: (url: string, refresh = false) =>
    fetch("/api/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, refresh }) }).then((r) =>
      j<{ url: string; title: string; byline: string | null; siteName: string | null; excerpt: string | null; content: string; textContent: string; fetchedAt: string }>(r),
    ),
  run: (lang: Snippet["lang"], code: string, projectId: string) =>
    fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang, code, projectId }) }).then((r) =>
      j<{ stdout: string; stderr: string; code: number; ms: number }>(r),
    ),
  /** Ask the target what it answers with, before trying to frame it. */
  probeSite: (url: string) =>
    fetch("/api/site/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => j<SiteProbe>(r)),

  /** Ask the server for a local URL that can be framed (strips frame blocking, proxies websockets). */
  registerSite: (url: string, mode: "app" | "read" = "app") =>
    fetch("/api/site/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, mode }) }).then((r) => j<{ url: string }>(r)),

  listFiles: (projectId: string) => fetch(`/api/projects/${projectId}/sources`).then((r) => j<SourceFile[]>(r)),
  uploadFile: (projectId: string, file: File) =>
    fetch(`/api/projects/${projectId}/sources/${encodeURIComponent(file.name)}`, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file }).then((r) => j<SourceFile>(r)),
  deleteFile: (projectId: string, name: string) =>
    fetch(`/api/projects/${projectId}/sources/${encodeURIComponent(name)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
  fileUrl: (projectId: string, name: string) => `/api/projects/${projectId}/sources/${encodeURIComponent(name)}`,

  inputTargets: () => fetch("/api/input/targets").then((r) => j<{ available: boolean; error?: string; windows: InputTarget[]; screens: InputTarget[] }>(r)),
  sendInput: (msg: Record<string, unknown>) =>
    fetch("/api/input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) }).then((r) => j<{ ok: boolean }>(r)),

  jupyterStatus: () => fetch("/api/jupyter/status").then((r) => j<JupyterStatus>(r)),
  jupyterStart: (projectId: string) => fetch("/api/jupyter/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId }) }).then((r) => j<JupyterStatus>(r)),
  jupyterStop: () => fetch("/api/jupyter/stop", { method: "POST" }).then((r) => j<JupyterStatus>(r)),
  jupyterInstall: (onText: (t: string) => void) => sse("/api/jupyter/install", {}, onText),
  aiStatus: () => fetch("/api/ai/status").then((r) => j<AiStatus>(r)),
  aiProviders: () => fetch("/api/ai/providers").then((r) => j<AiProviders>(r)),
  saveProvider: (id: string, patch: Partial<ProviderPatch>) =>
    fetch(`/api/ai/providers/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => j<AiProviders>(r)),
  removeProvider: (id: string) => fetch(`/api/ai/providers/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => j<AiProviders>(r)),
  setDefaultModel: (model: string | null) =>
    fetch("/api/ai/default-model", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) }).then((r) => j<AiProviders>(r)),
  /** Also the cheapest way to prove a key works. */
  providerModels: (id: string, apiKey?: string) =>
    fetch(`/api/ai/providers/${encodeURIComponent(id)}/models`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) }).then((r) => j<{ models: string[] }>(r)),
  /** Streams assistant text; resolves with the full text. */
  ai: async (
    messages: { role: "user" | "assistant"; content: string }[],
    context: string,
    onDelta: (text: string) => void,
    model?: string | null,
  ): Promise<string> => {
    const r = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, context, model }) });
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        const ev = JSON.parse(part.slice(6));
        if (ev.text) { full += ev.text; onDelta(ev.text); }
        if (ev.error) throw new Error(ev.error);
      }
    }
    return full;
  },
};
