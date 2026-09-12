import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const QUICK: [string, string][] = [
  ["claude", "claude"],
  ["codex", "codex"],
  ["python", "python"],
  ["node", "node"],
  ["clear", "clear"],
];

/** A real shell (PowerShell on Windows) over a PTY. Run any CLI harness here. */
export function TerminalPane({ dark, projectId }: { dark: boolean; projectId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");
  const [gen, setGen] = useState(0);

  useEffect(() => {
    const el = host.current!;
    const term = new Terminal({
      cursorBlink: true, fontSize: 14, fontFamily: "Consolas, 'Cascadia Mono', 'JetBrains Mono', monospace",
      theme: dark ? { background: "#0a0c10" } : { background: "#1b1f27" }, scrollback: 5000, allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    termRef.current = term;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/term?cols=${term.cols}&rows=${term.rows}&project=${encodeURIComponent(projectId)}`);
    wsRef.current = ws;
    setState("connecting");
    ws.onopen = () => { setState("open"); term.focus(); };
    ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : "");
    ws.onclose = () => { setState("closed"); term.write("\r\n\x1b[90m[disconnected — click Restart]\x1b[0m\r\n"); };
    term.onData((d) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "input", data: d })); });

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* not visible */ }
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    });
    ro.observe(el);
    return () => { ro.disconnect(); ws.close(); term.dispose(); };
  }, [gen, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { termRef.current?.options && (termRef.current.options.theme = dark ? { background: "#0a0c10" } : { background: "#1b1f27" }); }, [dark]);

  const run = (cmd: string) => { wsRef.current?.send(JSON.stringify({ type: "input", data: cmd + "\r" })); termRef.current?.focus(); };

  return (
    <div className="terminal-pane">
      <div className="row wrap term-bar">
        {QUICK.map(([label, cmd]) => <button key={label} className="chip" onClick={() => run(cmd)} disabled={state !== "open"}>{label}</button>)}
        <span className="grow" />
        <span className={`muted small`}>{state}</span>
        {state === "closed" && <button className="ghost small" onClick={() => setGen((g) => g + 1)}>Restart</button>}
      </div>
      <div ref={host} className="terminal-host" />
    </div>
  );
}
