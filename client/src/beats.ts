import type { Beat } from "./types";

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
