import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineVajraLayout, resizeInlineVajra } from '../client/src/inline-vajra-size.ts';

test('inline Vajra resizes left and down without leaving its source pane', () => {
  const bounds = { width: 1000, height: 760 };
  assert.deepEqual(resizeInlineVajra({ width: 450, height: 420 }, -250, 180, bounds), { width: 700, height: 600 });
  assert.deepEqual(resizeInlineVajra({ width: 450, height: 420 }, 900, -900, bounds), { width: 300, height: 280 });
  assert.deepEqual(resizeInlineVajra({ width: 450, height: 420 }, -2000, 2000, bounds), { width: 980, height: 740 });
});

test('a saved large Vajra window shrinks for a narrow pane and returns when it widens', () => {
  const preferred = { width: 850, height: 650 };
  assert.deepEqual(inlineVajraLayout(preferred, { width: 420, height: 400 }), { width: 400, height: 380, maxHeight: 380, top: 10, right: 10 });
  assert.deepEqual(inlineVajraLayout(preferred, { width: 1000, height: 760 }), { width: 850, height: 650, maxHeight: 740, top: 10, right: 10 });
  assert.deepEqual(preferred, { width: 850, height: 650 });
  assert.deepEqual(inlineVajraLayout(null, { width: 1000, height: 760 }).height, null);
  assert.deepEqual(inlineVajraLayout(preferred, { width: 1000, height: 760 }, true).width, 980);
});
