import type { Layout } from './types';

export function sourcePaneLabel(layout: Layout, index: number): string {
  const places: Record<Layout['preset'], string[]> = {
    '1': ['Main'], '2': ['Left', 'Right'], '3': ['Left', 'Middle', 'Right'],
    '1+2': ['Left', 'Top right', 'Bottom right'], '2+1': ['Top left', 'Bottom left', 'Right'],
    '4': ['Top left', 'Top right', 'Bottom left', 'Bottom right'],
  };
  return `${places[layout.preset]?.[index] ?? `Pane ${index + 1}`} pane`;
}

/** Choosing one pane must not switch every other pane that follows the sidebar. */
export function navigateSourceLayout(layout: Layout, index: number, sourceId: string, activeId: string | null): Layout {
  if (index < 0 || index >= layout.panes.length) return layout;
  return { ...layout, panes: layout.panes.map((pane, i) => {
    if (i === index) return { ...pane, kind: 'source', sourceId };
    if (pane.kind === 'source' && !pane.sourceId && activeId) return { ...pane, sourceId: activeId };
    return pane;
  }) };
}
