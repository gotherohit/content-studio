// WebSocket <-> pseudo-terminal bridge. One PTY per socket.
import { WebSocketServer } from "ws";
import pty from "node-pty";
import fs from "node:fs/promises";

export function attachTerminal(httpServer, { cwdFor }) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/api/term") return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const cols = Number(url.searchParams.get("cols") || 100);
    const rows = Number(url.searchParams.get("rows") || 30);
    const cwd = cwdFor(url.searchParams.get("project"));
    const shell = process.platform === "win32" ? (process.env.RS_SHELL || "powershell.exe") : process.env.SHELL || "bash";
    let term;
    try {
      await fs.mkdir(cwd, { recursive: true });
      term = pty.spawn(shell, process.platform === "win32" ? ["-NoLogo"] : [], {
        name: "xterm-256color", cols, rows, cwd, env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
    } catch (e) {
      ws.send(`\r\n[terminal] failed to start ${shell}: ${e.message}\r\n`);
      ws.close();
      return;
    }
    term.onData((d) => { if (ws.readyState === ws.OPEN) ws.send(d); });
    term.onExit(({ exitCode }) => { if (ws.readyState === ws.OPEN) { ws.send(`\r\n[process exited with code ${exitCode}]\r\n`); ws.close(); } });
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { term.write(raw.toString()); return; }
      if (msg.type === "input") term.write(msg.data);
      else if (msg.type === "resize") term.resize(Math.max(2, msg.cols | 0), Math.max(1, msg.rows | 0));
    });
    ws.on("close", () => { try { term.kill(); } catch { /* already gone */ } });
  });
}
