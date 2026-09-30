// How exported beats fit together in time. Shared by the export dialog, which shows the
// length, and the Electron process, which builds the ffmpeg graph — so the length the dialog
// shows is the length of the file that comes out.

/** A transition is taken out of both beats it joins, so it may use at most half of either. */
export function transitionLength(kind, requested, before, after) {
  if (kind === "cut" || !(requested > 0)) return 0;
  return Math.max(0, Math.min(requested, before / 2, after / 2));
}

/**
 * Where each beat starts in the finished video, how long each transition really is, and the
 * total. `beats` is [{ seconds, transition }]; the first beat's transition is ignored, since
 * nothing comes before it.
 */
export function timeline(beats, transitionSeconds) {
  const starts = [];
  const overlaps = [];
  let total = 0;
  beats.forEach((beat, i) => {
    const overlap = i === 0 ? 0 : transitionLength(beat.transition, transitionSeconds, beats[i - 1].seconds, beat.seconds);
    overlaps.push(overlap);
    starts.push(total - overlap);
    total += beat.seconds - overlap;
  });
  return { starts, overlaps, total };
}
