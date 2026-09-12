// A real browser, shown inside a pane.
//
// Sites like Colab, Drive and OneDrive refuse to be framed, and their sign-in pages
// refuse outright. Proxying them would mean stripping the protections they ship and
// holding your Google session in this process, which is a bad trade for a third-party
// account. So instead of faking a browser, the app drives a real one: Chrome runs on a
// profile of its own, its frames are streamed into the pane, and clicks and keys are
// sent back. Credentials stay in Chrome, over TLS, with the true origin. This process
// never sees them.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const CANDIDATES = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

async function findBrowser() {
  for (const c of CANDIDATES) {
    if (!c || c.includes("undefined")) continue;
    try { await fs.access(c); return c; } catch { /* next */ }
  }
  return null;
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });

export function createBrowser({ profileDirFn }) {
  let child = null;
  let port = 0;
  let exe = null;

  const status = () => ({ available: Boolean(exe), running: Boolean(child), port });

  async function detect() {
    exe ??= await findBrowser();
    return Boolean(exe);
  }

  /** Start Chrome once, on its own profile, positioned off screen because the pane is the window. */
  async function ensure() {
    if (child) return;
    if (!(await detect())) throw new Error("No Chrome or Edge found to use as the browser pane");
    const profile = profileDirFn();
    await fs.mkdir(profile, { recursive: true });
    port = await freePort();
    child = spawn(exe, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      // keep painting even though the window is not on screen, or the stream would freeze
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--window-size=1440,900",
      "--window-position=-2600,-2600",
      "about:blank",
    ]);
    child.on("exit", () => { child = null; port = 0; });

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 400));
      try { await fetch(`http://127.0.0.1:${port}/json/version`); return; } catch { /* still starting */ }
    }
    throw new Error("The browser did not start in time");
  }

  const cdpList = () => fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());

  /** Open a URL in its own tab and return the tab we will stream. */
  async function openTab(url) {
    await ensure();
    const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (!r.ok) throw new Error(`Could not open a tab (${r.status})`);
    return r.json();
  }

  async function closeTab(targetId) {
    if (!child) return;
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {});
  }

  function stop() {
    try { child?.kill(); } catch { /* already gone */ }
    child = null;
    port = 0;
  }
  process.on("exit", stop);

  /**
   * Bridge one pane to one tab: Chrome's screencast frames go out to the browser,
   * and the pane's mouse and keyboard events come back in.
   */
  function attach(httpServer) {
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/api/browser") return;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });

    wss.on("connection", async (ws, req) => {
      const params = new URL(req.url, "http://localhost").searchParams;
      const startUrl = params.get("url") || "about:blank";
      const say = (o) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o)); };

      let tab, cdp, msgId = 0, targetId = null;
      const pending = new Map();
      const call = (method, p = {}) =>
        new Promise((resolve, reject) => {
          if (cdp?.readyState !== WebSocket.OPEN) return reject(new Error("browser not connected"));
          const id = ++msgId;
          pending.set(id, { resolve, reject });
          cdp.send(JSON.stringify({ id, method, params: p }));
        });

      try {
        tab = await openTab(startUrl);
        targetId = tab.id;
        cdp = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
        await new Promise((res, rej) => { cdp.on("open", res); cdp.on("error", rej); });
      } catch (e) {
        say({ type: "error", message: e.message });
        return ws.close();
      }

      cdp.on("message", async (raw) => {
        const m = JSON.parse(raw);
        if (m.id && pending.has(m.id)) {
          const { resolve, reject } = pending.get(m.id);
          pending.delete(m.id);
          return m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        }
        if (m.method === "Page.screencastFrame") {
          say({ type: "frame", data: m.params.data, meta: m.params.metadata });
          call("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
        }
        if (m.method === "Page.frameNavigated" && !m.params.frame.parentId) {
          say({ type: "url", url: m.params.frame.url });
        }
        if (m.method === "Page.loadEventFired") {
          const t = await call("Runtime.evaluate", { expression: "document.title", returnByValue: true }).catch(() => null);
          say({ type: "title", title: t?.result?.value ?? "" });
        }
      });
      cdp.on("close", () => { say({ type: "closed" }); ws.close(); });

      await call("Page.enable").catch(() => {});
      await call("Runtime.enable").catch(() => {});
      say({ type: "ready", url: startUrl });

      ws.on("message", async (raw) => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        try {
          switch (m.type) {
            case "start":
              await call("Page.startScreencast", { format: "jpeg", quality: m.quality ?? 70, maxWidth: m.width ?? 1440, maxHeight: m.height ?? 900, everyNthFrame: 1 });
              break;
            case "stop": await call("Page.stopScreencast"); break;
            case "navigate": await call("Page.navigate", { url: m.url }); break;
            case "back": await call("Runtime.evaluate", { expression: "history.back()" }); break;
            case "forward": await call("Runtime.evaluate", { expression: "history.forward()" }); break;
            case "reload": await call("Page.reload"); break;
            case "mouse":
              await call("Input.dispatchMouseEvent", {
                type: m.action, x: m.x, y: m.y, button: m.button ?? "none",
                clickCount: m.clickCount ?? 0, modifiers: m.modifiers ?? 0,
                deltaX: m.deltaX ?? 0, deltaY: m.deltaY ?? 0,
              });
              break;
            case "key":
              await call("Input.dispatchKeyEvent", {
                type: m.action, key: m.key, code: m.code, text: m.text,
                windowsVirtualKeyCode: m.keyCode, nativeVirtualKeyCode: m.keyCode, modifiers: m.modifiers ?? 0,
              });
              break;
            case "text": await call("Input.insertText", { text: m.text }); break;
            case "resize":
              // the page should lay out for the pane, not the off-screen window
              await call("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height, deviceScaleFactor: 0, mobile: false });
              break;
          }
        } catch (e) {
          say({ type: "error", message: e.message });
        }
      });

      ws.on("close", async () => {
        try { await call("Page.stopScreencast"); } catch { /* gone */ }
        try { cdp.close(); } catch { /* gone */ }
        if (targetId) closeTab(targetId);
      });
    });
  }

  return { detect, status, stop, attach, cdpList };
}
