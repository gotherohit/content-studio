import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ChatMessage, Source } from "../types";
import { api } from "../api";

interface Props {
  chat: ChatMessage[];
  onChange: (c: ChatMessage[]) => void;
  source: Source | null;
  allSources: Source[];
}

const QUICK = [
  ["Summarize", "Summarize this article in 5 bullet points a viewer can follow, then list the 3 claims that most need verification."],
  ["Counterpoints", "What are the strongest counterarguments or missing context to this piece? Who would disagree and why?"],
  ["Explain simply", "Explain the core idea of this article to a smart 15-year-old, with one concrete analogy."],
  ["Video angles", "Suggest 5 angles for a YouTube video on this, each with a hook line and a demo or example I could show on screen."],
  ["Highlights → script", "Using my highlights and comments, draft a 2-minute spoken script segment in my own analytical voice."],
];

export function AiPanel({ chat, onChange, source, allSources }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [scope, setScope] = useState<"current" | "all">("current");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.aiStatus().then(setStatus).catch(() => setStatus({ configured: false, model: "?" })); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);

  function buildContext(): string {
    const list = scope === "all" ? allSources : source ? [source] : [];
    return list
      .map((s) => {
        const hl = s.highlights.map((h) => `- "${h.text}"${h.comment ? ` — creator note: ${h.comment}` : ""}`).join("\n");
        return `## ${s.title}\nURL: ${s.url}\n\n${s.textContent.slice(0, 60000)}\n\n### Creator highlights\n${hl || "(none)"}`;
      })
      .join("\n\n---\n\n");
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next: ChatMessage[] = [...chat, { role: "user", content: text.trim() }, { role: "assistant", content: "" }];
    onChange(next);
    setInput("");
    setBusy(true);
    let acc = "";
    try {
      await api.ai(next.slice(0, -1), buildContext(), (d) => {
        acc += d;
        onChange([...next.slice(0, -1), { role: "assistant", content: acc }]);
      });
    } catch (e) {
      onChange([...next.slice(0, -1), { role: "assistant", content: `${acc}\n\n**Error:** ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-body ai">
      <div className="row between wrap">
        <span className="muted small">
          {status ? (status.configured ? `model: ${status.model}` : "No API key: set ANTHROPIC_API_KEY in .env or run `ant auth login`") : "…"}
        </span>
        <select value={scope} onChange={(e) => setScope(e.target.value as "current" | "all")}>
          <option value="current">context: current source</option>
          <option value="all">context: all sources</option>
        </select>
        <button className="ghost small" onClick={() => onChange([])} disabled={!chat.length}>clear</button>
      </div>
      <div className="row wrap quick">
        {QUICK.map(([label, prompt]) => (
          <button key={label} className="chip" onClick={() => send(prompt)} disabled={busy}>{label}</button>
        ))}
      </div>
      <div className="chat">
        {chat.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "user" ? <p>{m.content}</p> : (
              <div className="md-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(m.content || "…") as string) }} />
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <textarea
        className="chat-input"
        placeholder="Ask about the source… (Enter to send, Shift+Enter newline)"
        value={input}
        rows={3}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
      />
    </div>
  );
}
