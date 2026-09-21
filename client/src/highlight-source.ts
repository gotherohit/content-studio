import type { PaneConfig, Source } from './types';

/** A Highlights pane follows the closest visible Source pane, including its pinned source. */
export function highlightSourceFor(panes: PaneConfig[], index: number, sources: Source[], activeId: string | null): Source | null {
  const candidates = panes.map((pane, i) => ({ pane, i })).filter(({ pane }) => pane.kind === 'source');
  candidates.sort((a, b) => Math.abs(a.i - index) - Math.abs(b.i - index) || a.i - b.i);
  for (const { pane } of candidates) {
    const source = sources.find(s => s.id === (pane.sourceId || activeId));
    if (source) return source;
  }
  return sources.find(s => s.id === activeId) ?? null;
}
