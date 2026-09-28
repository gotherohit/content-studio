import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { ArrowUp, ExternalLink, FileDown, Grip, Maximize2, Minimize2, Square, X } from "lucide-react";
import type { Highlight, Source } from "../types";
import type { AiStatus } from "../api";
import { api } from "../api";
import { research, type ResearchSession } from "../research";
import { inlineVajraLayout, resizeInlineVajra, type VajraBounds, type VajraSize } from "../inline-vajra-size";
import { inlineVajraFeedback } from "../inline-vajra-feedback";
import { VajraMark } from "./VajraMark";

const SIZE_KEY = "inlineVajraSize";
const savedSize = (): VajraSize | null => {
  try {
    const value = JSON.parse(localStorage.getItem(SIZE_KEY) || "null");
    return Number.isFinite(value?.width) && Number.isFinite(value?.height) ? value : null;
  } catch { return null; }
};
const rememberSize = (value: VajraSize | null) => {
  try { if (value) localStorage.setItem(SIZE_KEY, JSON.stringify(value)); else localStorage.removeItem(SIZE_KEY); } catch { /* private window */ }
};

interface Props {
  projectId: string;
  source: Source;
  highlight: Highlight;
  onAttach: (sessionId: string) => void;
  onSave: (session: ResearchSession, format: "md" | "pdf") => Promise<void>;
  onOpenFull: (sessionId: string) => void;
  onSettings: () => void;
  onClose: () => void;
}

