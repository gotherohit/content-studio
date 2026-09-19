import type { Beat, PaneConfig, Source, Stage } from "./types";

/** Reordering changes the running order, never which beat is on screen. */
export function moveBeatInList(beats: Beat[], id: string, to: number): Beat[] {
  const from = beats.findIndex((beat) => beat.id === id);
  if (from < 0 || to < 0 || to >= beats.length || from === to) return beats;
  const next = [...beats];
  const [beat] = next.splice(from, 1);
  next.splice(to, 0, beat);
  return next;
}

export function insertBeatAfter(beats: Beat[], afterId: string | null, beat: Beat): Beat[] {
  const index = beats.findIndex((item) => item.id === afterId);
  const next = [...beats];
  next.splice(index < 0 ? next.length : index + 1, 0, beat);
  return next;
}

export function duplicateBeat(beat: Beat, id: string): Beat {
  return { ...beat, id, point: beat.point ? `${beat.point} (copy)` : "", stage: structuredClone(beat.stage), createdAt: new Date().toISOString() };
}

const pathOf = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };

/**
 * What a capture recorded for its article panes: where each one is, and which had not yet
 * reported a reading position. Such a pane would restore to wherever it happened to be.
 */
export function captureSummary(stage: Stage, panes: PaneConfig[], sources: Source[]): { unplaced: number[]; where: string | null } {
  const unplaced: number[] = [];
  const places: string[] = [];
  const articles = panes.flatMap((pane, i) => {
    const source = pane.kind === "source" ? sources.find((s) => s.id === stage.views[i]?.sourceId) : undefined;
    return source && source.kind !== "file" ? [i] : [];
  });
  for (const i of articles) {
    const view = stage.views[i];
    if (!view?.position) { unplaced.push(i); continue; }
    const text = (view.position.seen || view.position.text)?.trim();
    const place = !view.position.y ? "the top" : text ? `“${text.length > 40 ? text.slice(0, 40) + "…" : text}”` : `${Math.round(view.position.y)} px down`;
    const page = view.page ? ` of ${pathOf(view.page)}` : "";
    places.push(articles.length > 1 ? `pane ${i + 1} at ${place}${page}` : `at ${place}${page}`);
  }
  return { unplaced, where: places.length ? places.join(", ") : null };
}
