import test from 'node:test';
import assert from 'node:assert/strict';
import { noteCardLayout } from '../client/src/note-popover.ts';

test('comment widths expand and remain inside a pane at either edge', () => {
  const bounds = { width: 1000, height: 600 };
  const wide = noteCardLayout(700, 900, 400, true, bounds, 120);
  assert.equal(wide.width, 700); assert.equal(wide.left, 292); assert.equal(wide.top, 400);
  assert.equal(noteCardLayout(700, 10, 400, true, bounds, 120).left, 8);
  assert.equal(noteCardLayout(300, 500, 400, true, bounds, 240).top, 352);
  assert.equal(noteCardLayout(700, 500, 400, true, bounds, 120).top, 400, 'a shorter, wider card returns beside its marker');
});
test('saved wide comments fit smaller panes and tall comments stay scrollable', () => {
  const small = noteCardLayout(900, 300, 40, false, { width: 350, height: 250 }, 600);
  assert.equal(small.width, 334); assert.equal(small.left, 8); assert.equal(small.top, 8); assert.equal(small.maxHeight, 234);
  assert.equal(noteCardLayout(NaN, 500, 400, false, { width: 1000, height: 600 }, 100).width, 300);
  const tiny = noteCardLayout(500, 100, 100, true, { width: 12, height: 12 }, 200);
  assert.ok(tiny.width > 0 && tiny.left + tiny.width <= 12); assert.ok(tiny.top + tiny.maxHeight <= 12);
});
