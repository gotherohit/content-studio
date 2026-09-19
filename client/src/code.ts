import type { Highlight, HighlightColor, Source } from "./types";

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
