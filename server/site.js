// Reverse proxy that gives every target its own local origin
//   https://www.example.com      ->  http://www--example--com.localhost:<port>/...
//   http://localhost:8501 (app)  ->  http://rs<hash>.localhost:<port>/...
// so a page can be framed, keeps its exact path (its own JavaScript keeps working),
// and can be highlighted by our injected script.
//
// Two modes:
//   read  - an article. GET only, cached to disk, our highlight script injected,
//           link clicks reported to the app instead of navigating.
//   app   - a live web app (Streamlit, Gradio, Jupyter, a local harness). Every
//           method passes through, nothing is cached or injected, websockets are
//           piped straight to the target.
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** Headers that must not be forwarded in either direction. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
/** Response headers that would stop the page being framed. */
const FRAME_BLOCKERS = new Set(["content-security-policy", "content-security-policy-report-only", "x-frame-options", "cross-origin-opener-policy", "cross-origin-embedder-policy", "cross-origin-resource-policy"]);

export function subFromHost(hostHeader) {
  const m = /^([a-z0-9-]+)\.localhost(?::\d+)?$/i.exec(hostHeader || "");
  return m ? m[1].toLowerCase() : null;
}

export function createSiteProxy({ cacheDirFn, port }) {
  /** sub -> { origin, mode }. Persisted so links survive a restart. */
  const registry = new Map();
  const regFile = () => path.join(cacheDirFn(), "sites.json");

  async function loadRegistry() {
    try {
      const raw = JSON.parse(await fs.readFile(regFile(), "utf8"));
      for (const [k, v] of Object.entries(raw)) registry.set(k, v);
    } catch { /* first run */ }
  }
  async function saveRegistry() {
    await fs.mkdir(cacheDirFn(), { recursive: true }).catch(() => {});
    await fs.writeFile(regFile(), JSON.stringify(Object.fromEntries(registry), null, 2)).catch(() => {});
  }

  /** Local sub-domain for an origin. Plain https sites keep a readable name. */
  function subFor(origin, mode) {
    const u = new URL(origin);
    const readable = mode === "read" && u.protocol === "https:" && !u.port && /^[a-z0-9.-]+$/i.test(u.hostname);
    const sub = readable
      ? u.hostname.toLowerCase().replace(/\./g, "--")
      : `rs${crypto.createHash("sha1").update(`${mode}|${u.origin}`).digest("hex").slice(0, 14)}`;
    if (!registry.has(sub)) { registry.set(sub, { origin: u.origin, mode }); saveRegistry(); }
    return sub;
  }

  /** Register a URL for framing and return the local URL that serves it. */
  function register(rawUrl, mode = "app") {
    const u = new URL(rawUrl);
    const sub = subFor(u.origin, mode);
    return `http://${sub}.localhost:${port}${u.pathname}${u.search}${u.hash}`;
  }

  function resolveSub(sub) {
    const hit = registry.get(sub);
    if (hit) return hit;
    // A readable name we have not seen before (e.g. a link followed inside a page).
    if (sub.includes("--")) {
      const entry = { origin: `https://${sub.replace(/--/g, ".")}`, mode: "read" };
      registry.set(sub, entry);
      saveRegistry();
      return entry;
    }
    return null;
  }

  /** proxied local URL -> the real URL it stands for (used when reporting link clicks). */
  function realUrl(localUrl) {
    try {
      const u = new URL(localUrl);
      const sub = subFromHost(u.host);
      const entry = sub && resolveSub(sub);
      return entry ? entry.origin + u.pathname + u.search + u.hash : localUrl;
    } catch { return localUrl; }
  }

  // ---------------------------------------------------------------- read mode
  const keyOf = (url) => crypto.createHash("sha1").update(url).digest("hex");

  async function fetchCached(url, { refresh = false, headers = {} } = {}) {
    const dir = path.join(cacheDirFn(), "sites");
    await fs.mkdir(dir, { recursive: true });
    const key = keyOf(url);
    const metaFile = path.join(dir, `${key}.json`), bodyFile = path.join(dir, `${key}.bin`);
    if (!refresh) {
      try {
        const meta = JSON.parse(await fs.readFile(metaFile, "utf8"));
        return { ...meta, body: await fs.readFile(bodyFile), cached: true };
      } catch { /* miss */ }
    }
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...headers }, redirect: "follow" });
    const type = r.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await r.arrayBuffer());
    const meta = { status: r.status, type, finalUrl: r.url };
    if (r.ok) {
      await fs.writeFile(bodyFile, body);
      await fs.writeFile(metaFile, JSON.stringify(meta));
    }
    return { ...meta, body, cached: false };
  }

  const isHtml = (t) => /text\/html|application\/xhtml/i.test(t);
  const isCss = (t) => /text\/css/i.test(t);

  function rewriteAbs(u, baseUrl, mode) {
    try {
      const abs = new URL(u, baseUrl);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return u;
      return `http://${subFor(abs.origin, mode)}.localhost:${port}${abs.pathname}${abs.search}${abs.hash}`;
    } catch { return u; }
  }

  function rewriteCss(css, baseUrl, mode) {
    return css
      .replace(/@import\s+(?:url\()?['"]?([^'")\s]+)['"]?\)?/g, (m, u) => `@import url("${rewriteAbs(u, baseUrl, mode)}")`)
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, u) => (/^(data:|blob:|#)/i.test(u) ? m : `url("${rewriteAbs(u, baseUrl, mode)}")`));
  }

  function rewriteSrcset(v, baseUrl, mode) {
    return v.split(",").map((part) => {
      const [u, d] = part.trim().split(/\s+/, 2);
      return u ? `${rewriteAbs(u, baseUrl, mode)}${d ? " " + d : ""}` : part;
    }).join(", ");
  }

  const ATTRS = ["src", "href", "poster", "data-src", "action", "formaction"];

  function transformHtml(html, pageUrl, { scripts, mode, appOrigin }) {
    const dom = new JSDOM(html, { url: pageUrl });
    const doc = dom.window.document;
    doc.querySelectorAll("meta[http-equiv]").forEach((m) => {
      if (/content-security-policy|x-frame-options|refresh/i.test(m.getAttribute("http-equiv") || "")) m.remove();
    });
    doc.querySelectorAll("base").forEach((b) => b.remove());
    if (!scripts) {
      doc.querySelectorAll("script, link[rel='preload'][as='script'], link[rel='modulepreload']").forEach((n) => n.remove());
      doc.querySelectorAll("noscript").forEach((n) => n.replaceWith(JSDOM.fragment(n.textContent || "")));
      doc.querySelectorAll("img, source, video").forEach((el) => {
        for (const [from, to] of [["data-src", "src"], ["data-lazy-src", "src"], ["data-srcset", "srcset"], ["data-lazy-srcset", "srcset"]]) {
          if (el.hasAttribute(from) && !el.getAttribute(to)) el.setAttribute(to, el.getAttribute(from));
        }
        el.removeAttribute("loading");
      });
    }
    doc.querySelectorAll("*").forEach((el) => {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v && /^https?:\/\//i.test(v.trim())) el.setAttribute(a, rewriteAbs(v, pageUrl, mode));
      }
      for (const a of ["srcset", "imagesrcset", "data-srcset"]) {
        const v = el.getAttribute(a);
        if (v && /https?:\/\//i.test(v)) el.setAttribute(a, rewriteSrcset(v, pageUrl, mode));
      }
      el.removeAttribute("integrity");
      el.removeAttribute("crossorigin");
      const style = el.getAttribute("style");
      if (style && /url\(/.test(style)) el.setAttribute("style", rewriteCss(style, pageUrl, mode));
    });
    doc.querySelectorAll("style").forEach((st) => { st.textContent = rewriteCss(st.textContent || "", pageUrl, mode); });

    // Service workers would cache the real origin's responses behind our back.
    const guard = doc.createElement("script");
    guard.textContent = `try{Object.defineProperty(navigator,"serviceWorker",{get:function(){return undefined}})}catch(e){}`;
    doc.head.prepend(guard);

    if (mode === "read") {
      const css = doc.createElement("link");
      css.rel = "stylesheet"; css.href = `${appOrigin}/api/inject.css`;
      doc.head.appendChild(css);
      const js = doc.createElement("script");
      js.src = `${appOrigin}/api/inject.js`; js.defer = true;
      (doc.body || doc.documentElement).appendChild(js);
    }
    return dom.serialize();
  }

  // ---------------------------------------------------------------- app mode
  /**
   * Cookies are held here rather than in the browser.
   *
   * An embedded app lives on its own proxy origin, which the browser treats as a
   * cross-site frame. Session cookies are almost always SameSite=Strict or Lax, and
   * those are never sent from such a frame, so a login could never stick no matter how
   * the cookie was rewritten. Keeping the jar server-side makes the proxy behave like
   * the ordinary browser tab the app expects. It is in memory only: restarting the
   * server forgets every session rather than leaving credentials on disk.
   */
  const jars = new Map(); // origin -> Map(name -> value)

  function storeCookies(origin, setCookies) {
    if (!setCookies.length) return;
    const jar = jars.get(origin) ?? new Map();
    for (const raw of setCookies) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a))
        || attrs.some((a) => { const m = /^\s*expires\s*=(.+)$/i.exec(a); return m && new Date(m[1]) <= new Date(); });
      if (expired) jar.delete(name);
      else jar.set(name, value);
    }
    jars.set(origin, jar);
  }

  const cookieHeader = (origin) => {
    const jar = jars.get(origin);
    return jar?.size ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : null;
  };

  /** Forget one app's session, e.g. when a fresh token URL is opened. */
  const clearCookies = (origin) => jars.delete(origin);

  async function readBody(req) {
    if (req.method === "GET" || req.method === "HEAD") return undefined;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return chunks.length ? Buffer.concat(chunks) : undefined;
  }

  async function passthrough(req, res, target, entry) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (HOP_BY_HOP.has(lk) || lk === "host" || lk === "accept-encoding" || lk === "content-length") continue;
      if (lk === "origin" || lk === "referer") { headers[lk] = entry.origin; continue; }
      if (lk === "cookie") continue; // the jar below is the authority
      headers[lk] = Array.isArray(v) ? v.join(", ") : v;
    }
    const jarHeader = cookieHeader(entry.origin);
    if (jarHeader) headers.cookie = jarHeader;

    const body = await readBody(req);
    const r = await fetch(target, { method: req.method, headers, body, redirect: "manual" });

    res.status(r.status);
    storeCookies(entry.origin, typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : []);
    for (const [k, v] of r.headers) {
      const lk = k.toLowerCase();
      // set-cookie is dropped on purpose: the jar holds it, and a cross-site frame
      // would refuse it anyway.
      if (HOP_BY_HOP.has(lk) || FRAME_BLOCKERS.has(lk) || lk === "content-encoding" || lk === "content-length" || lk === "set-cookie") continue;
      if (lk === "location") { res.setHeader("location", rewriteAbs(v, target, entry.mode)); continue; }
      res.setHeader(k, v);
    }
    res.setHeader("Access-Control-Allow-Origin", "*");

    const type = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (isHtml(type)) res.send(transformHtml(buf.toString("utf8"), target, { scripts: true, mode: "app", appOrigin: `http://localhost:${port}` }));
    else if (isCss(type)) res.send(rewriteCss(buf.toString("utf8"), target, "app"));
    else res.send(buf);
  }

  // ---------------------------------------------------------------- entry point
  async function middleware(req, res, next) {
    const sub = subFromHost(req.headers.host);
    if (!sub) return next();
    const entry = resolveSub(sub);
    if (!entry) return res.status(404).type("html").send("<p style='font-family:sans-serif;padding:24px'>Unknown proxied site.</p>");
    const target = entry.origin + req.originalUrl;
    try {
      if (entry.mode === "app") return await passthrough(req, res, target, entry);

      if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
      const refresh = req.headers["x-rs-refresh"] === "1";
      const r = await fetchCached(target, { refresh, headers: { accept: req.headers.accept || "*/*" } });
      res.status(r.status);
      res.setHeader("Content-Type", r.type);
      res.setHeader("Cache-Control", isHtml(r.type) ? "no-store" : "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      const appOrigin = `http://localhost:${port}`;
      if (isHtml(r.type)) res.send(transformHtml(r.body.toString("utf8"), target, { scripts: req.query.__rs_scripts !== "0", mode: "read", appOrigin }));
      else if (isCss(r.type)) res.send(rewriteCss(r.body.toString("utf8"), target, "read"));
      else res.send(r.body);
    } catch (e) {
      // Only the page itself deserves an error page; a failed sub-resource stays silent
      // so the browser does not try to parse an HTML body as CSS or an image.
      if (/text\/html/i.test(req.headers.accept || "")) {
        res.status(502).type("html").send(`<p style="font-family:sans-serif;padding:24px">Could not load <b>${target}</b>: ${e.message}</p>`);
      } else {
        res.status(404).end();
      }
    }
  }

  /**
   * Pipe a websocket upgrade straight through to the target. Local apps such as
   * Streamlit, Gradio and Jupyter do all their real work over a websocket, so an
   * embed is useless without this.
   */
  function handleUpgrade(req, socket, head) {
    const sub = subFromHost(req.headers.host);
    const entry = sub && resolveSub(sub);
    if (!entry) return false;
    const u = new URL(entry.origin);
    const secure = u.protocol === "https:";
    const targetPort = Number(u.port) || (secure ? 443 : 80);
    const connect = secure ? tls.connect : net.connect;
    const upstream = connect(secure ? { host: u.hostname, port: targetPort, servername: u.hostname } : { host: u.hostname, port: targetPort }, () => {
      const jarHeader = cookieHeader(entry.origin);
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) {
        const lk = k.toLowerCase();
        if (lk === "host") { lines.push(`host: ${u.host}`); continue; }
        if (lk === "origin") { lines.push(`origin: ${entry.origin}`); continue; }
        // the browser has no session cookie for this app; the jar does
        if (lk === "cookie" && jarHeader) continue;
        for (const one of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${one}`);
      }
      if (jarHeader) lines.push(`cookie: ${jarHeader}`);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    return true;
  }

  /**
   * Ask a target what it answers with, keeping whatever session it hands back.
   * A one-time token in the URL is spent by this request, so the resulting cookie has
   * to go into the jar or the frame that follows would be turned away.
   */
  async function probe(rawUrl) {
    const u = new URL(rawUrl);
    // A fresh token means a fresh handshake; drop anything stale for this app.
    if (u.searchParams.has("token") || u.searchParams.has("key")) clearCookies(u.origin);
    const existing = cookieHeader(u.origin);
    const r = await fetch(rawUrl, {
      redirect: "manual",
      headers: { accept: "text/html,*/*", ...(existing ? { cookie: existing } : {}) },
    });
    storeCookies(u.origin, typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : []);
    return {
      status: r.status,
      statusText: r.statusText,
      contentType: r.headers.get("content-type") || "",
      location: r.headers.get("location") || null,
      body: (await r.text()).slice(0, 400),
    };
  }

  /** Readable-text extraction of a page (shares the read-mode cache). */
  async function extract(url, { refresh = false } = {}) {
    const r = await fetchCached(url.split("#")[0], { refresh, headers: { accept: "text/html,application/xhtml+xml" } });
    if (r.status >= 400) throw new Error(`Upstream returned ${r.status}`);
    const html = r.body.toString("utf8");
    const dom = new JSDOM(html, { url: url.split("#")[0] });
    const article = new Readability(dom.window.document).parse();
    return { article, title: article?.title || dom.window.document.title || url };
  }

  return { middleware, handleUpgrade, extract, probe, register, realUrl, loadRegistry };
}
