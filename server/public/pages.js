// Shared by the proxied page and the app, so both agree on what "the same page" means.

/**
 * A page's identity: origin, path and query. The fragment only scrolls, and a trailing
 * slash is a site's choice of spelling, so neither makes a different page.
 */
export function pageKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.delete("__rs_scripts");
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
    return `${u.origin.toLowerCase()}${path}${u.search}`;
  } catch {
    return String(url);
  }
}

export const samePage = (a, b) => Boolean(a) && Boolean(b) && pageKey(a) === pageKey(b);

export function sameSite(a, b) {
  try { return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase(); } catch { return false; }
}

/** "http://docs--example--com.localhost:4700/a?b#c" -> "https://docs.example.com/a?b#c". */
export function realUrl(proxied) {
  const u = new URL(proxied);
  u.searchParams.delete("__rs_scripts");
  const m = /^([a-z0-9-]+)\.localhost$/i.exec(u.hostname);
  if (!m) return u.href;
  return `https://${m[1].replace(/--/g, ".")}${u.pathname}${u.search}${u.hash}`;
}

/** The pane's own history of pages, so Back never reaches the studio's history. */
export function visitPage(trail, url) {
  if (samePage(trail.list[trail.at], url)) return trail;
  const list = trail.list.slice(0, trail.at + 1).concat(url);
  return { list, at: list.length - 1 };
}

export function stepPage(trail, by) {
  const at = Math.min(trail.list.length - 1, Math.max(0, trail.at + by));
  return at === trail.at ? trail : { list: trail.list, at };
}
