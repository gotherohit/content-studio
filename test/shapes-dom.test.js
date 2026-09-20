import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { anchorAt, anchorForRect, blockAt, hostFor } from '../server/public/shapes-dom.js';

/**
 * jsdom has no layout, so every element here is given the box it would have: three paragraphs
 * down the middle of a page, with margins either side and a gap between them.
 */
function page(t) {
  const dom = new JSDOM(`<body>
    <article>
      <p id="one">Calibration is a property of a population of predictions, never of a single one.</p>
      <p id="two">RLHF rewards answers that sound right, not answers that are right at all.</p>
      <p id="three">A threshold only pays off when something in your code acts on it directly.</p>
    </article>
  </body>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const boxes = { one: [100, 100, 400, 40], two: [100, 200, 400, 40], three: [100, 300, 400, 40] };
  for (const [id, [left, top, width, height]] of Object.entries(boxes)) {
    doc.getElementById(id).getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  }
  doc.body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 500, right: 600, bottom: 500, x: 0, y: 0 });
  // Nothing is "under" a point in jsdom; the fallback is what this file is about.
  doc.elementsFromPoint = () => [];
  return doc;
}

test('a drag starting in the margin belongs to the paragraph beside it', t => {
  const doc = page(t);
  assert.equal(blockAt(doc, doc.body, 40, 210).id, 'two');
  assert.equal(blockAt(doc, doc.body, 560, 310).id, 'three');
});

test('a drag starting in the gap between paragraphs takes the nearer one', t => {
  const doc = page(t);
  // 150 is ten pixels below the first paragraph and fifty above the second.
  assert.equal(blockAt(doc, doc.body, 300, 150).id, 'one');
  assert.equal(blockAt(doc, doc.body, 300, 190).id, 'two');
});

test('far from any prose it falls back to the source itself, and says so', t => {
  const doc = page(t);
  const far = blockAt(doc, doc.body, 300, 2000);
  assert.equal(far, doc.body);
  const found = anchorAt(doc, doc.body, 300, 2000);
  assert.equal(found.host, doc.body);
  // The anchor must be empty: a quote from the top of the source would be found again inside
  // the first paragraph, and the drawing would jump there instead of staying where it was put.
  assert.equal(found.anchor.text, '');
  assert.equal(hostFor(doc.body, { text: '', prefix: '', suffix: '' }), doc.body);
});

test('a drawing anchored to a paragraph is put back on that paragraph', t => {
  const doc = page(t);
  const found = anchorAt(doc, doc.body, 40, 210);
  assert.equal(found.host.id, 'two');
  assert.match(found.anchor.text, /^RLHF rewards/);
  assert.equal(hostFor(doc.body, { ...found.anchor, shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1 } }).id, 'two');
});

test('a drawing belongs to what it covers, not to where the drag began', t => {
  const doc = page(t);
  // A box drawn around the second paragraph, started in the gap above it.
  const found = anchorForRect(doc, doc.body, { left: 90, top: 190, right: 510, bottom: 250 });
  assert.equal(found.host.id, 'two');
  assert.match(found.anchor.text, /^RLHF rewards/);
});

test('a drawing over nothing at all falls back to the source, with an empty anchor', t => {
  const doc = page(t);
  const found = anchorForRect(doc, doc.body, { left: 10, top: 2000, right: 60, bottom: 2100 });
  assert.equal(found.host, doc.body);
  assert.equal(found.anchor.text, '');
});

test('a drawing over a picture is anchored to the picture', t => {
  const doc = page(t);
  const img = doc.createElement('img');
  img.setAttribute('src', 'https://example.com/chart.png');
  doc.querySelector('article').append(img);
  img.getBoundingClientRect = () => ({ left: 120, top: 380, width: 300, height: 200, right: 420, bottom: 580, x: 120, y: 380 });
  const found = anchorForRect(doc, doc.body, { left: 110, top: 370, right: 430, bottom: 590 });
  assert.equal(found.host, img);
  assert.equal(found.onImage, 'https://example.com/chart.png');
});

test('a quote that runs past its paragraph still belongs to that paragraph', t => {
  const doc = page(t);
  // The body reads "…single one.RLHF rewards…", so this quote crosses from one block to the
  // next and the two of them have only the article in common.
  const across = { text: 'single one. RLHF rewards', prefix: '', suffix: '' };
  const host = hostFor(doc.body, across);
  assert.equal(host.id, 'one');
  assert.notEqual(host.tagName, 'ARTICLE');
});

test('a drawing dragged clear of the prose belongs to the source, not to the nearest line', t => {
  const doc = page(t);
  // Thirty pixels under the last paragraph: close enough to find, too far to be about it.
  const found = anchorForRect(doc, doc.body, { left: 120, top: 370, right: 480, bottom: 420 });
  assert.equal(found.host, doc.body);
  assert.equal(found.anchor.text, '');
  // A box drawn around a paragraph still belongs to that paragraph.
  const around = anchorForRect(doc, doc.body, { left: 90, top: 190, right: 510, bottom: 250 });
  assert.equal(around.host.id, 'two');
});
