import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureRange, applyHighlights, watchHighlights } from '../server/public/highlights.js';

function fixture(t, html) {
  const dom = new JSDOM(`<body>${html}</body>`);
  t.after(() => dom.window.close());
  return dom.window.document;
}
const quote = (id, text, extra = {}) => ({ id, text, prefix: '', suffix: '', color: 'green', ...extra });
const marked = (doc, id) => [...doc.querySelectorAll(`mark[data-hid="${id}"]`)].map(m => m.textContent).join('');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('hidden copies and script data cannot steal the visible article highlight', t => {
  const doc = fixture(t, '<script type="application/json">Repeated phrase</script><div hidden>Repeated phrase</div><div style="display:none">Repeated phrase</div><p>Repeated phrase</p>');
  applyHighlights(doc.body, [quote('one', 'Repeated phrase')], 'rs-hl');
  assert.equal(doc.querySelector('p mark')?.textContent, 'Repeated phrase');
  assert.equal(doc.querySelector('script mark, [hidden] mark'), null);
});

test('element selection boundaries stop at the selected block and ignore hidden text', t => {
  const doc = fixture(t, '<p>First <b>bold</b><span hidden>hidden</span> passage</p><p>Following paragraph</p>');
  const range = doc.createRange(), p = doc.querySelector('p'); range.selectNodeContents(p);
  const anchor = captureRange(doc.body, range);
  assert.equal(anchor.text, 'First bold passage');
  applyHighlights(doc.body, [quote('one', anchor.text, anchor)]);
  assert.equal(marked(doc, 'one'), anchor.text);
  assert.equal(doc.querySelectorAll('p')[1].querySelector('mark'), null);
});

test('whitespace changes and inline elements still anchor a saved passage', t => {
  const doc = fixture(t, '<p>Before: a&nbsp; <b>saved</b>\n  passage after.</p>');
  assert.deepEqual(applyHighlights(doc.body, [quote('one', 'a saved passage', { prefix: 'Before: ', suffix: ' after.' })]), []);
  assert.equal(marked(doc, 'one').replace(/\s+/g, ' '), 'a saved passage');
});

test('overlapping highlights retain their independent IDs and deletion unwraps only our marks', t => {
  const doc = fixture(t, '<p><mark>Article mark</mark> one two three</p>');
  applyHighlights(doc.body, [quote('one', 'one two'), quote('two', 'two three')]);
  assert.equal(marked(doc, 'one'), 'one two'); assert.equal(marked(doc, 'two'), 'two three');
  applyHighlights(doc.body, [quote('two', 'two three')]);
  assert.equal(marked(doc, 'one'), ''); assert.equal(marked(doc, 'two'), 'two three');
  assert.equal(doc.querySelector('mark:not([data-hid])').textContent, 'Article mark');
});

test('page replacement repairs a missing highlight even when another has many fragments', async t => {
  const doc = fixture(t, '<p id="first">A <b>long</b> highlight</p><p id="second">Second passage</p>');
  const list = [quote('one', 'A long highlight'), quote('two', 'Second passage')]; let renders = 0;
  const watcher = watchHighlights(doc.body, () => list, () => { renders++; applyHighlights(doc.body, list, 'rs-hl'); }, 5);
  t.after(watcher.stop); watcher.render();
  doc.querySelector('#second').textContent = 'Second passage';
  assert.ok(doc.querySelectorAll('mark').length >= list.length);
  await wait(60);
  assert.equal(marked(doc, 'two'), 'Second passage');
  const stable = renders; await wait(40); assert.equal(renders, stable, 'our own marks must not trigger a repair loop');
  doc.querySelector('#first b').textContent = 'long';
  await wait(60); assert.equal(marked(doc, 'one'), 'A long highlight');
});

test('Original colours override website styles and can be changed', t => {
  const doc = fixture(t, '<p>A passage</p>');
  applyHighlights(doc.body, [quote('one', 'A passage')], 'rs-hl');
  assert.equal(doc.querySelector('mark').style.getPropertyPriority('background-image'), 'important');
  applyHighlights(doc.body, [quote('one', 'A passage', { color: 'pink' })], 'rs-hl');
  assert.match(doc.querySelector('mark').style.backgroundImage, /#ffd0e0/i);
});

test('an Original highlight is painted as a band no taller than its line', t => {
  // A plain background fills the font's content area, which on tight leading covers the
  // line above; the colour goes in a sized background image instead.
  const doc = fixture(t, '<p>A passage</p>');
  applyHighlights(doc.body, [quote('one', 'A passage')], 'rs-hl');
  const style = doc.querySelector('mark').style;
  assert.equal(style.backgroundColor, 'transparent');
  assert.equal(style.backgroundSize, '100% min(1.2em, calc(1lh - 3px))');
  assert.equal(style.backgroundRepeat, 'no-repeat');
  assert.equal(style.getPropertyValue('box-decoration-break'), 'clone');
  assert.equal(style.padding, '0px');
});