export function InlineVajra({ projectId, source, highlight, onAttach, onSave, onOpenFull, onSettings, onClose }: Props) {
  const ids = highlight.vajraSessions ?? [];
  const [selected, setSelected] = useState(ids.at(-1) || "");
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [model, setModel] = useState("");
  const [question, setQuestion] = useState("");
  const [contextUrl, setContextUrl] = useState("");
  const [partial, setPartial] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preferred, setPreferred] = useState<VajraSize | null>(savedSize);
  const [expanded, setExpanded] = useState(false);
  const [bounds, setBounds] = useState<VajraBounds | null>(null);
  const abort = useRef<AbortController | null>(null);
  const card = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; start: VajraSize; current: VajraSize; previous: VajraSize | null } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);

  useLayoutEffect(() => {
    const parent = card.current?.parentElement;
    if (!parent) return;
    const measure = () => setBounds((old) => old?.width === parent.clientWidth && old.height === parent.clientHeight ? old : { width: parent.clientWidth, height: parent.clientHeight });
    measure();
    const observer = new ResizeObserver(measure); observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    api.aiStatus().then((s) => { setStatus(s); setModel(s.model && s.models.some((m) => m.ref === s.model) ? s.model : s.models[0]?.ref || ""); }).catch((e) => setError(e.message));
    input.current?.focus();
    return () => { generation.current++; abort.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!selected || busy) { if (!selected) setSession(null); return; }
    const version = ++generation.current;
    research.load(projectId, selected).then((s) => { if (version === generation.current) { setSession(s); if (s.model) setModel(s.model); } }).catch((e) => { if (version === generation.current) setError(e.message); });
  }, [projectId, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [session, partial]);
  useEffect(() => {
    if (busy || session?.status !== "running") return;
    const timer = window.setInterval(() => research.load(projectId, session.id).then(setSession).catch((e) => setError(e.message)), 1500);
    return () => window.clearInterval(timer);
  }, [busy, projectId, session?.id, session?.status]);

  async function send() {
    const text = question.trim();
    if (!text || busy || !model) return;
    setBusy(true); setError(""); setNotice(""); setPartial("");
    const controller = new AbortController(); abort.current = controller;
    let current = session;
    try {
      if (!current) {
        current = await research.create(projectId);
        setSession(current); setSelected(current.id); onAttach(current.id);
      }
      const id = current.id;
      await research.run(id, { projectId, message: text, model, mode: "explain", context: "source", sourceId: source.id,
        highlightId: highlight.id, highlightText: highlight.text, ...(contextUrl.trim() ? { contextUrl: contextUrl.trim() } : {}) }, controller.signal, (event) => {
        if (event.session) { setSession(event.session); setPartial(""); setQuestion(""); }
        if (event.text) setPartial((old) => old + event.text);
        if (event.error) setError(event.error);
        if (event.notice) setNotice(event.notice);
      });
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally {
      abort.current = null; setBusy(false);
      if (current) await research.load(projectId, current.id).then(setSession).catch((e) => setError(e.message));
    }
  }
  async function stop() {
    if (!session) return;
    try { await research.stop(projectId, session.id); } catch (e) { setError((e as Error).message); }
  }
  async function save(format: "md" | "pdf") {
    if (!session) return;
    setSaving(true); setError(""); setNotice("");
    try { await onSave(session, format); setNotice(`Saved as a linked ${format.toUpperCase()} source.`); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  const running = busy || session?.status === "running";
  const answered = session?.messages.some((m) => m.role === "assistant" && m.content.trim() && !m.interrupted);
  const feedback = inlineVajraFeedback(session);
  const layout = bounds ? inlineVajraLayout(preferred, bounds, expanded) : null;
  const resetSize = () => { setPreferred(null); setExpanded(false); rememberSize(null); };
  const resizeKey = (key: string) => {
    if (key === "Home") { resetSize(); return; }
    const element = card.current, parent = element?.parentElement;
    if (!element || !parent) return;
    const start = { width: element.offsetWidth, height: element.offsetHeight };
    const next = resizeInlineVajra(start, key === "ArrowLeft" ? -32 : key === "ArrowRight" ? 32 : 0,
      key === "ArrowDown" ? 32 : key === "ArrowUp" ? -32 : 0, { width: parent.clientWidth, height: parent.clientHeight });
    setPreferred(next); rememberSize(next);
  };

  return <aside ref={card} className={`inline-vajra${layout?.height != null ? " sized" : ""}`} aria-label="Ask Vajra about this passage" style={layout ? { width: layout.width, height: layout.height ?? undefined, maxHeight: layout.maxHeight, top: layout.top, right: layout.right } : undefined} onMouseDown={(e) => e.stopPropagation()}>
    <div className="inline-vajra-head"><span className="vajra-heading-mark"><VajraMark size={20} /></span><strong>Ask Vajra</strong><span className="grow" /><button className="icon-btn" title={expanded ? "Restore Vajra window" : "Expand Vajra window"} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button><button className="icon-btn" title="Close" onClick={onClose}><X size={15} /></button></div>
    <blockquote className="inline-vajra-quote">{highlight.text}</blockquote>
    {ids.length > 0 && <div className="inline-vajra-history"><select aria-label="Questions about this highlight" value={selected} disabled={running} onChange={(e) => { setSelected(e.target.value); setError(""); }}>
      {!selected && <option value="">New question</option>}
      {ids.map((id, i) => <option key={id} value={id}>Question {i + 1}</option>)}
    </select><button className="ghost small" disabled={running} onClick={() => { setSelected(""); setSession(null); setQuestion(""); }}>New question</button></div>}
    <div className="inline-vajra-thread" ref={scroll}>
      {session?.messages.map((message, i) => <div key={i} className={`inline-vajra-message ${message.role}`}>
        <span>{message.role === "user" ? "You" : "Vajra"}</span>
        {message.role === "user" ? <p>{message.content}</p> : <div className="md-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(message.content) as string) }} />}
        {message.interrupted && <span className="inline-vajra-interrupted">Interrupted response</span>}
      </div>)}
      {partial && <div className="inline-vajra-message assistant"><span>Vajra</span><div className="md-preview" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(partial) as string) }} /></div>}
      {running && <p className="muted small" role="status">{partial ? "Answering…" : "Reading the source…"}</p>}
    </div>
    {(error || feedback) && <div className={error || feedback?.kind === "error" ? "error-bar" : "note-bar"} role={error || feedback?.kind === "error" ? "alert" : "status"}>{error || feedback?.message}</div>}
    {notice && <div className="note-bar" role="status">{notice}</div>}
    <form className="inline-vajra-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea ref={input} aria-label="Question for Vajra" placeholder={session ? "Ask a follow-up…" : "Ask about this passage…"} rows={2} maxLength={16000} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <input type="url" aria-label="Additional URL context" placeholder="Optional public URL for more context" maxLength={2048} value={contextUrl} onChange={(e) => setContextUrl(e.target.value)} />
      <div className="row"><select aria-label="Vajra model" value={model} disabled={running} onChange={(e) => setModel(e.target.value)}><option value="">Choose model</option>{status?.models.map((m) => <option key={m.ref} value={m.ref}>{m.provider} — {m.model}</option>)}</select>
        {running ? <button type="button" className="icon-btn" title="Stop" onClick={() => void stop()}><Square size={15} /></button> : <button className="primary small" disabled={!question.trim() || !model} title="Ask Vajra"><ArrowUp size={15} /> Ask</button>}
      </div>
      {status && !status.models.length && <button type="button" className="ghost small" onClick={onSettings}>Configure a model</button>}
    </form>
    {session && <div className="inline-vajra-actions">
      <button className="ghost small" disabled={running} onClick={() => onOpenFull(session.id)}><ExternalLink size={13} /> Open in Vajra</button>
      <span className="grow" />
      <button className="ghost small" disabled={!answered || running || saving} onClick={() => void save("md")} title="Save conversation as a linked Markdown source"><FileDown size={13} /> Markdown</button>
      <button className="ghost small" disabled={!answered || running || saving} onClick={() => void save("pdf")} title="Save conversation as a linked PDF source"><FileDown size={13} /> PDF</button>
    </div>}
    {!expanded && <button type="button" className="inline-vajra-resize" aria-label="Resize Vajra window" title="Drag left and down to resize. Arrow keys resize; Home or double-click resets."
      onPointerDown={(e) => { const element = card.current; if (!element) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); const start = { width: element.offsetWidth, height: element.offsetHeight }; drag.current = { x: e.clientX, y: e.clientY, start, current: start, previous: preferred }; }}
      onPointerMove={(e) => { const move = drag.current, parent = card.current?.parentElement; if (!move || !parent) return; const next = resizeInlineVajra(move.start, e.clientX - move.x, e.clientY - move.y, { width: parent.clientWidth, height: parent.clientHeight }); move.current = next; setPreferred(next); }}
      onPointerUp={(e) => { const move = drag.current; if (!move) return; drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); rememberSize(move.current); }}
      onPointerCancel={() => { const move = drag.current; drag.current = null; if (move) setPreferred(move.previous); }}
      onKeyDown={(e) => { if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); resizeKey(e.key); }}
      onDoubleClick={resetSize}><Grip size={14} /></button>}
  </aside>;
}
