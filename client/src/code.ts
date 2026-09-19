import type { Highlight, HighlightColor, Project, Source } from "./types";

/** The lines `from`..`to` (1-based, inclusive) of a document. */
export function linesOf(content: string, [from, to]: [number, number]): string {
  return content.split("\n").slice(from - 1, to).join("\n");
}

/** A selection's lines; a selection that ends at the start of a line does not include it. */
export function selectedLines(content: string, fromOffset: number, toOffset: number): [number, number] {
  const lineAt = (offset: number) => content.slice(0, offset).split("\n").length;
  const a = lineAt(Math.min(fromOffset, toOffset));
  let b = lineAt(Math.max(fromOffset, toOffset));
  if (b > a && content[Math.max(fromOffset, toOffset) - 1] === "\n") b--;
  return [a, b];
}

/**
 * Highlight lines of code. The quoted lines, and one line either side, travel with it, so it
 * can be found again after the file is edited — the same idea as an article highlight.
 */
export function codeHighlight(content: string, lines: [number, number], color: HighlightColor, id: string): Highlight {
  const all = content.split("\n");
  return {
    id, text: linesOf(content, lines), color, comment: "", createdAt: new Date().toISOString(), lines,
    prefix: all[lines[0] - 2] ?? "", suffix: all[lines[1]] ?? "",
  };
}

/**
 * Where a code highlight is now. Its quoted lines are looked for first — nearest the lines
 * they were on, with the neighbouring lines breaking a tie — so inserting code above it
 * moves the highlight with its code. If the code itself was rewritten, the saved line
 * numbers are used and `found` is false, so the pane can say the highlight may be stale.
 */
export function locateLines(content: string, h: Highlight): { lines: [number, number]; found: boolean } | null {
  if (!h.lines) return null;
  const all = content.split("\n");
  const quote = h.text.split("\n");
  const length = quote.length;
  const matches: number[] = [];
  for (let i = 0; i + length <= all.length; i++) {
    let same = true;
    for (let j = 0; j < length && same; j++) same = all[i + j].trimEnd() === quote[j].trimEnd();
    if (same) matches.push(i + 1);
  }
  if (matches.length) {
    const score = (start: number) =>
      Math.abs(start - h.lines![0]) - (all[start - 2] === h.prefix ? 0.5 : 0) - (all[start - 1 + length] === h.suffix ? 0.5 : 0);
    const start = matches.reduce((best, m) => (score(m) < score(best) ? m : best));
    return { lines: [start, start + length - 1], found: true };
  }
  const last = Math.max(1, all.length);
  const from = Math.min(h.lines[0], last);
  return { lines: [from, Math.min(Math.max(h.lines[1], from), last)], found: false };
}

export const codeSourceFor = (sources: Source[], root: string, path: string) =>
  sources.find((s) => s.kind === "code" && s.code && samePath(s.code.root, root) && samePath(s.code.path, path));

/** Windows paths ignore case and either slash. */
export const samePath = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

export const joinPath = (root: string, rel: string) => `${root.replace(/[\\/]+$/, "")}\\${rel.replace(/\//g, "\\")}`;

/** Where `p` is after `from` was renamed to `to`: the thing itself, or something inside a renamed folder. */
export function renamedPath(p: string, from: string, to: string): string | null {
  const norm = (x: string) => x.replace(/\\/g, "/").replace(/\/+$/, "");
  const path = norm(p), old = norm(from);
  if (samePath(path, old)) return norm(to);
  if (path.toLowerCase().startsWith(old.toLowerCase() + "/")) return norm(to) + path.slice(old.length);
  return null;
}

/**
 * A file renamed in the Files pane takes its highlights, and every beat showing it, along —
 * otherwise they would quietly point at a name that no longer exists.
 */
export function renameCodeRefs(project: Pick<Project, "sources" | "beats" | "links">, root: string, from: string, to: string): Pick<Project, "sources" | "beats" | "links"> {
  let sources = project.sources.map((s) => {
    const moved = s.kind === "code" && s.code && samePath(s.code.root, root) ? renamedPath(s.code.path, from, to) : null;
    return moved ? { ...s, code: { root: s.code!.root, path: moved }, url: joinPath(s.code!.root, moved), title: moved } : s;
  });
  // A code source outlives its file, so a file renamed onto that name would make a second
  // source for one file. The first keeps both sets of highlights; links and beats follow it.
  const merged = new Map<string, string>();
  const byFile = new Map<string, Source>();
  sources = sources.flatMap((s) => {
    if (s.kind !== "code" || !s.code) return [s];
    const key = `${s.code.root}|${s.code.path}`.replace(/\\/g, "/").toLowerCase();
    const kept = byFile.get(key);
    // A copy, so merging never changes the project the caller still holds.
    if (!kept) { const copy = { ...s }; byFile.set(key, copy); return [copy]; }
    merged.set(s.id, kept.id);
    kept.highlights = [...kept.highlights, ...s.highlights];
    return [];
  });
  const id = (x: string | null | undefined) => (x && merged.get(x)) || x;
  const links = (project.links ?? []).map((l) => (merged.has(l.from.sourceId) || merged.has(l.to.sourceId)
    ? { ...l, from: { ...l.from, sourceId: id(l.from.sourceId)! }, to: { ...l.to, sourceId: id(l.to.sourceId)! } }
    : l));
  const beats = project.beats.map((b) => {
    let changed = false;
    const views = Object.fromEntries(Object.entries(b.stage.views ?? {}).map(([i, v]) => {
      const moved = v.code && samePath(v.code.root, root) ? renamedPath(v.code.path, from, to) : null;
      if (!moved && !merged.has(v.sourceId ?? "")) return [i, v];
      changed = true;
      return [i, { ...v, sourceId: id(v.sourceId) ?? undefined, ...(moved ? { code: { ...v.code!, path: moved } } : {}) }];
    }));
    const panes = b.stage.panes.map((pane) => (merged.has(pane.sourceId ?? "") ? { ...pane, sourceId: id(pane.sourceId) } : pane));
    const active = id(b.stage.activeSourceId) ?? null;
    if (active !== b.stage.activeSourceId || panes.some((pane, i) => pane !== b.stage.panes[i])) changed = true;
    return changed ? { ...b, stage: { ...b.stage, views, panes, activeSourceId: active } } : b;
  });
  return { sources, beats, links };
}
