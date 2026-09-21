import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import * as geometry from '../server/public/shapes-geom.js';
import * as shapes from '../server/public/shapes-dom.js';
import * as highlights from '../server/public/highlights.js';
import * as pages from '../server/public/pages.js';
import * as scrolls from '../server/public/scrolls.js';

const wait = () => new Promise(resolve => setTimeout(resolve, 80));
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('Original drawings use the overlay origin through resize, scroll and late reflow', async t => {
  const dom = new JSDOM('<body><p>A paragraph that moves when the pane changes width.</p></body>', {
    url: 'http://example.localhost:4710/article', runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document;
  let origin = box(180, 48, 0, 0), paragraph = box(204, 190, 720, 96), resize;
  doc.querySelector('p').getBoundingClientRect = () => paragraph;
  const bounds = win.Element.prototype.getBoundingClientRect;
  win.Element.prototype.getBoundingClientRect = function () {
    return this.classList.contains('rs-shapes') ? origin : bounds.call(this);
  };
  win.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() {} };
  Object.defineProperty(doc, 'currentScript', { value: { src: 'http://localhost:4710/api/inject.js' } });
  win.modules = {
    'reading-position.js': { trackReadingPosition: () => () => {} },
    'highlights.js': highlights, 'pages.js': pages, 'shapes-geom.js': geometry,
    'shapes-dom.js': shapes, 'scrolls.js': scrolls,
  };
  // Run the actual injected script; only its module loader and browser layout are supplied.
  const source = (await readFile(new URL('../server/public/inject.js', import.meta.url), 'utf8'))
    .replace(/await import\(new URL\("\.\/([^"]+)", scriptUrl\)\.href\)/g, (_, name) => `window.modules["${name}"]`);
  await win.eval(source);
  await wait();
  const h = { id: 'drawing', text: doc.querySelector('p').textContent, prefix: '', suffix: '', color: 'green',
    shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1 } };
  win.dispatchEvent(new win.MessageEvent('message', { source: win, data: { src: 'rs-app', type: 'highlights', list: [h] } }));
  await wait();
  const check = () => {
    const wrap = doc.querySelector('.rs-shapes [data-hid="drawing"]');
    assert.ok(wrap);
    assert.equal(parseFloat(wrap.style.left) + origin.left, paragraph.left);
    assert.equal(parseFloat(wrap.style.top) + origin.top, paragraph.top);
    assert.equal(parseFloat(wrap.style.width), paragraph.width);
    assert.equal(parseFloat(wrap.style.height), paragraph.height);
  };
  check();
  origin = box(18, 24, 0, 0); paragraph = box(42, 220, 360, 192);
  win.dispatchEvent(new win.Event('resize')); await wait(); check();
  origin = box(18, -176, 0, 0); paragraph = box(42, 20, 360, 192);
  doc.dispatchEvent(new win.Event('scroll')); await wait(); check();
  paragraph = box(42, 120, 360, 224);
  resize(); await wait(); check();
  paragraph = box(42, 160, 360, 224);
  doc.querySelector('p').dispatchEvent(new win.Event('load')); await wait(); check();
  paragraph = box(42, 180, 360, 240);
  const busy = win.setInterval(() => doc.querySelector('p').classList.toggle('busy'), 5);
  try { await wait(); check(); } finally { win.clearInterval(busy); }
});
