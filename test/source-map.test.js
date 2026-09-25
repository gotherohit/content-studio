import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

test('source map inspects evidence, filters links, focuses neighbors and traces a route', async () => {
  const require = createRequire(new URL('../client/package.json', import.meta.url));
  const ts = require('typescript'), React = require('react');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  let resize, observed;
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { constructor(cb) { resize = cb; } observe(el) { observed = el; Object.defineProperty(el, 'clientWidth', { value: 700, configurable: true }); Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true }); } disconnect() {} } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const load = (url, imports = {}) => {
    const source = fs.readFileSync(new URL(url, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    new Function('require', 'exports', code)(id => imports[id] || require(id), exports);
    return exports;
  };
  const links = load('../client/src/links.ts');
  const { SourceMap } = load('../client/src/components/SourceMap.tsx', { '../links': links });
  const source = id => ({ id, url: `https://example.com/${id}`, title: `Source ${id}`, content: '', textContent: '', fetchedAt: '2026-01-01', highlights: [{ id: `${id}-h`, text: `Evidence ${id}`, prefix: '', suffix: '', color: 'yellow', comment: '', createdAt: '2026-01-01' }] });
  const sources = ['a', 'b', 'c', 'd'].map(source);
  const makeLink = (id, from, to, relation) => ({ id, from: { sourceId: from, highlightId: `${from}-h` }, to: { sourceId: to, highlightId: `${to}-h` }, relation, createdAt: '2026-01-01' });
  const relationships = [makeLink('ab', 'a', 'b', 'supports'), makeLink('bc', 'b', 'c', 'cites'), makeLink('cd', 'c', 'd', 'contradicts')];
  let root, opened = [], linked = [], copied = '';
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async value => { copied = value; } }, configurable: true });
  try {
    root = require('react-dom/client').createRoot(document.getElementById('root'));
    const render = presenting => React.act(async () => root.render(React.createElement(SourceMap, { sources, links: relationships, activeSourceId: 'a', onOpen: id => opened.push(id), onGo: end => opened.push(end.sourceId), onCreateLink: end => linked.push(end.sourceId), presenting })));
    const click = async selector => { const el = document.querySelector(selector); assert.ok(el, selector); await React.act(async () => el.click()); return el; };
    const change = async (selector, value) => { const el = document.querySelector(selector); assert.ok(el, selector); await React.act(async () => { el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
    await render(false);
    assert.match(document.querySelector('.map-count').textContent, /4 sources · 3 connections/);
    await React.act(async () => {
      const node = document.querySelector('.map-node[aria-label="Inspect source Source a"]');
      node.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
      node.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }));
    });
    assert.match(document.querySelector('.map-inspector').textContent, /Source b/);
    await click('.map-inspector-actions button:nth-child(2)');
    assert.deepEqual(linked, ['a']);
    await click('.map-inspector-actions button:nth-child(3)');
    assert.equal(document.querySelectorAll('.map-node').length, 2, 'one hop hides unrelated nodes');
    await click('.map-inspector-actions button:nth-child(3)');
    assert.equal(document.querySelectorAll('.map-node').length, 3, 'two hops include the next source');
    await click('.map-inspector-actions button:nth-child(4)');
    assert.ok(document.querySelector('.map-trace'));
    await change('[aria-label="Trace to source"]', 'd');
    assert.match(document.querySelector('.map-trace-results').textContent, /3 steps/);
    await click('[aria-label="Copy trail as Markdown"]');
    assert.match(copied, /Evidence a/);
    assert.match(copied, /https:\/\/example.com\/a/);
    await click('.map-filter.edge-contradicts');
    assert.equal(document.querySelector('.map-filter.edge-contradicts').getAttribute('aria-pressed'), 'false');
    assert.match(document.querySelector('.map-trace').textContent, /No route/);
    await click('.map-filter.edge-contradicts');
    await click('.map-trace-step');
    assert.match(document.querySelector('.map-inspector').textContent, /Evidence a/);
    await click('.map-inspector-link button');
    assert.deepEqual(opened, ['a']);
    await click('[aria-label="Close map details"]');
    const search = document.querySelector('[aria-label="Find source in map"]');
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, 'Source d'); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await click('.map-search-results button');
    assert.equal(document.querySelectorAll('.map-node').length, 4, 'search clears an earlier focus filter');
    assert.match(document.querySelector('.map-inspector').textContent, /Source d/);
    await click('[aria-label="Close map details"]');
    Object.defineProperty(observed, 'clientWidth', { value: 460, configurable: true });
    Object.defineProperty(observed, 'clientHeight', { value: 500, configurable: true });
    await React.act(async () => resize());
    assert.ok(document.querySelector('.map-trace-compact'), 'narrow pane leaves the route visible by collapsing its card');
    await click('.map-trace-compact button:first-child');
    assert.ok(document.querySelector('.map-trace-results'), 'the trail remains inspectable');
    await render(true);
    assert.equal(document.querySelector('.map-toolbar'), null, 'present mode hides investigation controls');
    assert.equal(document.querySelectorAll('.map-node').length, 4);
    const props = { sources, links: relationships, activeSourceId: 'a', onOpen: () => {}, onGo: () => {}, presenting: true };
    await React.act(async () => root.render(React.createElement(React.Fragment, null, React.createElement(SourceMap, { ...props, key: 'left' }), React.createElement(SourceMap, { ...props, key: 'right' }))));
    const markerIds = [...document.querySelectorAll('.source-map marker')].map(el => el.id);
    assert.equal(new Set(markerIds).size, markerIds.length, 'two map panes use distinct arrow markers');
  } finally {
    if (root) await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
