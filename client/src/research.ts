export interface ResearchMessage { role: "user" | "assistant"; content: string; createdAt?: string; interrupted?: boolean; model?: string; attachments?: { name: string; kind: "text" | "pdf"; truncated: boolean }[] }
export interface ToolActivity {
  id: string; name: string; arguments: string; status: string; output?: string; createdAt: string;
  approval?: { id: string; kind: "write" | "shell"; path?: string; before?: string | null; after?: string; edit?: { before: string; after: string }; command?: string; shell?: string; cwd?: string };
}
export interface ResearchSession {
  id: string; title: string; status: string; model: string | null; workspace: string;
  messages: ResearchMessage[]; activity: ToolActivity[]; updatedAt: string; lastError?: string;
  plan?: { text: string; status: "pending" | "in_progress" | "complete" }[];
  progress?: { step: number; maxSteps: number; startedAt: string; finishedAt?: string };
}
export function exportResearch(session: ResearchSession): string {
  const lines = [`# ${session.title}`, "", `Vajra · ${session.status} · ${session.updatedAt}`, ""];
  if (session.plan?.length) lines.push("## Task plan", "", ...session.plan.map((s) => `- [${s.status === "complete" ? "x" : " "}] ${s.text}${s.status === "in_progress" ? " (in progress)" : ""}`), "");
  for (const message of session.messages) if (message.content) lines.push(`## ${message.role === "user" ? "You" : "Vajra"}${message.interrupted ? " (interrupted)" : ""}`, "", message.content, ...(message.attachments?.length ? ["", ...message.attachments.map((file) => `Attachment: ${file.name}${file.truncated ? " (excerpt)" : ""}`)] : []), "");
  if (session.activity.length) lines.push("## Tool activity", "", ...session.activity.map((a) => `- ${a.name}: ${a.status}`), "");
  return lines.join("\n");
}
export interface ResearchEvent { session?: ResearchSession; activity?: ToolActivity; text?: string; error?: string; notice?: string; done?: boolean }
export interface SearchStatus { provider: string; hasKey: boolean; keyHint: string; secure: boolean; unreadable: boolean }
const base = "/api/research";
const query = (projectId: string | null) => projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
async function json<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(base + url, body !== undefined ? { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Research request failed");
  return result;
}
export const research = {
  list: (projectId: string | null) => json<{ sessions: Pick<ResearchSession, "id" | "title" | "status" | "updatedAt">[]; workspace: string }>(`/sessions${query(projectId)}`),
  load: (projectId: string | null, id: string) => json<ResearchSession>(`/sessions/${id}${query(projectId)}`),
  create: (projectId: string | null, importLegacy = false) => json<ResearchSession>("/sessions", { projectId, importLegacy }),
  rename: (projectId: string | null, id: string, title: string) => json<ResearchSession>(`/sessions/${id}`, { projectId, title }, "PUT"),
  approve: (projectId: string | null, id: string, approvalId: string, allow: boolean) => json(`/sessions/${id}/approval`, { projectId, approvalId, allow }),
  stop: (projectId: string | null, id: string) => json(`/sessions/${id}/stop`, { projectId }),
  searchStatus: () => json<SearchStatus>("/search"),
  saveSearch: (apiKey: string) => json<SearchStatus>("/search", { apiKey }, "PUT"),
  async run(id: string, body: unknown, signal: AbortSignal, onEvent: (event: ResearchEvent) => void) {
    const response = await fetch(`${base}/sessions/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Could not start research"); }
    if (!response.body) throw new Error("The server returned no response stream");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "", complete = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n"); buffer = events.pop() || "";
        for (const item of events) {
          if (!item.startsWith("data: ")) continue;
          const event: ResearchEvent = JSON.parse(item.slice(6));
          if (event.done) complete = true;
          onEvent(event);
        }
        if (done) break;
      }
      if (!complete && !signal.aborted) throw new Error("Connection lost. Reopen the conversation to recover its saved progress.");
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  },
};
