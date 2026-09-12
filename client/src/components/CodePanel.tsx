import { useState } from "react";
import type { Snippet } from "../types";
import { api } from "../api";

interface Props {
  projectId: string;
  snippets: Snippet[];
  onChange: (s: Snippet[]) => void;
}

const LANGS: Snippet["lang"][] = ["python", "node", "bash", "powershell"];

export function CodePanel({ projectId, snippets, onChange }: Props) {
  const [activeId, setActiveId] = useState(snippets[0]?.id ?? "");
  const [running, setRunning] = useState(false);
  const active = snippets.find((s) => s.id === activeId) ?? snippets[0];

  const update = (patch: Partial<Snippet>) => onChange(snippets.map((s) => (s.id === active.id ? { ...s, ...patch } : s)));

  function add() {
    const s: Snippet = { id: `s${Date.now().toString(36)}`, title: `Snippet ${snippets.length + 1}`, lang: "python", code: "" };
    onChange([...snippets, s]);
    setActiveId(s.id);
  }

  function remove() {
    const rest = snippets.filter((s) => s.id !== active.id);
    onChange(rest);
    setActiveId(rest[0]?.id ?? "");
  }

  async function run() {
    setRunning(true);
    try {
      const out = await api.run(active.lang, active.code, projectId);
      update({ lastOutput: out });
    } catch (e) {
      update({ lastOutput: { stdout: "", stderr: (e as Error).message, code: -1, ms: 0 } });
    } finally {
      setRunning(false);
    }
  }

  if (!active) {
    return (
      <div className="panel-body">
        <div className="panel-empty">No snippets yet.</div>
        <button onClick={add}>+ New snippet</button>
      </div>
    );
  }

  return (
    <div className="panel-body code">
      <div className="row wrap">
        <select value={active.id} onChange={(e) => setActiveId(e.target.value)}>
          {snippets.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <button className="ghost small" onClick={add}>+ new</button>
        <button className="ghost small danger" onClick={remove}>delete</button>
      </div>
      <div className="row wrap">
        <input value={active.title} onChange={(e) => update({ title: e.target.value })} placeholder="Title" />
        <select value={active.lang} onChange={(e) => update({ lang: e.target.value as Snippet["lang"] })}>
          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={run} disabled={running} title="Ctrl+Enter">{running ? "Running…" : "▶ Run"}</button>
      </div>
      <textarea
        className="code-editor"
        value={active.code}
        spellCheck={false}
        onChange={(e) => update({ code: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); run(); }
          if (e.key === "Tab") {
            e.preventDefault();
            const t = e.currentTarget, s = t.selectionStart, en = t.selectionEnd;
            update({ code: active.code.slice(0, s) + "    " + active.code.slice(en) });
            requestAnimationFrame(() => t.setSelectionRange(s + 4, s + 4));
          }
        }}
      />
      {active.lastOutput && (
        <pre className={`code-output ${active.lastOutput.code === 0 ? "" : "err"}`}>
          {active.lastOutput.stdout}
          {active.lastOutput.stderr && `\n${active.lastOutput.stderr}`}
          {`\n— exit ${active.lastOutput.code} in ${active.lastOutput.ms} ms`}
        </pre>
      )}
    </div>
  );
}
