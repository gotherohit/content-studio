import test from 'node:test';
import assert from 'node:assert/strict';
import { navigateSourceLayout, sourcePaneLabel } from '../client/src/source-navigation.ts';
import type { Layout } from '../client/src/types.ts';

test('sidebar and link navigation replace a pinned source in the chosen pane', () => {
  const layout: Layout = { preset: '2', panes: [{ kind: 'source', sourceId: 'old', mode: 'reader' }, { kind: 'highlights' }], split: 60, rowSplit: 50 };
  const next = navigateSourceLayout(layout, 0, 'new', 'old');
  assert.equal(next.panes[0].sourceId, 'new');
  assert.equal(next.panes[0].mode, 'reader');
  assert.equal(next.panes[1], layout.panes[1]);
  assert.equal(layout.panes[0].sourceId, 'old');
  assert.equal(sourcePaneLabel(layout, 1), 'Right pane');
});

test('choosing one of multiple Source panes preserves other following and pinned panes', () => {
  const layout: Layout = { preset: '3', panes: [{ kind: 'source' }, { kind: 'source' }, { kind: 'source', sourceId: 'pinned' }], split: 50, rowSplit: 50 };
  const next = navigateSourceLayout(layout, 1, 'new', 'previous');
  assert.deepEqual(next.panes.map(p => p.sourceId), ['previous', 'new', 'pinned']);
  assert.equal(navigateSourceLayout(layout, -1, 'new', 'previous'), layout);
});

test('without a Source pane, the first pane can show the selected source without replacing other panes', () => {
  const layout: Layout = { preset: '2', panes: [{ kind: 'notes' }, { kind: 'highlights' }], split: 50, rowSplit: 50 };
  assert.deepEqual(navigateSourceLayout(layout, 0, 'new', null).panes, [{ kind: 'source', sourceId: 'new' }, { kind: 'highlights' }]);
});
