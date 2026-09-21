import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightSourceFor } from '../client/src/highlight-source.ts';
import type { Source } from '../client/src/types.ts';

const sources = [{ id: 'empty', highlights: [] }, { id: 'article', highlights: [{ id: 'quote' }] }] as Source[];
test('opening Highlights follows the pinned article without a click in it', () => {
  const panes = [{ kind: 'source' as const, sourceId: 'article' }, { kind: 'highlights' as const }];
  assert.equal(highlightSourceFor(panes, 1, sources, 'empty'), sources[1]);
  assert.equal(highlightSourceFor(panes, 1, sources, null), sources[1]);
});
test('multiple Source panes resolve by proximity and ordinary panes follow selection', () => {
  const panes = [{ kind: 'source' as const, sourceId: 'empty' }, { kind: 'source' as const, sourceId: 'article' }, { kind: 'highlights' as const }];
  assert.equal(highlightSourceFor(panes, 2, sources, 'empty'), sources[1]);
  assert.equal(highlightSourceFor([{ kind: 'source' }, { kind: 'highlights' }], 1, sources, 'empty'), sources[0]);
  assert.equal(highlightSourceFor([{ kind: 'highlights' }], 0, sources, 'article'), sources[1]);
  assert.equal(highlightSourceFor([{ kind: 'highlights' }], 0, sources, null), null);
});
